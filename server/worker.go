package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"
)

func workerLoop(ctx context.Context, s *Store, app *App) {
	conn, e := s.db.Conn(ctx)
	if e != nil {
		if ctx.Err() == nil {
			log.Fatal("worker connection unavailable")
		}
		return
	}
	defer conn.Close()
	var got int
	for ctx.Err() == nil {
		e = conn.QueryRowContext(ctx, "SELECT GET_LOCK('qingliu:worker',0)").Scan(&got)
		if e != nil {
			if ctx.Err() == nil {
				log.Fatal("worker lock unavailable")
			}
			return
		}
		if got == 1 {
			break
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Second):
		}
	}
	if ctx.Err() != nil {
		return
	}
	defer conn.ExecContext(context.Background(), "SELECT RELEASE_LOCK('qingliu:worker')")
	// Only the holder of the database-wide worker lock may recover interrupted jobs.
	s.exec("UPDATE ql_jobs SET status='queued',message='重启后恢复处理',progress=0,stage='queued' WHERE status='running'")
	for ctx.Err() == nil {
		if e = conn.PingContext(ctx); e != nil {
			if ctx.Err() == nil {
				log.Fatal("worker lost database lock; restart required")
			}
			return
		}
		worked := runOne(ctx, s, app)
		if !worked {
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Second):
			}
		}
	}
}
func runOne(ctx context.Context, s *Store, app *App) (worked bool) {
	var job Object
	defer func() {
		if v := recover(); v != nil {
			if job != nil {
				message := "处理失败，原件保留，请联系管理员"
				if e, ok := v.(error); ok {
					message = e.Error()
				}
				if a, ok := v.(apiError); ok {
					message = a.message
				}
				if len(message) > 900 {
					message = message[:900]
				}
				_, _ = s.db.Exec("UPDATE ql_jobs SET status='failed',message=? WHERE id=?", message, job["id"])
				log.Printf("job %s failed: %T", str(job, "id"), v)
			} else {
				log.Printf("worker query failed: %T", v)
			}
			worked = true
		}
	}()
	job = s.one("SELECT * FROM ql_jobs WHERE status='queued' ORDER BY seq LIMIT 1")
	if job == nil {
		return false
	}
	worked = true
	cid, jid := str(job, "customer_id"), str(job, "id")
	unlock, e := s.lock(ctx, "case:"+cid)
	must(e)
	defer unlock()
	s.jobProgress(jid, "starting", "正在准备处理", 3)
	// tenant_id 必须一起取：授权口径是「资料所属租户」，漏了它团队账号
	// 在后台任务里会被判成无权限（前台能进、后台任务全失败）。
	user := s.one("SELECT id,role,display,tenant_id,tenant_role FROM ql_users WHERE id=? AND active=1", job["user_id"])
	if user == nil || !s.allowed(user, cid) {
		panic(fmt.Errorf("操作账号已失效或没有客户权限"))
	}
	p := obj(str(job, "payload"))
	jobctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	if str(job, "kind") == "upload" {
		path := filepath.Join(s.root, "pending", jid)
		b, e := s.read(path)
		must(e)
		if hash(b) != str(p, "sha") {
			panic(fmt.Errorf("上传文件完整性校验失败"))
		}
		known := s.one("SELECT id FROM ql_documents WHERE customer_id=? AND sha=?", cid, p["sha"])
		if known == nil {
			result, e := parseFile(jobctx, b, str(p, "name"), str(p, "source"), yes(p, "ocr"), func(page, total int) {
				s.jobProgress(jid, "parsing", fmt.Sprintf("正在识别第 %d / %d 页", page, total), parsePercent(page, total))
			})
			must(e)
			did := id()
			must(s.write(filepath.Join(s.root, "uploads", cid, did), b))
			if e = s.insertParse(cid, did, str(p, "name"), str(p, "sha"), result); e != nil {
				os.Remove(filepath.Join(s.root, "uploads", cid, did))
				panic(e)
			}
			s.bump(cid)
			// 解析成功后扣积分：走哪条路径就按哪档单价，价格由后台配置。
			if points, chargeErr := app.chargeParse(jobctx, str(user, "id"), jid, parseBillingTier(result), int(integer(result.Meta["pages"]))); chargeErr == nil && points > 0 {
				s.jobProgress(jid, "charging", "已扣除 "+itoa(points)+" 积分", 98)
			}
		}
		d := s.one("SELECT payload FROM ql_documents WHERE customer_id=? AND sha=?", cid, p["sha"])
		meta := obj(str(d, "payload"))
		state := "done"
		message := "识别完成，请确认资料归属"
		if str(meta, "status") != "success" {
			state = "partial"
			message = "资料已保存，识别未完整通过，请核对提示；未通过的资料不能直接签发正式版本"
		}
		s.exec("UPDATE ql_jobs SET status=?,message=?,stage='done',progress=100 WHERE id=?", state, message, jid)
		must(os.Remove(path))
	} else if str(job, "kind") == "ai_analysis" {
		if app == nil {
			panic(fmt.Errorf("AI 分析执行器未装配"))
		}
		app.runAIAnalysisJob(jobctx, str(user, "id"), cid, p, func(stage, message string, progress int) {
			s.jobProgress(jid, stage, message, progress)
		})
	} else if str(job, "kind") == "report" {
		existing := s.one("SELECT id FROM ql_reports WHERE job_id=?", jid)
		if existing != nil {
			s.exec("UPDATE ql_jobs SET status='done',message='报告已保存',stage='done',progress=100 WHERE id=?", jid)
			return true
		}
		d := s.caseData(cid, str(p, "source"), str(p, "start"), str(p, "end"))
		if integer(nested(d, "customer")["revision"]) != integer(p["revision"]) {
			panic(fmt.Errorf("资料已变化，请重新生成报告"))
		}
		if str(p, "stage") == "formal" {
			if str(user, "role") != "admin" && str(user, "role") != "reviewer" {
				panic(fmt.Errorf("仅复核员或管理员可签发"))
			}
			if !yes(d, "submitted_current") || len(d["problems"].([]string)) > 0 {
				panic(fmt.Errorf("复核条件已变化，请重新提交"))
			}
		}
		s.jobProgress(jid, "rendering", "正在生成PDF、Excel与报告快照", 60)
		must(generateReport(s, cid, jid, d, p))
		s.exec("UPDATE ql_jobs SET status='done',message='报告已保存，可下载',stage='done',progress=100 WHERE id=?", jid)
	} else {
		panic(fmt.Errorf("未知任务类型"))
	}
	s.event(str(user, "id"), cid, str(job, "kind")+"_finished", jid)
	return true
}
