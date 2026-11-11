import { describe, expect, it } from "vitest";
import { extractDocxTables, extractDocxText } from "../docx-table.js";

/** 无压缩最小 docx，含一张两行表，供 mammoth 解析。 */
function buildMinimalDocxWithTable() {
  const encoder = new TextEncoder();
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

  return buildStoreZip([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rels },
    { name: "word/document.xml", data: documentXml },
  ]);

  function buildStoreZip(files) {
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
}

describe("extractDocxTables", () => {
  it("reads first statement-like table", async () => {
    const buf = buildMinimalDocxWithTable();
    const rows = await extractDocxTables(buf);
    expect(rows[0]).toEqual(["交易日期", "金额", "收支方向"]);
    expect(rows[1][0]).toBe("2024-01-02");
    expect(rows[1][1]).toBe("12.50");
  });
});

describe("extractDocxText", () => {
  it("returns plain text", async () => {
    const text = await extractDocxText(buildMinimalDocxWithTable());
    expect(text).toMatch(/交易日期/);
    expect(text).toMatch(/12\.50/);
  });
});
