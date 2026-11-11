package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const maxClientParsedRows = 100000

// acceptClientParsedRows 把前端提交的行还原为权威 standard 行。
// 优先用每行 raw（表头→原值）再跑 standard()；不信任前端已算好的金额方向。
func acceptClientParsedRows(rows []Object, source string) ([]Object, error) {
	if len(rows) == 0 {
		return nil, fmt.Errorf("Table has no transactions")
	}
	if len(rows) > maxClientParsedRows {
		return nil, fmt.Errorf("Max 100,000 rows per file. Please split.")
	}
	out := make([]Object, 0, len(rows))
	for i, row := range rows {
		locator := strings.TrimSpace(str(row, "locator"))
		if locator == "" {
			locator = fmt.Sprintf("row:%d", i+2)
		}
		rawJSON := strings.TrimSpace(str(row, "raw"))
		if rawJSON == "" {
			return nil, fmt.Errorf("第 %d 行缺少原始字段", i+1)
		}
		raw := obj(rawJSON)
		if len(raw) == 0 {
			return nil, fmt.Errorf("第 %d 行原始字段无效", i+1)
		}
		out = append(out, standard(raw, source, 0, locator))
	}
	return out, nil
}

func decodeClientRowsJSON(raw string) ([]Object, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, fmt.Errorf("缺少解析结果")
	}
	if len(raw) > 32<<20 {
		return nil, fmt.Errorf("解析结果过大")
	}
	var rows []Object
	if e := json.Unmarshal([]byte(raw), &rows); e != nil {
		return nil, fmt.Errorf("解析结果格式无效")
	}
	return rows, nil
}

// registerUploadParsed 挂载前端拆行入库接口（不进 upload worker 重解析）。
func (a *App) registerUploadParsed(m *http.ServeMux) {
	s := a.s
	m.HandleFunc("POST /api/clients/{cid}/upload-parsed", a.route(func(q *request) {
		q.edit(func(cid string) {
			if e := q.r.ParseMultipartForm(2 << 20); e != nil {
				bad(400, "Upload failed; batch must be under 64MB")
			}
			defer q.r.MultipartForm.RemoveAll()

			source := q.r.FormValue("source")
			require(source == "bank_statement" || source == "wechat_statement" || source == "alipay_statement", "For tables, pick bank, WeChat, or Alipay as source")

			if balance, ok := a.pointBalance(q.r.Context(), str(q.user, "id")); ok && balance <= 0 {
				bad(402, insufficientPointsMessage)
			}

			batch := strings.TrimSpace(q.r.FormValue("batch"))
			if len(batch) > 96 {
				batch = batch[:96]
			}
			if batch != "" {
				if done := s.one("SELECT payload FROM ql_upload_batches WHERE customer_id=? AND batch=?", cid, batch); done != nil {
					q.json(obj(str(done, "payload")))
					return
				}
			}

			files := q.r.MultipartForm.File["file"]
			if len(files) == 0 {
				files = q.r.MultipartForm.File["files"]
			}
			require(len(files) == 1, "本机解析每次提交一份原件")
			f := files[0]
			require(f.Size > 0 && f.Size <= 30<<20, "Each file must be 1 byte–30MB")
			name := filepath.Base(strings.ReplaceAll(f.Filename, "\\", "/"))
			ext := strings.ToLower(filepath.Ext(name))
			require((ext == ".csv" || ext == ".xlsx" || ext == ".docx") && len([]rune(name)) <= 240, "Local parse supports CSV / XLSX / Word (docx) only")

			stream, e := f.Open()
			must(e)
			b, e := io.ReadAll(io.LimitReader(stream, (30<<20)+1))
			stream.Close()
			must(e)
			require(len(b) <= 30<<20, "File exceeds 30MB")
			sha := hash(b)
			require(s.one("SELECT id FROM ql_documents WHERE customer_id=? AND sha=?", cid, sha) == nil, "重复文件：客户已上传此内容")

			rawRows, errRows := decodeClientRowsJSON(q.r.FormValue("rows_json"))
			if errRows != nil {
				bad(400, errRows.Error())
			}
			rows, errAccept := acceptClientParsedRows(rawRows, source)
			if errAccept != nil {
				bad(400, errAccept.Error())
			}

			did := id()
			traceID := did
			if batch != "" {
				traceID = batch
			}
			result := ParseResult{
				Meta: Object{
					"source":       source,
					"status":       "success",
					"issues":       []string{},
					"facts":        []Object{},
					"pages":        0,
					"subject_name": "",
					"coverage":     "",
					"method":       "client-parse",
					"rows":         len(rows),
				},
				Rows: rows,
			}

			path := filepath.Join(s.root, "uploads", cid, did)
			must(s.write(path, b))
			if e = s.insertParse(cid, did, name, sha, result); e != nil {
				_ = os.Remove(path)
				bad(400, "入库失败，请检查表格内容后重试")
			}

			points := int64(0)
			if charged, chargeErr := a.chargeParse(q.r.Context(), str(q.user, "id"), "client-"+traceID, "text", 0); chargeErr == nil {
				points = charged
			}

			s.bump(cid)
			q.event(cid, "upload_parsed", "1")
			out := Object{
				"ok":          true,
				"document_id": did,
				"sha":         sha,
				"rows":        len(rows),
				"points":      points,
				"batch":       batch,
				"method":      "client-parse",
			}
			if batch != "" {
				s.exec("INSERT INTO ql_upload_batches(customer_id,batch,payload) VALUES(?,?,?) ON DUPLICATE KEY UPDATE payload=payload", cid, batch, js(out))
			}
			q.json(out)
		})
	}))
}
