import { describe, expect, it } from "vitest";
import { jobPolicy } from "../job-policy.js";

describe("jobPolicy", () => {
  it("gives ai_analysis longer stale than upload", () => {
    expect(jobPolicy("ai_analysis").staleMinutes).toBeGreaterThan(
      jobPolicy("upload").staleMinutes,
    );
  });

  it("marks upload as busy-locking", () => {
    expect(jobPolicy("upload").locksBusy).toBe(true);
    expect(jobPolicy("ai_analysis").locksBusy).toBe(false);
  });
});
