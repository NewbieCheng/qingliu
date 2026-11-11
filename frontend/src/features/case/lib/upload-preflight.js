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
  if (!list.length) return fail("Select at least one original file");
  if (list.length > MAX_FILES) return fail(`每批最多 ${MAX_FILES} 份`);

  let total = 0;
  for (const file of list) {
    const size = Number(file?.size) || 0;
    total += size;
    const name = String(file?.name || "");
    const ext = extOf(name);

    if (ext === ".doc" || ext === ".ppt") {
      return fail("请另存为 .docx / .pptx");
    }
    if (!OK_EXT.has(ext)) {
      return fail("Only PDF / CSV / XLSX / Word (docx)");
    }
    if (size <= 0) return fail("文件不能为空");
    if (size > MAX_EACH) return fail("单份不能超过 30MB");
    if ((ext === ".csv" || ext === ".xlsx") && !TABLE_SOURCES.has(source)) {
      return fail(tStandalone("upload.table_source_required"));
    }
  }

  if (total > MAX_TOTAL) return fail("整批不能超过 60MB");
  return { ok: true };
}
