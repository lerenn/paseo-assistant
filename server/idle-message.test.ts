import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdleMessage } from "./idle-message";
import { heartbeatChangedPrompt, kickoffPrompt } from "./prompt";

describe("IdleMessage (heartbeat interval change)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("waits for an idle Assistant and sends only the latest request", async () => {
    const state = { status: "running" as string | null };
    const send = vi.fn(async (_t: string) => {});
    const m = new IdleMessage({ status: async () => state.status, send, pollMs: 1000 });
    m.request(heartbeatChangedPrompt(5));
    m.request(heartbeatChangedPrompt(10));
    await vi.advanceTimersByTimeAsync(5000);
    expect(send).not.toHaveBeenCalled();
    state.status = "idle";
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toContain("10 minutes");
    expect(m.isQueued).toBe(false);
    m.stop();
  });

  it("tells the Assistant to delete the old heartbeat and create one with the new interval; new sessions get it too", () => {
    const text = heartbeatChangedPrompt(7);
    expect(text).toContain("delete_heartbeat");
    expect(text).toContain("every 7 minutes");
    expect(kickoffPrompt(7)).toContain("every 7 minutes");
  });
});
