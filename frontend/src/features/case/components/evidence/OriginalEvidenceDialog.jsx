import React, { useState } from "react";
import { TRANSACTION_LABELS } from "@/shared/lib/constants.js";
import { formatCents } from "@/shared/lib/format.js";
import { Modal } from "@/shared/ui/Modal.jsx";
import { Pagination } from "@/shared/ui/Pagination.jsx";
import { originalPageURL } from "../../api.js";

export function OriginalEvidenceDialog({ cid, original, onClose }) {
  const row = original.row;
  const isPdf = row.filename.toLowerCase().endsWith(".pdf");
  const total = Math.max(Number(original.pages) || row.page || 1, 1);
  const [page, setPage] = useState(Math.min(row.page || 1, total));

  return (
    <Modal
      title={`原件与确认记录${isPdf && total > 1 ? `（第 ${page}/${total} 页）` : ""}`}
      onClose={onClose}
    >
      <div className="original">
        {isPdf && (
          <>
            <img
              alt={`原件第${page}页`}
              src={originalPageURL(cid, row.document_id, page)}
            />
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
              ["日期", row.date],
              ["对手方", row.counterparty],
              ["收入（元）", formatCents(row.income)],
              ["支出（元）", formatCents(row.expense)],
              ["余额（元）", formatCents(row.balance)],
              ["本方账户", row.account],
              ["对方账户", row.counter_account],
              ["摘要", row.memo],
              [
                "定位",
                `${row.filename} · 第${row.page}页 · ${row.locator}`,
              ],
            ].map(([label, value]) => (
              <React.Fragment key={label}>
                <dt>{label}</dt>
                <dd>{value || "原件未提供"}</dd>
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
