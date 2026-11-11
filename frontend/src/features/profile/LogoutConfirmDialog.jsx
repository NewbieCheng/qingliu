import React, { useState } from "react";
import { Modal } from "@/shared/ui/Modal.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import { navigate } from "@/shared/router/index.js";
import { useI18n } from "@/shared/i18n/index.jsx";
import { logout } from "./api.js";

export function LogoutConfirmDialog({ onClose }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  async function onConfirm() {
    if (busy) return;
    setBusy(true);
    try {
      await logout();
      navigate("/login");
    } catch (error) {
      toast(error.message || t("auth.sign_out_failed"), "error");
      setBusy(false);
    }
  }

  return (
    <Modal title={t("auth.sign_out_title")} onClose={onClose}>
      <p className="account-dialog-lead">{t("auth.sign_out_description")}</p>
      <div className="account-dialog-actions">
        <button type="button" className="ghost" onClick={onClose} disabled={busy}>
          {t("common.cancel")}
        </button>
        <button type="button" className="primary" onClick={() => void onConfirm()} disabled={busy}>
          {busy ? t("auth.signing_out") : t("auth.confirm_sign_out")}
        </button>
      </div>
    </Modal>
  );
}
