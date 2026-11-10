package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"
)

// sweepStaleJobs 把超时仍停在 queued/running 的任务标成失败。
//
// 历史缺陷：任务失败时没有写 ql_jobs 终态，记录会永久停在 queued，
// busy() 恒真，该客户的上传、核对、报告全部被 409 挡住。启动时和之后
// 每 5 分钟扫一次，把这些僵尸任务收掉，并留下 event 方便回溯。
func sweepStaleJobs(s *Store) {
	rows := s.query("SELECT id,customer_id,user_id,kind,space_kind,space_id FROM ql_jobs WHERE status IN ('queued','running') AND created < DATE_SUB(NOW(6), INTERVAL ? MINUTE)", staleJobMinutes)
	for _, job := range rows {
		jid := str(job, "id")
		message := "任务超时未完成，已自动终止；可重新提交"
		s.exec("UPDATE ql_jobs SET status='failed',message=?,stage='failed',progress=0 WHERE id=?", message, jid)
		// AI 分析还有一张明细表，一起收掉，否则会被 startAIAnalysis 复用。
		s.exec("UPDATE ql_ai_analyses SET status='failed',stage='failed',error=?,completed=NOW(6) WHERE customer_id=? AND status IN ('queued','running','uploading')", message, str(job, "customer_id"))
		s.event(spaceOf(job), str(job, "user_id"), str(job, "customer_id"), "job_timeout", jid)
		log.Printf("swept stale job %s (%s)", jid, str(job, "kind"))
	}
}

func workerLoop(ctx context.Context, s *Store, app *App) {	conn, e := s.db.Conn(ctx)
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
	// 只有持有数据库级 worker 锁的进程才做恢复：
	// ①把上次中断的 running 放回队列；
	// ②把超时仍停在中间态的任务标成失败——历史版本里任务失败时没有写
	//   终态，会永久占着客户，sweepStaleJobs 负责把它们收拾掉。
	s.exec("UPDATE ql_jobs SET status='queued',message='重启后恢复处理',progress=0,stage='queued' WHERE status='running'")
	sweepStaleJobs(s)
	var sweepTick int
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
			sweepTick++
			if sweepTick%300 == 0 {
				sweepStaleJobs(s)
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
				_, _ = s.db.Exec("UPDATE ql_jobs SET status='failed',message=?,stage='failed',progress=0 WHERE id=?", message, job["id"])
				// AI 分析有两张表：任务坞读 ql_jobs，入口卡读 ql_ai_analyses。
				// panic 只写前者时会出现「上面分析中 10%，下面已失败」的错位。
				if str(job, "kind") == "ai_analysis" {
					analysisID := str(obj(str(job, "payload")), "analysis_id")
					if analysisID != "" {
						_, _ = s.db.Exec("UPDATE ql_ai_analyses SET status='failed',stage='failed',error=?,completed=NOW(6) WHERE id=? AND status IN ('queued','running','uploading')", message, analysisID)
					}
				}
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
	// 先抢客户锁再取任务：更新之后 task 才会被标成 running，
	// 因此这里取到的仍然是 queued 的那一条。
	unlock, e := s.lock(ctx, "case:"+cid)
	must(e)
	defer unlock()
	s.jobStart(jid)
	// 空间来自**任务行**，不是账号：ql_users 上已经没有空间列（见 migrations/005），
	// 而 worker 也没有会话。任务在提交时把 space_kind/space_id 记了下来，
	// 按它判权限才不会出现「前台能进、后台任务全失败」。
	user := s.one(`SELECT u.id,u.role,u.display,w.workbench_user_id,w.permissions
 FROM ql_users u LEFT JOIN ql_workbench_accounts w ON w.user_id=u.id
 WHERE u.id=? AND u.active=1`, job["user_id"])
	if user == nil || !s.allowed(jobCustomerAccess(user, spaceOf(job)), cid) {
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
		s.jobFinish(jid, state, message)
		must(os.Remove(path))
	} else if str(job, "kind") == "ai_analysis" {
		if app == nil {
			panic(fmt.Errorf("AI 分析执行器未装配"))
		}
		// AI 分析分支必须自己写终态：之前的版本跑完就直接往下走，
		// ql_jobs.status 停在 queued，busy() 永远为真，整个客户被锁死。
		failed := false
		app.runAIAnalysisJob(jobctx, str(user, "id"), cid, jid, p, func(stage, message string, progress int) {
			if stage == "failed" {
				failed = true
			}
			s.jobProgress(jid, stage, message, progress)
		})
		if !failed {
			s.jobFinish(jid, "done", "AI 辅助分析已完成")
		}
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
		s.jobFinish(jid, "done", "报告已保存，可下载")
	} else {
		panic(fmt.Errorf("未知任务类型"))
	}
	s.event(spaceOf(job), str(user, "id"), cid, str(job, "kind")+"_finished", jid)
	return true
}

// jobCustomerAccess 把任务提交人还原成 scopeWhere 入参（worker 没有会话）。
func jobCustomerAccess(user Object, space spaceRef) customerAccess {
	admin := false
	if perms := parsePermissions(str(user, "permissions")); perms != nil {
		admin = perms[permAdmin]
	} else {
		admin = str(user, "role") == "admin"
	}
	return customerAccess{
		Space:    space,
		UserID:   str(user, "id"),
		WBUserID: integer(user["workbench_user_id"]),
		Admin:    admin,
	}
}
