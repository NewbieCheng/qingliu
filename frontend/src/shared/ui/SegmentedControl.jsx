import React, { useState } from "react";

/**
 * 横向分段单选。带 name 时可直接进 FormData；受控时传 value + onChange。
 * options: [{ value, label, hint? }]
 */
export function SegmentedControl({
  name,
  options,
  defaultValue,
  value,
  onChange,
  "aria-label": ariaLabel,
  className = "",
}) {
  const controlled = value !== undefined;
  const [internal, setInternal] = useState(
    defaultValue ?? options[0]?.value ?? "",
  );
  const current = controlled ? value : internal;

  return (
    <div
      className={`ql-segment${className ? ` ${className}` : ""}`}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const active = current === option.value;
        return (
          <label
            key={option.value}
            className={`ql-segment-item${active ? " is-active" : ""}`}
            title={option.hint || undefined}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={active}
              onChange={() => {
                if (!controlled) setInternal(option.value);
                onChange?.(option.value);
              }}
            />
            <span className="ql-segment-label">{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}
