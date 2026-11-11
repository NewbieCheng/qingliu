/** 自写 CSV 读表：UTF-8、BOM、引号转义；与后端 encoding/csv 夹具对齐。 */

export function stripBom(text) {
  const value = String(text ?? "");
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

/**
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsvText(text) {
  const input = stripBom(text);
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let inQuotes = false;

  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (inQuotes) {
    throw new Error("CSV must be UTF-8 and well-formed");
  }

  // 末行无换行也收进结果；全空文件给空表
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
