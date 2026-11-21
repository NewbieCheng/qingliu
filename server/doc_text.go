package main

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// 原件正文按页浏览。
//
// 为什么不能直接用文档 payload 里的 extract_text：
// 那份是为了喂给 AI 兜底而截断的（structureRescueMaxInputRunes = 24000 字符）。
// 一份 30 页的银行流水正文远超这个量，截断后只剩前几页——用户点"查看原件正文"
// 会发现后面十几页是空的，比不给这个功能更糟。
// 所以查看时按需从加密原件重新抽取完整正文，按页切分返回。

// docPageText 缓存一份已抽取的完整分页正文。
// 键用文档 sha（内容不可变），所以重新解析同一份文件不会命中旧缓存。
type docPageText struct {
	pages []Object
	total int
	// 无文字层的页（扫描件）页码，前端据此提示"该页需视觉识别"。
	blank []int
	// 正文来自重新抽取（pdf）还是已存文本（stored）。
	source string
}

var (
	docPageCacheMu sync.Mutex
	docPageCache   = map[string]*docPageText{}
)

const docPageCacheLimit = 32

// pdfPageTexts 用 pdftotext -layout 抽全文，按换页符 \f 切页。
// -layout 保留原始行列关系，比裸 pdftotext 可读性好得多。
func pdfPageTexts(ctx context.Context, path string) ([]string, error) {
	out, err := command(ctx, "pdftotext", "-layout", "-enc", "UTF-8", path, "-")
	if err != nil {
		return nil, err
	}
	// pdftotext 每页之间输出一个 \f；末尾通常也有一个，split 后会出现空尾元素。
	parts := strings.Split(string(out), "\f")
	for len(parts) > 0 && strings.TrimSpace(parts[len(parts)-1]) == "" {
		parts = parts[:len(parts)-1]
	}
	return parts, nil
}

// splitMarkedPages 把带【第N页】标记的正文切成按页。
// docx / 表单模板等非 PDF 路径的 extract_text 用这个形态。
var pageMarkRE = regexp.MustCompile(`【第(\d+)页】`)

func splitMarkedPages(text string) []string {
	marks := pageMarkRE.FindAllStringSubmatchIndex(text, -1)
	if len(marks) == 0 {
		return []string{text}
	}
	pages := make([]string, 0, len(marks))
	for i, m := range marks {
		start := m[1] // 标记结尾
		end := len(text)
		if i+1 < len(marks) {
			end = marks[i+1][0]
		}
		pages = append(pages, strings.TrimSpace(text[start:end]))
	}
	return pages
}

// documentPageText 返回某文档按页切分的正文。
func (s *Store) documentPageText(q *request, cid, did string) Object {
	d := s.one("SELECT name,sha,payload FROM ql_documents WHERE customer_id=? AND id=?", cid, did)
	require(d != nil, "Document not found")
	name, sha := str(d, "name"), str(d, "sha")
	meta := obj(str(d, "payload"))
	storedPages := integer(meta["pages"])
	ext := strings.ToLower(filepath.Ext(name))

	docPageCacheMu.Lock()
	cached := docPageCache[sha]
	docPageCacheMu.Unlock()
	if cached != nil {
		return pageTextPayload(cached, name, ext)
	}

	var pages []string
	source := "stored"

	// PDF 走重新抽取，拿到未截断的完整正文。
	if ext == ".pdf" {
		if raw, e := s.read(filepath.Join(s.root, "uploads", cid, did)); e == nil {
			tmp, e2 := os.CreateTemp("", "ql-text-*.pdf")
			if e2 == nil {
				_, werr := tmp.Write(raw)
				tmp.Close()
				if werr == nil {
					ctx, cancel := context.WithTimeout(q.r.Context(), 45*time.Second)
					if texts, xerr := pdfPageTexts(ctx, tmp.Name()); xerr == nil {
						pages = texts
						source = "pdf"
					}
					cancel()
				}
				os.Remove(tmp.Name())
			}
		}
	}
	// 非 PDF，或重新抽取失败：退回已存正文（docx/csv 等本就完整）。
	if len(pages) == 0 {
		text := str(meta, "extract_text")
		if strings.TrimSpace(text) == "" {
			text = str(meta, "ocr_text")
		}
		if strings.TrimSpace(text) == "" {
			return Object{"pages": []Object{}, "total": 0, "source": "none", "name": name}
		}
		pages = splitMarkedPages(text)
		source = "stored"
	}

	// 页数与文档记录对齐：以实际抽到的为准，但不少于声明页数（缺页要如实暴露）。
	total := len(pages)
	if declared := int(storedPages); declared > total {
		total = declared
	}
	out := &docPageText{pages: make([]Object, 0, total), total: total, source: source}
	for i := 0; i < total; i++ {
		text := ""
		if i < len(pages) {
			text = strings.TrimSpace(pages[i])
		}
		if text == "" {
			out.blank = append(out.blank, i+1)
		}
		out.pages = append(out.pages, Object{"page": i + 1, "text": text})
	}

	docPageCacheMu.Lock()
	if len(docPageCache) >= docPageCacheLimit {
		for k := range docPageCache { // 简单淘汰：清空重建，避免复杂的 LRU
			delete(docPageCache, k)
			break
		}
	}
	docPageCache[sha] = out
	docPageCacheMu.Unlock()

	return pageTextPayload(out, name, ext)
}

func pageTextPayload(c *docPageText, name, ext string) Object {
	return Object{
		"name":   name,
		"ext":    ext,
		"pages":  c.pages,
		"total":  c.total,
		"blank":  c.blank,
		"source": c.source,
	}
}
