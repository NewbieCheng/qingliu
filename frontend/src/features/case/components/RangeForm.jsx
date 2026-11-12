import React, { useEffect, useState } from "react";
import { Form } from "@/shared/ui/Form.jsx";
import { Select } from "@/shared/ui/FormRow.jsx";
import { SearchInput } from "@/shared/ui/SearchInput.jsx";
import { SOURCES } from "@/shared/lib/constants.js";
import { useI18n } from "@/shared/i18n/index.jsx";

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
  const { t } = useI18n();
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
            <span>{t("review.filter_source")}</span>
            <Select
              name="source"
              label={t("review.filter_source")}
              className="review-filter-select"
              defaultValue={data.source}
              title={t("review.apply_range_tip")}
            >
              {choiceCount === 0 ? (
                <option value={data.source || "other"}>
                  {SOURCES[data.source] || t("case.review.no_source")}
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
            <span>{t("review.filter_start")}</span>
            <input
              name="start"
              type="date"
              defaultValue={data.start}
              required
              title={t("review.apply_range_tip")}
            />
          </label>
          <label className="review-filter-field">
            <span>{t("review.filter_end")}</span>
            <input
              name="end"
              type="date"
              defaultValue={data.end}
              required
              title={t("review.apply_range_tip")}
            />
          </label>
          <button
            type="submit"
            className="primary review-filter-apply"
            title={t("review.apply_range_tip")}
          >
            {t("review.apply_range")}
          </button>
        </Form>

        <span className="review-filter-sep" aria-hidden="true" />

        <div
          className="review-filter-view"
          role="group"
          aria-label={t("case.review.filter_aria_label")}
        >
          <label className="review-filter-field">
            <span>{t("review.filter_status")}</span>
            <Select
              aria-label={t("review.filter_status")}
              label={t("review.filter_status")}
              className="review-filter-select"
              value={view}
              onChange={(event) => onViewChange(event.target.value)}
              title={t("case.review.range_scope_tip")}
            >
              <option value="issues">{t("review.view_issues")}</option>
              <option value="all">{t("review.view_all")}</option>
              <option value="confirmed">{t("review.view_confirmed")}</option>
              <option value="duplicate">{t("review.view_duplicate")}</option>
            </Select>
          </label>
          <label className="review-filter-field is-search">
            <span>{t("common.search")}</span>
            <SearchInput
              aria-label={t("case.review.search_aria_label")}
              placeholder={t("review.search_placeholder")}
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
