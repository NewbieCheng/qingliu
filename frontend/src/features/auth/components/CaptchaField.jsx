import React, { useCallback, useEffect, useState } from "react";
import { api } from "@/shared/api/client.js";

// 图形验证码：与工作台同源同强度。工作台返回 SVG，这里直接以
// dangerouslySetInnerHTML 注入 —— SVG 由服务端生成，不含用户输入。
// 组件同时把 captcha_id/captcha_code 交给父级，父级提交时原样带给后端。
export function CaptchaField({ value, onChange, onError }) {
  const [captcha, setCaptcha] = useState(null);

  const load = useCallback(async () => {
    onError?.("");
    try {
      const data = await api("/api/auth/captcha?type=image");
      setCaptcha(data);
      onChange?.("", data?.captcha_id || "");
    } catch (requestError) {
      onError?.(requestError.message);
    }
  }, [onChange, onError]);

  // 只在挂载时拉一次；失败后由用户点击图片或父级换 key 重新挂载。
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="captcha-row">
      <input
        className="captcha-input"
        name="captcha_code"
        autoComplete="off"
        maxLength="8"
        required
        placeholder="请输入右侧字符"
        value={value}
        onChange={(event) => onChange?.(event.target.value, captcha?.captcha_id || "")}
      />
      <button
        type="button"
        className="captcha-image"
        onClick={() => void load()}
        title="看不清？点击换一张"
        aria-label="刷新验证码"
      >
        {captcha?.svg ? (
          <span dangerouslySetInnerHTML={{ __html: captcha.svg }} />
        ) : (
          <span className="captcha-loading">加载中…</span>
        )}
      </button>
    </div>
  );
}
