import React from "react";
import { Pagination } from "@/shared/ui/Pagination.jsx";
import { FoldPanel } from "@/shared/ui/FoldPanel.jsx";
import { AccountingSummary } from "../AccountingSummary.jsx";
import { RangeForm } from "../RangeForm.jsx";
import { RuleEditor } from "../RuleEditor.jsx";
import { TransactionTable } from "./TransactionTable.jsx";
import { BulkReviewForm } from "./BulkReviewForm.jsx";
import { CoverageForm } from "./CoverageForm.jsx";
import {
  reviewCanNext,
  reviewPagerLabel,
} from "../../lib/review-paging.js";
import { adoptedAIRows, highConfidenceSuggested } from "../../lib/ai-adopt.js";
import { useI18n } from "@/shared/i18n/index.jsx";

export function ReviewStep({
  data,
  summary,
  selected,
  onSelectedChange,
  view,
  onViewChange,
  query,
  onQueryChange,
  page,
  onPageChange,
  onRangeChange,
  onReview,
  onAIAdopt,
  onAIRevoke,
  onRulesSave,
  onCoverage,
  onOpenOriginal,
  onStepChange,
}) {
  const { t } = useI18n();
  const highAI = highConfidenceSuggested(data.rows);
  const adoptedAI = adoptedAIRows(data.rows);
  function changeView(value) {
    onViewChange(value);
    onPageChange(1);
  }

  function changeQuery(value) {
    // 仅在 SearchInput 点放大镜 / 回车 / 清空时触发，避免键入实时打服务器
    onPageChange(1);
    onQueryChange(value);
  }

  return (
    <>
      <RangeForm
        data={data}
        onChange={onRangeChange}
        view={view}
        onViewChange={changeView}
        query={query}
        onQueryChange={changeQuery}
      />
      <AccountingSummary summary={summary} />
      <FoldPanel
        className="card fold-panel--card review-table-card"
        title={t("case.review.title")}
        badge={
          <em className="fold-panel-badge">{t("case.tx_stat", { n: data.row_count })}</em>
        }
        defaultOpen
      >
        <TransactionTable
          data={data}
          selected={selected}
          onSelectedChange={onSelectedChange}
          onOpenOriginal={onOpenOriginal}
        />
        {!data.rows.length && (
          <p className="empty">
            {t("case.review.no_transactions")}
          </p>
        )}
        <div className="review-table-foot">
          {data.rows?.length > 0 &&
          data.rows.every((row) => row.scope_excluded) ? (
            <p className="muted" role="status">
              {t("case.review.all_out_of_range")}
            </p>
          ) : null}
          {data.busy ? (
            <p className="muted" role="status">
              {t("case.review.busy_notice")}
            </p>
          ) : null}
          <Pagination
            page={page}
            canPrevious={page !== 1}
            canNext={reviewCanNext(page, data.row_count)}
            onPrevious={() => onPageChange(page - 1)}
            onNext={() => onPageChange(page + 1)}
            label={reviewPagerLabel(page, data.row_count)}
          />
          {(highAI.length > 0 || adoptedAI.length > 0) && (
            <div className="review-action review-action--ai" role="group" aria-label={t("case.review.ai_group")}>
              {highAI.length > 0 ? (
                <button
                  type="button"
                  className="primary"
                  disabled={data.busy || !onAIAdopt}
                  onClick={() => onAIAdopt?.()}
                >
                  {t("case.review.adopt_ai_suggestions", { count: highAI.length })}
                </button>
              ) : null}
              {adoptedAI.length > 0 ? (
                <button
                  type="button"
                  className="ghost"
                  disabled={data.busy || !onAIRevoke}
                  onClick={() =>
                    onAIRevoke?.(
                      (selected.length
                        ? adoptedAI.filter((row) => selected.includes(row.id))
                        : adoptedAI
                      ).map((row) => row.id),
                    )
                  }
                >
                  {t("case.review.revoke_ai_adoption")}
                </button>
              ) : null}
            </div>
          )}
          <BulkReviewForm
            selectedCount={selected.length}
            busy={data.busy}
            onSave={(form) =>
              onReview({
                ids: selected,
                label: form.get("label"),
                reason: form.get("reason"),
              })
            }
          />
        </div>
      </FoldPanel>
      <RuleEditor
        rules={data.fields.rules}
        busy={data.busy}
        onSave={onRulesSave}
      />
      <CoverageForm
        data={data}
        onSave={async (payload) => {
          await onCoverage(payload);
          onStepChange("report");
        }}
      />
    </>
  );
}
