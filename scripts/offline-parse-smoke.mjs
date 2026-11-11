/**
 * 离线验收：对本机 samples 跑 CSV/XLSX/docx 解析，不依赖服务与扣费。
 * 用法：node scripts/offline-parse-smoke.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const frontendSrc = join(root, "frontend", "src", "features", "case", "lib");

async function load(mod) {
  return import(pathToFileURL(join(frontendSrc, mod)).href);
}

function fail(msg) {
  console.error("FAIL:", msg);
  process.exitCode = 1;
}

const { parseCsvText } = await load("parse-csv.js");
const { rowsFromRecords } = await load("map-standard.js");
const { readFirstSheet } = await load("parse-xlsx.js");
const { extractDocxTables } = await load("docx-table.js");
const { probeDocxMedia } = await load("docx-media-probe.js");

const csvPath = join(root, "samples", "bank_statement.csv");
const csvText = readFileSync(csvPath, "utf8");
const csvRows = rowsFromRecords(parseCsvText(csvText), "bank_statement", "bank_statement.csv");
if (!csvRows.ok || csvRows.rows.length < 1) fail(`CSV 解析失败: ${csvRows.reason || "empty"}`);
else console.log(`OK CSV rows=${csvRows.rows.length}`);

// 最小 docx（与 vitest 同结构）用内存构造并抽表
const { Buffer } = await import("node:buffer");
function buildStoreZip(files) {
  const encoder = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.data);
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
  return out.buffer;
}

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>交易日期</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>金额</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>收支方向</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>2024-01-02</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>12.50</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>收入</w:t></w:r></w:p></w:tc>
      </w:tr>
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
const probe = probeDocxMedia(docxBuf);
if (probe.hint !== "lean") fail(`docx media hint=${probe.hint}`);
const tables = await extractDocxTables(docxBuf);
const docxRows = rowsFromRecords(tables, "bank_statement", "smoke.docx");
if (!docxRows.ok || docxRows.rows.length !== 1) fail(`docx rows=${docxRows.rows?.length} ${docxRows.reason}`);
if (Number(docxRows.rows[0].income) !== 1250) fail(`docx income=${docxRows.rows[0].income}`);
console.log(`OK DOCX rows=${docxRows.rows.length} income=${docxRows.rows[0].income}`);

// XLSX：若有夹具再验；没有则跳过
try {
  const xlsxPath = join(root, "samples", "bank_statement.xlsx");
  const xlsxBuf = readFileSync(xlsxPath);
  const records = await readFirstSheet(xlsxBuf.buffer.slice(xlsxBuf.byteOffset, xlsxBuf.byteOffset + xlsxBuf.byteLength));
  const xRows = rowsFromRecords(records, "bank_statement", "bank_statement.xlsx");
  if (!xRows.ok) fail(`XLSX: ${xRows.reason}`);
  console.log(`OK XLSX rows=${xRows.rows.length}`);
} catch (e) {
  if (e && e.code === "ENOENT") console.log("SKIP XLSX (no samples/bank_statement.xlsx)");
  else throw e;
}

if (!process.exitCode) console.log("offline-parse-smoke: all passed");
