/**
 * 两级门闩：一级浏览器环境；二级按文件 classify（预算跟 class，禁止一律 60s）。
 * class / route 只进内部态，不上用户文案。
 */

import { tStandalone } from "@/shared/i18n/core.js";
import { extOf } from "./upload-preflight.js";
import { probeDocxMedia } from "./docx-media-probe.js";

const HARD_LIMIT = {
  csv: 15 << 20,
  xlsx: 8 << 20,
  docx: 5 << 20,
};

const BANDS = {
  csv: { tiny: 256 << 10, small: 2 << 20, medium: 8 << 20 },
  xlsx: { tiny: 512 << 10, small: 2 << 20, medium: 5 << 20 },
  docx: { tiny: 512 << 10, small: 2 << 20, medium: 5 << 20 },
};

export const IMPORT_MS = 60_000;

function supportsDynamicImport() {
  // 现代引擎都有动态 import；残缺环境（极老内核）连 Promise 都缺，一级门闩会先拦。
  try {
    return typeof import.meta !== "undefined" || typeof document !== "undefined";
  } catch {
    return false;
  }
}

/** 一级：运行环境。失败 → reject，提示换浏览器/用电脑 */
export function checkBrowserEnvironment(
  globals = typeof globalThis !== "undefined" ? globalThis : {},
) {
  const missing = [];
  if (typeof globals.File === "undefined") missing.push("File");
  if (typeof globals.FileReader === "undefined") missing.push("FileReader");
  if (typeof globals.Blob === "undefined") missing.push("Blob");
  if (typeof globals.ArrayBuffer === "undefined") missing.push("ArrayBuffer");
  if (typeof globals.Promise === "undefined") missing.push("Promise");
  if (!supportsDynamicImport()) missing.push("dynamic_import");
  if (missing.length) {
    return {
      ok: false,
      level: 1,
      action: "reject",
      message: tStandalone("upload.browser_unsupported"),
      missing,
    };
  }
  return { ok: true, level: 1 };
}

export function kindOf(name) {
  switch (extOf(name)) {
    case ".csv":
      return "csv";
    case ".xlsx":
      return "xlsx";
    case ".docx":
      return "docx";
    case ".pdf":
      return "pdf";
    default:
      return "other";
  }
}

export function sizeBandOf(kind, size) {
  const hard = HARD_LIMIT[kind];
  if (hard != null && size > hard) return "over";
  const bands = BANDS[kind];
  if (!bands) return "medium";
  if (size <= bands.tiny) return "tiny";
  if (size <= bands.small) return "small";
  if (size <= bands.medium) return "medium";
  return "large";
}

export function isWeakDevice(nav = typeof navigator !== "undefined" ? navigator : {}) {
  if (nav.connection?.saveData) return true;
  const memory = Number(nav.deviceMemory);
  if (Number.isFinite(memory) && memory > 0 && memory <= 2) return true;
  const ua = String(nav.userAgent || "").toLowerCase();
  if (/iphone|ipod|android.+mobile|mobile/.test(ua) && memory > 0 && memory <= 4) {
    return true;
  }
  return false;
}

/**
 * 二级：对「当前这一份」打 class。
 * PDF 一律 boost_direct；docx 先轻量扫 media，过重 media_heavy，瘦表走本机。
 */
export async function classifyFile(file, options = {}) {
  const kind = kindOf(file?.name);
  const size = Number(file?.size) || 0;
  const sizeBand = sizeBandOf(kind, size);
  const deviceTier =
    options.deviceTier || (isWeakDevice(options.navigator) ? "weak" : "strong");
  const base = { kind, sizeBand, deviceTier };

  if (kind === "pdf" || kind === "other") {
    return { class: "boost_direct", route: "server", budgetMs: 0, ...base };
  }

  if (sizeBand === "over") {
    return { class: "too_heavy", route: "server", budgetMs: 0, ...base };
  }

  if (kind === "docx") {
    let mediaHint = "lean";
    try {
      const buffer =
        typeof file?.arrayBuffer === "function"
          ? await file.arrayBuffer()
          : options.docxBuffer;
      if (buffer) {
        mediaHint = probeDocxMedia(buffer, size).hint;
      }
    } catch {
      mediaHint = "heavy";
    }
    base.mediaHint = mediaHint;
    if (mediaHint === "heavy") {
      return { class: "media_heavy", route: "server", budgetMs: 0, ...base };
    }
    if (deviceTier === "weak" && sizeBand !== "tiny") {
      return { class: "weak_skip", route: "server", budgetMs: 0, ...base };
    }
    if (sizeBand === "tiny") {
      return { class: "instant", route: "client", budgetMs: 15_000, ...base };
    }
    if (sizeBand === "large" && deviceTier === "strong") {
      return { class: "heavy_try", route: "client", budgetMs: 60_000, ...base };
    }
    return { class: "normal", route: "client", budgetMs: 50_000, ...base };
  }

  if (
    deviceTier === "weak" &&
    (kind === "xlsx" || kind === "docx") &&
    sizeBand !== "tiny"
  ) {
    return { class: "weak_skip", route: "server", budgetMs: 0, ...base };
  }

  if (
    (kind === "csv" && (sizeBand === "tiny" || sizeBand === "small")) ||
    (kind === "xlsx" && sizeBand === "tiny")
  ) {
    return { class: "instant", route: "client", budgetMs: 12_000, ...base };
  }

  if (sizeBand === "large" && deviceTier === "strong") {
    return { class: "heavy_try", route: "client", budgetMs: 60_000, ...base };
  }

  return { class: "normal", route: "client", budgetMs: 50_000, ...base };
}

export function withTimeout(ms, fn) {
  return Promise.race([
    typeof fn === "function" ? fn() : fn,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("budget_exceeded")), ms);
    }),
  ]);
}

export async function loadParserModule(kind) {
  return withTimeout(IMPORT_MS, async () => {
    if (kind === "xlsx") return import("./parse-xlsx.js");
    if (kind === "docx") return import("./docx-table.js");
    return import("./parse-csv.js");
  });
}

/** 用户可见进度文案（不暴露 class / 前后端） */
export function progressCopy(phase, { label, index, total } = {}) {
  const fileLabel = label ? `「${label}」` : "";
  const ordinal =
    index && total && total > 1 ? tStandalone("upload.progress_ordinal", { index, total }) : "";
  switch (phase) {
    case "prepare":
      return tStandalone("upload.progress_prepare", { ordinal, fileLabel });
    case "parse":
      return tStandalone("upload.progress_parse");
    case "parse_long":
      return tStandalone("upload.progress_parse_long");
    case "boost":
      return tStandalone("upload.progress_boost");
    case "boosting":
      return tStandalone("upload.progress_boosting");
    case "done":
      return tStandalone("upload.progress_done", { fileLabel: fileLabel || tStandalone("upload.document") });
    default:
      return tStandalone("upload.progress_parse");
  }
}
