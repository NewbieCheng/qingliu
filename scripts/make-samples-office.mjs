/**
 * 生成 S5/S1 真机夹具：瘦表 docx + 银行 xlsx（合成数据，可入库）。
 * 用法：node scripts/make-samples-office.mjs
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const samples = join(root, "samples");
const require = createRequire(import.meta.url);

function buildStoreZip(files) {
  const encoder = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data =
      file.data instanceof Uint8Array ? file.data : encoder.encode(file.data || "");
    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    locals.push(local);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const cdOffset = offset;
  let cdSize = 0;
  for (const c of centrals) cdSize += c.length;
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdOffset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let pos = 0;
  for (const l of locals) {
    out.set(l, pos);
    pos += l.length;
  }
  for (const c of centrals) {
    out.set(c, pos);
    pos += c.length;
  }
  out.set(eocd, pos);
  return Buffer.from(out);
}

function cell(text) {
  return `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
}

function row(cols) {
  return `<w:tr>${cols.map(cell).join("")}</w:tr>`;
}

const docxRows = [
  ["交易日期", "金额", "收支方向", "交易对方", "摘要", "本方账号"],
  ["2026-01-05", "1280.50", "收入", "华丰商贸", "货款", "6222"],
  ["2026-01-08", "0.36", "收入", "结息账户", "利息", "6222"],
  ["2026-01-12", "86.00", "支出", "超市", "消费", "6222"],
  ["2026-01-18", "500.00", "收入", "微信零钱提现", "提现", "6222"],
  ["2026-01-22", "3200.00", "收入", "李客户", "货款", "6222"],
];

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:tbl>
      ${docxRows.map(row).join("\n      ")}
    </w:tbl>
    <w:sectPr/>
  </w:body>
</w:document>`;

const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const docxBuf = buildStoreZip([
  { name: "[Content_Types].xml", data: contentTypes },
  { name: "_rels/.rels", data: rels },
  { name: "word/document.xml", data: documentXml },
]);
const docxPath = join(samples, "bank_statement_table.docx");
writeFileSync(docxPath, docxBuf);
console.log(`OK docx ${docxPath} bytes=${docxBuf.length} data_rows=${docxRows.length - 1}`);

// 用前端依赖的 xlsx 写一份与 CSV 对齐的银行表
const xlsxPkg = join(root, "frontend", "node_modules", "xlsx");
const XLSX = require(xlsxPkg);
const sheetRows = [
  ["交易日期", "收支方向", "金额", "交易对方", "摘要", "本方账号"],
  ["2026-01-05", "收入", "1280.50", "华丰商贸", "货款", "6222"],
  ["2026-01-08", "收入", "0.36", "结息账户", "利息", "6222"],
  ["2026-01-12", "支出", "86.00", "超市", "消费", "6222"],
  ["2026-01-18", "收入", "500.00", "微信零钱提现", "提现", "6222"],
  ["2026-01-22", "收入", "3200.00", "李客户", "货款", "6222"],
  ["2026-01-25", "支出", "120.00", "加油", "油费", "6222"],
];
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(sheetRows);
XLSX.utils.book_append_sheet(wb, ws, "流水");
const xlsxPath = join(samples, "bank_statement.xlsx");
XLSX.writeFile(wb, xlsxPath);
console.log(`OK xlsx ${xlsxPath} data_rows=${sheetRows.length - 1}`);

// 自检：本机解析路径能读出行
const { extractDocxTables } = await import(
  pathToFileURL(join(root, "frontend/src/features/case/lib/docx-table.js")).href
);
const { rowsFromRecords } = await import(
  pathToFileURL(join(root, "frontend/src/features/case/lib/map-standard.js")).href
);
const matrix = await extractDocxTables(docxBuf);
const parsed = rowsFromRecords(matrix, "bank_statement", "bank_statement_table.docx");
if (!parsed.ok || parsed.rows.length !== 5) {
  console.error("FAIL docx parse", parsed);
  process.exitCode = 1;
} else {
  console.log(`OK docx client-parse rows=${parsed.rows.length}`);
}
