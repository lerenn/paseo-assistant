import { describe, expect, it } from "vitest";
import { isBusyStatus } from "./busy";

describe("isBusyStatus", () => {
  it("is busy while running or starting, and not when idle, closed, errored or unknown", () => {
    expect(isBusyStatus("running")).toBe(true);
    expect(isBusyStatus("initializing")).toBe(true);
    for (const s of ["idle", "closed", "error", null, undefined]) expect(isBusyStatus(s)).toBe(false);
  });
});
