import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/shared/api/client.js", () => ({
  api: vi.fn(async () => ({ ok: true })),
}));

import { api } from "@/shared/api/client.js";
import { startAnalysis, startPersonMerge } from "../api.js";

describe("startAnalysis", () => {
  beforeEach(() => {
    api.mockClear();
  });

  it("rejects without documentId", () => {
    expect(() => startAnalysis("c1", {})).toThrow(/选择要分析的文档/);
    expect(api).not.toHaveBeenCalled();
  });

  it("posts document_id and optional task", async () => {
    await startAnalysis("c1", { documentId: "doc-9", task: "page_ocr" });
    expect(api).toHaveBeenCalledWith("/api/clients/c1/ai-analysis", {
      document_id: "doc-9",
      task: "page_ocr",
    });
  });

  it("posts document_ids for batch", async () => {
    await startAnalysis("c1", { documentIds: ["a", "b", "a"] });
    expect(api).toHaveBeenCalledWith("/api/clients/c1/ai-analysis", {
      document_ids: ["a", "b"],
    });
  });
});

describe("startPersonMerge", () => {
  beforeEach(() => {
    api.mockClear();
  });

  it("rejects fewer than two ids", () => {
    expect(() => startPersonMerge("c1", ["only"])).toThrow(/同人合并/);
    expect(api).not.toHaveBeenCalled();
  });

  it("posts person_merge task", async () => {
    await startPersonMerge("c1", ["x", "y", "x"]);
    expect(api).toHaveBeenCalledWith("/api/clients/c1/ai-analysis", {
      task: "person_merge",
      analysis_ids: ["x", "y"],
    });
  });
});
