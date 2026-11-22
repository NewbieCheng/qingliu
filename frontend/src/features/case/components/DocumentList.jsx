import React, { useState } from "react";
import { DOCUMENT_STATUS, SOURCES } from "@/shared/lib/constants.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";
import { FoldPanel } from "@/shared/ui/FoldPanel.jsx";
import { useI18n } from "@/shared/i18n/index.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import { EyeIcon, RefreshIcon } from "@/shared/ui/icons.jsx";
import { reparseDocument } from "../api.js";
import { PdfPreviewPane } from "./evidence/PdfPreviewPane.jsx";

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
        const metaLine = t("upload.pages_stat", {
          source: t(SOURCES[meta.source] || "source.other"),
          pages: meta.pages || 0,
          rows: meta.rows || 0,
          coverage: meta.coverage || t("upload.unidentified_coverage"),
        });
        const hasDetail =
          Boolean(meta.doc_type === "form" && meta.form_header) ||
          Boolean(explain?.what) ||
          Boolean(meta.issues?.length) ||
          Boolean(meta.facts?.length);

        const badges = (
          <span className="doc-badges">
            {verdict ? (
              <StatusBadge tone={VERDICT_TONE[verdict] || "default"}>
                {verdict === "ok" ? "识别正常" : verdict === "suspect" ? "需核对" : "识别失败"}
              </StatusBadge>
            ) : null}
            <StatusBadge tone={meta.status !== "success" ? "amber" : "default"}>
              {t(DOCUMENT_STATUS[meta.status] || "doc.failed")}
            </StatusBadge>
          </span>
        );

        const openBtn = (
          <button
            type="button"
            className="btn-outline btn-compact"
            onClick={() => setViewing(document)}
          >
            <EyeIcon size={13} />
            {t("doc_text.open")}
          </button>
        );

        // 无额外说明时整行平铺，不再套折叠；有导诊/问题才展开。
        if (!hasDetail) {
          return (
            <div className="doc-row" key={document.id}>
              <div className="doc-row-main">
                <span className="doc-row-name" title={document.name}>
                  {document.name}
                </span>
                {badges}
                <span className="doc-fold-meta" title={metaLine}>
                  {metaLine}
                </span>
              </div>
              <div className="doc-actions">
                {needsAttention ? (
                  <button
                    type="button"
                    className="btn-outline-warning btn-compact"
                    disabled={busy === document.id}
                    onClick={() => handleReparse(document)}
                  >
                    <RefreshIcon size={13} />
                    {busy === document.id ? "识别中…" : "重新识别"}
                  </button>
                ) : null}
                {openBtn}
              </div>
            </div>
          );
        }

        return (
          <FoldPanel
            key={document.id}
            className="doc-fold"
            title={document.name}
            badge={badges}
            actions={openBtn}
            defaultOpen={needsAttention}
          >
            <div className="doc-fold-line">
              <p className="doc-fold-meta">{metaLine}</p>
              {needsAttention && !explain?.actions?.length ? (
                <div className="doc-actions">
                  <button
                    type="button"
                    className="btn-outline-warning btn-compact"
                    disabled={busy === document.id}
                    onClick={() => handleReparse(document)}
                  >
                    <RefreshIcon size={13} />
                    {busy === document.id ? "识别中…" : "重新识别"}
                  </button>
                </div>
              ) : null}
            </div>
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
                        className="btn-outline-warning btn-compact"
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
                {t("case.documents.fact_page", {
                  page: fact.page,
                  kind: fact.kind,
                })}
                <br />
                {fact.text}
              </p>
            ))}
          </FoldPanel>
        );
      })}
      {viewing ? (
        <PdfPreviewPane
          cid={caseIdFromPath()}
          doc={viewing}
          row={null}
          totalPages={viewing.meta?.pages}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </div>
  );
}
