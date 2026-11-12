import React from "react";
import { CASE_STEPS } from "../constants.js";
import { useI18n } from "@/shared/i18n/index.jsx";

export function CaseSteps({ step, onChange }) {
  const { t } = useI18n();
  return (
    <div className="steps">
      {CASE_STEPS.map(([key], index) => (
        <button
          className={step === key ? "active" : ""}
          key={key}
          onClick={() => onChange(key)}
        >
          <span>{index + 1}</span>
          {t(`step.${key}`)}
        </button>
      ))}
    </div>
  );
}
