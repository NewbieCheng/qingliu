import React from "react";
import { formatCents } from "@/shared/lib/format.js";
import { AlertIcon } from "@/shared/ui/icons.jsx";

export function AccountingSummary({ summary }) {
  const note =
    `原始总流入 = 范围外 + 重复隔离 + 无效行可识别流入 + 当前测算流入。` +
    `无效行可识别流入：${formatCents(summary.invalid_income)} 元。不同来源分别统计。`;

  const stats = [
    ["原始总流入", summary.original_income, true],
    ["范围外", summary.scope_excluded_income, false],
    ["重复隔离", summary.quarantined_income, false],
    ["当前测算流入", summary.income, false],
    ["暂计经营（未核实）", summary.included, false],
  ];

  return (
    <section className="accounting-panel" aria-label="核算摘要">
      <div className="accounting">
        {stats.map(([title, value, withNote], index) => (
          <div key={title} className={index === 4 ? "emphasis" : ""}>
            <span className="accounting-label">
              {title}
              {withNote ? (
                <button
                  type="button"
                  className="accounting-note-tip"
                  title={note}
                  aria-label={note}
                >
                  <AlertIcon size={13} />
                </button>
              ) : null}
            </span>
            <strong>{formatCents(value)}</strong>
            <small>元</small>
          </div>
        ))}
      </div>
    </section>
  );
}
