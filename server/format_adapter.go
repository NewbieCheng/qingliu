package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"
)

// 格式适配器：让 AI 为"没见过的表头"生成一条规则，而不是每次都靠 AI 兜底重解析。
//
// 问题：客户换一家银行、换一种导出模板，列名我们没收录，整行就会粘连或缺字段。
// 纯靠 AI 兜底意味着每一份这类文件都要花一次模型调用，且结果不可复用。
//
// 做法：把"表头签名"（各列名归一化后排序拼接）当键，第一次遇到时请 AI 只做一件事——
// 给出「这个列名该映射到哪个标准字段」以及「哪一列需要按什么规则再切分」，
// 存成一条适配器。之后同签名的文件在**本地解析阶段直接命中**，零 AI 调用。
//
// 注意：AI 生成的是**映射规则**（列名 → 标准字段 + 可选切分方式），不是解析结果。
// 它不能执行任意代码，只在白名单字段和几种预置切分器里选，避免把模型输出
// 当成可执行逻辑跑进生产。

const adapterTable = `
CREATE TABLE IF NOT EXISTS ql_parser_adapters (
  signature    VARCHAR(190) NOT NULL PRIMARY KEY,
  sample       TEXT NOT NULL,
  mapping_json TEXT NOT NULL,
  hits         BIGINT NOT NULL DEFAULT 0,
  created      DATETIME NOT NULL,
  updated      DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`

// globalStore 让 parser 在解析阶段能查已学习的适配器。
// 解析函数是纯函数式签名（不接 *App），用包级引用比给每条调用链加参数改动小。
var globalStore *Store

// headerCandidates 复用主流程的"同行拼接 + 最长匹配"逻辑，只求表头候选。
// 单独抽出来是为了在正式建列之前就能算出表头签名，从而查适配器。
func headerCandidates(words []Word, labels map[string]string) []Anchor {
	out := []Anchor{}
	for i, w := range words {
		joined := ""
		last := -1
		best := Anchor{}
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
			out = append(out, best)
		}
	}
	return out
}

// adapterFieldWhitelist：AI 只允许映射到这些标准字段。
var adapterFieldWhitelist = map[string]bool{
	"date": true, "time": true, "amount": true, "income": true, "expense": true,
	"direction": true, "memo": true, "counterparty": true, "counter_account": true,
	"balance": true, "account": true, "account_type": true, "channel": true,
	"transaction_id": true, "payer": true, "payee": true,
	"payer_account": true, "payee_account": true,
	"counter_both": true, "remark": true, "signed": true,
}

// adapterSplitterWhitelist：可选的列内切分器（预置实现，不是 AI 生成的代码）。
var adapterSplitterWhitelist = map[string]bool{
	"account_name": true, // 账号/户名
	"amount_memo":  true, // 金额粘连摘要
	"none":         true,
}

// AdapterMapping 是一条适配器的内容。
type AdapterMapping struct {
	// 列名（归一化后）→ 标准字段
	Aliases map[string]string `json:"aliases"`
	// 标准字段 → 切分器名（见 adapterSplitterWhitelist）
	Splitters map[string]string `json:"splitters"`
	// AI 给这段格式的一句话说明，用于运营排查
	Note string `json:"note"`
}

// headerSignature 把一页的表头列名压成一个稳定键。
// 排序后拼接，所以列顺序变化、换行方式不同也命中同一条适配器。
func headerSignature(labels []string) string {
	clean := make([]string, 0, len(labels))
	for _, l := range labels {
		n := normalize(l)
		if n == "" || n == "序号" || n == "序" {
			continue
		}
		clean = append(clean, n)
	}
	if len(clean) < 3 {
		return ""
	}
	sortStrings(clean)
	return strings.Join(clean, "|")
}

func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}

// loadAdapter 查已学习的适配器。命中即把 hits+1（用于统计哪些格式最常靠 AI 补）。
//
// 注意：表可能尚未创建（老库首次跑新版本），此时必须安静地返回 nil，
// 绝不能让查询异常冒泡到解析主流程——否则整份文件会解析失败。
func (s *Store) loadAdapter(signature string) *AdapterMapping {
	if signature == "" {
		return nil
	}
	row := s.queryOptional("SELECT mapping_json FROM ql_parser_adapters WHERE signature=?", signature)
	if row == nil {
		return nil
	}
	var m AdapterMapping
	if e := json.Unmarshal([]byte(str(row, "mapping_json")), &m); e != nil {
		log.Printf("loadAdapter: 适配器内容损坏 signature=%q err=%v", signature, e)
		return nil
	}
	s.execQuiet("UPDATE ql_parser_adapters SET hits=hits+1, updated=? WHERE signature=?", time.Now(), signature)
	return &m
}

