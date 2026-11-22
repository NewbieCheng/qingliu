import React, { useEffect, useRef, useState } from "react";
import { Form } from "@/shared/ui/Form.jsx";
import { Select } from "@/shared/ui/FormRow.jsx";
import { SearchInput } from "@/shared/ui/SearchInput.jsx";
import { SOURCES } from "@/shared/lib/constants.js";
import { useI18n } from "@/shared/i18n/index.jsx";
import { ChromeCenter } from "@/shared/layout/ChromeTitle.jsx";
import { ChevronDownIcon, FunnelIcon } from "@/shared/ui/icons.jsx";

/**
 * 核对筛选：摘要按钮挂顶栏正中；展开后紧贴按钮下方浮层，不占内容区。
 * 测算来源单独一行、立刻切换；日期仍在「测算范围」浮层里点应用才改。
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
  const [rangeOpen, setRangeOpen] = useState(false);
  const [barOpen, setBarOpen] = useState(false);
  const chromeWrapRef = useRef(null);
  const rangeWrapRef = useRef(null);

  useEffect(() => {
    setDraft(query || "");
  }, [query]);

  useEffect(() => {
    if (!barOpen) {
      setRangeOpen(false);
      return undefined;
    }
    function onDown(e) {
      const target = e.target;
      // Select 菜单经 portal 挂在 body，点选项时不算“点在外面”。
      if (target?.closest?.(".ql-select-menu")) return;
      if (!chromeWrapRef.current?.contains(target)) setBarOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") {
        if (rangeOpen) setRangeOpen(false);
        else setBarOpen(false);
      }
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [barOpen, rangeOpen]);

  const sourceLabel = SOURCES[data.source]
    ? t(SOURCES[data.source])
    : data.source || t("case.review.no_source");
  const summary = (
    <>
      {sourceLabel}
      {" · "}
      {data.start} → {data.end}
      {" · "}
      {t(`review.view_${view}`)}
      {query ? ` · "${query}"` : ""}
    </>
  );

  function switchSource(next) {
    if (!next || next === data.source) return;
    // 只传 source：服务端按该来源重算默认起止日。
    onChange({ source: next });
  }

  return (
    <ChromeCenter>
      <div className="review-filter-chrome" ref={chromeWrapRef}>
        <button
          type="button"
          className={`review-filter-toggle review-filter-toggle--chrome${barOpen ? " is-open" : ""}`}
          aria-expanded={barOpen}
          aria-haspopup="dialog"
          title={t("case.review.filter_aria_label")}
          onClick={() => setBarOpen((v) => !v)}
        >
          <FunnelIcon size={12} />
          <span className="review-filter-chrome-label">{t("review.filter_chrome")}</span>
          <span className="review-filter-summary">{summary}</span>
          <ChevronDownIcon size={12} className="review-filter-caret" />
        </button>

        {barOpen ? (
          <div
            className="review-filter-pop"
            role="dialog"
            aria-label={t("case.review.filter_aria_label")}
          >
            <div className="review-filter-source-row">
              <label className="review-filter-field is-source-row">
                <span>{t("review.filter_source")}</span>
                <Select
                  aria-label={t("review.filter_source")}
                  label={t("review.filter_source")}
                  className="review-filter-select review-filter-source-select"
                  value={data.source || ""}
                  onChange={(event) => switchSource(event.target.value)}
                  title={t("case.review.switch_source_tip")}
                >
                  {choiceCount === 0 ? (
                    <option value={data.source || "other"}>
                      {sourceLabel}
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
              <p className="review-filter-source-hint muted">
                {t("case.review.switch_source_hint")}
              </p>
            </div>

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
                  <span className="review-range-label">
                    {t("review.filter_range")}
                  </span>
                  <span className="review-range-value">
                    {data.start}{" "}
                    <span className="review-range-dash">→</span> {data.end}
                  </span>
                  <ChevronDownIcon size={13} />
                </button>

                {rangeOpen ? (
                  <div
                    className="range-pop"
                    role="dialog"
                    aria-label={t("review.filter_range")}
                  >
                    <Form
                      className="review-filter-range"
                      success=""
                      onSave={(form) => {
                        onChange({
                          source: data.source,
                          ...Object.fromEntries(form),
                        });
                        setRangeOpen(false);
                      }}
                      key={`${data.start}-${data.end}-${data.source}-${choiceCount}`}
                    >
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
                        {t("review.apply_range_body_hint")}
                      </p>
                      <div className="range-pop-actions">
                        <button
                          type="button"
                          className="btn-outline btn-compact"
                          onClick={() => setRangeOpen(false)}
                        >
                          {t("common.cancel")}
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
                    <option value="all">{t("review.view_all")}</option>
                    <option value="issues">{t("review.view_issues")}</option>
                    <option value="confirmed">
                      {t("review.view_confirmed")}
                    </option>
                    <option value="duplicate">
                      {t("review.view_duplicate")}
                    </option>
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
        ) : null}
      </div>
    </ChromeCenter>
  );
}
