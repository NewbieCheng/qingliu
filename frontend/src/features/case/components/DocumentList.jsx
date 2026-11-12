import React from "react";
import { DOCUMENT_STATUS, SOURCES } from "@/shared/lib/constants.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";
import { FoldPanel } from "@/shared/ui/FoldPanel.jsx";
import { useI18n } from "@/shared/i18n/index.jsx";

export function DocumentList({ data }) {
  const { t } = useI18n();
  if (!data.docs.length) return null;
  const pending = data.docs.filter(
    (document) => document.meta.status !== "success",
  ).length;
  return (
    <div className="docs">
      <p className="docs-count">
        {t("upload.docs_header", { total: data.docs.length, pending: pending > 0 ? t("upload.docs_pending_part", { n: pending }) : "" })}
      </p>
      {data.docs.map((document) => (
        <FoldPanel
          key={document.id}
          className="doc-fold"
          title={document.name}
          badge={
            <StatusBadge
              tone={document.meta.status !== "success" ? "amber" : "default"}
            >
              {DOCUMENT_STATUS[document.meta.status]}
            </StatusBadge>
          }
        >
          <p>
            {t("upload.pages_stat", { source: SOURCES[document.meta.source], pages: document.meta.pages || 0, rows: document.meta.rows || 0, coverage: document.meta.coverage || t("upload.unidentified_coverage") })}
          </p>
          {document.meta.issues?.map((issue, index) => (
            <p className="error" key={index}>
              {issue}
            </p>
          ))}
          {document.meta.facts?.map((fact, index) => (
            <p key={index}>
              {t("case.documents.fact_page", { page: fact.page, kind: fact.kind })}
              <br />
              {fact.text}
            </p>
          ))}
        </FoldPanel>
      ))}
    </div>
  );
}
