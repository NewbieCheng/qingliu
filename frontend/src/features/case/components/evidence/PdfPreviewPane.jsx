import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
import { SplitDock } from "@/shared/ui/SplitDock.jsx";
import { originalPageURL } from "../../api.js";
import { loadPageURL } from "@/shared/cache/pageCache.js";
import "./pdf-preview-pane.css";

// 原件 PDF 对照面板（右侧可拖拽浮窗）。
//
// 为什么不渲染 PDF：服务端已把每页渲染成图并带缓存，直接显示图片更快，
// 也不用引入 pdf.js 的体积。行定位靠解析时记录的归一化 bbox 叠加高亮框。
//
// 页图走三级缓存（内存 → IndexedDB → 服务器）：同一页第二次打开不再请求，
// 刷新页面后依然命中，只有真正没缓存过才打服务器。
function loadPage(cid, did, page, sha, signal) {
  return loadPageURL({
    cid,
    did,
    page,
    sha,
    buildURL: originalPageURL,
    signal,
  });
}

function Viewer({ cid, doc, row, totalPages, onClose, variant }) {
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

  return (
    <SplitDock
      variant={variant}
      title={t("pdf.original")}
      subtitle={doc?.name}
      toolbar={toolbar}
      onClose={onClose}
    >
      {body}
    </SplitDock>
  );
}

export function PdfPreviewPane({ cid, doc, row, totalPages, onClose, variant = "fixed" }) {
  if (!doc?.id) return null;
  return (
    <Viewer
      cid={cid}
      doc={doc}
      row={row}
      totalPages={totalPages}
      onClose={onClose}

      variant={variant}
    />
  );
}
