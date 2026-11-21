import React, { useEffect, useMemo, useState } from "react";
import { Modal } from "@/shared/ui/Modal.jsx";
import { Loading } from "@/shared/ui/Loading.jsx";
import { useI18n } from "@/shared/i18n/index.jsx";
import { documentText } from "../../api.js";
import "./document-text.css";

// 原件正文按页浏览：只显示已提取的文字，不渲染 PDF。
//
// 之所以不做 PDF 渲染：渲染要把每页转成图片，慢且占带宽，而这个功能真正的
// 用途是"核对某一行的原文长什么样"。文字按页铺开反而能直接看、能复制、能搜索。
export function DocumentTextDialog({ cid, doc, onClose }) {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState(1);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
    documentText(cid, doc.id)
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        // 默认落在第一个有内容的页，避免一打开就是空白扫描页。
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

  return (
    <Modal
      title={t("doc_text.title", { name: doc.name })}
      onClose={onClose}
      className="modal--wide"
    >
      {error ? <p className="error">{error}</p> : null}
      {!data && !error ? <Loading compact text={t("doc_text.loading")} /> : null}

      {data ? (
        <div className="doc-text">
          <div className="doc-text-meta">
            <span>
              {t("doc_text.summary", {
                total: data.total,
                blank: blank.size,
              })}
            </span>
            <input
              type="search"
              className="doc-text-search"
              placeholder={t("doc_text.search_placeholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
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
                  title={
                    blank.has(p.page)
                      ? t("doc_text.blank_page_hint")
                      : undefined
                  }
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
                <pre className="doc-text-pre">{current?.text || ""}</pre>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
