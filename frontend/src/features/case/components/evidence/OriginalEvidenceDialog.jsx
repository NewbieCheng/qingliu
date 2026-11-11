import React, { useEffect, useState } from "react";
import { TRANSACTION_LABELS } from "@/shared/lib/constants.js";
import { formatCents } from "@/shared/lib/format.js";
import { Modal } from "@/shared/ui/Modal.jsx";
import { Pagination } from "@/shared/ui/Pagination.jsx";
import { originalPageURL } from "../../api.js";
import { loadPagePreview } from "../../lib/page-preview-cache.js";
import { prefetchNeighborPages } from "../../lib/prefetch-pages.js";

export function OriginalEvidenceDialog({ cid, original, onClose }) {
  const row = original.row;
  const isPdf = row.filename.toLowerCase().endsWith(".pdf");
  const total = Math.max(Number(original.pages) || row.page || 1, 1);
  const [page, setPage] = useState(Math.min(row.page || 1, total));
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewError, setPreviewError] = useState("");

  useEffect(() => {
    if (!isPdf) return undefined;
    let cancelled = false;
    let objectUrl = "";
    setPreviewError("");
    setPreviewUrl("");
    void loadPagePreview(
      cid,
      row.document_id,
      page,
      original.sha || "",
      originalPageURL(cid, row.document_id, page),
    )
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setPreviewUrl(url);
        void prefetchNeighborPages({
          cid,
          documentId: row.document_id,
          sha: original.sha || "",
          page,
          total,
        });
      })
      .catch((error) => {
        if (!cancelled) setPreviewError(error.message || "Failed to load original page");
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [cid, isPdf, original.sha, page, row.document_id, total]);

  return (
    <Modal
      title={`原件与确认记录${isPdf && total > 1 ? `（第 ${page}/${total} 页）` : ""}`}
      onClose={onClose}
    >
      <div className="original">
        {isPdf && (
          <>
            {previewError ? (
              <p className="error" role="alert">
                {previewError}
              </p>
            ) : previewUrl ? (
              <img alt={`原件第${page}页`} src={previewUrl} />
            ) : (
              <p style={{ color: "var(--muted)" }}>正在加载原件页…</p>
            )}
            {total > 1 && (
              <Pagination
                page={page}
                onPrevious={() => setPage((value) => value - 1)}
                onNext={() => setPage((value) => value + 1)}
                canPrevious={page > 1}
                canNext={page < total}
                label={`第 ${page} 页 / 共 ${total} 页`}
              />
            )}
          </>
        )}
        <div>
          <dl>
            {[
              ["Date", row.date],
              ["Counterparty", row.counterparty],
              ["收入（元）", formatCents(row.income)],
              ["支出（元）", formatCents(row.expense)],
              ["余额（元）", formatCents(row.balance)],
              ["本方账户", row.account],
              ["对方账户", row.counter_account],
              ["Memo", row.memo],
              [
                "定位",
                `${row.filename} · 第${row.page}页 · ${row.locator}`,
              ],
            ].map(([label, value]) => (
              <React.Fragment key={label}>
                <dt>{label}</dt>
                <dd>{value || "Original not provided"}</dd>
              </React.Fragment>
            ))}
          </dl>
          <h3>原始字段</h3>
          <pre>{row.raw}</pre>
          <h3>确认记录</h3>
          {original.audits.map((audit, index) => (
            <p key={index}>
              {audit.created} · {audit.operator} ·{" "}
              {TRANSACTION_LABELS[audit.label] || audit.label}：{audit.reason}
            </p>
          ))}
        </div>
      </div>
    </Modal>
  );
}
