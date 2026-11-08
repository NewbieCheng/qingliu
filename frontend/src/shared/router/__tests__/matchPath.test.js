import { describe, expect, it } from "vitest";
import { matchPath } from "../matchPath.js";

describe("matchPath", () => {
  it("matches the root route", () => {
    expect(matchPath("/", "/")).toEqual({ params: {} });
  });

  it("extracts route params", () => {
    expect(matchPath("/clients/:cid", "/clients/abc123")).toEqual({
      params: { cid: "abc123" },
    });
  });

  it("rejects extra or missing segments", () => {
    expect(matchPath("/clients/:cid", "/clients")).toBeNull();
    expect(matchPath("/clients/:cid", "/clients/abc/extra")).toBeNull();
  });

  it("falls through to wildcard", () => {
    expect(matchPath("*", "/anything")).toEqual({ params: {} });
  });
});
