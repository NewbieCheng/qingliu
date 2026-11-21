import React, { useState } from "react";
import { DOCUMENT_STATUS, SOURCES } from "@/shared/lib/constants.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";
import { FoldPanel } from "@/shared/ui/FoldPanel.jsx";
import { useI18n } from "@/shared/i18n/index.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import { reparseDocument } from "../api.js";
import { DocumentTextDialog } from "./evidence/DocumentTextDialog.jsx";

function caseIdFromPath() {
  const m = window.location.pathname.match(/\/clients\/([^/?]+)/);
  return m ? m[1] : "";
}

const VERDICT_TONE = { ok: "green", suspect: "amber", fail: "red" };

export function DocumentList({ data, onReparsed }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState("");
  // 正在查看正文的文档（null 表示不显示）。
  const [viewing, setViewing] = useState(null);
  if (!data.docs.length) return null;
  const pending = data.docs.filter(
    (document) => document.meta.status !== "success",
  ).length;

  async function handleReparse(doc) {
    setBusy(doc.id);
    try {
      await reparseDocument(caseIdFromPath(), doc.id, "other");
      toast(t("doc.reparse_queued") || "已提交重新识别");
      if (onReparsed) onReparsed();
    } catch (error) {
      toast(error.message || "重新识别失败", "error");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="docs">
      <p className="docs-count">
        {t("upload.docs_header", {
          total: data.docs.length,
          pending: pending > 0 ? t("upload.docs_pending_part", { n: pending }) : "",
        })}
      </p>
      {data.docs.map((document) => {
        const meta = document.meta || {};
        const verdict = meta.verdict;
        const explain = meta.explain;
        const needsAttention = meta.status !== "success" || verdict === "suspect" || verdict === "fail";
        return (
          <FoldPanel
            key={document.id}
            className="doc-fold"
            title={document.name}
            badge={
              <span className="doc-badges">
                {verdict ? (
                  <StatusBadge tone={VERDICT_TONE[verdict] || "default"}>
                    {verdict === "ok" ? "识别正常" : verdict === "suspect" ? "需核对" : "识别失败"}
                  </StatusBadge>
                ) : null}
                <StatusBadge
                  tone={meta.status !== "success" ? "amber" : "default"}
                >
                  {t(DOCUMENT_STATUS[meta.status] || "doc.failed")}
                </StatusBadge>
              </span>
            }
          >
            <p>
              {t("upload.pages_stat", {
                source: t(SOURCES[meta.source] || "source.other"),
                pages: meta.pages || 0,
                rows: meta.rows || 0,
                coverage: meta.coverage || t("upload.unidentified_coverage"),
              })}
            </p>
            {meta.doc_type === "form" && meta.form_header ? (
              <p className="doc-form-note">
                表单解析：{meta.form_header["纳税人名称"] || ""}
                {(meta.form_lines || []).length} 栏次 · 已存结构化字段
              </p>
            ) : null}
            {explain?.what ? (
              <div className="doc-explain" role="status">
                <strong>{explain.what}</strong>
                {explain.why ? <p className="muted">{explain.why}</p> : null}
                {explain.actions?.length ? (
                  <div className="doc-actions">
                    {explain.actions.map((action, i) => (
                      <button
                        type="button"
                        key={i}
                        className="btn-outline-warning"
                        disabled={busy === document.id}
                        onClick={() => handleReparse(document)}
                        title={action.hint}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {meta.issues?.map((issue, index) => (
              <p className="error" key={index}>
                {issue}
              </p>
            ))}
            {meta.facts?.map((fact, index) => (
              <p key={index}>
                {t("case.documents.fact_page", { page: fact.page, kind: fact.kind })}
                <br />
                {fact.text}
              </p>
            ))}
            {needsAttention && !explain?.actions?.length ? (
              <div className="doc-actions">
                <button
                  type="button"
                  className="btn-outline-warning"
                  disabled={busy === document.id}
                  onClick={() => handleReparse(document)}
                >
                  {busy === document.id ? "识别中…" : "重新识别"}
                </button>
              </div>
            ) : null}
            {/* 查看原件正文：按页铺开已提取文字，不渲染 PDF */}
            <div className="doc-actions">
              <button
                type="button"
                className="btn-outline"
                onClick={() => setViewing(document)}
              >
                {t("doc_text.open")}
              </button>
            </div>
          </FoldPanel>
        );
      })}
      {viewing ? (
        <DocumentTextDialog
          cid={caseIdFromPath()}
          doc={viewing}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </div>
  );
}
