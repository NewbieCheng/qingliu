import React, { useEffect, useState } from "react";
import { PageHeader } from "@/shared/ui/PageHeader.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import { Link } from "@/shared/router/index.js";
import {
  getCase,
  generalParse,
  listParsePresets,
} from "@/features/case/api.js";
import "./parse-page.css";

// 通用解析工具（L3/L5）：对已抽正文做定向提取。
// 结果用 <iframe sandbox srcdoc> 渲染 Markdown→HTML，隔离脚本，防 XSS——
// 模型输出不可信，绝不用 dangerouslySetInnerHTML 直接插进主文档。
function markdownToHtml(md) {
  if (!md) return "";
  const esc = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const lines = String(md).split("\n");
  let html = "";
  let inTable = false;
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("|") && t.endsWith("|")) {
      const cells = t
        .slice(1, -1)
        .split("|")
        .map((c) => esc(c.trim()));
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      if (!inTable) {
        html += "<table><tr>" + cells.map((c) => `<th>${c}</th>`).join("") + "</tr>";
        inTable = true;
      } else {
        html += "<tr>" + cells.map((c) => `<td>${c}</td>`).join("") + "</tr>";
      }
    } else {
      if (inTable) { html += "</table>"; inTable = false; }
      if (t.startsWith("### ")) html += `<h3>${esc(t.slice(4))}</h3>`;
      else if (t.startsWith("## ")) html += `<h2>${esc(t.slice(3))}</h2>`;
      else if (t) html += `<p>${esc(t)}</p>`;
    }
  }
  if (inTable) html += "</table>";
  return html;
}

const PAGE_SHELL = `<!doctype html><meta charset="utf-8"><style>
body{font:14px/1.7 -apple-system,"PingFang SC",sans-serif;color:#183332;padding:8px 16px}
table{border-collapse:collapse;width:100%;margin:8px 0}
th,td{border:1px solid #dce5e3;padding:7px 10px;text-align:left}
th{background:#f3f8f6}h2,h3{color:#176b60}
</style>`;

export function ParsePage({ cid }) {
  const [docs, setDocs] = useState([]);
  const [presets, setPresets] = useState([]);
  const [docId, setDocId] = useState("");
  const [preset, setPreset] = useState("vat_summary");
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([getCase(cid, {}), listParsePresets()])
      .then(([caseData, presetData]) => {
        if (!active) return;
        setDocs(caseData.docs || []);
        setPresets(presetData.presets || []);
        const first = (caseData.docs || [])[0];
        if (first) setDocId(first.id);
      })
      .catch((e) => active && setError(e.message || "加载失败"));
    return () => { active = false; };
  }, [cid]);

  async function handleParse() {
    if (!docId) { toast("请先选择资料", "error"); return; }
    setBusy(true); setError("");
    try {
      const data = await generalParse(cid, docId, preset, question);
      setResult(data.result);
    } catch (e) {
      setError(e.message || "解析失败");
    } finally {
      setBusy(false);
    }
  }

  const html = result ? PAGE_SHELL + markdownToHtml(result.markdown) : "";

  return (
    <section className="parse-page card">
      <PageHeader title="资料解析工具" description="选择资料与想要的结果，AI 按需提取并生成可复制的表格" />
      <p className="muted">
        <Link to={`/clients/${cid}`}>← 返回客户底稿</Link>
      </p>
      <div className="parse-grid">
        <div className="parse-controls">
          <label className="field">
            <span>选择资料</span>
            <select value={docId} onChange={(e) => setDocId(e.target.value)}>
              {docs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>想要什么结果</span>
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
              {presets.map((p) => (
                <option key={p.id} value={p.id} title={p.hint}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          {preset === "custom" ? (
            <label className="field">
              <span>描述你的需求</span>
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="例如：提取每期的销售额和应纳税额，按月排列"
              />
            </label>
          ) : null}
          <button type="button" className="primary" disabled={busy} onClick={handleParse}>
            {busy ? "解析中…" : "开始解析"}
          </button>
          {error ? <p className="error" role="alert">{error}</p> : null}
        </div>
        <div className="parse-output">
          {result ? (
            <>
              {result.note ? <p className="muted">{result.note}</p> : null}
              <div className="parse-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => navigator.clipboard?.writeText(result.markdown || "")}
                >
                  复制结果
                </button>
              </div>
              <iframe
                title="解析结果"
                className="parse-frame"
                sandbox=""
                srcDoc={html}
              />
            </>
          ) : (
            <p className="muted">选择资料与解析目标后，结果会显示在这里。</p>
          )}
        </div>
      </div>
    </section>
  );
}
