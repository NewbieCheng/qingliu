import { tStandalone } from "@/shared/i18n/core.js";

/** 上传业务预检：坏文件当场拒绝，不请求、不扣费。 */

const OK_EXT = new Set([".pdf", ".csv", ".xlsx", ".docx"]);
const TABLE_SOURCES = new Set([
  "bank_statement",
  "wechat_statement",
  "alipay_statement",
]);
const MAX_EACH = 30 * 1024 * 1024;
const MAX_TOTAL = 60 * 1024 * 1024;
const MAX_FILES = 10;

export function extOf(name) {
  const lower = String(name || "").toLowerCase();
  const index = lower.lastIndexOf(".");
  if (index < 0) return "";
  return lower.slice(index);
}

function fail(message) {
  return { ok: false, message };
}

/**
 * @param {Array<{ name?: string, size?: number }>} files
 * @param {{ source?: string }} options
 */
export function preflight(files, { source } = {}) {
  const list = Array.isArray(files) ? files : [];
  if (!list.length) return fail(tStandalone("upload.select_one_file"));
  if (list.length > MAX_FILES) {
    return fail(tStandalone("upload.max_files", { max: MAX_FILES }));
  }

  let total = 0;
  for (const file of list) {
    const size = Number(file?.size) || 0;
    total += size;
    const name = String(file?.name || "");
    const ext = extOf(name);

    if (ext === ".doc" || ext === ".ppt") {
      return fail(tStandalone("upload.save_as_modern"));
    }
    if (!OK_EXT.has(ext)) {
      return fail(tStandalone("upload.allowed_types"));
    }
    if (size <= 0) return fail(tStandalone("upload.empty_file"));
    if (size > MAX_EACH) {
      return fail(tStandalone("upload.max_each_size", { size: 30 }));
    }
    if ((ext === ".csv" || ext === ".xlsx") && !TABLE_SOURCES.has(source)) {
      return fail(tStandalone("upload.table_source_required"));
    }
  }

  if (total > MAX_TOTAL) {
    return fail(tStandalone("upload.max_batch_size", { size: "60MB" }));
  }
  return { ok: true };
}
