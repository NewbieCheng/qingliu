import { describe, expect, it } from "vitest";
import {
  initialConfirmedMap,
  normalizeRelationship,
  RELATIONSHIP_KEYS,
  RELATIONSHIPS,
} from "../ownership.js";

describe("ownership helpers", () => {
  it("normalizes legacy Chinese relationship values to canonical codes", () => {
    expect(normalizeRelationship("本人")).toBe("Self");
    expect(normalizeRelationship("其他")).toBe("Other");
    expect(normalizeRelationship("Self")).toBe("Self");
    expect(normalizeRelationship("配偶")).toBe("配偶");
    expect(normalizeRelationship("子女")).toBe("子女");
    expect(normalizeRelationship("Other")).toBe("Other");
    expect(normalizeRelationship("")).toBe("");
  });

  it("maps every relationship option to an i18n label key", () => {
    for (const value of RELATIONSHIPS) {
      expect(RELATIONSHIP_KEYS[value]).toBeTruthy();
    }
  });

  it("restores confirmed state only for documents with saved holder and confirmed=true", () => {
    const docs = [{ id: "d1" }, { id: "d2" }, { id: "d3" }];
    const scopes = {
      d1: { holder: "谢治伟", confirmed: true },
      d2: { holder: "", confirmed: true },
      d3: { holder: "庄桂娟", confirmed: false },
    };
    expect(initialConfirmedMap(docs, scopes)).toEqual({ d1: true });
  });
});
