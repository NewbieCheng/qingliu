import React, { useEffect, useState } from "react";
import { TRANSACTION_LABELS } from "@/shared/lib/constants.js";
import { formatCents } from "@/shared/lib/format.js";
import { Modal } from "@/shared/ui/Modal.jsx";
import { Pagination } from "@/shared/ui/Pagination.jsx";
import { originalPageURL } from "../../api.js";
import { loadPagePreview } from "../../lib/page-preview-cache.js";
import { prefetchNeighborPages } from "../../lib/prefetch-pages.js";
import { useI18n } from "@/shared/i18n/index.jsx";

export function OriginalEvidenceDialog({ cid, original, onClose }) {
  const { t } = useI18n();
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
        if (!cancelled) setPreviewError(error.message || t("case.original.load_failed"));
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [cid, isPdf, original.sha, page, row.document_id, t, total]);

  return (
    <Modal
      title={t("case.original.title", { page: page, total })}
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
              <img alt={t("case.original.page_image_alt", { page })} src={previewUrl} />
            ) : (
              <p style={{ color: "var(--muted)" }}>{t("case.original.loading_page")}</p>
            )}
            {total > 1 && (
              <Pagination
                page={page}
                onPrevious={() => setPage((value) => value - 1)}
                onNext={() => setPage((value) => value + 1)}
                canPrevious={page > 1}
                canNext={page < total}
                label={t("case.original.page_label", { page, total })}
              />
            )}
          </>
        )}
        <div>
          <dl>
            {[
              ["Date", row.date],
              ["Counterparty", row.counterparty],
              [t("case.original.income"), formatCents(row.income)],
              [t("case.original.expense"), formatCents(row.expense)],
              [t("case.original.balance"), formatCents(row.balance)],
              [t("case.original.own_account"), row.account],
              [t("case.original.counterparty_account"), row.counter_account],
              ["Memo", row.memo],
              [
                t("case.original.location"),
                t("case.original.location_value", { filename: row.filename, page: row.page, locator: row.locator }),
              ],
            ].map(([label, value]) => (
              <React.Fragment key={label}>
                <dt>{label}</dt>
                <dd>{value || t("review.original_not_provided")}</dd>
              </React.Fragment>
            ))}
          </dl>
          <h3>{t("case.original.raw_fields")}</h3>
          <pre>{row.raw}</pre>
          <h3>{t("case.original.confirmation_records")}</h3>
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
