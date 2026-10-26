import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MailWaker, WAKE_PROMPT } from "./wake";

const flush = async () => {
  await vi.advanceTimersByTimeAsync(1000);
};

describe("MailWaker", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = (status: string | null | Error) => {
    const wake = vi.fn(async () => {});
    const waker = new MailWaker({
      status: async () => {
        if (status instanceof Error) throw status;
        return status;
      },
      wake,
      debounceMs: 100,
    });
    return { wake, waker };
  };

  it("wakes an idle Assistant once for a burst of mails", async () => {
    const { wake, waker } = make("idle");
    waker.notify();
    waker.notify();
    waker.notify();
    await flush();
    expect(wake).toHaveBeenCalledTimes(1);
    expect(wake).toHaveBeenCalledWith(WAKE_PROMPT);
  });

  it("does not interrupt a running Assistant", async () => {
    const { wake, waker } = make("running");
    waker.notify();
    await flush();
    expect(wake).not.toHaveBeenCalled();
  });

  it("does nothing when the status is unknown or cannot be read", async () => {
    for (const status of [null, new Error("boom")]) {
      const { wake, waker } = make(status);
      vi.spyOn(console, "error").mockImplementation(() => {});
      waker.notify();
      await flush();
      expect(wake).not.toHaveBeenCalled();
    }
  });

  it("wakes again for mail that arrives after a wake", async () => {
    const { wake, waker } = make("idle");
    waker.notify();
    await flush();
    waker.notify();
    await flush();
    expect(wake).toHaveBeenCalledTimes(2);
  });
});
