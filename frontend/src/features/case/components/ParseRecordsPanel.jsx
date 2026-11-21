import React, { useEffect, useMemo, useState } from "react";
import { DOCUMENT_STATUS, SOURCES } from "@/shared/lib/constants.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";
import { useI18n } from "@/shared/i18n/index.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import { RefreshIcon } from "@/shared/ui/icons.jsx";
import { generalParse, reparseBatch } from "../api.js";
import { ParseDetailDialog } from "./ParseDetailDialog.jsx";
import "./parse-records.css";

const PAGE_SIZE = 5;
const VERDICT_TONE = { ok: "green", suspect: "amber", fail: "red" };

function caseIdFromPath() {
  const m = window.location.pathname.match(/\/clients\/([^/?]+)/);
  return m ? m[1] : "";
}

// 解析记录快捷面板：编号列表 + 5/页 + 全选 + 查看大弹窗 + 勾选后批量重新解析。
// 用户勾选历史资料 → 作为一批重新放回解析（复用 reparse），无需再次上传。
export function ParseRecordsPanel({ data, onReparsed }) {
  const { t } = useI18n();
  const docs = data?.docs || [];
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(() => new Set());
  const [detail, setDetail] = useState(null);
  const [generalResult, setGeneralResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyDetail, setBusyDetail] = useState(false);
  // 高成本操作先确认：重新解析会真花钱，不能一点就跑。
  const [confirming, setConfirming] = useState(false);

  const totalPages = Math.max(1, Math.ceil(docs.length / PAGE_SIZE));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageDocs = useMemo(
    () => docs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [docs, page],
  );
  const allOnPageSelected =
    pageDocs.length > 0 && pageDocs.every((d) => selected.has(d.id));

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageDocs.forEach((d) => next.delete(d.id));
      else pageDocs.forEach((d) => next.add(d.id));
      return next;
    });
  }

  async function handleBatchReparse() {
    const chosen = docs.filter((d) => selected.has(d.id));
    if (!chosen.length) {
      toast("请先勾选要重新解析的资料", "error");
      return;
    }
    setBusy(true);
    try {
      const results = await reparseBatch(caseIdFromPath(), chosen);
      const ok = results.filter((r) => r.ok).length;
      toast(`已将 ${ok}/${results.length} 份资料放回解析队列`);
      setSelected(new Set());
      setConfirming(false);
      if (onReparsed) onReparsed();
    } catch (e) {
      toast(e.message || "重新解析失败", "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleGeneralParse(doc) {
    if (!doc) return;
    setBusyDetail(true);
    setGeneralResult(null);
    try {
      const r = await generalParse(caseIdFromPath(), doc.id, "key_facts", "提取关键信息");
      setGeneralResult(r.result);
    } catch (e) {
      toast(e.message || "AI 提取失败", "error");
    } finally {
      setBusyDetail(false);
    }
  }

  if (!docs.length) return null;

  return (
    <div className="pr-panel">
      <div className="pr-header">
        <div>
          <h3 className="pr-title">解析记录</h3>
          <p className="muted">
            共 {docs.length} 份 · 勾选后可重新放回解析队列（无需重新上传）
          </p>
        </div>
        <div className="pr-actions">
          {confirming ? (
            <span className="pr-confirm" role="alert">
              会重新调用 AI 解析，可能消耗积分。
              <button type="button" className="btn-outline btn-compact" onClick={() => setConfirming(false)}>
                取消
              </button>
              <button
                type="button"
                className="btn-outline-warning"
                disabled={busy}
                onClick={handleBatchReparse}
              >
                <RefreshIcon size={14} />{busy ? "提交中…" : `确认重新解析 ${selected.size} 份`}
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="btn-outline-warning"
              disabled={busy || selected.size === 0}
              title="重新调用 AI 解析，会消耗积分"
              onClick={() => setConfirming(true)}
            >
              <RefreshIcon size={14} />重新解析（已选 {selected.size}）
            </button>
          )}
        </div>
      </div>

      <div className="pr-list">
        {pageDocs.map((doc, i) => {
          const meta = doc.meta || {};
          const globalNo = (page - 1) * PAGE_SIZE + i + 1;
          const verdict = meta.verdict;
          return (
            <div className="pr-row" key={doc.id}>
              <label className="pr-check">
                <input
                  type="checkbox"
                  checked={selected.has(doc.id)}
                  onChange={() => toggle(doc.id)}
                />
                <span className="pr-no">{globalNo}</span>
              </label>
              <button
                type="button"
                className="pr-main"
                onClick={() => {
                  setDetail(doc);
                  setGeneralResult(null);
                }}
              >
                <span className="pr-name">{doc.name}</span>
                <span className="pr-meta">
                  {t(SOURCES[meta.source] || "source.other")} · {meta.pages || 0} 页 · {meta.rows || 0} 笔
                  {meta.doc_type === "form" ? " · 表单" : ""}
                </span>
              </button>
              <span className="pr-badges">
                {verdict ? (
                  <StatusBadge tone={VERDICT_TONE[verdict] || "default"}>
                    {verdict === "ok" ? "识别正常" : verdict === "suspect" ? "需核对" : "识别失败"}
                  </StatusBadge>
                ) : null}
                <StatusBadge tone={meta.status !== "success" ? "amber" : "default"}>
                  {t(DOCUMENT_STATUS[meta.status] || "doc.failed")}
                </StatusBadge>
              </span>
            </div>
          );
        })}
      </div>

      <div className="pr-footer">
        <label className="pr-selectall">
          <input type="checkbox" checked={allOnPageSelected} onChange={togglePage} />
          本页全选
        </label>
        <div className="pr-pager">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</button>
          <span>第 {page} / {totalPages} 页</span>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>下一页</button>
        </div>
      </div>

      {detail ? (
        <ParseDetailDialog
          cid={caseIdFromPath()}
          doc={detail}
          onClose={() => setDetail(null)}
          onGeneralParse={handleGeneralParse}
          onRequestReparse={async (target) => {
            // 导诊按钮「重新识别」：只重跑这一份，不走批量勾选。
            try {
              await reparseBatch(caseIdFromPath(), [target]);
              toast("已放回解析队列");
              setDetail(null);
              if (onReparsed) onReparsed();
            } catch (e) {
              toast(e.message || "重新解析失败", "error");
            }
          }}
          generalResult={generalResult}
          busy={busyDetail}
        />
      ) : null}
    </div>
  );
}
