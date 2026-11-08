import React from "react";
import { formatCents } from "@/shared/lib/format.js";

export function AccountingSummary({ summary }) {
  const stats = [
    ["原始总流入", summary.original_income],
    ["范围外", summary.scope_excluded_income],
    ["重复隔离", summary.quarantined_income],
    ["当前测算流入", summary.income],
    ["暂计经营（未核实）", summary.included],
  ];

  return (
    <>
      <div className="accounting">
        {stats.map(([title, value], index) => (
          <div key={title} className={index === 4 ? "emphasis" : ""}>
            <span>{title}</span>
            <strong>{formatCents(value)}</strong>
            <small>元</small>
          </div>
        ))}
      </div>
      <p className="muted accounting-note">
        原始总流入 = 范围外 + 重复隔离 + 无效行可识别流入 + 当前测算流入。
        无效行可识别流入：{formatCents(summary.invalid_income)} 元。不同来源分别统计。
      </p>
    </>
  );
}
