import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "@/shared/ui/icons.jsx";
import { useI18n } from "@/shared/i18n/index.jsx";

export function Modal({ title, onClose, children, className = "" }) {
  const { t } = useI18n();
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${className}`.trim()}
      >
        <header className="modal-header">
          <h2>{title}</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label={t("common.close")}
            autoFocus
          >
            <XIcon size={16} />
          </button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  );
}
