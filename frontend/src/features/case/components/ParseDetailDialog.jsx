import React, { useEffect, useMemo, useState } from "react";
import { Modal } from "@/shared/ui/Modal.jsx";
import { Loading } from "@/shared/ui/Loading.jsx";
import { SOURCES } from "@/shared/lib/constants.js";
import { formatCents } from "@/shared/lib/format.js";
import { useI18n } from "@/shared/i18n/index.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import {
  CopyIcon,
  DownloadIcon,
  SparkIcon,
  TableIcon,
  FileTextIcon,
  ChevronDownIcon,
  InfoIcon,
  AlertIcon,
  CheckIcon,
} from "@/shared/ui/icons.jsx";
import { documentRows } from "../api.js";
import { counterpartyDisplay } from "../lib/counterparty.js";
import { PdfPreviewPane } from "./evidence/PdfPreviewPane.jsx";
import "./parse-detail.css";

// ─────────────────────────────────────────────────────────────
// 解析详情：两页
//   页1「资料信息」——这份文件是什么、抽到了什么、质检有没有问题
//   页2「字段解析核对」——每一笔交易怎么由原件那一行来的，可逐行展开对照
//
// 为什么这么分：业务员真正要做两件事，先判断"这份文件抽对了没有"，
// 再逐笔确认"某一行是不是抽错了"。之前两件事挤在一屏，且银行流水
// 根本没有展示交易行（只认 OCR 转写和表单），于是 1048 笔的文件
// 打开只看到一句"没有可展示的明细"——这才是真正的病。
// ─────────────────────────────────────────────────────────────

