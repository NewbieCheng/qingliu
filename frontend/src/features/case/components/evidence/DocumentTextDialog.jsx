import React, { useEffect, useMemo, useState } from "react";
import { Loading } from "@/shared/ui/Loading.jsx";
import { FloatingPane } from "@/shared/ui/FloatingPane.jsx";
import { useI18n } from "@/shared/i18n/index.jsx";
import { documentText } from "../../api.js";
import "./document-text.css";

// 原件正文按页浏览：只显示已提取的文字，不渲染 PDF。
//
// 排版上有个真实矛盾：
//   - 银行流水靠等宽 + 不换行来维持列对齐，一换行列就散了；
//   - 申报表这类长句表单，不换行就会横向溢出，看不全（用户截图就是这个）。
// 所以给一个"自动换行"开关：默认换行（先保证看得全），需要看列对齐时关掉。

export function DocumentTextDialog({ cid, doc, onClose }) {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState(1);
  const [query, setQuery] = useState("");
  // 默认换行：长表格一旦横向溢出，用户第一眼就是"内容被切掉了"。
  const [wrap, setWrap] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
    documentText(cid, doc.id)
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        const firstFilled = (payload.pages || []).find((p) =>
          String(p.text || "").trim(),
        );
        setActive(firstFilled ? firstFilled.page : 1);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || t("doc_text.load_failed"));
      });
    return () => {
      cancelled = true;
    };
  }, [cid, doc.id, t]);

  const pages = data?.pages || [];
  const blank = useMemo(() => new Set(data?.blank || []), [data]);
  const current = pages.find((p) => p.page === active);

  const hits = useMemo(() => {
    const q = query.trim();
    if (!q) return new Set();
    const matched = new Set();
    for (const p of pages) {
      if (String(p.text || "").includes(q)) matched.add(p.page);
    }
    return matched;
  }, [pages, query]);

  const toolbar = (
    <>
      <button
        type="button"
        className={`btn-outline btn-compact${wrap ? " is-on" : ""}`}
        title={t("doc_text.wrap_hint")}
        onClick={() => setWrap((v) => !v)}
      >
        {wrap ? t("doc_text.wrap_on") : t("doc_text.wrap_off")}
      </button>
      <input
        type="search"
        className="doc-text-search"
        placeholder={t("doc_text.search_placeholder")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
    </>
  );

  return (
    <FloatingPane
      title={t("doc_text.title_short")}
      subtitle={doc?.name}
      toolbar={toolbar}
      onClose={onClose}
      ariaLabel={t("doc_text.title_short")}
      defaultWidth={860}
      defaultHeight={720}
    >
      {error ? <p className="error doc-text-pad">{error}</p> : null}
      {!data && !error ? (
        <div className="doc-text-pad">
          <Loading compact text={t("doc_text.loading")} />
        </div>
      ) : null}

      {data ? (
        <div className="doc-text">
          <div className="doc-text-meta">
            <span>{t("doc_text.summary", { total: data.total, blank: blank.size })}</span>
            {query.trim() ? (
              <span className="doc-text-hits">
                {t("doc_text.hits", { n: hits.size })}
              </span>
            ) : null}
          </div>

          <div className="doc-text-body">
            <nav className="doc-text-pages" aria-label={t("doc_text.pages_aria")}>
              {pages.map((p) => (
                <button
                  key={p.page}
                  type="button"
                  className={
                    "doc-text-page-btn" +
                    (p.page === active ? " is-active" : "") +
                    (blank.has(p.page) ? " is-blank" : "") +
                    (hits.has(p.page) ? " is-hit" : "")
                  }
                  title={blank.has(p.page) ? t("doc_text.blank_page_hint") : undefined}
                  onClick={() => setActive(p.page)}
                >
                  {p.page}
                </button>
              ))}
            </nav>

            <div className="doc-text-content">
              {blank.has(active) ? (
                <p className="doc-text-blank">{t("doc_text.blank_page")}</p>
              ) : (
                <pre className={`doc-text-pre${wrap ? " is-wrap" : ""}`}>
                  {current?.text || ""}
                </pre>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </FloatingPane>
  );
}