// ensureAdapterTable 启动时建表。缺表时解析会退化为"没有学习过的格式"，
// 功能可用但不会复用，所以启动就建好。
func (s *Store) ensureAdapterTable() {
	s.execQuiet(adapterTable)
}

// saveAdapter 持久化一条 AI 生成的适配器（同签名覆盖）。
func (s *Store) saveAdapter(signature, sample string, m AdapterMapping) {
	if signature == "" {
		return
	}
	b, _ := json.Marshal(m)
	now := time.Now()
	s.exec(adapterTable)
	s.exec(`INSERT INTO ql_parser_adapters(signature,sample,mapping_json,hits,created,updated)
	        VALUES(?,?,?,0,?,?)
	        ON DUPLICATE KEY UPDATE sample=VALUES(sample), mapping_json=VALUES(mapping_json), updated=VALUES(updated)`,
		signature, truncateRunes(sample, 2000), string(b), now, now)
}

// sanitizeAdapter 只保留白名单内的字段与切分器。
// AI 输出一律当不可信数据：认不出的字段直接丢弃，绝不让它影响解析主流程。
func sanitizeAdapter(m AdapterMapping) AdapterMapping {
	out := AdapterMapping{Aliases: map[string]string{}, Splitters: map[string]string{}, Note: m.Note}
	for k, v := range m.Aliases {
		nk := normalize(k)
		if nk == "" {
			continue
		}
		if adapterFieldWhitelist[v] {
			out.Aliases[nk] = v
		}
	}
	for k, v := range m.Splitters {
		if adapterFieldWhitelist[k] && adapterSplitterWhitelist[v] {
			out.Splitters[k] = v
		}
	}
	return out
}

// learnAdapter 请 AI 为一份陌生表头生成映射规则，校验后入库。
// 失败只记日志，不影响本次解析——本次仍走原有的 AI 兜底路径。
func (a *App) learnAdapter(ctx context.Context, userID, source string, headers []string, sample string) {
	signature := headerSignature(headers)
	if signature == "" {
		return
	}
	if s := a.s; s != nil && s.loadAdapter(signature) != nil {
		return // 已经学过，不重复花调用
	}
	prompt := fmt.Sprintf(`你是银行流水解析器的配置生成助手。

下面是一份没见过的流水表头（列名顺序可能与实际不同）和几行样例。
请只输出一段 JSON，说明每个列名对应哪个标准字段，不要输出任何解释文字。

可选标准字段（只能从这里选，不能发明）：
date 交易日期, time 交易时间, amount 单一金额列, income 收入列, expense 支出列,
direction 收支方向, memo 摘要备注, counterparty 对方户名, counter_account 对方账号,
counter_both 对方账号与户名合成一列, balance 账户余额, account 本方账号,
account_type 账户类型, channel 交易渠道, transaction_id 交易单号,
payer 转出方名称, payee 转入方名称, payer_account 转出账号, payee_account 转入账号,
remark 附言, signed 带正负号的金额列

可选切分器（配在 splitters 里，字段名做键）：
account_name 该列是"账号/户名"合并且需要用斜杠拆开
amount_memo 该列是"金额+摘要"粘在一起
none 不切分

输出格式（严格 JSON，不要 Markdown 围栏）：
{"aliases":{"原列名":"标准字段"},"splitters":{"标准字段":"切分器"},"note":"一句话说明这是什么格式"}

资料来源类型：%s
表头：%s
样例行：
%s`, source, strings.Join(headers, " | "), truncateRunes(sample, 1500))

	out, err := a.wbChatText(ctx, userID, "", prompt)
	if err != nil {
		log.Printf("learnAdapter: AI 调用失败 signature=%q err=%v", signature, err)
		return
	}
	raw := bracesOnly(stripCodeFence(out))
	var m AdapterMapping
	if e := json.Unmarshal([]byte(raw), &m); e != nil {
		log.Printf("learnAdapter: AI 输出不是合法 JSON signature=%q err=%v", signature, e)
		return
	}
	m = sanitizeAdapter(m)
	if len(m.Aliases) == 0 {
		return
	}
	a.s.saveAdapter(signature, strings.Join(headers, " | ")+"\n"+sample, m)
	log.Printf("learnAdapter: 已学习适配器 signature=%q fields=%d", signature, len(m.Aliases))
}

// applyAdapter 把适配器的列名映射合并进标签表。
func applyAdapter(labels map[string]string, m *AdapterMapping) {
	if m == nil {
		return
	}
	for alias, field := range m.Aliases {
		// 已有硬编码别名优先：AI 学到的只补空缺，不覆盖人工确认过的映射。
		if _, exists := labels[alias]; !exists {
			labels[alias] = field
		}
	}
}
