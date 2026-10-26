import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UndoQueue } from "./undo";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("UndoQueue", () => {
  it("commits only after the window, once", async () => {
    const commit = vi.fn();
    const q = new UndoQueue(commit, 5_000);
    q.start("d1");
    q.start("d1");
    expect(q.pending()).toEqual(["d1"]);
    await vi.advanceTimersByTimeAsync(4_900);
    expect(commit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("d1");
    expect(q.pending()).toEqual([]);
  });

  it("an undo inside the window sends nothing", async () => {
    const commit = vi.fn();
    const q = new UndoQueue(commit, 5_000);
    q.start("d1");
    await vi.advanceTimersByTimeAsync(2_000);
    q.undo("d1");
    expect(q.pending()).toEqual([]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(commit).not.toHaveBeenCalled();
    q.undo("d1"); // nothing to undo: harmless
  });

  it("tracks several decisions independently, and notifies subscribers", async () => {
    const commit = vi.fn();
    const q = new UndoQueue(commit, 1_000);
    const seen: string[][] = [];
    const off = q.subscribe(() => seen.push([...q.pending()]));
    q.start("a");
    await vi.advanceTimersByTimeAsync(500);
    q.start("b");
    await vi.advanceTimersByTimeAsync(600);
    expect(commit.mock.calls.map((c) => c[0])).toEqual(["a"]);
    q.undo("b");
    expect(seen).toEqual([["a"], ["a", "b"], ["b"], []]);
    off();
    q.start("c");
    expect(seen).toHaveLength(4);
  });

  it("uses the latest commit handler and survives a failing one", async () => {
    const first = vi.fn();
    const second = vi.fn(async () => {
      throw new Error("rpc down");
    });
    const q = new UndoQueue(first, 100);
    q.setCommit(second);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    q.start("d1");
    await vi.advanceTimersByTimeAsync(150);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("d1");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
