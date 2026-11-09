import React, { useState } from "react";
import { toast } from "@/shared/ui/toast-api.js";

// 企业注册：与「今天不加班」工作台同一套线下开通流程。
// 企业账号由客服在工作台后台创建，这里只收集申请信息：
// 「提交申请」打开微信客服弹窗，「复制信息」把申请拼成文本进剪贴板。
// 全程不调后端接口（与工作台 EnterpriseRegisterPanel 一致）。

const WECHAT_ID = "sihai332211";

const COPY_TITLE = "【企业注册申请 - 今天不加班·智能团】";

export function EnterpriseApplyPanel() {
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
    if (!values.company_name) nextErrors.company_name = "请输入企业名称";
    if (!values.contact_name) nextErrors.contact_name = "请输入联系人姓名";
    if (!values.contact_phone) nextErrors.contact_phone = "请输入联系电话";
    if (!values.contact_email) nextErrors.contact_email = "请输入工作邮箱";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.contact_email)) {
      nextErrors.contact_email = "邮箱格式不正确";
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0 ? values : null;
  }

  function buildCopyText(values) {
    const optional = (label, value) => `${label}：${value || "—"}`;
    return [
      COPY_TITLE,
      `企业名称：${values.company_name}`,
      `联系人：${values.contact_name}`,
      `联系电话：${values.contact_phone}`,
      `工作邮箱：${values.contact_email}`,
      optional("职位", values.job_title),
      optional("需求说明", values.remark),
    ].join("\n");
  }

  async function copyText(text, okMessage) {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMessage);
    } catch {
      toast("复制失败请手动复制", "error");
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
    void copyText(buildCopyText(values), "申请信息已复制");
  }

  return (
    <>
      <p className="auth-enterprise-intro">
        请填写企业信息，提交申请后添加微信客服完成开通。
      </p>

      <div className="auth-form auth-enterprise-fields">
        <label className="auth-field">
          <span className="auth-label">企业名称 *</span>
          <input
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            maxLength={60}
            placeholder="例如：某某科技有限公司"
          />
          {errors.company_name && <span className="auth-field-error">{errors.company_name}</span>}
        </label>

        <label className="auth-field">
          <span className="auth-label">联系人 *</span>
          <input
            value={contactName}
            onChange={(event) => setContactName(event.target.value)}
            maxLength={30}
            placeholder="您的姓名"
          />
          {errors.contact_name && <span className="auth-field-error">{errors.contact_name}</span>}
        </label>

        <div className="auth-field-row">
          <label className="auth-field">
            <span className="auth-label">联系电话 *</span>
            <input
              value={contactPhone}
              onChange={(event) => setContactPhone(event.target.value)}
              maxLength={20}
              inputMode="tel"
              placeholder="手机或座机"
            />
            {errors.contact_phone && <span className="auth-field-error">{errors.contact_phone}</span>}
          </label>

          <label className="auth-field">
            <span className="auth-label">工作邮箱 *</span>
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
          <span className="auth-label">职位（可选）</span>
          <input
            value={jobTitle}
            onChange={(event) => setJobTitle(event.target.value)}
            maxLength={30}
            placeholder="如：IT 负责人"
          />
        </label>

        <label className="auth-field">
          <span className="auth-label">需求说明（可选）</span>
          <textarea
            value={remark}
            onChange={(event) => setRemark(event.target.value)}
            maxLength={300}
            rows={3}
            placeholder="团队规模、使用场景等"
          />
        </label>
      </div>

      <div className="auth-enterprise-actions">
        <button type="button" className="auth-submit auth-enterprise-apply" onClick={onApply}>
          提交申请
        </button>
        <button type="button" className="auth-ghost auth-enterprise-copy" onClick={onCopyInfo}>
          复制信息
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
              <h2 id="auth-wechat-title">添加微信客服完成开通</h2>
              <button
                type="button"
                className="auth-modal-close"
                aria-label="关闭"
                onClick={() => setWechatOpen(false)}
              >
                <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <path d="m5 5 10 10M15 5 5 15" />
                </svg>
              </button>
            </header>

            <p className="auth-modal-reason">
              请按以下步骤联系专属客服，我们将尽快为您开通企业账号。
            </p>

            <ol className="auth-wechat-steps">
              <li><span className="auth-wechat-step-no">1</span>复制下方微信号，打开微信添加好友</li>
              <li><span className="auth-wechat-step-no">2</span>将申请信息发送给客服（可先点「复制信息」）</li>
              <li><span className="auth-wechat-step-no">3</span>等待审核通过即可登录企业控制台</li>
            </ol>

            <div className="auth-wechat-card">
              <span className="auth-wechat-label">联系微信客服：</span>
              <span className="auth-wechat-id">{WECHAT_ID}</span>
              <button
                type="button"
                className="auth-verify-btn"
                onClick={() => void copyText(WECHAT_ID, "微信号已复制")}
              >
                复制微信号
              </button>
            </div>

            <div className="auth-wechat-footer">
              <button
                type="button"
                className="auth-ghost auth-enterprise-copy"
                onClick={() => {
                  if (validated) void copyText(buildCopyText(validated), "申请信息已复制");
                }}
              >
                复制信息
              </button>
              <button
                type="button"
                className="auth-modal-primary"
                onClick={() => setWechatOpen(false)}
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
