import React from "react";
import { Pagination } from "@/shared/ui/Pagination.jsx";
import { SearchInput } from "@/shared/ui/SearchInput.jsx";
import { Select } from "@/shared/ui/FormRow.jsx";
import { AccountingSummary } from "../AccountingSummary.jsx";
import { RangeForm } from "../RangeForm.jsx";
import { RuleEditor } from "../RuleEditor.jsx";
import { TransactionTable } from "./TransactionTable.jsx";
import { BulkReviewForm } from "./BulkReviewForm.jsx";
import { CoverageForm } from "./CoverageForm.jsx";

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
    onPageChange(1);
    onQueryChange(value);
  }

  return (
    <>
      <RangeForm data={data} onChange={onRangeChange} />
      <AccountingSummary summary={summary} />
      <section className="card">
        <div className="toolbar">
          <h2>
            逐笔核对 <small>{data.row_count} 笔</small>
          </h2>
          <Select
            aria-label="交易筛选"
            label="交易筛选"
            value={view}
            onChange={(event) => changeView(event.target.value)}
          >
            <option value="issues">待处理疑点</option>
            <option value="all">全部交易</option>
            <option value="confirmed">已人工确认</option>
            <option value="duplicate">疑似重复</option>
          </Select>
          <SearchInput
            aria-label="搜索交易"
            placeholder="对手方、摘要或日期"
            value={query}
            onChange={(value) => changeQuery(value)}
          />
        </div>
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
        <Pagination
          page={page}
          canPrevious={page !== 1}
          canNext={page * 50 < data.row_count}
          onPrevious={() => onPageChange(page - 1)}
          onNext={() => onPageChange(page + 1)}
          label={`第 ${page} 页 / ${data.row_count} 笔`}
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
      </section>
      <RuleEditor rules={data.fields.rules} busy={data.busy} onSave={onRulesSave} />
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
