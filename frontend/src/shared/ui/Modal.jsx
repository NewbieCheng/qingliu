import React, { useEffect } from "react";

export function Modal({ title, onClose, children, className = "" }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
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
        <header>
          <h2>{title}</h2>
          <button type="button" className="ghost" onClick={onClose} autoFocus>
            关闭 ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
