import React from "react";

export function Pagination({ page, onPrevious, onNext, canPrevious, canNext, label }) {
  return (
    <div className="pager">
      <button disabled={!canPrevious} onClick={onPrevious}>
        上一页
      </button>
      <span>{label ?? `第 ${page} 页`}</span>
      <button disabled={!canNext} onClick={onNext}>
        下一页
      </button>
    </div>
  );
}
