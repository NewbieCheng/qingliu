import { describe, expect, it } from "vitest";
import {
  clientBucket,
  clientNextStep,
  filterClients,
} from "../clientStatus.js";

describe("clientStatus", () => {
  it("maps buckets and next-step labels", () => {
    expect(clientBucket({ doc_count: 0, running: 0 })).toBe("pending");
    expect(clientBucket({ doc_count: 2, running: 0 })).toBe("ready");
    expect(clientBucket({ doc_count: 1, running: 1 })).toBe("running");
    expect(clientNextStep({ doc_count: 0, running: 0 }).label).toBe(
      "待上传资料",
    );
    expect(clientNextStep({ doc_count: 3, running: 0 })).toMatchObject({
      label: "继续核对",
      docs: 3,
    });
    expect(clientNextStep({ doc_count: 1, running: 2 }).label).toBe("识别中");
  });

  it("filters the current page list", () => {
    const clients = [
      { id: "a", doc_count: 0, running: 0 },
      { id: "b", doc_count: 2, running: 0 },
      { id: "c", doc_count: 1, running: 1 },
    ];
    expect(filterClients(clients, "pending").map((item) => item.id)).toEqual([
      "a",
    ]);
    expect(filterClients(clients, "ready").map((item) => item.id)).toEqual([
      "b",
    ]);
    expect(filterClients(clients, "running").map((item) => item.id)).toEqual([
      "c",
    ]);
    expect(filterClients(clients, "all")).toHaveLength(3);
  });
});
