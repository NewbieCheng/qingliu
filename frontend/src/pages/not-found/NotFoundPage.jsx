import React from "react";
import { Link } from "@/shared/router/index.js";
import { EmptyState } from "@/shared/ui/EmptyState.jsx";
import { ArrowLeftIcon } from "@/shared/ui/icons.jsx";
import { useI18n } from "@/shared/i18n/index.jsx";

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <main>
      <EmptyState title={t("route.not_found_check_address")}>
        <p>{t("route.not_found_help")}</p>
        <Link className="back" to="/">
          <ArrowLeftIcon />
          {t("route.back_customers")}
        </Link>
      </EmptyState>
    </main>
  );
}
