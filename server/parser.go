package main

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/xml"
	"errors"
	"fmt"
	"github.com/xuri/excelize/v2"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

type ParseResult struct {
	Meta Object
	Rows []Object
}
type Word struct {
	X    float64 `xml:"xMin,attr"`
	Y    float64 `xml:"yMin,attr"`
	X2   float64 `xml:"xMax,attr"`
	Y2   float64 `xml:"yMax,attr"`
	Text string  `xml:",chardata"`
}
type Anchor struct {
	Key  string
	X, Y float64
	Name string
	Left float64
}

type PDFPage struct {
	Items  []Word  `xml:"-"`
	Width  float64 `xml:"width,attr"`
	Height float64 `xml:"height,attr"`
	Flows  []struct {
		Blocks []struct {
			Lines []struct {
				Words []Word `xml:"word"`
			} `xml:"line"`
		} `xml:"block"`
	} `xml:"flow"`
}
type PDFXML struct {
	Pages []PDFPage `xml:"body>doc>page"`
}

func (p PDFPage) words() []Word {
	if p.Items != nil {
		return p.Items
	}
	out := []Word{}
	for _, f := range p.Flows {
		for _, b := range f.Blocks {
			for _, l := range b.Lines {
				out = append(out, l.Words...)
			}
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if abs(out[i].Y-out[j].Y) < 1 {
			return out[i].X < out[j].X
		}
		return out[i].Y < out[j].Y
	})
	return out
}
func abs(n float64) float64 {
	if n < 0 {
		return -n
	}
	return n
}
func command(ctx context.Context, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	var out, stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr
	if e := cmd.Run(); e != nil {
		return nil, fmt.Errorf("%s 处理未成功，请检查文件或安装依赖", name)
	}
	return out.Bytes(), nil
}
func parseFile(ctx context.Context, b []byte, name, source string, ocr bool, progress func(int, int)) (ParseResult, error) {
	result := ParseResult{Object{"source": source, "status": "success", "issues": []string{}, "facts": []Object{}, "pages": 0, "subject_name": "", "coverage": "", "method": "standard-import"}, []Object{}}
	ext := strings.ToLower(filepath.Ext(name))
	if ext != ".pdf" {
		if source != "bank_statement" && source != "wechat_statement" && source != "alipay_statement" {
			return result, errors.New("标准表格请选择银行卡、微信或支付宝来源")
		}
		var records [][]string
		if ext == ".csv" {
			r := csv.NewReader(strings.NewReader(strings.TrimPrefix(string(b), "\ufeff")))
			r.FieldsPerRecord = -1
			var e error
			records, e = r.ReadAll()
			if e != nil {
				return result, errors.New("CSV须为UTF-8编码且格式正确")
			}
		} else if ext == ".xlsx" {
			f, e := excelize.OpenReader(bytes.NewReader(b), excelize.Options{UnzipSizeLimit: 100 << 20, UnzipXMLSizeLimit: 16 << 20})
			if e != nil {
				return result, errors.New("Excel文件无效或解压超过100MB")
			}
			defer f.Close()
			sheet := f.GetSheetList()
			if len(sheet) == 0 {
				return result, errors.New("空Excel")
			}
			records, e = f.GetRows(sheet[0])
			if e != nil {
				return result, e
			}
		} else {
			return result, errors.New("仅支持PDF、CSV、XLSX")
		}
		if len(records) > 100001 {
			return result, errors.New("单文件最多10万行，请拆分")
		}
		if len(records) > 0 && len(records[0]) > 0 && strings.Contains(records[0][0], "原始流水") {
			records = records[1:]
		}
		if len(records) < 2 {
			return result, errors.New("表格没有交易记录")
		}
		for i, r := range records[1:] {
			raw := Object{}
			nonempty := false
			for j, k := range records[0] {
				if j < len(r) {
					raw[k] = r[j]
					if strings.TrimSpace(r[j]) != "" {
						nonempty = true
					}
				}
			}
			if nonempty {
				result.Rows = append(result.Rows, standard(raw, source, 0, fmt.Sprintf("row:%d", i+2)))
			}
		}
	} else {
		dir, e := os.MkdirTemp("", "qingliu-parse-")
		if e != nil {
			return result, e
		}
		defer os.RemoveAll(dir)
		must(os.Chmod(dir, 0700))
		file := filepath.Join(dir, "source.pdf")
		if e = os.WriteFile(file, b, 0600); e != nil {
			return result, e
		}
		info, e := command(ctx, "pdfinfo", file)
		if e != nil {
			return result, e
		}
		pageMatch := regexp.MustCompile(`(?m)^Pages:\s+(\d+)`).FindStringSubmatch(string(info))
		if len(pageMatch) < 2 {
			return result, errors.New("无法读取PDF页数")
		}
		var count int
		fmt.Sscan(pageMatch[1], &count)
		if count < 1 || count > 500 {
			return result, errors.New("PDF须为1至500页")
		}
		if regexp.MustCompile(`(?m)^Encrypted:\s+yes`).Match(info) {
			return result, errors.New("请先解密PDF")
		}
		data, e := command(ctx, "pdftotext", "-bbox-layout", "-enc", "UTF-8", file, "-")
		if e != nil {
			return result, e
		}
		var doc PDFXML
		if e = xml.Unmarshal(data, &doc); e != nil {
			return result, e
		}
		if len(doc.Pages) != count {
			return result, errors.New("PDF页数与提取结果不一致")
		}
		result.Meta["pages"] = count
		result.Meta["method"] = "Poppler/labelled-coordinates"
		first := ""
		for i, p := range doc.Pages {
			if i >= 2 {
				break
			}
			for _, w := range p.words() {
				first += w.Text + " "
			}
		}
		compact := normalize(first)
		if contains(compact, "中国工商银行借记账户历史明细") {
			rotated, e := command(ctx, "mutool", "draw", "-q", "-F", "stext", "-o", "-", file)
			if e != nil {
				return result, e
			}
			pages, e := mupdfPages(rotated)
			if e != nil {
				return result, e
			}
			if len(pages) != count {
				return result, errors.New("旋转PDF页数不一致")
			}
			doc.Pages = pages
		}

		detected := source
		if contains(compact, "微信支付交易明细证明") {
			detected = "wechat_statement"
		} else if contains(compact, "支付宝") && contains(compact, "交易流水证明") {
			detected = "alipay_statement"
		} else if contains(compact, "信用报告", "征信报告") {
			detected = "credit_report"
		} else if contains(compact, "银行", "个人账户交易明细") {
			detected = "bank_statement"
		}
		result.Meta["source"] = detected
		if source != "other" && detected != "other" && source != detected {
			return result, errors.New("内容类型与所选来源冲突")
		}
		source = detected
		owner := regexp.MustCompile(`(?:户名|客户姓名|兹证明)[:：]?\s*([^\s（(]{1,30})`).FindStringSubmatch(first)
		if len(owner) > 1 {
			result.Meta["subject_name"] = owner[1]
		}
		account := ""
		am := regexp.MustCompile(`(?:账户|借记卡号|账号|卡号)[:：]?\s*(\d{8,})`).FindStringSubmatch(first)
		if len(am) > 1 {
			account = am[1]
		}
		dates := dateRE.FindAllString(first, -1)
		if len(dates) >= 2 {
			result.Meta["coverage"] = dates[0] + " / " + dates[1]
		} else {
			m := regexp.MustCompile(`(\d{8})\s*-\s*(\d{8})`).FindStringSubmatch(first)
			if len(m) == 3 {
				result.Meta["coverage"] = compactDate(m[1]) + " / " + compactDate(m[2])
			}
		}
		issues := []string{}
		facts := []Object{}
		textPages := 0
		var walletLayout []Anchor
		for i, p := range doc.Pages {
			if e = ctx.Err(); e != nil {
				return result, e
			}
			progress(i+1, count)
			words := p.words()
			if len(words) == 0 {
				if ocr && (source == "credit_report" || source == "other") {
					prefix := filepath.Join(dir, fmt.Sprintf("ocr-%d", i+1))
					_, renderErr := command(ctx, "pdftoppm", "-f", fmt.Sprint(i+1), "-singlefile", "-scale-to", "2200", "-png", file, prefix)
					if renderErr == nil {
						txt, ocrErr := command(ctx, "tesseract", prefix+".png", "stdout", "-l", "chi_sim+eng")
						if ocrErr == nil {
							facts = append(facts, Object{"page": i + 1, "text": string(txt), "kind": "OCR候选，需对照原页人工核对"})
						}
						os.Remove(prefix + ".png")
					}
				}
				issues = append(issues, fmt.Sprintf("第%d页无文本；扫描件须人工核对，OCR不自动生成金融结论", i+1))
				continue
			}
			textPages++
			if source == "credit_report" {
				lines := pageLines(words)
				for _, line := range lines {
					if contains(normalize(line), "报告日期", "报告时间", "未结清", "贷款余额", "逾期", "查询", "呆账", "代偿", "账户数") {
						facts = append(facts, Object{"page": i + 1, "text": line, "kind": "原文候选事实/待人工确认"})
					}
				}
				continue
			}
			if source == "other" {
				issues = append(issues, fmt.Sprintf("第%d页未分类，请人工核对", i+1))
				continue
			}
			rows, pageIssues := parsePage(p, source, i+1, str(result.Meta, "subject_name"), account, &walletLayout)
			result.Rows = append(result.Rows, rows...)
			issues = append(issues, pageIssues...)
		}
		result.Meta["facts"] = facts
		result.Meta["issues"] = issues
		result.Meta["text_pages"] = textPages
		if len(issues) > 0 {
			result.Meta["status"] = "partial"
		}
		if textPages == 0 {
			result.Meta["status"] = "partial"
		}
		if source != "credit_report" && len(result.Rows) == 0 {
			result.Meta["status"] = "failed"
		}
	}
	for _, t := range result.Rows {
		if str(t, "quality") == "invalid" {
			result.Meta["status"] = "partial"
			result.Meta["issues"] = appendStrings(result.Meta["issues"], "部分交易字段无效，请核对原件")
			break
		}
	}
	result.Meta["rows"] = len(result.Rows)
	return result, nil
}
func appendStrings(v any, s string) []string {
	r := []string{}
	for _, x := range list(v) {
		r = append(r, text(x))
	}
	return append(r, s)
}

