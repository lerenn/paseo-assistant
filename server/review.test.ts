import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TASK_REVIEW_PROMPT } from "../shared/review";
import { ReviewScheduler } from "./review";

const MIN = 60_000;

function setup(initial: { minutes: number; status: string | null }) {
  const state = { ...initial };
  const send = vi.fn(async (_text: string) => {});
  const scheduler = new ReviewScheduler({ minutes: () => state.minutes, status: async () => state.status, send, pollMs: 1000 });
  return { state, send, scheduler };
}

describe("ReviewScheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends the review prompt every N minutes", async () => {
    const { send, scheduler } = setup({ minutes: 30, status: "idle" });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(29 * MIN);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1 * MIN);
    expect(send).toHaveBeenCalledWith(TASK_REVIEW_PROMPT);
    await vi.advanceTimersByTimeAsync(30 * MIN);
    expect(send).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("is off at 0, and picks up a new interval on reschedule", async () => {
    const { state, send, scheduler } = setup({ minutes: 0, status: "idle" });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(120 * MIN);
    expect(send).not.toHaveBeenCalled();
    state.minutes = 10;
    scheduler.reschedule();
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(send).toHaveBeenCalledTimes(1);
    state.minutes = 0;
    scheduler.reschedule();
    await vi.advanceTimersByTimeAsync(60 * MIN);
    expect(send).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it("queues instead of steering a running Assistant, and sends once it is idle", async () => {
    const { state, send, scheduler } = setup({ minutes: 30, status: "running" });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(30 * MIN + 5000);
    expect(send).not.toHaveBeenCalled();
    expect(scheduler.isQueued).toBe(true);
    state.status = "idle";
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(scheduler.isQueued).toBe(false);
    scheduler.stop();
  });

  it("skips a tick when a review is already queued", async () => {
    const { state, send, scheduler } = setup({ minutes: 30, status: "running" });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(95 * MIN); // three ticks while busy
    expect(send).not.toHaveBeenCalled();
    state.status = "idle";
    await vi.advanceTimersByTimeAsync(2000);
    expect(send).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });
});
