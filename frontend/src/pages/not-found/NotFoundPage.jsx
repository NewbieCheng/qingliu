import React from "react";
import { Link } from "@/shared/router/index.js";
import { PageHeader } from "@/shared/ui/PageHeader.jsx";
import { EmptyState } from "@/shared/ui/EmptyState.jsx";
import { ArrowLeftIcon } from "@/shared/ui/icons.jsx";
import { useI18n } from "@/shared/i18n/index.jsx";

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <main>
      <PageHeader
        title={t("route.not_found_title")}
        description={t("route.not_found_description")}
        actions={
          <Link className="back" to="/">
            <ArrowLeftIcon />
            {t("route.back_customers")}
          </Link>
        }
      />
      <EmptyState title={t("route.not_found_check_address")}>
        <p>{t("route.not_found_help")}</p>
      </EmptyState>
    </main>
  );
}
