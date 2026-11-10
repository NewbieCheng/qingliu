import React from "react";
import { DOCUMENT_STATUS, SOURCES } from "@/shared/lib/constants.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";
import { FoldPanel } from "@/shared/ui/FoldPanel.jsx";

export function DocumentList({ data }) {
  if (!data.docs.length) return null;
  const pending = data.docs.filter(
    (document) => document.meta.status !== "success",
  ).length;
  return (
    <div className="docs">
      <p className="docs-count">
        已上传 {data.docs.length} 份{pending > 0 && `（${pending} 份待处理）`}
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
            {SOURCES[document.meta.source]} · {document.meta.pages || 0} 页 ·{" "}
            {document.meta.rows || 0} 笔 · 原件期间：
            {document.meta.coverage || "未识别"}
          </p>
          {document.meta.issues?.map((issue, index) => (
            <p className="error" key={index}>
              {issue}
            </p>
          ))}
          {document.meta.facts?.map((fact, index) => (
            <p key={index}>
              第{fact.page}页 · {fact.kind}
              <br />
              {fact.text}
            </p>
          ))}
        </FoldPanel>
      ))}
    </div>
  );
}
