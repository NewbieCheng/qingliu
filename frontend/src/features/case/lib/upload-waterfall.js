/**
 * 上传瀑布：①预检 → ①b 门闩/分类 → ②本机拆行入库 → 失败升③加强解析。
 * 用户文案不暴露 class / 前后端。
 */

import {
  checkBrowserEnvironment,
  classifyFile,
  loadParserModule,
  progressCopy,
  withTimeout,
} from "./client-capability.js";
import { clientParse } from "./client-parse.js";
import { preflight } from "./upload-preflight.js";

/**
 * @param {object} options
 * @param {FormData} options.form
 * @param {(payload: FormData) => Promise<unknown>} options.uploadOriginal
 * @param {(payload: { file: File, rows: object[], meta: object, batch: string, source: string }) => Promise<unknown>} options.commitParsed
 * @param {(state: { index: number, total: number, label: string, phase: string, copy: string }) => void} [options.onProgress]
 */
export async function runUploadWaterfall({
  form,
  uploadOriginal,
  commitParsed,
  onProgress,
  environment,
}) {
  const files = form.getAll("files").filter((item) => item instanceof File);
  const source = String(form.get("source") || "");
  const ocr = form.get("ocr");
  const baseBatch = String(form.get("batch") || "").trim();

  const gate = preflight(files, { source });
  if (!gate.ok) {
    const error = new Error(gate.message);
    error.code = "preflight";
    throw error;
  }

  const env = checkBrowserEnvironment(
    environment || (typeof globalThis !== "undefined" ? globalThis : {}),
  );
  if (!env.ok) {
    const error = new Error(env.message);
    error.code = "browser";
    throw error;
  }

  const total = files.length;
  const serverFiles = [];
  let parsedCount = 0;

  for (let i = 0; i < total; i += 1) {
    const file = files[i];
    const index = i + 1;
    const label = file.name;
    const emit = (phase) =>
      onProgress?.({
        index,
        total,
        label,
        phase,
        copy: progressCopy(phase, { label, index, total }),
      });

    emit("prepare");
    const classified = await classifyFile(file);

    if (classified.route === "server") {
      emit("boost");
      serverFiles.push(file);
      continue;
    }

    try {
      emit("parse");
      await loadParserModule(classified.kind);
      const parsed = await withTimeout(classified.budgetMs, () =>
        clientParse(file, { source }),
      );
      if (parsed.ok) {
        await commitParsed({
          file,
          rows: parsed.rows,
          meta: parsed.meta,
          source,
          batch: baseBatch
            ? `${baseBatch}:parsed:${index}`
            : `parsed:${Date.now()}:${index}`,
        });
        parsedCount += 1;
        emit("done");
        continue;
      }
    } catch {
      // 预算用尽 / 装包失败 / 解析失败 → 加强解析；禁止「请换浏览器」
    }

    emit("boost");
    serverFiles.push(file);
  }

  if (serverFiles.length) {
    const next = new FormData();
    next.set("source", source);
    if (baseBatch) next.set("batch", baseBatch);
    if (ocr) next.set("ocr", String(ocr));
    for (const file of serverFiles) {
      next.append("files", file);
    }
    await uploadOriginal(next);
    return { parsedCount, boostedCount: serverFiles.length };
  }

  return { parsedCount, boostedCount: 0 };
}
