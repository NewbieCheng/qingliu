import React from "react";

export function PageHeader({ eyebrow, title, description, actions, className = "" }) {
  return (
    <div className={`page-title ${className}`.trim()}>
      <div className="page-title-copy">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {actions ? <div className="page-title-actions">{actions}</div> : null}
    </div>
  );
}

export function SectionTitle({ title, description }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </div>
  );
}
