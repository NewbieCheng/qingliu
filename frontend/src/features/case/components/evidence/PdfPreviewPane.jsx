import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
import { originalPageURL } from "../../api.js";
import "./pdf-preview-pane.css";

// 原件 PDF 对照面板。
//
// 设计要点：
//   1) 不渲染 PDF 文字层，直接显示服务端渲染好的页面图（已有缓存机制），
//      所以打开快、不引入 pdf.js 的体积。
//   2) 左侧点某一行 → 这里自动切到那一行所在页，并在图上叠加高亮框。
//   3) 框的位置来自解析时记录的归一化 bbox（0~1），与页面图尺寸无关，
//      缩放窗口也不会跑偏。
//   4) 面板本身可折叠；展开时是独立一栏而不是覆盖层，避免遮挡表格。

// 页面图缓存：同一次会话内翻回同一页不再请求。
const pageCache = new Map();

async function loadPage(cid, did, page, sha, signal) {
  const key = `${sha}:${page}`;
  if (pageCache.has(key)) return pageCache.get(key);
  const url = originalPageURL(cid, did, page);
  const res = await fetch(url, { credentials: "include", signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const objURL = URL.createObjectURL(blob);
  pageCache.set(key, objURL);
  return objURL;
}

export function PdfPreviewPane({
  cid,
  doc,
  row,
  totalPages,
  onClose,
}) {
  const { t } = useI18n();
  const [page, setPage] = useState(Number(row?.page) || 1);
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);

  const total = Math.max(Number(totalPages) || 1, 1);
  const bbox = row?.bbox;
  const rowPage = Number(row?.page) || 1;

  // 点新行时跟随跳到它的页
  useEffect(() => {
    if (row) setPage(rowPage);
  }, [row?.id, rowPage]);

  useEffect(() => {
    if (!cid || !doc?.id) return undefined;
    const controller = new AbortController();
    setError("");
    setLoading(true);
    loadPage(cid, doc.id, page, doc.sha || "", controller.signal)
      .then((url) => setSrc(url))
      .catch((err) => {
        if (err.name !== "AbortError") setError(err.message || t("pdf.load_failed"));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [cid, doc?.id, doc?.sha, page, t]);

  // 换页后把高亮框滚进视野，避免用户要自己找。
  useEffect(() => {
    if (!bbox || page !== rowPage) return;
    boxRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [bbox, page, rowPage, src]);

  const showBox = bbox && page === rowPage && src;

  return (
    <aside className="pdf-pane" aria-label={t("pdf.pane_aria")}>
      <header className="pdf-pane-head">
        <div className="pdf-pane-title">
          <strong>{t("pdf.original")}</strong>
          <span className="pdf-pane-doc" title={doc?.name}>{doc?.name}</span>
        </div>
        <div className="pdf-pane-nav">
          <button
            type="button"
            className="btn-outline btn-compact"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            {t("pdf.prev")}
          </button>
          <span className="pdf-pane-page">{page} / {total}</span>
          <button
            type="button"
            className="btn-outline btn-compact"
            disabled={page >= total}
            onClick={() => setPage((p) => Math.min(total, p + 1))}
          >
            {t("pdf.next")}
          </button>
          <button type="button" className="btn-outline btn-compact" onClick={onClose}>
            {t("pdf.close")}
          </button>
        </div>
      </header>

      <div className="pdf-pane-viewport">
        {error ? <p className="error">{error}</p> : null}
        {loading && !src ? <p className="muted">{t("pdf.loading")}</p> : null}
        {src ? (
          <div className="pdf-page-wrap">
            <img className="pdf-page-img" src={src} alt={`${doc?.name} 第 ${page} 页`} />
            {showBox ? (
              <div
                ref={boxRef}
                className="pdf-row-box"
                style={{
                  top: `${bbox.y * 100}%`,
                  height: `${Math.max(bbox.h * 100, 0.6)}%`,
                  left: `${bbox.x * 100}%`,
                  width: `${bbox.w * 100}%`,
                }}
                aria-hidden="true"
              />
            ) : null}
          </div>
        ) : null}
        {src && !showBox && row ? (
          <p className="pdf-pane-hint">{t("pdf.no_box")}</p>
        ) : null}
      </div>
    </aside>
  );
}
