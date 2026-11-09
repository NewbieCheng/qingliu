import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/shared/api/client.js";

// 人机验证挑战：与「今天不加班」工作台同一套点击式验证码，行为完全对齐
// 工作台 `CaptchaVerifyDialog`（出题规则、提交时机、容错次数都以它为准）。
//
// 后端返回 { captcha_id, svg, prompt, icon_target, sequence }。
// 用户在 SVG 上按提示依次点击图标，点击结果拼成 captcha_code 提交后端校验。
//
// 关键对齐点（之前这里是错的，导致「明明点对了、后端却判错」）：
// - click_size_asc = 从小到大，click_size_desc = 从大到小（之前写反了，
//   用户按界面提示点完，顺序正好和后端期望的相反，每次必败）。
// - 尺寸/单点类题目不在前端预判对错：后端按自己的尺寸口径校验，
//   前端只负责按用户点击顺序原样提交（工作台也是这么做的）。
//   唯一做前端即时校验的是 click_sequence——sequence 就在题目里，结果确定。
// - 单点类点一次就自动提交；序列类点满自动提交；点错 sequence 当场重置，
//   连续错 2 次换一张新题。
//
// 交互约定：登录/注册页不常驻验证码输入框。用户点「登录」/「获取验证码」
// 时才弹出本挑战验证通过后拿到 { captcha_id, captcha_code }再真正发请求。

const MAX_SEQUENCE_WRONG_ATTEMPTS = 2;

// 图标中文名与工作台 login.json captchaIcon 保持一致，题目里出现新种类时
// 回退显示原始 kind不至于展示空白。
const ICON_NAME = {
  fish: "清蒸鱼",
  cake: "蛋糕",
  egg: "荷包蛋",
  milk: "牛奶",
  chili: "小米辣",
  potato: "土豆",
  chocolate: "巧克力",
  garlic: "蒜",
  scallion: "蒜苗",
  mint: "薄荷",
  snow_lotus: "雪莲",
  sweet_potato: "土豆",
  bean: "雪莲",
};

function isSequencePrompt(prompt) {
  return prompt === "click_sequence" || prompt === "click_size_asc" || prompt === "click_size_desc";
}

