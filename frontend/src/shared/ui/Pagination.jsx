import React from "react";
import { useI18n } from "@/shared/i18n/index.jsx";

export function Pagination({ page, onPrevious, onNext, canPrevious, canNext, label }) {
  const { t } = useI18n();
  return (
    <div className="pager">
      <button disabled={!canPrevious} onClick={onPrevious}>
        {t("common.previous")}
      </button>
      <span>{label ?? t("common.page", { page })}</span>
      <button disabled={!canNext} onClick={onNext}>
        {t("common.next")}
      </button>
    </div>
  );
}