var dateRE = regexp.MustCompile(`\d{4}-\d{2}-\d{2}`)
var date8RE = regexp.MustCompile(`^\d{8}$`)
var timeRE = regexp.MustCompile(`\d{2}:\d{2}:\d{2}`)

func compactDate(s string) string {
	if len(s) == 8 {
		return s[:4] + "-" + s[4:6] + "-" + s[6:]
	}
	return s
}
func pageLines(words []Word) []string {
	out := []string{}
	var y float64 = -100
	for _, w := range words {
		if abs(w.Y-y) > 3 {
			out = append(out, w.Text)
			y = w.Y
		} else {
			out[len(out)-1] += " " + w.Text
		}
	}
	return out
}

// Header labels determine columns; unrecognized layouts never guess monetary direction.
func parsePage(p PDFPage, source string, page int, owner, account string, walletLayout *[]Anchor) ([]Object, []string) {
	words := p.words()
	labels := map[string]string{}
	for k, aa := range aliases {
		for _, a := range append([]string{k}, aa...) {
			labels[normalize(a)] = k
		}
	}
	for label, key := range map[string]string{"交易单号": "transaction_id", "交易时间": "date", "交易类型": "memo", "收/支": "direction", "支付方式": "channel", "交易对方": "counterparty", "交易金额(元)": "amount", "金额(元)": "amount", "收入/支出金额": "signed", "交易金额(借:-，贷:)": "signed", "交易金额(借:-,贷:)": "signed", "本次余额": "balance", "账户余额": "balance", "余额": "balance", "交易附言": "remark", "附言": "remark", "对手信息": "counterparty", "记账时间": "time", "记账日期": "date", "业务摘要": "memo", "收支": "direction"} {
		labels[normalize(label)] = key
	}
	for label, key := range map[string]string{"收/支/其他": "direction", "交易方式": "channel", "商户单号": "merchant_id", "商品说明": "memo", "收/付款方式": "channel", "交易订单号": "transaction_id", "商家订单号": "merchant_id"} {
		labels[normalize(label)] = key
	}
	if source == "alipay_statement" {
		labels[normalize("交易时间")] = "date"
	}
	if source == "bank_statement" {
		labels[normalize("交易时间")] = "time"
	}
	if source == "bank_statement" {
		for label, key := range map[string]string{"账号": "account", "地区": "ignore_region", "币种": "ignore_currency", "钞汇": "ignore_cash", "储种": "ignore_deposit", "序号": "ignore_sequence"} {
			labels[normalize(label)] = key
		}
	}
	candidates := []Anchor{}
	// Join fragmented Chinese labels on the same baseline, taking the longest recognized label.
	for i, w := range words {
		joined := ""
		best := Anchor{}
		last := -1
		for j := i; j < len(words) && j < i+12; j++ {
			v := words[j]
			if abs(v.Y-w.Y) > 3 || (j > i && v.X-words[j-1].X2 > 15) {
				break
			}
			joined += v.Text
			if k, ok := labels[normalize(joined)]; ok {
				best = Anchor{k, (w.X + v.X2) / 2, w.Y, joined, w.X}
				last = j
			}
		}
		if last >= i {
			candidates = append(candidates, best)
		}
	}
	best := []Anchor{}
	for _, a := range candidates {
		if a.Key != "date" {
			continue
		}
		group := []Anchor{}
		used := map[string]bool{}
		for _, b := range candidates {
			if abs(a.Y-b.Y) < 5 && !used[b.Key] {
				group = append(group, b)
				used[b.Key] = true
			}
		}
		if len(group) > len(best) {
			best = group
		}
	}
	inherited := false
	if len(best) < 4 && (source == "wechat_statement" || source == "alipay_statement") && len(*walletLayout) >= 8 {
		best = append([]Anchor{}, (*walletLayout)...)
		inherited = true
	}
	if len(best) < 4 {
		return nil, []string{fmt.Sprintf("第%d页缺少明确表头，请核对或导入标准CSV", page)}
	}
	sort.Slice(best, func(i, j int) bool { return best[i].X < best[j].X })
	if !inherited && (source == "wechat_statement" || source == "alipay_statement") {
		*walletLayout = append([]Anchor{}, best...)
	}
	bounds := []float64{0}
	for i := 0; i < len(best)-1; i++ {
		if source == "alipay_statement" {
			bounds = append(bounds, best[i+1].Left)
		} else {
			bounds = append(bounds, (best[i].X+best[i+1].X)/2)
		}
	}
	bounds = append(bounds, p.Width+1)
	dateCol := -1
	for i, a := range best {
		if a.Key == "date" {
			dateCol = i
		}
	}
	headerY := best[0].Y
	if inherited {
		headerY = -10
	}
	starts := []Word{}
	for _, w := range words {
		cx := (w.X + w.X2) / 2
		if w.Y <= headerY+4 {
			continue
		}
		if dateCol >= 0 && cx >= bounds[dateCol] && cx < bounds[dateCol+1] && (dateRE.MatchString(w.Text) || date8RE.MatchString(w.Text)) {
			starts = append(starts, w)
		}

	}
	sort.Slice(starts, func(i, j int) bool { return starts[i].Y < starts[j].Y })
	unique := []Word{}
	for _, w := range starts {
		if len(unique) == 0 || abs(w.Y-unique[len(unique)-1].Y) > 4 {
			unique = append(unique, w)
		}
	}
	starts = unique
	if len(starts) == 0 {
		compact := ""
		for _, w := range words {
			compact += w.Text
		}
		if contains(normalize(compact), "盖章") && !dateRE.MatchString(compact) {
			return nil, nil
		}
		return nil, []string{fmt.Sprintf("第%d页未找到可识别交易行，请人工核对", page)}
	}
	out := []Object{}
	issues := []string{}
	for i, start := range starts {
		bottom := p.Height - 20
		if i+1 < len(starts) {
			bottom = starts[i+1].Y - 2
		} else if len(starts) > 1 && source == "bank_statement" {
			gap := starts[len(starts)-1].Y - starts[len(starts)-2].Y
			bottom = start.Y + gap - 2
		}
		if i == len(starts)-1 && (source == "wechat_statement" || source == "alipay_statement") {
			for _, w := range words {
				v := normalize(w.Text)
				if w.Y > start.Y && w.X < p.Width*0.2 && (v == "说明:" || v == "注:" || v == "说明" || strings.HasPrefix(v, "特别说明:")) {
					if w.Y < bottom {
						bottom = w.Y - 1
					}
				}
			}
		}
		cells := make([]string, len(best))
		for _, w := range words {
			if w.Y < start.Y-2 || w.Y >= bottom {
				continue
			}
			x := (w.X + w.X2) / 2
			for j := range best {
				if bounds[j] <= x && x < bounds[j+1] {
					cells[j] += w.Text
					break
				}
			}
		}
		raw := Object{}
		for j, a := range best {
			raw[a.Key] = cells[j]
		}
		raw["raw_cells"] = strings.Join(cells, " | ")
		d := dateRE.FindString(str(raw, "date"))
		if d == "" {
			v := regexp.MustCompile(`\d{8}`).FindString(str(raw, "date"))
			d = compactDate(v)
		}
		originalTime := str(raw, "time")
		raw["time"] = timeRE.FindString(str(raw, "date") + " " + str(raw, "time"))
		if str(raw, "time") == "" && regexp.MustCompile(`^\d{6}$`).MatchString(originalTime) {
			raw["time"] = originalTime[:2] + ":" + originalTime[2:4] + ":" + originalTime[4:]
		}
		if source == "wechat_statement" {
			if tid := regexp.MustCompile(`^\d{15,}`).FindString(str(raw, "transaction_id")); tid != "" {
				raw["transaction_id"] = tid
			}
		}

		raw["date"] = d
		raw["memo"] = str(raw, "memo") + " " + str(raw, "remark")
		raw["account"] = account
		if source == "bank_statement" {
			signed := str(raw, "signed")
			if signed == "" && str(raw, "direction") == "" && str(raw, "income") == "" && str(raw, "expense") == "" {
				// Signed semantics are accepted only for the explicitly supported labelled bank formats.
				pageText := normalize(strings.Join(pageLines(words), ""))
				if contains(pageText, "中国农业银行账户活期交易明细清单", "中国银行交易流水明细清单", "个人账户交易明细") {
					signed = str(raw, "amount")
				}
			}
			if signed != "" {
				n, e := cents(signed)
				if e == nil {
					raw["direction"] = "收入"
					if n < 0 {
						raw["direction"] = "支出"
						n = -n
					} else if n == 0 {
						raw["direction"] = "不计收支"
					}
					raw["amount"] = money(n)
				} else {
					raw["direction"] = "未知"
				}
			}
		}
		if source == "bank_statement" {
			for _, key := range []string{"counterparty", "counter_account", "remark"} {
				if regexp.MustCompile(`^[-—]+$`).MatchString(str(raw, key)) {
					raw[key] = ""
				}
			}
		}
		t := standard(raw, source, page, fmt.Sprintf("pdf:row:%d", i+1))
		t["raw"] = raw["raw_cells"]
		t["account_holder"] = owner
		if n, e := cents(str(raw, "balance")); e == nil {
			t["balance"] = n
		}
		out = append(out, t)
	}
	allText := strings.Join(pageLines(words), " ")
	for _, control := range []struct{ Field, Pattern string }{{"income", `(?:本页收入算术合计|贷方发生数)[:：]?\s*([\d,.]+)`}, {"expense", `(?:本页支出算术合计|借方发生数)[:：]?\s*([\d,.]+)`}} {
		m := regexp.MustCompile(control.Pattern).FindStringSubmatch(allText)
		if len(m) > 1 {
			n, e := cents(m[1])
			var actual int64
			for _, t := range out {
				actual += integer(t[control.Field])
			}
			if e != nil || n != actual {
				issues = append(issues, fmt.Sprintf("第%d页%s控制总额核对未通过", page, control.Field))
			}
		}
	}
	return out, issues
}
func pdfPage(ctx context.Context, b []byte, page int) ([]byte, error) {
	if page < 1 || page > 500 {
		return nil, errors.New("无效页码")
	}
	dir, e := os.MkdirTemp("", "qingliu-page-")
	if e != nil {
		return nil, e
	}
	defer os.RemoveAll(dir)
	must(os.Chmod(dir, 0700))
	path := filepath.Join(dir, "source.pdf")
	if e = os.WriteFile(path, b, 0600); e != nil {
		return nil, e
	}
	prefix := filepath.Join(dir, "page")
	if _, e = command(ctx, "pdftoppm", "-f", fmt.Sprint(page), "-singlefile", "-scale-to", "1600", "-png", path, prefix); e != nil {
		return nil, e
	}
	return os.ReadFile(prefix + ".png")
}
func parseTimeout() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 10*time.Minute)
}

