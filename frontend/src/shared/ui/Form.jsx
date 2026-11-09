import React, { useState } from "react";
import { toast } from "@/shared/ui/toast-api.js";

export function Form({ onSave, children, className = "", success = "已保存" }) {
  const [busy, setBusy] = useState(false);
  return (
    <form
      className={className}
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const data = new FormData(event.currentTarget);
        setBusy(true);
        try {
          await onSave(data, event.currentTarget);
          if (success) toast(success);
        } catch (error) {
          // silent：用户主动取消（例如关掉人机验证）不是错误，不该弹 toast。
          if (!error?.silent) toast(error.message, "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy}>{children}</fieldset>
    </form>
  );
}

export function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