function KeyValueTable({ obj }) {
  if (!obj || typeof obj !== "object") return null;
  const entries = Object.entries(obj).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );
  if (!entries.length) return null;
  return (
    <table className="pd-table pd-kv">
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k}>
            <th>{k}</th>
            <td>{typeof v === "object" ? JSON.stringify(v) : String(v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// 原始字段：把 "568 | 2026-05-23 | CNY | -1,000.00 | 5,850.26财付通…"
// 拆成可读的键值，让用户看得出「这一笔是从原件哪一段来的」。
function rawFields(row) {
  const raw = String(row.raw || "").trim();
  if (!raw) return [];
  const parts = raw.split("|").map((s) => s.trim());
  if (parts.length < 2) return [{ label: "原件文本", value: raw }];
  return parts.map((value, i) => ({
    label: `第 ${i + 1} 列`,
    value,
  }));
}

function toMarkdown(doc, meta, generalResult, rows) {
  const lines = [];
  lines.push(`# ${doc?.name || "解析结果"}`);
  lines.push("");
  const info = [
    ["资料来源", SOURCES[meta.source] || "其他"],
    ["页数", meta.pages || 0],
    ["识别笔数", meta.rows || 0],
    ["识别结论", meta.verdict === "ok" ? "识别正常" : meta.verdict === "suspect" ? "需核对" : meta.verdict === "fail" ? "识别失败" : "—"],
    ["解析方式", meta.method || "—"],
  ];
  lines.push("## 资料信息");
  lines.push("");
  lines.push("| 项目 | 值 |");
  lines.push("| --- | --- |");
  for (const [k, v] of info) lines.push(`| ${k} | ${v} |`);
  lines.push("");
  if (meta.doc_type === "form" && meta.form_header) {
    lines.push("## 表单基本信息");
    lines.push("");
    lines.push("| 字段 | 值 |");
    lines.push("| --- | --- |");
    for (const [k, v] of Object.entries(meta.form_header)) {
      if (v === null || v === undefined || v === "") continue;
      lines.push(`| ${k} | ${String(v).replace(/\|/g, "\\|")} |`);
    }
    lines.push("");
  }
  if (meta.checks?.length) {
    lines.push("## 质检结果");
    lines.push("");
    lines.push("| 检查项 | 结果 | 说明 |");
    lines.push("| --- | --- | --- |");
    for (const c of meta.checks) lines.push(`| ${c.field} | ${c.status} | ${c.note} |`);
    lines.push("");
  }
  if (rows?.length) {
    lines.push(`## 字段解析核对（${rows.length} 笔）`);
    lines.push("");
    lines.push("| 页码 | 日期 | 方向 | 收入 | 支出 | 对手方 | 摘要 | 原件原文 |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const r of rows) {
      const dir = r.direction === "income" ? "收入" : r.direction === "expense" ? "支出" : "未确认";
      lines.push(
        `| ${r.page ?? ""} | ${r.date ?? ""} | ${dir} | ${formatCents(r.income)} | ${formatCents(r.expense)} | ${r.counterparty || ""} | ${String(r.memo || "").replace(/\|/g, "\\|")} | ${String(r.raw || "").replace(/\|/g, "\\|")} |`,
      );
    }
    lines.push("");
  }
  if (generalResult?.markdown) {
    lines.push("## AI 提取结果");
    lines.push("");
    lines.push(generalResult.markdown);
    lines.push("");
  }
  return lines.join("\n");
}

function toCSV(meta, generalResult, rows) {
  const out = [["类型", "字段", "值"]];
  if (meta.form_header) {
    for (const [k, v] of Object.entries(meta.form_header)) {
      if (v === null || v === undefined || v === "") continue;
      out.push(["表单", k, String(v)]);
    }
  }
  for (const field of generalResult?.fields || []) {
    if (field?.label) out.push(["AI", field.label, String(field.value ?? "")]);
  }
  if (rows?.length) {
    for (const r of rows) {
      out.push(["交易", "日期", String(r.date ?? "")]);
      out.push(["交易", "方向", r.direction || ""]);
      out.push(["交易", "收入", formatCents(r.income)]);
      out.push(["交易", "支出", formatCents(r.expense)]);
      out.push(["交易", "对手方", String(r.counterparty || "")]);
      out.push(["交易", "摘要", String(r.memo || "")]);
    }
  }
  if (out.length === 1) return "";
  return out
    .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function baseName(name) {
  return String(name || "解析结果").replace(/\.[^.]+$/, "");
}

// 对手方：银行内部交易（取现/归还贷款利息）原件里本来就没有对方，
// 直接写"原件未记载"会让人以为解析漏了。
function CounterpartyText({ row }) {
  const { text, kind } = counterpartyDisplay(row);
  if (kind === "party") return <>{text}</>;
  if (kind === "internal") return <span className="pd-party-internal">{text}</span>;
  return <em className="muted">原件未记载</em>;
}

function verdictTone(v) {
  if (v === "ok") return "ok";
  if (v === "suspect") return "suspect";
  if (v === "fail") return "fail";
  return "unknown";
}

export function ParseDetailDialog({
  cid,
  doc,
  onClose,
  onGeneralParse,
  onRequestReparse,
  generalResult,
  busy,
}) {
  const { t } = useI18n();
  const meta = doc?.meta || {};
  const verdict = meta.verdict;
  const [tab, setTab] = useState("info");
  const [copied, setCopied] = useState(false);
  const [rows, setRows] = useState(null);
  const [rowsError, setRowsError] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [filter, setFilter] = useState("all");
  const [peek, setPeek] = useState(null);
  const [peekMode, setPeekMode] = useState("float");

  useEffect(() => {
    if (!cid || !doc?.id) return undefined;
    let cancelled = false;
    setRows(null);
    setRowsError("");
    documentRows(cid, doc.id)
      .then((payload) => {
        if (!cancelled) setRows(payload.rows || []);
      })
      .catch((err) => {
        if (!cancelled) setRowsError(err.message || t("pd.rows_failed"));
      });
    return () => {
      cancelled = true;
    };
  }, [cid, doc?.id, t]);

  const shown = useMemo(() => {
    if (!rows) return [];
    if (filter === "issues") {
      return rows.filter((r) => r.quality !== "structured" || r.duplicate);
    }
    if (filter === "manual") return rows.filter((r) => r.manual);
    return rows;
  }, [rows, filter]);

  const stats = useMemo(() => {
    if (!rows?.length) return null;
    let income = 0;
    let expense = 0;
    let issues = 0;
    for (const r of rows) {
      income += Number(r.income) || 0;
      expense += Number(r.expense) || 0;
      if (r.quality !== "structured" || r.duplicate) issues += 1;
    }
    return { count: rows.length, income, expense, issues };
  }, [rows]);

  async function handleCopy() {
    const text = toMarkdown(doc, meta, generalResult, rows || []);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function handleExport(kind) {
    if (kind === "csv") {
      const csv = toCSV(meta, generalResult, rows || []);
      if (!csv) return;
      download(`${baseName(doc?.name)}-解析结果.csv`, `\uFEFF${csv}`, "text/csv");
      return;
    }
    download(
      `${baseName(doc?.name)}-解析结果.md`,
      toMarkdown(doc, meta, generalResult, rows || []),
      "text/markdown",
    );
  }

  function handleExplainAction(action) {
    switch (action?.action) {
      case "reparse":
        onRequestReparse?.(doc);
        break;
      case "use_tool":
        onGeneralParse?.(doc);
        break;
      case "decrypt_reupload":
        onClose?.();
        toast("请先在本地去掉 PDF 密码，再重新上传", "error");
        break;
      case "upload_new":
        onClose?.();
        toast("请重新上传一份可读的文件", "error");
        break;
      default:
        toast(action?.hint || "请按提示换一种方式重试", "error");
    }
  }

  const tone = verdictTone(verdict);

  return (
    <Modal title={doc?.name || "解析记录"} onClose={onClose} className="pd-dialog">
      <div className="pd-body">
        {/* 顶部：结论 + 操作 */}
        <div className="pd-head">
          <div className="pd-head-info">
            <span className={`pd-verdict pd-verdict-${tone}`}>
              {tone === "ok" ? <CheckIcon size={13} /> : tone === "unknown" ? <InfoIcon size={13} /> : <AlertIcon size={13} />}
              {verdict === "ok" ? "识别正常" : verdict === "suspect" ? "需核对" : verdict === "fail" ? "识别失败" : "待确认"}
            </span>
            <span className="pd-head-meta">
              {t(SOURCES[meta.source] || "source.other")} · {meta.pages || 0} 页 · {meta.rows || 0} 笔
            </span>
          </div>
          <div className="pd-actions">
            <button type="button" className="btn-outline" onClick={handleCopy} title="复制为 Markdown">
              <CopyIcon />{copied ? "已复制" : "复制"}
            </button>
            <button type="button" className="btn-outline" onClick={() => handleExport("md")} title="导出 Markdown">
              <DownloadIcon size={15} />导出 .md
            </button>
            <button type="button" className="btn-outline" onClick={() => handleExport("csv")} title="导出 CSV">
              <DownloadIcon size={15} />导出 .csv
            </button>
            <button
              type="button"
              className="btn-outline-warning"
              disabled={busy}
              onClick={() => onGeneralParse?.(doc)}
            >
              <SparkIcon />{busy ? "解析中…" : "AI 提取要点"}
            </button>
          </div>
        </div>

        {/* 分页 */}
        <div className="pd-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "info"}
            className={`pd-tab${tab === "info" ? " is-active" : ""}`}
            onClick={() => setTab("info")}
          >
            <FileTextIcon size={14} />资料信息
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "rows"}
            className={`pd-tab${tab === "rows" ? " is-active" : ""}`}
            onClick={() => setTab("rows")}
          >
            <TableIcon size={14} />字段解析核对
            {rows?.length ? <em className="pd-tab-badge">{rows.length}</em> : null}
          </button>
        </div>

        {tab === "info" ? (
          <div className="pd-pane">
            {/* 导诊：有问题才显示，避免正常文件也挂一片黄条 */}
            {meta.explain?.what && tone !== "ok" ? (
              <div className={`pd-explain pd-explain-${tone}`}>
                <div className="pd-explain-body">
                  <strong>{meta.explain.what}</strong>
                  {meta.explain.why ? <p>{meta.explain.why}</p> : null}
                  {meta.rescue_failed ? (
                    <p className="pd-explain-tech">技术原因：{meta.rescue_failed}</p>
                  ) : null}
                </div>
                {meta.explain.actions?.length ? (
                  <div className="pd-explain-actions">
                    {meta.explain.actions.map((action, i) => (
                      <button
                        key={i}
                        type="button"
                        className="btn-outline-warning"
                        title={action.hint}
                        onClick={() => handleExplainAction(action)}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* 摘要卡片 */}
            <section className="pd-section">
              <h4>识别概况</h4>
              <div className="pd-stats">
                <div className="pd-stat">
                  <span className="pd-stat-label">页数</span>
                  <span className="pd-stat-value">{meta.pages || 0}</span>
                </div>
                <div className="pd-stat">
                  <span className="pd-stat-label">笔数</span>
                  <span className="pd-stat-value">{stats?.count ?? meta.rows ?? 0}</span>
                </div>
                <div className={`pd-stat${stats?.issues ? " is-warn" : ""}`}>
                  <span className="pd-stat-label">待核对</span>
                  <span className="pd-stat-value">{stats?.issues ?? 0}</span>
                </div>
                <div className="pd-stat">
                  <span className="pd-stat-label">流入合计</span>
                  <span className="pd-stat-value">{formatCents(stats?.income ?? 0)}</span>
                </div>
                <div className="pd-stat">
                  <span className="pd-stat-label">流出合计</span>
                  <span className="pd-stat-value">{formatCents(stats?.expense ?? 0)}</span>
                </div>
              </div>
            </section>

            {/* 表单类：基本信息 + 栏次 */}
            {meta.doc_type === "form" && meta.form_header ? (
              <>
                <section className="pd-section">
                  <h4>表单基本信息</h4>
                  <KeyValueTable obj={meta.form_header} />
                </section>
                <section className="pd-section">
                  <h4>栏次明细（{(meta.form_lines || []).length} 项）</h4>
                  {meta.form_lines?.length ? (
                    <table className="pd-table">
                      <thead>
                        <tr><th>项目</th><th>栏次</th><th>本月数</th><th>本年累计</th><th>即征即退本月</th><th>即征即退累计</th></tr>
                      </thead>
                      <tbody>
                        {meta.form_lines.map((l, i) => (
                          <tr key={i}>
                            <td>{l.item}</td><td>{l.no}</td><td>{l.general_month}</td>
                            <td>{l.general_year}</td><td>{l.refund_month}</td><td>{l.refund_year}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p className="muted">无栏次明细</p>}
                </section>
              </>
            ) : null}

            {meta.checks?.length ? (
              <section className="pd-section">
                <h4>质检结果</h4>
                <table className="pd-table">
                  <thead><tr><th>检查项</th><th>结果</th><th>说明</th></tr></thead>
                  <tbody>
                    {meta.checks.map((c, i) => (
                      <tr key={i}>
                        <td>{c.field}</td>
                        <td><span className={`pd-chip pd-chip-${c.status}`}>{c.status}</span></td>
                        <td>{c.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}

            {generalResult ? (
              <section className="pd-section">
                <h4>AI 提取结果</h4>
                {generalResult.markdown ? (
                  <pre className="pd-raw">{generalResult.markdown}</pre>
                ) : null}
                {generalResult.note ? <p className="muted">{generalResult.note}</p> : null}
              </section>
            ) : null}

            {meta.issues?.length ? (
              <section className="pd-section">
                <h4>提示</h4>
                {meta.issues.map((issue, i) => <p className="error" key={i}>{issue}</p>)}
              </section>
            ) : null}
          </div>
        ) : (
          <div className="pd-pane">
            {rowsError ? <p className="error">{rowsError}</p> : null}
            {!rows && !rowsError ? <Loading compact text={t("pd.rows_loading")} /> : null}

            {rows ? (
              rows.length ? (
                <div className={peek && peekMode === "dock" ? "pd-with-pdf" : ""}>
                  <div className="pd-left">
                    <div className="pd-rows-bar">
                    <div className="pd-filter">
                      {[
                        ["all", `全部 ${rows.length}`],
                        ["issues", `待核对 ${stats?.issues ?? 0}`],
                        ["manual", `手工新增 ${rows.filter((r) => r.manual).length}`],
                      ].map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          className={`pd-filter-btn${filter === key ? " is-active" : ""}`}
                          onClick={() => setFilter(key)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <span className="muted">
                      点任意一行：展开字段对照，同时在右侧原件上框出这一行
                    </span>
                    </div>

                    <div className="pd-rows">
                    {shown.slice(0, 300).map((row) => {
                      const open = expanded === row.id;
                      const fields = open ? rawFields(row) : [];
                      return (
                        <div className={`pd-row${open ? " is-open" : ""}${peek?.id === row.id ? " is-peeking" : ""}`} key={row.id}>
                          <button
                            type="button"
                            className="pd-row-head"
                            onClick={() => {
                              setExpanded(open ? null : row.id);
                              // 同时把原件面板跳到这一行，形成"左选中、右框住"的呼应。
                              setPeek(row);
                            }}
                            aria-expanded={open}
                          >
                            <span className={`pd-row-caret${open ? " is-open" : ""}`}>
                              <ChevronDownIcon size={13} />
                            </span>
                            <span className="pd-row-page">第 {row.page ?? "—"} 页</span>
                            <span className="pd-row-date">{row.date || "—"}</span>
                            <span className={`pd-row-dir pd-row-dir-${row.direction || "unknown"}`}>
                              {row.direction === "income" ? "收入" : row.direction === "expense" ? "支出" : "未确认"}
                            </span>
                            <span className="pd-row-amount">
                              {formatCents(row.income !== 0 ? row.income : row.expense)}
                            </span>
                            <span className="pd-row-party">
                              <CounterpartyText row={row} />
                            </span>
                            {row.quality !== "structured" ? (
                              <span className="pd-chip pd-chip-suspect">{row.error || "待核对"}</span>
                            ) : null}
                            {row.duplicate ? <span className="pd-chip pd-chip-duplicate">疑似重复</span> : null}
                            {row.manual ? <span className="pd-chip pd-chip-manual">手工</span> : null}
                          </button>
                          {open ? (
                            <div className="pd-row-detail">
                              <div className="pd-row-detail-grid">
                                <div>
                                  <span className="pd-detail-label">摘要 / 备注</span>
                                  <span className="pd-detail-value">{row.memo || "—"}</span>
                                </div>
                                <div>
                                  <span className="pd-detail-label">定位</span>
                                  <span className="pd-detail-value">{row.locator || "—"}</span>
                                </div>
                              </div>
                              <div className="pd-detail-raw">
                                <span className="pd-detail-label">原件原文（按列拆开）</span>
                                {fields.length ? (
                                  <ol className="pd-raw-cols">
                                    {fields.map((f, i) => (
                                      <li key={i}>
                                        <span className="pd-raw-col-no">{f.label}</span>
                                        <span className="pd-raw-col-val">{f.value || "—"}</span>
                                      </li>
                                    ))}
                                  </ol>
                                ) : (
                                  <p className="muted">这份行没有保留原件原文（手工新增或结构化导入）。</p>
                                )}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  {shown.length > 300 ? (
                    <p className="muted pd-rows-more">
                      只显示前 300 行，完整清单请导出 .md / .csv。
                    </p>
                  ) : null}
                  </div>
                  {peek ? (
                    <PdfPreviewPane
                      cid={cid}
                      doc={doc}
                      row={peek}
                      totalPages={meta.pages}
                      onClose={() => setPeek(null)}
                      mode={peekMode}
                      onModeChange={setPeekMode}
                    />
                  ) : null}
                </div>
              ) : (
                <p className="muted">这份文件没有解析出交易行。</p>
              )
            ) : null}
          </div>
        )}
      </div>
    </Modal>
  );
}
