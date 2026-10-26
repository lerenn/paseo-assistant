import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPIN_MS, STEP_DEG, nextAngle, startSpinner } from "./spin";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("spinner", () => {
  it("steps round and wraps at a full turn", () => {
    expect(nextAngle(0)).toBe(STEP_DEG);
    expect(nextAngle(330)).toBe(0);
    expect(360 % STEP_DEG).toBe(0);
  });

  it("keeps turning, through many full turns, until stopped (regression: it ran once and stopped)", () => {
    const seen: number[] = [];
    const stop = startSpinner((a) => seen.push(a));
    vi.advanceTimersByTime(SPIN_MS * (360 / STEP_DEG) * 5);
    expect(seen).toHaveLength((360 / STEP_DEG) * 5);
    expect(seen.slice(0, 13)).toEqual([30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 0, 30]);
    stop();
    const count = seen.length;
    vi.advanceTimersByTime(SPIN_MS * 50);
    expect(seen).toHaveLength(count);
  });

  it("two spinners are independent", () => {
    const a: number[] = [];
    const b: number[] = [];
    const stopA = startSpinner((x) => a.push(x));
    startSpinner((x) => b.push(x))();
    vi.advanceTimersByTime(SPIN_MS * 3);
    expect(a).toHaveLength(3);
    expect(b).toHaveLength(0);
    stopA();
  });
});
