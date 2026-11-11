import React from "react";
import { formatDate } from "@/shared/lib/format.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";
import { PageHeader } from "@/shared/ui/PageHeader.jsx";

export function CaseHeader({ data, adminAction = null }) {
  return (
    <PageHeader
      className="case-page-header"
      title={data.customer.name}
      description={`${data.fields.company || "企业名称未填写"} · 创建于 ${formatDate(data.customer.created)}`}
      actions={
        <div className="case-header-actions">
          <div className="case-facts">
            <StatusBadge tone={data.busy ? "amber" : "default"}>
              {data.busy
                ? "后台处理中"
                : data.submitted_current
                  ? "已提交复核"
                  : "Needs check"}
            </StatusBadge>
            <span>
              <strong>{data.docs.length}</strong> 份资料
            </span>
            <span>
              <strong>{data.row_count}</strong> 笔交易
            </span>
          </div>
          {adminAction}
        </div>
      }
    />
  );
}
