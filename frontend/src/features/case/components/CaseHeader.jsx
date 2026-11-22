import React from "react";
import { formatDate } from "@/shared/lib/format.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";
import { useChromeTitleValue } from "@/shared/layout/ChromeTitle.jsx";
import { useI18n } from "@/shared/i18n/index.jsx";
import { Link } from "@/shared/router/index.js";
import { ArrowLeftIcon } from "@/shared/ui/icons.jsx";

export function CaseHeader({ data, adminAction = null }) {
  const { t } = useI18n();
  useChromeTitleValue(data.customer.name);

  return (
    <div className="case-page-header case-page-strip">
      <Link className="case-back" to="/">
        <ArrowLeftIcon />
        <span>{t("route.back_customers")}</span>
      </Link>
      <p className="case-page-meta muted">
        {data.fields.company || t("case.unnamed_company")}
        {" · "}
        {t("case.created_at", { date: formatDate(data.customer.created) })}
      </p>
      <div className="case-facts">
        <StatusBadge tone={data.busy ? "amber" : "default"}>
          {data.busy
            ? t("case.busy")
            : data.submitted_current
              ? t("case.submitted")
              : t("case.needs_check")}
        </StatusBadge>
        <span>{t("case.docs_stat", { n: data.docs.length })}</span>
        <span>{t("case.tx_stat", { n: data.row_count })}</span>
      </div>
      {adminAction}
    </div>
  );
}