// SVG 按 360x240 出题，弹窗里宽度自适应：加上 preserveAspectRatio="none"
// 让它铺满画布（与工作台 fillCaptchaViewport 同一处理）。
function fillCaptchaViewport(svg) {
  return String(svg).replace(/<svg\b([^>]*)>/, (_tag, attributes) => {
    const next = /\spreserveAspectRatio\s*=/.test(attributes)
      ? attributes.replace(/\spreserveAspectRatio\s*=\s*(["']).*?\1/, ' preserveAspectRatio="none"')
      : `${attributes} preserveAspectRatio="none"`;
    return `<svg${next}>`;
  });
}

export function CaptchaChallenge({ open, title, reason, onCancel, onSolved }) {
  const [captchaId, setCaptchaId] = useState("");
  const [captchaSvg, setCaptchaSvg] = useState("");
  const [prompt, setPrompt] = useState("");
  const [iconTarget, setIconTarget] = useState("");
  const [sequence, setSequence] = useState([]);
  const [clicks, setClicks] = useState([]);
  const [pickMarkers, setPickMarkers] = useState([]);
  const [wrongAttempts, setWrongAttempts] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const wrongAttemptsRef = useRef(0);
  const stageRef = useRef(null);
  const sheetRef = useRef(null);
  const completeTimer = useRef(null);

  const expectedSteps = useMemo(() => {
    if (prompt === "click_sequence") return sequence.length;
    if (prompt === "click_size_asc" || prompt === "click_size_desc") return 4;
    return 1;
  }, [prompt, sequence.length]);

  const promptHint = useMemo(() => {
    const iconLabel = ICON_NAME[iconTarget] || iconTarget || "图标";
    switch (prompt) {
      case "click_largest":
        return `请点击最大的${iconLabel}图标`;
      case "click_smallest":
        return `请点击最小的${iconLabel}图标`;
      case "click_second_smallest":
        return `请点击第二小的${iconLabel}图标`;
      case "click_icon":
        return `请点击${iconLabel}图标`;
      case "click_sequence":
        return "请按下方顺序依次点击对应图标";
      case "click_size_asc":
        return `请按从小到大的顺序依次点击全部${iconLabel}`;
      case "click_size_desc":
        return `请按从大到小的顺序依次点击全部${iconLabel}`;
      default:
        return "请点击图片中对应的图标完成验证";
    }
  }, [iconTarget, prompt]);

  const resetPickState = useCallback(() => {
    setClicks([]);
    setPickMarkers([]);
    wrongAttemptsRef.current = 0;
    setWrongAttempts(0);
    setError("");
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    resetPickState();
    try {
      const data = await api("/api/auth/captcha?type=click");
      if (!data?.captcha_id || !data?.svg) {
        setError("验证码加载失败，请刷新重试");
        return;
      }
      setCaptchaId(data.captcha_id);
      setCaptchaSvg(fillCaptchaViewport(data.svg));
      setPrompt(data.prompt ?? "");
      setIconTarget(data.icon_target ?? "");
      setSequence(data.sequence ?? []);
    } catch (requestError) {
      setError(requestError.message || "验证码加载失败请刷新重试");
    } finally {
      setLoading(false);
    }
  }, [resetPickState]);

  // 每次打开都换一张新题：验证码一次性有效，不能拿上一次的图重试。
  useEffect(() => {
    if (!open) return;
    setCaptchaId("");
    setCaptchaSvg("");
    setPrompt("");
    setIconTarget("");
    setSequence([]);
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return undefined;
    const node = sheetRef.current;
    const first = node?.querySelector("button, [href], input");
    first?.focus?.();
    function onKeyDown(event) {
      if (event.key === "Escape") onCancel?.();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (completeTimer.current) window.clearTimeout(completeTimer.current);
    };
  }, [open, onCancel]);

  if (!open) return null;

  function complete(code) {
    onSolved?.(code, captchaId);
    resetPickState();
  }

  function addPickMarker(target, id, order) {
    const stage = stageRef.current;
    if (!stage) return;
    const targetRect = target.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    setPickMarkers((previous) => [
      ...previous,
      {
        id,
        order,
        x: targetRect.left - stageRect.left + targetRect.width / 2,
        y: targetRect.top - stageRect.top + targetRect.height / 2,
      },
    ]);
    target.classList.add("is-picked");
  }

  function handleSequenceWrong() {
    const nextWrong = wrongAttemptsRef.current + 1;
    wrongAttemptsRef.current = nextWrong;
    setWrongAttempts(nextWrong);
    setClicks([]);
    setPickMarkers([]);
    stageRef.current?.querySelectorAll(".is-picked").forEach((node) => {
      node.classList.remove("is-picked");
    });
    if (nextWrong >= MAX_SEQUENCE_WRONG_ATTEMPTS) {
      setError("连续点错 2 次已刷新验证码");
      void load();
      return;
    }
    setError("顺序不正确请按提示重新点击");
  }

  function handleSvgClick(event) {
    if (loading) return;
    const target = event.target.closest?.("[data-captcha-id]");
    if (!target) return;
    const id = target.getAttribute("data-captcha-id");
    const kind = target.getAttribute("data-captcha-kind") ?? "";
    if (!id) return;

    // 单点类：点一次就提交，后端说了算，前端不预判。
    if (!isSequencePrompt(prompt)) {
      addPickMarker(target, id, 1);
      completeTimer.current = window.setTimeout(() => complete(id), 180);
      return;
    }

    if (clicks.includes(id)) return;

    // click_sequence：题目自带顺序，点错当场重置（与工作台一致）。
    // click_size_*：只管收集点满 4 个就提交，顺序由后端校验。
    if (prompt === "click_sequence") {
      const expectedKind = sequence[clicks.length];
      if (expectedKind && kind !== expectedKind) {
        handleSequenceWrong();
        return;
      }
    }

    const next = [...clicks, id];
    addPickMarker(target, id, next.length);
    setClicks(next);
    setError("");

    if (next.length >= expectedSteps) {
      completeTimer.current = window.setTimeout(() => complete(next.join(",")), 220);
    }
  }

  return (
    <div
      className="auth-modal"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel?.();
      }}
    >
      <div
        className="auth-modal-sheet"
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-challenge-title"
      >
        <header className="auth-modal-head">
          <h2 id="auth-challenge-title">{title || "真人验证"}</h2>
          <button
            type="button"
            className="auth-modal-close"
            aria-label="关闭验证"
            onClick={onCancel}
          >
            <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <path d="m5 5 10 10M15 5 5 15" />
            </svg>
          </button>
        </header>

        <p className="auth-modal-reason">
          {reason || "请完成人机验证，防止恶意注册。"}
        </p>

        <div className="auth-modal-prompt">
          {prompt === "click_sequence" && sequence.length > 0 ? (
            sequence.map((name, index) => (
              <span
                key={`${name}-${index}`}
                className={`auth-step ${index < clicks.length ? "is-done" : index === clicks.length ? "is-next" : ""}`}
              >
                <span className="auth-step-no">{index + 1}</span>
                {ICON_NAME[name] || name}
              </span>
            ))
          ) : (
            <span className="auth-step auth-step--single">{loading ? "题目加载中…" : promptHint}</span>
          )}
        </div>

        {(prompt === "click_size_asc" || prompt === "click_size_desc") && (
          <p className="auth-modal-progress">
            已点击 {clicks.length} / {expectedSteps}
          </p>
        )}
        {wrongAttempts > 0 && wrongAttempts < MAX_SEQUENCE_WRONG_ATTEMPTS && (
          <p className="auth-modal-progress">
            还可试错 {MAX_SEQUENCE_WRONG_ATTEMPTS - wrongAttempts} 次再错将刷新验证码
          </p>
        )}

        <div className="auth-challenge-stage">
          <div
            ref={stageRef}
            className="auth-challenge-canvas"
            onClick={handleSvgClick}
            role="presentation"
          >
            {loading && <span className="auth-challenge-loading">正在出题…</span>}
            {!loading && captchaSvg && (
              <span
                className="auth-challenge-svg"
                dangerouslySetInnerHTML={{ __html: captchaSvg }}
              />
            )}
            {!loading && !captchaSvg && !error && (
              <span className="auth-challenge-loading">题目为空，请换一张</span>
            )}
            {pickMarkers.map((marker) => (
              <span
                key={`${marker.id}-${marker.order}`}
                className="auth-pick-check"
                style={{ left: marker.x, top: marker.y }}
                aria-hidden="true"
              >
                ✓
              </span>
            ))}
          </div>
          <button
            type="button"
            className="auth-ghost auth-challenge-refresh"
            aria-label="换一张"
            onClick={() => void load()}
            disabled={loading}
          >
            <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M16.5 10a6.5 6.5 0 1 1-1.9-4.6" />
              <path d="M16.8 2.6v3.4h-3.4" />
            </svg>
          </button>
        </div>

        {error && (
          <p className="auth-modal-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
