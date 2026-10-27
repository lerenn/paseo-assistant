import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Delivery, PendingDeliveries, WAKE_PROMPT } from "./delivery";

let dir: string;
beforeEach(() => {
  vi.useFakeTimers();
  dir = mkdtempSync(path.join(tmpdir(), "delivery-"));
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

const REVIEW_PROMPT = "review prompt";
const setup = (statuses: Array<string | null | Error> | { current: string | null }) => {
  const queue = new PendingDeliveries(path.join(dir, "q.json"));
  const send = vi.fn(async (_text: string) => {});
  let i = 0;
  const status = async () => {
    if (Array.isArray(statuses)) {
      const s = statuses[Math.min(i++, statuses.length - 1)];
      if (s instanceof Error) throw s;
      return s;
    }
    return statuses.current;
  };
  const delivery = new Delivery({
    queue,
    status,
    decisionText: (id) => `answer ${id}`,
    send,
    reviewPrompt: () => REVIEW_PROMPT,
    debounceMs: 100,
    pollMs: 1000,
  });
  return { queue, send, delivery };
};
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe("Delivery", () => {
  it("wakes an idle Assistant once for a burst of mails", async () => {
    const { send, delivery } = setup({ current: "idle" });
    delivery.notifyMail();
    delivery.notifyMail();
    delivery.notifyMail();
    await tick(500);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(WAKE_PROMPT);
  });

  it("never sends mail to a running Assistant and does not retry it", async () => {
    const state = { current: "running" as string | null };
    const { send, delivery } = setup(state);
    delivery.notifyMail();
    await tick(500);
    state.current = "idle";
    await tick(5000);
    expect(send).not.toHaveBeenCalled();
  });

  it("queues answers while running and delivers them as one message once idle", async () => {
    const state = { current: "running" as string | null };
    const { send, queue, delivery } = setup(state);
    delivery.enqueueDecision("d1");
    delivery.enqueueDecision("d2");
    await tick(3000);
    expect(send).not.toHaveBeenCalled();
    expect(queue.list()).toEqual(["d1", "d2"]);
    state.current = "idle";
    await tick(1500);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe("answer d1\n\nanswer d2");
    expect(queue.list()).toEqual([]);
  });

  it("combines answers and mail into one message when idle", async () => {
    const { send, delivery } = setup({ current: "idle" });
    delivery.enqueueDecision("d1");
    delivery.notifyMail();
    await tick(500);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe(`answer d1\n\n${WAKE_PROMPT}`);
  });

  it("requeues when the re-check right before sending finds it running", async () => {
    const { send, queue, delivery } = setup(["idle", "running", "idle", "idle"]);
    delivery.enqueueDecision("d1");
    await tick(200);
    expect(send).not.toHaveBeenCalled();
    expect(queue.list()).toEqual(["d1"]);
    await tick(1500);
    expect(send).toHaveBeenCalledTimes(1);
    expect(queue.list()).toEqual([]);
  });

  it("keeps answers queued when sending fails, and when the status is unknown", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { send, queue, delivery } = setup([null, new Error("boom"), "idle", "idle"]);
    send.mockRejectedValueOnce(new Error("down"));
    delivery.enqueueDecision("d1");
    await tick(200);
    expect(queue.list()).toEqual(["d1"]);
    await tick(1200);
    await tick(1200);
    expect(send).toHaveBeenCalled();
  });

  it("persists the queue across restarts and poke() resumes delivery", async () => {
    const first = setup({ current: "running" });
    first.delivery.enqueueDecision("d1");
    first.delivery.stop();
    const second = setup({ current: "idle" });
    expect(second.queue.list()).toEqual(["d1"]);
    second.delivery.poke();
    await tick(500);
    expect(second.send).toHaveBeenCalledWith("answer d1");
  });
});

describe("Delivery.requestReview", () => {
  it("sends the exact prompt at once to an idle Assistant, alone", async () => {
    const { send, delivery } = setup({ current: "idle" });
    delivery.notifyMail();
    delivery.requestReview();
    await tick(10);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(REVIEW_PROMPT);
  });
  it("queues behind a running turn (no steering) and sends once idle, once", async () => {
    const state = { current: "running" as string | null };
    const { send, delivery } = setup(state);
    delivery.requestReview();
    await tick(3500);
    expect(send).not.toHaveBeenCalled();
    state.current = "idle";
    await tick(1500);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(REVIEW_PROMPT);
    await tick(5000);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("retries when sending fails", async () => {
    const { send, delivery } = setup({ current: "idle" });
    send.mockRejectedValueOnce(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    delivery.requestReview();
    await tick(1500);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe("statusOf (regression: answers stuck in the queue)", () => {
  it("reads the status from the shape refresh() returns, where it sits under `agent`", async () => {
    const { statusOf } = await import("./delivery");
    expect(statusOf({ agent: { status: "idle" }, project: null })).toBe("idle");
    expect(statusOf({ agent: { status: "running" } })).toBe("running");
    expect(statusOf({ status: "idle" })).toBe("idle");
    expect(statusOf(null)).toBeNull();
    expect(statusOf({ agent: {} })).toBeNull();
  });

  it("delivers a queued answer to an Assistant whose status comes from a refresh() result, and reports it delivered", async () => {
    const { statusOf } = await import("./delivery");
    const queue = new PendingDeliveries(path.join(dir, "q.json"));
    queue.add("d1");
    const delivered: string[][] = [];
    const send = vi.fn(async (_t: string) => {});
    const refresh = async () => ({ agent: { status: "idle" }, project: null });
    const delivery = new Delivery({
      queue,
      status: async () => statusOf(await refresh()),
      decisionText: (id) => `answer ${id}`,
      send,
      delivered: (ids) => delivered.push(ids),
      debounceMs: 100,
      pollMs: 1000,
    });
    delivery.poke();
    await tick(500);
    expect(send).toHaveBeenCalledWith("answer d1");
    expect(queue.list()).toEqual([]);
    expect(delivered).toEqual([["d1"]]);
  });
});

describe("dropStaleOnce", () => {
  it("drops the queue the first time only, and returns what it dropped", async () => {
    const { dropStaleOnce } = await import("./delivery");
    const queue = new PendingDeliveries(path.join(dir, "q.json"));
    queue.add("a");
    queue.add("b");
    const marker = path.join(dir, "q.json.cleared-v1");
    expect(dropStaleOnce(queue, marker)).toEqual(["a", "b"]);
    expect(queue.list()).toEqual([]);
    queue.add("c");
    expect(dropStaleOnce(queue, marker)).toEqual([]);
    expect(queue.list()).toEqual(["c"]);
  });
});

describe("titleOf", () => {
  it("reads the title from the refresh() shape, so forwarded mail names the agent instead of its id", async () => {
    const { titleOf } = await import("./delivery");
    expect(titleOf({ agent: { title: "Builder" }, project: null })).toBe("Builder");
    expect(titleOf({ title: "Old shape" })).toBe("Old shape");
    expect(titleOf({ agent: { title: null } })).toBeNull();
    expect(titleOf(null)).toBeNull();
  });
});