// MuPDF normalizes rotated ICBC pages and exposes text direction, so diagonal watermarks are excluded.
func mupdfPages(b []byte) ([]PDFPage, error) {
	var doc struct {
		Pages []struct {
			Width  float64 `xml:"width,attr"`
			Height float64 `xml:"height,attr"`
			Blocks []struct {
				Lines []struct {
					BBox  string `xml:"bbox,attr"`
					Dir   string `xml:"dir,attr"`
					Fonts []struct {
						Chars []struct {
							C string `xml:"c,attr"`
						} `xml:"char"`
					} `xml:"font"`
				} `xml:"line"`
			} `xml:"block"`
		} `xml:"page"`
	}
	if e := xml.Unmarshal(b, &doc); e != nil {
		return nil, e
	}
	pages := []PDFPage{}
	for _, p := range doc.Pages {
		words := []Word{}
		for _, block := range p.Blocks {
			for _, line := range block.Lines {
				if line.Dir != "1 0" {
					continue
				}
				var x, y, x2, y2 float64
				if _, e := fmt.Sscan(line.BBox, &x, &y, &x2, &y2); e != nil {
					return nil, e
				}
				s := ""
				for _, font := range line.Fonts {
					for _, c := range font.Chars {
						s += c.C
					}
				}
				if strings.TrimSpace(s) != "" {
					words = append(words, Word{X: x, Y: y, X2: x2, Y2: y2, Text: strings.TrimSpace(s)})
				}
			}
		}
		pages = append(pages, PDFPage{Width: p.Width, Height: p.Height, Items: words})
	}
	return pages, nil
}
