import React from "react";
import { formatDate } from "@/shared/lib/format.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";
import { PageHeader } from "@/shared/ui/PageHeader.jsx";
import { useI18n } from "@/shared/i18n/index.jsx";

export function CaseHeader({ data, adminAction = null }) {
  const { t } = useI18n();
  return (
    <PageHeader
      className="case-page-header"
      title={data.customer.name}
      description={`${data.fields.company || t("case.unnamed_company")} · ${t("case.created_at", { date: formatDate(data.customer.created) })}`}
      actions={
        <div className="case-header-actions">
          <div className="case-facts">
            <StatusBadge tone={data.busy ? "amber" : "default"}>
              {data.busy
                ? t("case.busy")
                : data.submitted_current
                  ? t("case.submitted")
                  : t("case.needs_check")}
            </StatusBadge>
            <span>
              <strong>{data.docs.length}</strong> {t("case.docs_stat", { n: data.docs.length })}
            </span>
            <span>
              <strong>{data.row_count}</strong> {t("case.tx_stat", { n: data.row_count })}
            </span>
          </div>
          {adminAction}
        </div>
      }
    />
  );
}
