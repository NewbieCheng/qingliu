import { describe, expect, it } from "vitest";
import {
  checkBrowserEnvironment,
  classifyFile,
  sizeBandOf,
} from "../client-capability.js";

describe("checkBrowserEnvironment", () => {
  it("rejects when File is missing", () => {
    const result = checkBrowserEnvironment({
      FileReader: function FileReader() {},
      Blob: function Blob() {},
      ArrayBuffer: ArrayBuffer,
      Promise,
    });
    expect(result.ok).toBe(false);
    expect(result.action).toBe("reject");
    expect(result.message).toMatch(/浏览器/);
  });

  it("passes with modern globals", () => {
    const result = checkBrowserEnvironment({
      File: function File() {},
      FileReader: function FileReader() {},
      Blob: function Blob() {},
      ArrayBuffer,
      Promise,
    });
    expect(result.ok).toBe(true);
  });
});

describe("classifyFile", () => {
  it("sends pdf to boost_direct", async () => {
    const gate = await classifyFile(
      { name: "a.pdf", size: 1024 },
      { deviceTier: "strong" },
    );
    expect(gate.class).toBe("boost_direct");
    expect(gate.route).toBe("server");
    expect(gate.budgetMs).toBe(0);
  });

  it("classifies small csv as instant with short budget", async () => {
    const gate = await classifyFile(
      { name: "a.csv", size: 10_000 },
      { deviceTier: "strong" },
    );
    expect(gate.class).toBe("instant");
    expect(gate.route).toBe("client");
    expect(gate.budgetMs).toBeLessThanOrEqual(15_000);
  });

  it("marks oversize xlsx as too_heavy", async () => {
    expect(sizeBandOf("xlsx", 9 << 20)).toBe("over");
    const gate = await classifyFile(
      { name: "big.xlsx", size: 9 << 20 },
      { deviceTier: "strong" },
    );
    expect(gate.class).toBe("too_heavy");
    expect(gate.route).toBe("server");
  });

  it("classifies lean docx as client route", async () => {
    const gate = await classifyFile(
      { name: "table.docx", size: 20_000 },
      { deviceTier: "strong", docxBuffer: emptyLeanDocxBuffer() },
    );
    expect(gate.route).toBe("client");
    expect(gate.class).toBe("instant");
    expect(gate.mediaHint).toBe("lean");
  });

  it("sends media-heavy docx to server", async () => {
    const gate = await classifyFile(
      { name: "pics.docx", size: 3 << 20 },
      { deviceTier: "strong", docxBuffer: heavyMediaDocxBuffer() },
    );
    expect(gate.class).toBe("media_heavy");
    expect(gate.route).toBe("server");
  });
});

function emptyLeanDocxBuffer() {
  return buildStoreZip([{ name: "word/document.xml", data: "<w:document/>" }]);
}

function heavyMediaDocxBuffer() {
  const files = [{ name: "word/document.xml", data: "x" }];
  for (let i = 0; i < 8; i += 1) {
    files.push({ name: `word/media/img${i}.png`, data: new Uint8Array(10) });
  }
  return buildStoreZip(files);
}

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
  return out.buffer;
}
