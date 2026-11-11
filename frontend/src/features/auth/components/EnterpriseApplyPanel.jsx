import React, { useState } from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
import { toast } from "@/shared/ui/toast-api.js";

// 企业注册：与「今天不加班」工作台同一套线下开通流程。
// 企业账号由客服在工作台后台创建，这里只收集申请信息：
// 「提交申请」打开微信客服弹窗，「复制信息」把申请拼成文本进剪贴板。
// 全程不调后端接口（与工作台 EnterpriseRegisterPanel 一致）。

const WECHAT_ID = "sihai332211";

export function EnterpriseApplyPanel() {
  const { t } = useI18n();
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [remark, setRemark] = useState("");
  const [errors, setErrors] = useState({});
  const [wechatOpen, setWechatOpen] = useState(false);
  const [validated, setValidated] = useState(null);

  function readForm() {
    return {
      company_name: companyName.trim(),
      contact_name: contactName.trim(),
      contact_phone: contactPhone.trim(),
      contact_email: contactEmail.trim(),
      job_title: jobTitle.trim(),
      remark: remark.trim(),
    };
  }

  // 必填 4 项与工作台一一对应：企业名称 / 联系人 / 联系电话 / 工作邮箱。
  function validate() {
    const values = readForm();
    const nextErrors = {};
    if (!values.company_name) nextErrors.company_name = t("enterprise.company_required");
    if (!values.contact_name) nextErrors.contact_name = t("enterprise.contact_required");
    if (!values.contact_phone) nextErrors.contact_phone = t("enterprise.phone_required");
    if (!values.contact_email) nextErrors.contact_email = t("enterprise.email_required");
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.contact_email)) {
      nextErrors.contact_email = t("auth.invalid_email");
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0 ? values : null;
  }

  function buildCopyText(values) {
    const optional = (label, value) => `${label}: ${value || "—"}`;
    return [
      t("enterprise.copy_title"),
      optional(t("enterprise.company"), values.company_name),
      optional(t("enterprise.contact"), values.contact_name),
      optional(t("enterprise.phone"), values.contact_phone),
      optional(t("enterprise.work_email"), values.contact_email),
      optional(t("enterprise.job_title"), values.job_title),
      optional(t("enterprise.remark"), values.remark),
    ].join("\n");
  }

  async function copyText(text, okMessage) {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMessage);
    } catch {
      toast(t("auth.copy_failed"), "error");
    }
  }

  function onApply() {
    const values = validate();
    if (!values) return;
    setValidated(values);
    setWechatOpen(true);
  }

  function onCopyInfo() {
    const values = validate();
    if (!values) return;
    void copyText(buildCopyText(values), t("enterprise.info_copied"));
  }

  return (
    <>
      <p className="auth-enterprise-intro">
        {t("enterprise.intro")}
      </p>

      <div className="auth-form auth-enterprise-fields">
        <label className="auth-field">
          <span className="auth-label">{t("enterprise.company")} *</span>
          <input
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            maxLength={60}
            placeholder={t("enterprise.company_placeholder")}
          />
          {errors.company_name && <span className="auth-field-error">{errors.company_name}</span>}
        </label>

        <label className="auth-field">
          <span className="auth-label">{t("enterprise.contact")} *</span>
          <input
            value={contactName}
            onChange={(event) => setContactName(event.target.value)}
            maxLength={30}
            placeholder={t("enterprise.name_placeholder")}
          />
          {errors.contact_name && <span className="auth-field-error">{errors.contact_name}</span>}
        </label>

        <div className="auth-field-row">
          <label className="auth-field">
            <span className="auth-label">{t("enterprise.phone")} *</span>
            <input
              value={contactPhone}
              onChange={(event) => setContactPhone(event.target.value)}
              maxLength={20}
              inputMode="tel"
              placeholder={t("enterprise.phone_placeholder")}
            />
            {errors.contact_phone && <span className="auth-field-error">{errors.contact_phone}</span>}
          </label>

          <label className="auth-field">
            <span className="auth-label">{t("enterprise.work_email")} *</span>
            <input
              value={contactEmail}
              onChange={(event) => setContactEmail(event.target.value)}
              maxLength={120}
              type="email"
              placeholder="name@company.com"
            />
            {errors.contact_email && <span className="auth-field-error">{errors.contact_email}</span>}
          </label>
        </div>

        <label className="auth-field">
          <span className="auth-label">{t("enterprise.job_title")}</span>
          <input
            value={jobTitle}
            onChange={(event) => setJobTitle(event.target.value)}
            maxLength={30}
            placeholder={t("enterprise.job_title_placeholder")}
          />
        </label>

        <label className="auth-field">
          <span className="auth-label">{t("enterprise.remark")}</span>
          <textarea
            value={remark}
            onChange={(event) => setRemark(event.target.value)}
            maxLength={300}
            rows={3}
            placeholder={t("enterprise.remark_placeholder")}
          />
        </label>
      </div>

      <div className="auth-enterprise-actions">
        <button type="button" className="auth-submit auth-enterprise-apply" onClick={onApply}>
          {t("enterprise.submit")}
        </button>
        <button type="button" className="auth-ghost auth-enterprise-copy" onClick={onCopyInfo}>
          {t("enterprise.copy")}
        </button>
      </div>

      {wechatOpen && (
        <div
          className="auth-modal"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setWechatOpen(false);
          }}
        >
          <div
            className="auth-modal-sheet auth-wechat-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-wechat-title"
          >
            <header className="auth-modal-head">
              <h2 id="auth-wechat-title">{t("enterprise.wechat_title")}</h2>
              <button
                type="button"
                className="auth-modal-close"
                aria-label={t("common.close")}
                onClick={() => setWechatOpen(false)}
              >
                <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <path d="m5 5 10 10M15 5 5 15" />
                </svg>
              </button>
            </header>

            <p className="auth-modal-reason">
              {t("enterprise.steps_intro")}
            </p>

            <ol className="auth-wechat-steps">
              <li><span className="auth-wechat-step-no">1</span>{t("enterprise.step_copy_contact")}</li>
              <li><span className="auth-wechat-step-no">2</span>{t("enterprise.step_send_info")}</li>
              <li><span className="auth-wechat-step-no">3</span>{t("enterprise.step_wait")}</li>
            </ol>

            <div className="auth-wechat-card">
              <span className="auth-wechat-label">{t("auth.wechat_support")}</span>
              <span className="auth-wechat-id">{WECHAT_ID}</span>
              <button
                type="button"
                className="auth-verify-btn"
                onClick={() => void copyText(WECHAT_ID, t("auth.wechat_copied"))}
              >
                {t("auth.copy_wechat")}
              </button>
            </div>

            <div className="auth-wechat-footer">
              <button
                type="button"
                className="auth-ghost auth-enterprise-copy"
                onClick={() => {
                  if (validated) void copyText(buildCopyText(validated), t("enterprise.info_copied"));
                }}
              >
                {t("enterprise.copy")}
              </button>
              <button
                type="button"
                className="auth-modal-primary"
                onClick={() => setWechatOpen(false)}
              >
                {t("auth.got_it")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
