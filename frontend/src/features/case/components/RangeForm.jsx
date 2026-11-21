import React, { useEffect, useState } from "react";
import { Form } from "@/shared/ui/Form.jsx";
import { Select } from "@/shared/ui/FormRow.jsx";
import { SearchInput } from "@/shared/ui/SearchInput.jsx";
import { SOURCES } from "@/shared/lib/constants.js";
import { useI18n } from "@/shared/i18n/index.jsx";
import { ChevronDownIcon, FunnelIcon } from "@/shared/ui/icons.jsx";

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
  // 测算范围收进二级浮层：三个字段 + 应用按钮挤在工具条里会把右侧
  // 的状态/搜索挤到第二行，还容易被误认为"改了就生效"。
  const [rangeOpen, setRangeOpen] = useState(false);
  // 整条筛选默认收起成一个按钮：核对页首先是「看数据」，筛选是次要动作，
  // 常驻一整行会把统计和表格往下推。
  const [barOpen, setBarOpen] = useState(false);

  useEffect(() => {
    setDraft(query || "");
  }, [query]);

  // 点外部关闭浮层，避免它一直挂着挡住下面的统计卡
  const rangeWrapRef = React.useRef(null);
  useEffect(() => {
    if (!rangeOpen) return undefined;
    function onDown(e) {
      if (!rangeWrapRef.current?.contains(e.target)) setRangeOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setRangeOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [rangeOpen]);

  return (
        <div className={`card review-filter${barOpen ? " is-open" : ""}`}>
      <button
        type="button"
        className="review-filter-toggle"
        aria-expanded={barOpen}
        onClick={() => setBarOpen((v) => !v)}
      >
        <FunnelIcon size={13} />
        <span>筛选</span>
        <span className="review-filter-summary">
          {data.start} → {data.end}
          {" · "}
          {t(`review.view_${view}`)}
          {query ? ` · "${query}"` : ""}
        </span>
        <ChevronDownIcon size={13} className="review-filter-caret" />
      </button>
      {barOpen ? (
      <div className="review-filter-row">
        <div className="range-pop-wrap" ref={rangeWrapRef}>
          <button
            type="button"
            className={`review-range-trigger${rangeOpen ? " is-open" : ""}`}
            aria-expanded={rangeOpen}
            aria-haspopup="dialog"
            title={t("review.apply_range_tip")}
            onClick={() => setRangeOpen((v) => !v)}
          >
            <span className="review-range-label">{t("review.filter_range")}</span>
            <span className="review-range-value">
              {data.start} <span className="review-range-dash">→</span> {data.end}
            </span>
            <ChevronDownIcon size={13} />
          </button>

          {rangeOpen ? (
            <div className="range-pop" role="dialog" aria-label={t("review.filter_range")}>
              <Form
                className="review-filter-range"
                success=""
                onSave={(form) => {
                  onChange(Object.fromEntries(form));
                  setRangeOpen(false);
                }}
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
                        {SOURCES[data.source]
                          ? t(SOURCES[data.source])
                          : t("case.review.no_source")}
                      </option>
                    ) : (
                      data.choices.map((value) => (
                        <option key={value} value={value}>
                          {SOURCES[value] ? t(SOURCES[value]) : value}
                        </option>
                      ))
                    )}
                  </Select>
                </label>
                <div className="range-pop-dates">
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
                </div>
                <p className="range-pop-hint">
                  改完点「应用范围」才生效，统计与列表会一起重算。
                </p>
                <div className="range-pop-actions">
                  <button
                    type="button"
                    className="btn-outline btn-compact"
                    onClick={() => setRangeOpen(false)}
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="primary review-filter-apply"
                    title={t("review.apply_range_tip")}
                  >
                    {t("review.apply_range")}
                  </button>
                </div>
              </Form>
            </div>
          ) : null}
        </div>

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
      ) : null}
    </div>
  );
}
