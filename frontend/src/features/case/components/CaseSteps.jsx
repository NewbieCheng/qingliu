import React from "react";
import { CASE_STEPS } from "../constants.js";

export function CaseSteps({ step, onChange }) {
  return (
    <div className="steps">
      {CASE_STEPS.map(([key, label], index) => (
        <button
          className={step === key ? "active" : ""}
          key={key}
          onClick={() => onChange(key)}
        >
          <span>{index + 1}</span>
          {label}
        </button>
      ))}
    </div>
  );
}
