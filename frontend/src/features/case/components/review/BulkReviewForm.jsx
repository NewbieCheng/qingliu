import React from "react";
import { Form } from "@/shared/ui/Form.jsx";
import { Select } from "@/shared/ui/FormRow.jsx";
import { REVIEW_OPTIONS } from "../../constants.js";
import { useI18n } from "@/shared/i18n/index.jsx";

/** 批量处理：挂在「交易核对」标题行，仅在有选中时显示。 */
export function BulkReviewForm({ selectedCount, busy, onSave }) {
  const { t } = useI18n();
  if (!selectedCount) return null;

  return (
    <Form className="review-bulk-form" onSave={onSave}>
      <div className="review-action review-action--chrome">
        <strong>{t("review.bulk_selected", { n: selectedCount })}</strong>
        <Select
          name="label"
          label={t("review.bulk_handling")}
          aria-label={t("review.bulk_handling")}
          className="review-bulk-select"
        >
          {REVIEW_OPTIONS.map(([value, labelKey]) => (
            <option key={value} value={value}>
              {t(labelKey)}
            </option>
          ))}
        </Select>
        <input
          name="reason"
          className="review-bulk-reason"
          aria-label={t("case.review.bulk_reason_label")}
          placeholder={t("review.bulk_reason_placeholder")}
          required
        />
        <button
          className="primary btn-compact"
          disabled={busy || !selectedCount}
          type="submit"
        >
          {t("review.bulk_submit")}
        </button>
      </div>
    </Form>
  );
}
