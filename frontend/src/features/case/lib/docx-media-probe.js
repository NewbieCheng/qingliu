/**
 * docx 插图过重轻量探测：只读 ZIP 中央目录 word/media/*，不解压、不拉 mammoth。
 */

const MEDIA_COUNT_HEAVY = 8;
const MEDIA_RATIO_HEAVY = 0.4;
const MEDIA_SINGLE_HEAVY = 2 << 20;

/**
 * @param {ArrayBuffer} buffer
 * @param {number} [fileSize]
 * @returns {{ count: number, bytes: number, maxSingle: number, ratio: number, hint: 'lean'|'heavy' }}
 */
export function probeDocxMedia(buffer, fileSize = 0) {
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  const eocd = findEOCD(view);
  if (!eocd) {
    return { count: 0, bytes: 0, maxSingle: 0, ratio: 0, hint: "lean" };
  }
  let offset = eocd.cdOffset;
  let count = 0;
  let bytes = 0;
  let maxSingle = 0;
  for (let i = 0; i < eocd.cdEntries; i++) {
    if (offset + 46 > view.byteLength) break;
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const uncompressed = view.getUint32(offset + 20, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > u8.length) break;
    const name = utf8Decode(u8.subarray(nameStart, nameEnd));
    if (name.startsWith("word/media/") && !name.endsWith("/")) {
      count += 1;
      bytes += uncompressed;
      if (uncompressed > maxSingle) maxSingle = uncompressed;
    }
    offset = nameEnd + extraLen + commentLen;
  }
  const total = fileSize > 0 ? fileSize : buffer.byteLength;
  const ratio = total > 0 ? bytes / total : 0;
  const heavy =
    count >= MEDIA_COUNT_HEAVY ||
    ratio >= MEDIA_RATIO_HEAVY ||
    maxSingle >= MEDIA_SINGLE_HEAVY;
  return {
    count,
    bytes,
    maxSingle,
    ratio,
    hint: heavy ? "heavy" : "lean",
  };
}

function findEOCD(view) {
  const min = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let i = view.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) !== 0x06054b50) continue;
    return {
      cdEntries: view.getUint16(i + 10, true),
      cdOffset: view.getUint32(i + 16, true),
    };
  }
  return null;
}

function utf8Decode(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    let out = "";
    for (const b of bytes) out += String.fromCharCode(b);
    return out;
  }
}
