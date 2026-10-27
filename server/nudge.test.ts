import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { NudgeLedger, agentInfos, nudgeCheck, type AgentInfo } from "./nudge";

const MIN = 60_000;
const T0 = Date.parse("2026-10-27T12:00:00Z");

const agent = (over: Partial<AgentInfo> = {}): AgentInfo => ({ id: "a1", title: "Worker", status: "idle", labels: {}, parentAgentId: null, lastActivityAt: T0 - 45 * MIN, ...over });

function setup(agents: AgentInfo[], opts: { decision?: boolean } = {}) {
  const clock = { now: T0 };
  const ledger = new NudgeLedger(path.join(mkdtempSync(path.join(tmpdir(), "nudge-")), "nudges.json"));
  const escalate = vi.fn();
  const list = { agents };
  const check = (id = "a1", input: { pendingInbox?: boolean } = {}) =>
    nudgeCheck(id, input, { agents: async () => list.agents, ledger, pendingDecision: () => !!opts.decision, escalate, now: () => clock.now });
  return { clock, ledger, escalate, check, list };
}

describe("nudgeCheck", () => {
  it("allows an agent silent for over 30 min, records it and shows the budget", async () => {
    const { check } = setup([agent()]);
    const v = await check();
    expect(v.allowed).toBe(true);
    expect(v.budget).toMatchObject({ nudgesInWindow: 1, remainingInWindow: 0, unanswered: 1, escalateAfter: 2 });
  });

  it("refuses an agent with a turn running, a recent one, a pending decision and an unknown one", async () => {
    expect((await setup([agent({ status: "running" })]).check()).allowed).toBe(false);
    const recent = await setup([agent({ lastActivityAt: T0 - 10 * MIN })]).check();
    expect(recent.allowed).toBe(false);
    expect(recent.why).toContain("10 min ago");
    expect((await setup([agent()], { decision: true }).check()).allowed).toBe(false);
    expect((await setup([agent()]).check("a1", { pendingInbox: true })).allowed).toBe(false);
    expect((await setup([agent()]).check("nope")).allowed).toBe(false);
  });

  it("allows at most one nudge per agent per hour", async () => {
    const { check, clock, list } = setup([agent()]);
    expect((await check()).allowed).toBe(true);
    clock.now += 30 * MIN;
    const second = await check();
    expect(second.allowed).toBe(false);
    expect(second.why).toContain("next allowed at");
    expect(second.budget.remainingInWindow).toBe(0);
    expect(second.budget.nextNudgeAt).toBe(T0 + 60 * MIN);
    clock.now = T0 + 61 * MIN;
    list.agents = [agent({ lastActivityAt: T0 - 45 * MIN })];
    expect((await check()).allowed).toBe(true);
  });

  it("queues a decision once after two nudges without progress, then refuses", async () => {
    const { check, clock, escalate } = setup([agent()]);
    expect((await check()).allowed).toBe(true);
    clock.now += 61 * MIN;
    expect((await check()).allowed).toBe(true);
    clock.now += 61 * MIN;
    const third = await check();
    expect(third).toMatchObject({ allowed: false, escalated: true });
    expect(escalate).toHaveBeenCalledTimes(1);
    expect(escalate.mock.calls[0][1]).toBe(2);
    clock.now += 61 * MIN;
    const fourth = await check();
    expect(fourth.allowed).toBe(false);
    expect(fourth.escalated).toBeUndefined();
    expect(escalate).toHaveBeenCalledTimes(1);
  });

  it("progress after a nudge resets the count", async () => {
    const { check, clock, list, escalate } = setup([agent()]);
    await check();
    clock.now += 61 * MIN;
    await check();
    clock.now += 61 * MIN;
    list.agents = [agent({ lastActivityAt: T0 + 62 * MIN })]; // active after the 2nd nudge (T0+61)
    clock.now = T0 + 62 * MIN + 61 * MIN;
    const v = await check();
    expect(v.allowed).toBe(true);
    expect(v.budget.unanswered).toBe(1);
    expect(escalate).not.toHaveBeenCalled();
  });

  it("redirects a coordinator's subagent to its live coordinator", async () => {
    const coordinator = agent({ id: "c1", title: "PCC" });
    const sub = agent({ id: "s1", title: "Helper", labels: { "paseo.parent-agent-id": "c1" } });
    const v = await setup([coordinator, sub]).check("s1");
    expect(v.allowed).toBe(false);
    expect(v.askInstead).toEqual({ agentId: "c1", title: "PCC" });
    // The parent is gone: the label no longer protects it.
    expect((await setup([sub]).check("s1")).allowed).toBe(true);
  });

  it("parses agents from the Paseo list", () => {
    const [a] = agentInfos([{ agent: { id: "x", title: "T", status: "idle", labels: { k: "v" }, parentAgentId: "p", updatedAt: "2026-10-27T12:00:00Z" } }, { nope: 1 }]);
    expect(a).toMatchObject({ id: "x", parentAgentId: "p", lastActivityAt: T0 });
  });
});
