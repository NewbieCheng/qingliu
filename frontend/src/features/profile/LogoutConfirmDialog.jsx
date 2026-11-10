import React, { useState } from "react";
import { Modal } from "@/shared/ui/Modal.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import { navigate } from "@/shared/router/index.js";
import { logout } from "./api.js";

export function LogoutConfirmDialog({ onClose }) {
  const [busy, setBusy] = useState(false);

  async function onConfirm() {
    if (busy) return;
    setBusy(true);
    try {
      await logout();
      navigate("/login");
    } catch (error) {
      toast(error.message || "退出失败", "error");
      setBusy(false);
    }
  }

  return (
    <Modal title="退出登录" onClose={onClose}>
      <p className="account-dialog-lead">
        退出后需要重新登录才能继续使用青流。当前设备上的会话会被结束，不影响其他设备。
      </p>
      <div className="account-dialog-actions">
        <button type="button" className="ghost" onClick={onClose} disabled={busy}>
          取消
        </button>
        <button type="button" className="primary" onClick={() => void onConfirm()} disabled={busy}>
          {busy ? "正在退出…" : "确认退出"}
        </button>
      </div>
    </Modal>
  );
}
