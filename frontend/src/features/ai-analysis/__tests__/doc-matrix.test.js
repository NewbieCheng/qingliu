import { describe, expect, it } from "vitest";
import {
  latestAnalysisByDoc,
  matrixStats,
  mergeCandidates,
  recentPersonMerges,
} from "../doc-matrix.js";

describe("doc-matrix", () => {
  const items = [
    { id: "m1", document_id: "d1", status: "done", result: { kind: "person_merge" } },
    { id: "a2", document_id: "d2", status: "done", result: { summary: "ok" } },
    { id: "a1b", document_id: "d1", status: "failed", result: {} },
    { id: "a1", document_id: "d1", status: "done", result: { summary: "bank" } },
    { id: "a3", document_id: "d3", status: "running", result: null },
  ];

  it("maps latest single-source analysis per document", () => {
    const map = latestAnalysisByDoc(items);
    expect(map.get("d1").id).toBe("a1b");
    expect(map.get("d2").id).toBe("a2");
    expect(map.get("d3").id).toBe("a3");
    expect(map.has("m1")).toBe(false);
  });

  it("collects merge candidates from latest done per document", () => {
    const ids = mergeCandidates(items).map((row) => row.id);
    expect(ids).toEqual(["a2", "a1"]);
  });

  it("lists recent person merges", () => {
    expect(recentPersonMerges(items).map((row) => row.id)).toEqual(["m1"]);
  });

  it("counts matrix stats", () => {
    const docs = [{ id: "d1" }, { id: "d2" }, { id: "d3" }, { id: "d4" }];
    expect(matrixStats(docs, latestAnalysisByDoc(items))).toEqual({
      total: 4,
      done: 1,
      failed: 1,
      active: 1,
      idle: 1,
    });
  });
});
