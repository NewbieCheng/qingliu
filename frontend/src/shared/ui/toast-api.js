let sequence = 0;

export function toast(message, type = "success") {
  if (typeof window === "undefined" || !message) return;
  window.dispatchEvent(
    new CustomEvent("ql:toast", {
      detail: { id: ++sequence, message: String(message), type },
    }),
  );
}
