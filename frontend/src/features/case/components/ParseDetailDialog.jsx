import React, { useState } from "react";
import { Modal } from "@/shared/ui/Modal.jsx";
import { SOURCES } from "@/shared/lib/constants.js";
import { useI18n } from "@/shared/i18n/index.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import "./parse-detail.css";

// 安全渲染含 <table> 的 OCR/模型文本：把其中的表格块渲染成真表格，
// 表格前后的普通文字（表头、账号、期间、标记等）保留为段落。
// OCR/模型输出不可信，绝不用 dangerouslySetInnerHTML 直接注入主文档；
// 只解析 tr/td/th 且对内容做标签剥离（React 文本节点天然转义）。
function renderTableBlock(block) {
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(block)) !== null) {
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells = [];
    let c;
    while ((c = cellRe.exec(m[1])) !== null) {
      cells.push(c[1].replace(/<[^>]+>/g, "").trim());
    }
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) return null;
  return (
    <table className="pd-table">
      <tbody>
        {rows.map((cells, i) => (
          <tr key={i}>
            {cells.map((cell, j) =>
              i === 0 ? <th key={j}>{cell}</th> : <td key={j}>{cell}</td>,
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TableSource({ html }) {
  const text = String(html || "");
  const tableRe = /<table[^>]*>[\s\S]*?<\/table>/gi;
  const parts = [];
  let last = 0;
  let m;
  let hasTable = false;
  while ((m = tableRe.exec(text)) !== null) {
    hasTable = true;
    const before = text.slice(last, m.index).trim();
    if (before) parts.push(<p className="pd-text" key={`t${last}`}>{before}</p>);
    const table = renderTableBlock(m[0]);
    if (table) parts.push(<React.Fragment key={`b${m.index}`}>{table}</React.Fragment>);
    last = m.index + m[0].length;
  }
  const after = text.slice(last).trim();
  if (after) parts.push(<p className="pd-text" key={`a${last}`}>{after}</p>);
  if (!hasTable) return <pre className="pd-raw">{text.trim()}</pre>;
  return <div className="pd-mixed">{parts}</div>;
}

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

function MarkdownTable({ md }) {
  if (!md) return null;
  // 极简：把 Markdown 表格源码交给 TableSource（它认 <table> 不认 |），
  // 所以这里做一层 | → <table> 的转换后复用安全渲染。
  const lines = String(md).split("\n").filter((l) => l.trim().startsWith("|"));
  if (!lines.length) return <pre className="pd-raw">{md}</pre>;
  const parseRow = (l) =>
    l
      .trim()
      .slice(1, -1)
      .split("|")
      .map((c) => c.trim());
  const header = parseRow(lines[0]);
  const body = lines
    .slice(1)
    .filter((l) => !/^\|[\s:|-]+\|$/.test(l.trim()))
    .map(parseRow);
  return (
    <table className="pd-table">
      <thead>
        <tr>{header.map((h, i) => <th key={i}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {body.map((cells, i) => (
          <tr key={i}>{cells.map((c, j) => <td key={j}>{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

// 复制/导出：把结果整理成纯文本（Markdown），不含 HTML 标签。
function toMarkdown(doc, meta, generalResult) {
  const lines = [];
  lines.push(`# ${doc?.name || "解析结果"}`);
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
    if (meta.form_lines?.length) {
      lines.push(`## 栏次明细（${meta.form_lines.length} 项）`);
      lines.push("");
      lines.push("| 项目 | 栏次 | 本月数 | 本年累计 | 即征即退本月 | 即征即退累计 |");
      lines.push("| --- | --- | --- | --- | --- | --- |");
      for (const l of meta.form_lines) {
        lines.push(`| ${l.item} | ${l.no} | ${l.general_month} | ${l.general_year} | ${l.refund_month} | ${l.refund_year} |`);
      }
      lines.push("");
    }
  }
  if (meta.checks?.length) {
    lines.push("## 质检结果");
    lines.push("");
    lines.push("| 检查项 | 结果 | 说明 |");
    lines.push("| --- | --- | --- |");
    for (const c of meta.checks) lines.push(`| ${c.field} | ${c.status} | ${c.note} |`);
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

// CSV 只需要字段键值对，表格类明细用 md 更合适。
function toCSV(meta, generalResult) {
  const rows = [["类型", "字段", "值"]];
  if (meta.form_header) {
    for (const [k, v] of Object.entries(meta.form_header)) {
      if (v === null || v === undefined || v === "") continue;
      rows.push(["表单", k, String(v)]);
    }
  }
  for (const field of generalResult?.fields || []) {
    if (field?.label) rows.push(["AI", field.label, String(field.value ?? "")]);
  }
  if (rows.length === 1) return "";
  return rows
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

export function ParseDetailDialog({ doc, onClose, onGeneralParse, onRequestReparse, generalResult, busy }) {
  const { t } = useI18n();
  const meta = doc?.meta || {};
  const verdict = meta.verdict;
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const text = toMarkdown(doc, meta, generalResult);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // 非安全上下文（http）没有 clipboard API，退回到 textarea 选中复制。
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
      // 复制失败也不要静默：把内容留在可全选的 textarea 里。
      setCopied(false);
    }
  }

  function handleExport(kind) {
    if (kind === "csv") {
      const csv = toCSV(meta, generalResult);
      if (!csv) return;
      download(`${baseName(doc?.name)}-解析结果.csv`, `\uFEFF${csv}`, "text/csv");
      return;
    }
    download(`${baseName(doc?.name)}-解析结果.md`, toMarkdown(doc, meta, generalResult), "text/markdown");
  }

  // 导诊按钮：把后端给的 action 翻成前端能做的事。
  // 认不出的 action 不假装成功，提示用户该怎么做。
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
  return (
    <Modal title={doc?.name || "解析记录"} onClose={onClose} className="pd-dialog">
      <div className="pd-body">
        <div className="pd-toolbar">
          <span>
            {t(SOURCES[meta.source] || "source.other")} · {meta.pages || 0} 页 · {meta.rows || 0} 笔
            {verdict ? ` · ${verdict === "ok" ? "识别正常" : verdict === "suspect" ? "需核对" : "识别失败"}` : ""}
          </span>
          <span className="pd-toolbar-actions">
            <button type="button" className="ghost" onClick={handleCopy} title="复制为 Markdown">
              {copied ? "✓ 已复制" : "复制"}
            </button>
            <button type="button" className="ghost" onClick={() => handleExport("md")} title="导出 Markdown">
              导出 .md
            </button>
            <button type="button" className="ghost" onClick={() => handleExport("csv")} title="导出 CSV">
              导出 .csv
            </button>
            <button
              type="button"
              className="btn-outline-warning"
              disabled={busy}
              onClick={() => onGeneralParse?.(doc)}
            >
              {busy ? "解析中…" : "AI 提取要点"}
            </button>
          </span>
        </div>

        {meta.explain?.what ? (
          <div className={`pd-explain pd-explain-${verdict === "fail" ? "fail" : verdict === "suspect" ? "suspect" : "ok"}`}>
            <div className="pd-explain-body">
              <strong>{meta.explain.what}</strong>
              {meta.explain.why ? <p>{meta.explain.why}</p> : null}
              {/* 兜底失败的真原因也要露出来，否则用户只看到一句概括。 */}
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

        {generalResult ? (
          <section className="pd-section">
            <h4>AI 提取结果</h4>
            <MarkdownTable md={generalResult.markdown} />
            {generalResult.note ? <p className="muted">{generalResult.note}</p> : null}
          </section>
        ) : null}

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
                    <td>{c.status}</td>
                    <td>{c.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {meta.facts?.length ? (
          <section className="pd-section">
            <h4>原文 / OCR 转写</h4>
            {meta.facts.map((fact, i) => (
              <div key={i} className="pd-fact">
                <p className="muted">第 {fact.page} 页 · {fact.kind || "转写"}</p>
                <TableSource html={fact.text} />
              </div>
            ))}
          </section>
        ) : null}

        {meta.issues?.length ? (
          <section className="pd-section">
            <h4>提示</h4>
            {meta.issues.map((issue, i) => <p className="error" key={i}>{issue}</p>)}
          </section>
        ) : null}

        {!meta.facts?.length && !meta.form_header && !generalResult ? (
          <p className="muted">这份资料没有可展示的明细，可点「AI 提取要点」生成结构化结果。</p>
        ) : null}
      </div>
    </Modal>
  );
}
