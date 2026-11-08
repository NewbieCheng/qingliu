import React from "react";
import { DOCUMENT_STATUS, SOURCES } from "@/shared/lib/constants.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";

export function DocumentList({ data }) {
  return (
    <div className="docs">
      {data.docs.map((document) => (
        <details key={document.id}>
          <summary>
            {document.name}{" "}
            <StatusBadge tone={document.meta.status !== "success" ? "amber" : "default"}>
              {DOCUMENT_STATUS[document.meta.status]}
            </StatusBadge>
          </summary>
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
        </details>
      ))}
    </div>
  );
}
