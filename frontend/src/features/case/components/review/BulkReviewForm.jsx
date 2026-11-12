import React from "react";
import { Form } from "@/shared/ui/Form.jsx";
import { Select } from "@/shared/ui/FormRow.jsx";
import { REVIEW_OPTIONS } from "../../constants.js";
import { useI18n } from "@/shared/i18n/index.jsx";

export function BulkReviewForm({ selectedCount, busy, onSave }) {
  const { t } = useI18n();
  return (
    <Form onSave={onSave}>
      <div className="review-action">
        <strong>{t("review.bulk_selected", { n: selectedCount })}</strong>
        <Select name="label" label={t("review.bulk_handling")} aria-label={t("review.bulk_handling")}>
          {REVIEW_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <input
          name="reason"
          aria-label={t("case.review.bulk_reason_label")}
          placeholder={t("review.bulk_reason_placeholder")}
          required
        />
        <button
          className="primary"
          disabled={busy || !selectedCount}
          type="submit"
        >
          {t("review.bulk_submit")}
        </button>
      </div>
    </Form>
  );
}
