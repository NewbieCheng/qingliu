import React, { useEffect, useState } from "react";
import { Form } from "@/shared/ui/Form.jsx";
import { Select } from "@/shared/ui/FormRow.jsx";
import { SearchInput } from "@/shared/ui/SearchInput.jsx";
import { SOURCES } from "@/shared/lib/constants.js";

/**
 * 核对页单行工具条：左侧改测算范围（需点「应用范围」）；
 * 右侧状态即时切换，搜索需点右侧放大镜或回车才请求。
 */
export function RangeForm({
  data,
  onChange,
  view,
  onViewChange,
  query,
  onQueryChange,
}) {
  const choiceCount = data.choices?.length || 0;
  const [draft, setDraft] = useState(query || "");

  useEffect(() => {
    setDraft(query || "");
  }, [query]);

  return (
    <div className="card review-filter">
      <div className="review-filter-row">
        <Form
          className="review-filter-range"
          success=""
          onSave={(form) => onChange(Object.fromEntries(form))}
          key={`${data.start}-${data.end}-${data.source}-${choiceCount}`}
        >
          <label className="review-filter-field is-source">
            <span>Source</span>
            <Select
              name="source"
              label="Source"
              className="review-filter-select"
              defaultValue={data.source}
              title="After changing source or dates, click Apply range to recalculate"
            >
              {choiceCount === 0 ? (
                <option value={data.source || "other"}>
                  {SOURCES[data.source] || "暂无来源"}
                </option>
              ) : (
                data.choices.map((value) => (
                  <option key={value} value={value}>
                    {SOURCES[value] || value}
                  </option>
                ))
              )}
            </Select>
          </label>
          <label className="review-filter-field">
            <span>开始</span>
            <input
              name="start"
              type="date"
              defaultValue={data.start}
              required
              title="After changing dates, click Apply range to recalculate"
            />
          </label>
          <label className="review-filter-field">
            <span>截止</span>
            <input
              name="end"
              type="date"
              defaultValue={data.end}
              required
              title="After changing dates, click Apply range to recalculate"
            />
          </label>
          <button
            type="submit"
            className="primary review-filter-apply"
            title="应用后才会按新来源与日期重算"
          >
            Apply range
          </button>
        </Form>

        <span className="review-filter-sep" aria-hidden="true" />

        <div
          className="review-filter-view"
          role="group"
          aria-label="交易列表筛选"
        >
          <label className="review-filter-field">
            <span>Status</span>
            <Select
              aria-label="Transaction status"
              label="Transaction status"
              className="review-filter-select"
              value={view}
              onChange={(event) => onViewChange(event.target.value)}
              title="只影响下方交易表，不改测算范围"
            >
              <option value="issues">待处理疑点</option>
              <option value="all">全部交易</option>
              <option value="confirmed">已人工确认</option>
              <option value="duplicate">疑似重复</option>
            </Select>
          </label>
          <label className="review-filter-field is-search">
            <span>Search</span>
            <SearchInput
              aria-label="搜索交易"
              placeholder="对手方、摘要或日期"
              value={draft}
              onChange={setDraft}
              onSearch={onQueryChange}
              title="Search only after clicking the magnifier or pressing Enter; does not change the calculation range"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
