import { describe, expect, it } from "vitest";
import { probeDocxMedia } from "../docx-media-probe.js";

/** 无压缩（STORE）最小 ZIP，供中央目录扫描。 */
function buildStoreZip(files) {
  const encoder = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = file.data instanceof Uint8Array ? file.data : encoder.encode(file.data || "");
    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, 0, true); // method store
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 0, true);
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
  const total = offset + cdSize + 22;
  const out = new Uint8Array(total);
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

describe("probeDocxMedia", () => {
  it("marks lean when few small media", () => {
    const buf = buildStoreZip([
      { name: "word/document.xml", data: "<w:document/>" },
      { name: "word/media/image1.png", data: new Uint8Array(100) },
    ]);
    const probe = probeDocxMedia(buf, 1200);
    expect(probe.hint).toBe("lean");
    expect(probe.count).toBe(1);
  });

  it("marks heavy when media count >= 8", () => {
    const files = [{ name: "word/document.xml", data: "x" }];
    for (let i = 0; i < 8; i += 1) {
      files.push({ name: `word/media/img${i}.png`, data: new Uint8Array(10) });
    }
    const buf = buildStoreZip(files);
    expect(probeDocxMedia(buf).hint).toBe("heavy");
  });

  it("marks heavy when single media >= 2MB", () => {
    const buf = buildStoreZip([
      { name: "word/media/huge.png", data: new Uint8Array(2 << 20) },
    ]);
    expect(probeDocxMedia(buf).hint).toBe("heavy");
  });
});
