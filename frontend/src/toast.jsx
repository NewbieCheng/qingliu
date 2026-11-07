import React, { useEffect, useState } from "react";

let sequence = 0;

export function toast(message, type = "success") {
  if (typeof window === "undefined" || !message) return;
  window.dispatchEvent(
    new CustomEvent("ql:toast", {
      detail: { id: ++sequence, message: String(message), type },
    }),
  );
}

function ToastIcon({ type }) {
  if (type === "error") {
    return (
      <svg
        viewBox="0 0 20 20"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="10" cy="10" r="7.2" />
        <path d="M10 6.5v4.2M10 13.5h.01" />
      </svg>
    );
  }
  if (type === "info") {
    return (
      <svg
        viewBox="0 0 20 20"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="10" cy="10" r="7.2" />
        <path d="M10 9v4.5M10 6.5h.01" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 20 20"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m4.5 10.5 3.2 3.2 7.8-7.8" />
    </svg>
  );
}

export function ToastHost() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    const onToast = (event) => {
      const next = event.detail;
      setItems((current) => [...current.slice(-2), next]);
      window.setTimeout(() => {
        setItems((current) => current.filter((item) => item.id !== next.id));
      }, 3600);
    };
    const clearOnNavigate = () => setItems([]);
    window.addEventListener("ql:toast", onToast);
    window.addEventListener("ql:navigate", clearOnNavigate);
    return () => {
      window.removeEventListener("ql:toast", onToast);
      window.removeEventListener("ql:navigate", clearOnNavigate);
    };
  }, []);

  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      {items.map((item) => (
        <div className={`toast toast-${item.type}`} key={item.id} role="status">
          <ToastIcon type={item.type} />
          <span>{item.message}</span>
        </div>
      ))}
    </div>
  );
}
