import React, { useEffect, useRef, useState } from "react";
import { FileTextIcon, PlusIcon, XIcon } from "@/shared/ui/icons.jsx";
import { Pagination } from "@/shared/ui/Pagination.jsx";
import { FoldPanel } from "@/shared/ui/FoldPanel.jsx";
import { AIAnalysisPanel } from "@/features/ai-analysis/index.js";
import { AccountingSummary } from "../AccountingSummary.jsx";
import { RangeForm } from "../RangeForm.jsx";
import { RuleEditor } from "../RuleEditor.jsx";
import { TransactionTable } from "./TransactionTable.jsx";
import { BulkReviewForm } from "./BulkReviewForm.jsx";
import { CoverageForm } from "./CoverageForm.jsx";
import { ReviewSourceSwitcher } from "./ReviewSourceSwitcher.jsx";
import {
  reviewCanNext,
  reviewPagerLabel,
} from "../../lib/review-paging.js";
import { adoptedAIRows, highConfidenceSuggested } from "../../lib/ai-adopt.js";
import { useI18n } from "@/shared/i18n/index.jsx";

export function ReviewStep({
  cid,
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
  onStepChange,
  onRefresh,
}) {
  const { t } = useI18n();
  const [addOpen, setAddOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const rulesWrapRef = useRef(null);
  const highAI = highConfidenceSuggested(data.rows);
  const adoptedAI = adoptedAIRows(data.rows);
  const relatedCount = data.fields?.rules?.related?.length || 0;

  function changeView(value) {
    onViewChange(value);
    onPageChange(1);
  }

  function changeQuery(value) {
    onPageChange(1);
    onQueryChange(value);
  }

  useEffect(() => {
    if (!rulesOpen) return undefined;
    function onDown(event) {
      if (event.target?.closest?.(".ql-select-menu")) return;
      if (!rulesWrapRef.current?.contains(event.target)) setRulesOpen(false);
    }
    function onKey(event) {
      if (event.key === "Escape") setRulesOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [rulesOpen]);

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
          <ReviewSourceSwitcher
            source={data.source}
            choices={data.choices || []}
            rowCount={data.row_count}
            onChange={(source) => onRangeChange({ source })}
          />
        }
        defaultOpen
        actions={
          <>
            <AIAnalysisPanel
              cid={cid}
              docs={data.docs || []}
              onCaseRefresh={onRefresh}
              variant="toolbar"
            />
            <div className="review-rules-wrap" ref={rulesWrapRef}>
              <button
                type="button"
                className={`btn-outline btn-compact${rulesOpen ? " is-active" : ""}`}
                aria-expanded={rulesOpen}
                aria-haspopup="dialog"
                onClick={() => setRulesOpen((value) => !value)}
              >
                <FileTextIcon size={13} />
                {t("case.rules.title")}
                {relatedCount > 0 ? (
                  <em className="fold-panel-badge">{relatedCount}</em>
                ) : null}
              </button>
              {rulesOpen ? (
                <div
                  className="review-rules-pop ql-secondary-pop"
                  role="dialog"
                  aria-label={t("case.rules.title")}
                >
                  <RuleEditor
                    rules={data.fields.rules}
                    busy={data.busy}
                    onSave={async (payload) => {
                      await onRulesSave(payload);
                      setRulesOpen(false);
                    }}
                  />
                </div>
              ) : null}
            </div>
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
            <button
              type="button"
              className="btn-outline btn-compact"
              onClick={() => setAddOpen((value) => !value)}
            >
              {addOpen ? (
                <>
                  <XIcon size={13} />
                  {t("common.cancel")}
                </>
              ) : (
                <>
                  <PlusIcon size={13} />
                  {t("review.add_row")}
                </>
              )}
            </button>
          </>
        }
      >
        <TransactionTable
          data={{ ...data, cid }}
          selected={selected}
          onSelectedChange={onSelectedChange}
          onChanged={onRefresh}
          addOpen={addOpen}
          onAddOpenChange={setAddOpen}
        />
        {!data.rows.length ? (
          <p className="empty">{t("case.review.no_transactions")}</p>
        ) : null}
        <div className="review-table-foot">
          <div className="review-table-foot-row">
            <div className="review-table-foot-status" role="status">
              {data.busy ? (
                <p className="muted">{t("case.review.busy_notice")}</p>
              ) : data.rows?.length > 0 &&
                data.rows.every((row) => row.scope_excluded) ? (
                <p className="muted">{t("case.review.all_out_of_range")}</p>
              ) : null}
            </div>
            <Pagination
              page={page}
              canPrevious={page !== 1}
              canNext={reviewCanNext(page, data.row_count)}
              onPrevious={() => onPageChange(page - 1)}
              onNext={() => onPageChange(page + 1)}
              label={reviewPagerLabel(page, data.row_count)}
            />
          </div>
          {highAI.length > 0 || adoptedAI.length > 0 ? (
            <div
              className="review-action review-action--ai"
              role="group"
              aria-label={t("case.review.ai_group")}
            >
              {highAI.length > 0 ? (
                <button
                  type="button"
                  className="primary btn-compact"
                  disabled={data.busy || !onAIAdopt}
                  onClick={() => onAIAdopt?.()}
                >
                  {t("case.review.adopt_ai_suggestions", {
                    count: highAI.length,
                  })}
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
          ) : null}
        </div>
      </FoldPanel>
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
