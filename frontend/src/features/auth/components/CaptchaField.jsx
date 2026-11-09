import React, { useCallback, useEffect, useState } from "react";
import { api } from "@/shared/api/client.js";

// 人机验证：与工作台同一套点击式验证码。
//
// 后端返回 { captcha_id, type, svg, prompt, icon_target, sequence, objects }。
// 用户在 SVG 上按提示依次点击图标，点击结果拼成 captcha_code 提交后端校验。
// 这不是「输入四个字母」那种弱验证 —— 它是工作台正在用的图标序列挑战。

const PROMPT_TEXT = {
  click_largest: "请点击最大的图标",
  click_smallest: "请点击最小的图标",
  click_second_smallest: "请点击第二小的图标",
  click_icon: "请点击指定图标",
  click_sequence: "请按顺序依次点击图标",
  click_size_asc: "请按从大到小依次点击",
  click_size_desc: "请按从小到大依次点击",
};

const ICON_NAME = {
  fish: "小鱼",
  chili: "小米辣",
  potato: "土豆",
  onion: "洋葱",
  garlic: "大蒜",
  cake: "蛋糕",
  milk: "牛奶",
  scallion: "小葱",
};

function expectedSteps(captcha) {
  if (!captcha) return 1;
  if (captcha.prompt === "click_sequence") return (captcha.sequence || []).length || 1;
  if (captcha.prompt === "click_size_asc" || captcha.prompt === "click_size_desc") return 4;
  return 1;
}

export function CaptchaField({ value, onChange, onError }) {
  const [open, setOpen] = useState(false);
  const [captcha, setCaptcha] = useState(null);
  const [clicks, setClicks] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api("/api/auth/captcha?type=click");
      setCaptcha(data);
      setClicks([]);
      onChange?.("", data?.captcha_id || "");
    } catch (requestError) {
      setError(requestError.message);
      onError?.(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [onChange, onError]);

  useEffect(() => {
    if (open && !captcha) void load();
  }, [open, captcha, load]);

  // 点击 SVG 内的图标：SVG 的每个图标都带 data-captcha-id，
  // 用事件委托读取即可，不必自己算坐标（缩放/自适应都不会错位）。
  function handleCanvasClick(event) {
    const group = event.target.closest?.("[data-captcha-id]");
    const id = group?.getAttribute("data-captcha-id");
    const kind = group?.getAttribute("data-captcha-kind");
    if (!id) return;
    setClicks((previous) => [...previous, { id, kind }]);
    setError("");
  }

  // 按题型算出「用户应当依序点击的图标种类」。
  // 服务端只认元素 id，但**点击是否算对由题型决定**：
  //   click_sequence 必须按提示给出的种类顺序点；
  //   click_icon 必须点中 icon_target；
  //   尺寸类必须按大小顺序点前 4 个。
  // 之前直接把点击到的 id 拼起来提交，用户点错顺序也照样提交，
  // 结果是「验证码已通过」却一直登录失败。
  function expectedSequence() {
    if (!captcha) return [];
    const objects = captcha.objects || [];
    // 尺寸类题目按**面积**排序（宽高都可能不同），只按宽度会在同宽不同高时选错。
    const area = (o) => (o.w || 0) * (o.h || 0);
    switch (captcha.prompt) {
      case "click_sequence":
        return captcha.sequence || [];
      case "click_icon":
        return captcha.icon_target ? [captcha.icon_target] : [];
      case "click_largest": {
        const top = [...objects].sort((a, b) => area(b) - area(a))[0];
        return top ? [top.kind] : [];
      }
      case "click_smallest": {
        const top = [...objects].sort((a, b) => area(a) - area(b))[0];
        return top ? [top.kind] : [];
      }
      case "click_second_smallest": {
        const ranked = [...objects].sort((a, b) => area(a) - area(b));
        return ranked[1] ? [ranked[1].kind] : [];
      }
      case "click_size_asc": {
        return [...objects].sort((a, b) => area(b) - area(a)).slice(0, 4).map((o) => o.kind);
      }
      case "click_size_desc": {
        return [...objects].sort((a, b) => area(a) - area(b)).slice(0, 4).map((o) => o.kind);
      }
      default:
        return [];
    }
  }

  function confirm() {
    const expected = expectedSequence();
    const steps = expected.length || 1;
    if (clicks.length !== steps) {
      setError(`请依次点击 ${steps} 个图标（当前 ${clicks.length} 个）`);
      return;
    }
    // 顺序/种类不对时当场提示，不要把注定失败的答案提交上去。
    const wrong = expected.some((kind, index) => clicks[index]?.kind !== kind);
    if (wrong) {
      setError("点击顺序或图标不正确，请重新完成验证");
      return;
    }
    onChange?.(clicks.map((item) => item.id).join(","), captcha.captcha_id);
    setOpen(false);
    setError("");
  }

  const steps = expectedSteps(captcha);
  const targetName = ICON_NAME[captcha?.icon_target] || captcha?.icon_target || "";
  const promptText = captcha?.prompt === "click_icon" && targetName
    ? `请点击「${targetName}」`
    : PROMPT_TEXT[captcha?.prompt] || "请按提示依次点击图标";

  return (
    <>
      <div className="captcha-row">
        <input
          className="captcha-input"
          readOnly
          value={value ? "已完成人机验证" : ""}
          placeholder="请先完成人机验证"
          onClick={() => setOpen(true)}
        />
        <button type="button" className="captcha-trigger" onClick={() => setOpen(true)}>
          {value ? "重新验证" : "去验证"}
        </button>
      </div>

      {open && (
        <div className="captcha-modal" role="dialog" aria-modal="true" aria-label="人机验证">
          <div className="captcha-dialog">
            <div className="captcha-head">
              <span>真人验证</span>
              <button type="button" className="captcha-close" onClick={() => setOpen(false)}>×</button>
            </div>
            <p className="captcha-desc">请完成人机验证，防止恶意登录</p>
            <p className="captcha-prompt">
              {captcha?.sequence?.length > 0
                ? captcha.sequence.map((name, index) => (
                    <span key={name} className="captcha-step">
                      {index + 1}. {ICON_NAME[name] || name}
                    </span>
                  ))
                : promptText}
            </p>
            <div className="captcha-canvas" onClick={handleCanvasClick}>
              {loading && <span className="captcha-loading">加载中…</span>}
              {!loading && captcha?.svg && (
                <span dangerouslySetInnerHTML={{ __html: captcha.svg }} />
              )}
              {clicks.length > 0 && (
                <span className="captcha-picked">已选 {clicks.length}/{steps}</span>
              )}
            </div>
            {error && <p className="captcha-error">{error}</p>}
            <div className="captcha-actions">
              <button type="button" className="ghost" onClick={() => void load()} disabled={loading}>
                换一张
              </button>
              <button type="button" className="primary" onClick={confirm} disabled={loading}>
                确认（{clicks.length}/{steps}）
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
