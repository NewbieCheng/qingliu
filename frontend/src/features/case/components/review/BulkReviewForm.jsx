import React from "react";
import { Form } from "@/shared/ui/Form.jsx";
import { Select } from "@/shared/ui/FormRow.jsx";
import { REVIEW_OPTIONS } from "../../constants.js";

export function BulkReviewForm({ selectedCount, busy, onSave }) {
  return (
    <Form onSave={onSave}>
      <div className="review-action">
        <strong>已选 {selectedCount} 笔</strong>
        <Select name="label" label="处理方式" aria-label="处理方式">
          {REVIEW_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <input
          name="reason"
          aria-label="处理依据"
          placeholder="填写适用于每笔交易的原件或凭证依据"
          required
        />
        <button className="primary" disabled={busy || !selectedCount}>
          保存处理
        </button>
      </div>
    </Form>
  );
}
