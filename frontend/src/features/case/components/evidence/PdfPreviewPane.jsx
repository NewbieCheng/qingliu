import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
import { FloatingPane } from "@/shared/ui/FloatingPane.jsx";
import { originalPageURL } from "../../api.js";
import "./pdf-preview-pane.css";

// 原件 PDF 对照面板。
//
// 两种形态，用户可随时切换：
//   float（默认）—— 独立浮窗，标题栏拖动可移到任何位置，右下角可缩放。
//                   适合"一边翻表格一边瞄原件"，也不会把表格挤窄。
//   dock        —— 并排核对：左侧识别信息、右侧原件固定一栏。
//                   适合逐行核对，两边都不动。
//
// 为什么不渲染 PDF：服务端已把每页渲染成图并带缓存，直接显示图片更快，
// 也不用引入 pdf.js 的体积。行定位靠解析时记录的归一化 bbox 叠加高亮框。

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

function Viewer({ cid, doc, row, totalPages, onClose, mode, onModeChange }) {
  const { t } = useI18n();
  const [page, setPage] = useState(Number(row?.page) || 1);
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const boxRef = useRef(null);

  const total = Math.max(Number(totalPages) || 1, 1);
  const bbox = row?.bbox;
  const rowPage = Number(row?.page) || 1;

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

  useEffect(() => {
    if (!bbox || page !== rowPage) return;
    boxRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [bbox, page, rowPage, src]);

  const showBox = bbox && page === rowPage && src;

  const toolbar = (
    <>
      <div className="pdf-zoom" role="group" aria-label={t("pdf.zoom_aria")}>
        <button
          type="button"
          className="btn-outline btn-compact"
          disabled={zoom <= 0.5}
          title={t("pdf.zoom_out")}
          onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))}
        >
          −
        </button>
        <button
          type="button"
          className="pdf-zoom-value"
          title={t("pdf.zoom_reset")}
          onClick={() => setZoom(1)}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          className="btn-outline btn-compact"
          disabled={zoom >= 4}
          title={t("pdf.zoom_in")}
          onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.25) * 100) / 100))}
        >
          +
        </button>
      </div>
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
      <button
        type="button"
        className="btn-outline btn-compact"
        title={t("pdf.switch_mode_hint")}
        onClick={() => onModeChange?.(mode === "float" ? "dock" : "float")}
      >
        {mode === "float" ? t("pdf.mode_dock") : t("pdf.mode_float")}
      </button>
    </>
  );

  const body = (
    <div className="pdf-pane-viewport">
      {error ? <p className="error">{error}</p> : null}
      {loading && !src ? <p className="muted">{t("pdf.loading")}</p> : null}
      {src ? (
        <div className="pdf-page-wrap" style={{ width: `${Math.round(zoom * 100)}%` }}>
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
      {src && !showBox && row ? <p className="pdf-pane-hint">{t("pdf.no_box")}</p> : null}
    </div>
  );

  if (mode === "dock") {
    return (
      <aside className="pdf-pane" aria-label={t("pdf.pane_aria")}>
        <header className="pdf-pane-head">
          <div className="pdf-pane-title">
            <strong>{t("pdf.original")}</strong>
            <span className="pdf-pane-doc" title={doc?.name}>{doc?.name}</span>
          </div>
          <div className="pdf-pane-nav">
            {toolbar}
            <button type="button" className="btn-outline btn-compact" onClick={onClose}>
              {t("pdf.close")}
            </button>
          </div>
        </header>
        {body}
      </aside>
    );
  }

  return (
    <FloatingPane
      title={t("pdf.original")}
      subtitle={doc?.name}
      toolbar={toolbar}
      onClose={onClose}
      ariaLabel={t("pdf.pane_aria")}
      defaultWidth={620}
      defaultHeight={680}
    >
      {body}
    </FloatingPane>
  );
}

export function PdfPreviewPane({ cid, doc, row, totalPages, onClose, mode, onModeChange }) {
  if (!doc?.id) return null;
  return (
    <Viewer
      cid={cid}
      doc={doc}
      row={row}
      totalPages={totalPages}
      onClose={onClose}
      mode={mode}
      onModeChange={onModeChange}
    />
  );
}
