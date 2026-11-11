import { describe, expect, it, vi } from "vitest";
import { runUploadWaterfall } from "../upload-waterfall.js";

const modernEnv = {
  File,
  FileReader: function FileReader() {},
  Blob,
  ArrayBuffer,
  Promise,
};

function csvFile(name, text) {
  return new File([text], name, { type: "text/csv" });
}

const bankCsv = `交易日期,收支方向,金额,交易对方,摘要,本方账号,交易单号
2026-01-05,收入,1280.50,华丰商贸,货款结算,6222****1234,BK-001
`;

describe("runUploadWaterfall", () => {
  it("commits client-parsed csv without uploadOriginal", async () => {
    const uploadOriginal = vi.fn();
    const commitParsed = vi.fn(async () => ({ ok: true }));
    const form = new FormData();
    form.set("source", "bank_statement");
    form.set("batch", "b1");
    form.append("files", csvFile("bank.csv", bankCsv));

    const result = await runUploadWaterfall({
      form,
      uploadOriginal,
      commitParsed,
      environment: modernEnv,
    });

    expect(result.parsedCount).toBe(1);
    expect(result.boostedCount).toBe(0);
    expect(commitParsed).toHaveBeenCalledOnce();
    expect(uploadOriginal).not.toHaveBeenCalled();
  });

  it("boosts pdf via uploadOriginal", async () => {
    const uploadOriginal = vi.fn(async () => ({ ok: true }));
    const commitParsed = vi.fn();
    const form = new FormData();
    form.set("source", "other");
    form.append(
      "files",
      new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "a.pdf", {
        type: "application/pdf",
      }),
    );

    const result = await runUploadWaterfall({
      form,
      uploadOriginal,
      commitParsed,
      environment: modernEnv,
    });

    expect(result.boostedCount).toBe(1);
    expect(commitParsed).not.toHaveBeenCalled();
    expect(uploadOriginal).toHaveBeenCalledOnce();
  });

  it("rejects wrong source before any request", async () => {
    const form = new FormData();
    form.set("source", "other");
    form.append("files", csvFile("a.csv", bankCsv));
    await expect(
      runUploadWaterfall({
        form,
        uploadOriginal: vi.fn(),
        commitParsed: vi.fn(),
      }),
    ).rejects.toThrow(/银行卡|微信|支付宝/);
  });
});
