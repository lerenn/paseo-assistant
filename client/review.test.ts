import { describe, expect, it, vi } from "vitest";
import { REVIEW_NO_ASSISTANT_HINT, reviewDisabled, reviewLabel, runReview, type ReviewState } from "./review";

describe("runReview (click → send path)", () => {
  it("goes sending → sent when the Assistant was idle", async () => {
    const states: ReviewState[] = [];
    const call = vi.fn(async () => ({ result: "sent" as const }));
    await runReview(true, call, (s) => states.push(s));
    expect(call).toHaveBeenCalledTimes(1);
    expect(states).toEqual([{ phase: "sending" }, { phase: "done", result: "sent" }]);
    expect(reviewLabel(states[1])).toBe("Sent");
  });
  it("shows Queued when the Assistant is mid-turn", async () => {
    const states: ReviewState[] = [];
    await runReview(true, async () => ({ result: "queued" }), (s) => states.push(s));
    expect(reviewLabel(states.at(-1)!)).toBe("Queued");
  });
  it("reports a failure instead of throwing", async () => {
    const states: ReviewState[] = [];
    await runReview(true, async () => Promise.reject(new Error("boom")), (s) => states.push(s));
    expect(states.at(-1)).toEqual({ phase: "error", message: "boom" });
    expect(reviewLabel(states.at(-1)!)).toBe("Not sent");
  });
  it("does nothing without an Assistant", async () => {
    const call = vi.fn(async () => ({ result: "sent" as const }));
    await runReview(false, call, () => {});
    expect(call).not.toHaveBeenCalled();
  });
  it("treats a no-assistant answer as an error", async () => {
    const states: ReviewState[] = [];
    await runReview(true, async () => ({ result: "no-assistant" }), (s) => states.push(s));
    expect(states.at(-1)).toEqual({ phase: "error", message: REVIEW_NO_ASSISTANT_HINT });
  });
});

describe("reviewDisabled", () => {
  it("is disabled with a tooltip when there is no Assistant agent", () => {
    expect(reviewDisabled(false, { phase: "idle" })).toEqual({ disabled: true, hint: REVIEW_NO_ASSISTANT_HINT });
  });
  it("is disabled while sending, enabled otherwise", () => {
    expect(reviewDisabled(true, { phase: "sending" }).disabled).toBe(true);
    expect(reviewDisabled(true, { phase: "idle" })).toEqual({ disabled: false, hint: null });
    expect(reviewDisabled(true, { phase: "done", result: "sent" }).disabled).toBe(false);
  });
});
