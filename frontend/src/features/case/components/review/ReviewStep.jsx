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
  onRulesSave,
  onCoverage,
  onOpenOriginal,
  onStepChange,
}) {
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
        title="逐笔核对"
        badge={
          <em className="fold-panel-badge">{data.row_count} 笔</em>
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
            当前筛选没有交易。可以切换“全部交易”检查，或继续确认统计期间。
          </p>
        )}
        <div className="review-table-foot">
          {data.rows?.length > 0 &&
          data.rows.every((row) => row.scope_excluded) ? (
            <p className="muted" role="status">
              本页交易均标记为「范围外」，勾选不可用。请先到「确认归属」把对应原件勾上「纳入本次」。
            </p>
          ) : null}
          {data.busy ? (
            <p className="muted" role="status">
              资料识别或报告生成进行中，暂不可批量保存处理；AI 辅助分析不会锁住勾选。
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
