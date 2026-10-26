import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { orderOptions } from "../shared/decision";
import { McpServer } from "./mcp";
import { DecisionStore, decisionNudge } from "./decisions";
import { AgentsMailClient } from "./agentsmail";
import { ItemStore } from "./items";
import { mailTools, type ToolContext } from "./tools";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "decisions-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const input = { question: "Ship it?", options: ["No", "Yes", "Later"], recommended: "Yes" };

describe("orderOptions", () => {
  it("puts the recommended option first and keeps the rest in order", () => {
    expect(orderOptions(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
    expect(orderOptions(["a", "b"], " a ")).toEqual(["a", "b"]);
  });
  it("refuses a recommendation that is not an option", () => {
    expect(() => orderOptions(["a", "b"], "z")).toThrow(/one of the options/);
  });
});

describe("DecisionStore", () => {
  it("stores options with the recommended one first", () => {
    const store = new DecisionStore(path.join(dir, "d.json"));
    expect(store.add(input).options).toEqual(["Yes", "No", "Later"]);
    expect(store.openCount()).toBe(1);
  });

  it("lists open decisions oldest first, then answered ones newest first", () => {
    let t = 0;
    const store = new DecisionStore(path.join(dir, "d.json"), () => ++t);
    const a = store.add({ ...input, question: "A" });
    const b = store.add({ ...input, question: "B" });
    const c = store.add({ ...input, question: "C" });
    store.answer(a.id, "Yes", false);
    store.answer(c.id, "my own", true);
    expect(store.list().map((d) => d.question)).toEqual(["B", "C", "A"]);
    expect(store.openCount()).toBe(1);
    expect(b.answer).toBeNull();
  });

  it("answers once, only with an option unless free text", () => {
    const store = new DecisionStore(path.join(dir, "d.json"));
    const d = store.add(input);
    expect(() => store.answer(d.id, "Maybe", false)).toThrow(/options/);
    expect(store.answer(d.id, "Maybe", true).answer).toMatchObject({ text: "Maybe", other: true });
    expect(() => store.answer(d.id, "Yes", false)).toThrow(/already answered/);
    expect(() => store.answer("nope", "Yes", false)).toThrow(/Unknown/);
  });

  it("rejects duplicate options and persists across instances", () => {
    const file = path.join(dir, "d.json");
    const store = new DecisionStore(file);
    expect(() => store.add({ question: "q", options: ["a", "a"], recommended: "a" })).toThrow(/distinct/);
    const d = store.add(input);
    store.answer(d.id, "No", false);
    expect(new DecisionStore(file).list()[0].answer?.text).toBe("No");
  });
});

describe("decisionNudge", () => {
  it("carries the id, question and answer, and marks free text", () => {
    const store = new DecisionStore(path.join(dir, "d.json"));
    const d = store.add(input);
    const text = decisionNudge(store.answer(d.id, "Wait for QA", true));
    expect(text).toContain(`id ${d.id}`);
    expect(text).toContain("Question: Ship it?");
    expect(text).toContain("Answer: Wait for QA (free text)");
    const d2 = store.add(input);
    expect(decisionNudge(store.answer(d2.id, "Yes", false))).toContain("Answer: Yes\n");
  });
});

describe("assistant_decision_add", () => {
  const ctx = (role: "agent" | "assistant"): ToolContext => ({
    capability: { role, agentId: role === "agent" ? "a1" : undefined },
    agentsMail: new AgentsMailClient(path.join(dir, "no-endpoint.json")),
    decisions: new DecisionStore(path.join(dir, "d.json")),
    items: new ItemStore(path.join(dir, "i.json")),
    paseo: () => null,
    renew: async () => ({ agentId: "new" }),
    nameOf: async () => "x",
  });
  const call = (c: ToolContext, args: unknown) =>
    new McpServer(mailTools).handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "assistant_decision_add", arguments: args } }, c) as Promise<any>;

  it("lets the Assistant queue a decision", async () => {
    const c = ctx("assistant");
    const out = await call(c, input);
    expect(JSON.parse(out.result.content[0].text).options).toEqual(["Yes", "No", "Later"]);
    expect(c.decisions.openCount()).toBe(1);
  });
  it("is hidden from other agents", async () => {
    const c = ctx("agent");
    expect((await call(c, input)).error.code).toBe(-32602);
    expect(c.decisions.openCount()).toBe(0);
  });
  it("validates option count and the recommendation", async () => {
    const c = ctx("assistant");
    expect((await call(c, { ...input, options: ["only"] })).result.isError).toBe(true);
    expect((await call(c, { ...input, options: ["a", "b", "c", "d", "e"] })).result.isError).toBe(true);
    expect((await call(c, { ...input, recommended: "zzz" })).result.isError).toBe(true);
  });
});

describe("assistant_decision_close", () => {
  const ctx = (role: "agent" | "assistant" = "assistant"): ToolContext => ({
    capability: { role, agentId: role === "agent" ? "a1" : undefined },
    agentsMail: new AgentsMailClient(path.join(dir, "no-endpoint.json")),
    decisions: new DecisionStore(path.join(dir, "d.json")),
    items: new ItemStore(path.join(dir, "i.json")),
    paseo: () => null,
    renew: async () => ({ agentId: "new" }),
    nameOf: async () => "x",
  });
  const call = (c: ToolContext, name: string, args: unknown) =>
    new McpServer(mailTools).handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, c) as Promise<any>;

  it("records a chat answer without any nudge, shown as chat", async () => {
    const c = ctx();
    const id = JSON.parse((await call(c, "assistant_decision_add", input)).result.content[0].text).id;
    const out = await call(c, "assistant_decision_close", { id, answer: "Yes" });
    expect(out.result.isError).toBeUndefined();
    const d = c.decisions.list()[0];
    expect(d.answer).toMatchObject({ text: "Yes", other: false, source: "chat" });
    expect(c.decisions.openCount()).toBe(0);
  });
  it("keeps an answer outside the options as free text", async () => {
    const c = ctx();
    const id = JSON.parse((await call(c, "assistant_decision_add", input)).result.content[0].text).id;
    await call(c, "assistant_decision_close", { id, answer: "Tomorrow" });
    expect(c.decisions.list()[0].answer).toMatchObject({ text: "Tomorrow", other: true, source: "chat" });
  });
  it("errors on an unknown or already answered id, and is hidden from agents", async () => {
    const c = ctx();
    expect((await call(c, "assistant_decision_close", { id: "nope", answer: "x" })).result.content[0].text).toContain("Unknown decision");
    const id = JSON.parse((await call(c, "assistant_decision_add", input)).result.content[0].text).id;
    await call(c, "assistant_decision_close", { id, answer: "Yes" });
    expect((await call(c, "assistant_decision_close", { id, answer: "No" })).result.content[0].text).toContain("already answered");
    expect((await call(ctx("agent"), "assistant_decision_close", { id, answer: "x" })).error.code).toBe(-32602);
  });
  it("tab answers default to source tab", () => {
    const store = new DecisionStore(path.join(dir, "t.json"));
    const d = store.add({ question: "q", options: ["a", "b"], recommended: "a" });
    expect(store.answer(d.id, "a", false).answer?.source).toBe("tab");
  });
});

describe("decision status and assistant_decision_list", () => {
  const ctx = (): ToolContext => ({
    capability: { role: "assistant" },
    agentsMail: new AgentsMailClient(path.join(dir, "none.json")),
    decisions: new DecisionStore(path.join(dir, "d.json"), () => Date.parse("2026-10-26T10:00:00Z")),
    items: new ItemStore(path.join(dir, "i.json")),
    paseo: () => null,
    renew: async () => ({ agentId: "new" }),
    nameOf: async () => "x",
  });
  const list = async (c: ToolContext, args: unknown = {}) =>
    JSON.parse(
      ((await new McpServer(mailTools).handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "assistant_decision_list", arguments: args } }, c)) as any).result.content[0].text,
    ) as any[];

  it("reports pending, answered (not yet told), delivered and closed, with timestamps and the recommended option", async () => {
    const c = ctx();
    const pending = c.decisions.add(input);
    const tab = c.decisions.add({ ...input, question: "Tab?" });
    const delivered = c.decisions.add({ ...input, question: "Delivered?" });
    const chat = c.decisions.add({ ...input, question: "Chat?" });
    c.decisions.answer(tab.id, "No", false);
    c.decisions.answer(delivered.id, "Yes", false);
    c.decisions.markDelivered([delivered.id]);
    c.decisions.close(chat.id, "Later");
    const all = await list(c);
    const byQuestion = Object.fromEntries(all.map((d) => [d.question, d]));
    expect(byQuestion["Ship it?"]).toMatchObject({ id: pending.id, status: "pending", recommended: "Yes", answer: null, source: null });
    expect(byQuestion["Tab?"]).toMatchObject({ status: "answered", answer: "No", source: "tab", deliveredAt: null });
    expect(byQuestion["Delivered?"]).toMatchObject({ status: "delivered", source: "tab" });
    expect(byQuestion["Delivered?"].deliveredAt).toBe("2026-10-26T10:00:00.000Z");
    expect(byQuestion["Chat?"]).toMatchObject({ status: "closed", source: "chat", answer: "Later" });
    expect(byQuestion["Ship it?"].createdAt).toBe("2026-10-26T10:00:00.000Z");
  });

  it("filters by status and by creation time", async () => {
    let t = Date.parse("2026-10-26T10:00:00Z");
    const c = ctx();
    c.decisions = new DecisionStore(path.join(dir, "d2.json"), () => (t += 3_600_000));
    c.decisions.add(input);
    const second = c.decisions.add({ ...input, question: "Second?" });
    c.decisions.answer(second.id, "No", false);
    expect((await list(c, { status: "answered" })).map((d) => d.question)).toEqual(["Second?"]);
    expect((await list(c, { status: "pending" })).map((d) => d.question)).toEqual(["Ship it?"]);
    expect((await list(c, { since: "2026-10-26T12:30:00Z" })).map((d) => d.question)).toEqual([]);
    expect((await list(c, { since: "2026-10-26T11:30:00Z", until: "2026-10-26T12:30:00Z" })).map((d) => d.question)).toEqual(["Second?"]);
  });

  it("is for the Assistant only and rejects a bad date", async () => {
    const agent = { ...ctx(), capability: { role: "agent" as const, agentId: "a1" } };
    const out: any = await new McpServer(mailTools).handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "assistant_decision_list", arguments: {} } }, agent);
    expect(out.error.code).toBe(-32602);
    const bad: any = await new McpServer(mailTools).handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "assistant_decision_list", arguments: { since: "not a date" } } }, ctx());
    expect(bad.result.isError).toBe(true);
  });

  it("tells the Assistant to check the list before queueing", async () => {
    const { ASSISTANT_PROMPT, ALLOWED_TOOLS } = await import("./prompt");
    expect(ASSISTANT_PROMPT).toContain("assistant_decision_list");
    expect(ALLOWED_TOOLS).toContain("mcp__assistant__assistant_decision_list");
  });
});

describe("cancelling a decision (the × on its card)", () => {
  it("moves it out of the open ones with no answer, refuses a second cancel or a later answer, and not after an answer", () => {
    let t = 0;
    const store = new DecisionStore(path.join(dir, "c.json"), () => ++t);
    const a = store.add(input);
    const b = store.add({ ...input, question: "Second?" });
    const cancelled = store.cancel(a.id);
    expect(cancelled).toMatchObject({ id: a.id, answer: null, cancelledAt: 3 });
    expect(store.openCount()).toBe(1);
    expect(store.list().map((d) => d.id)).toEqual([b.id, a.id]); // open first, then done
    expect(() => store.cancel(a.id)).toThrow(/already cancelled/);
    expect(() => store.answer(a.id, "Yes", false)).toThrow(/cancelled/);
    store.answer(b.id, "No", false);
    expect(() => store.cancel(b.id)).toThrow(/already answered/);
    expect(() => store.cancel("nope")).toThrow(/Unknown/);
    // Survives a restart.
    expect(new DecisionStore(path.join(dir, "c.json")).list().find((d) => d.id === a.id)?.cancelledAt).toBe(3);
  });

  it("is told to the Assistant with the id and the question, and marked delivered", async () => {
    const { cancelNudge } = await import("./decisions");
    const store = new DecisionStore(path.join(dir, "n.json"));
    const d = store.cancel(store.add(input).id);
    expect(cancelNudge(d)).toMatch(/^Decision cancelled by the user \(id .+\): Ship it\?/);
    expect(cancelNudge(d)).toMatch(/not to wait/);
    store.markDelivered([d.id]);
    expect(store.list()[0].deliveredAt).not.toBeNull();
  });

  it("goes through the same idle-only queue as answers", async () => {
    const { Delivery, PendingDeliveries } = await import("./delivery");
    const { cancelNudge } = await import("./decisions");
    const store = new DecisionStore(path.join(dir, "q.json"));
    const d = store.cancel(store.add(input).id);
    const queue = new PendingDeliveries(path.join(dir, "pq.json"));
    const sent: string[] = [];
    const state = { status: "running" as string | null };
    vi.useFakeTimers();
    const delivery = new Delivery({ queue, status: async () => state.status, decisionText: () => cancelNudge(d), send: async (t) => void sent.push(t), debounceMs: 10, pollMs: 100 });
    delivery.enqueueDecision(d.id);
    await vi.advanceTimersByTimeAsync(50);
    expect(sent).toEqual([]); // the Assistant is running: never interrupted
    state.status = "idle";
    await vi.advanceTimersByTimeAsync(300);
    expect(sent[0]).toMatch(/Decision cancelled by the user/);
    vi.useRealTimers();
  });

  it("assistant_decision_list shows status cancelled, filters on it, and keeps cancelled ones out of pending", async () => {
    const c: ToolContext = {
      capability: { role: "assistant" },
      agentsMail: new AgentsMailClient(path.join(dir, "none.json")),
      decisions: new DecisionStore(path.join(dir, "l.json")),
      items: new ItemStore(path.join(dir, "i.json")),
      paseo: () => null,
      renew: async () => ({ agentId: "x" }),
      nameOf: async () => "x",
    };
    const open = c.decisions.add(input);
    const dropped = c.decisions.add({ ...input, question: "Dropped?" });
    c.decisions.cancel(dropped.id);
    const list = async (args: unknown) =>
      JSON.parse(((await new McpServer(mailTools).handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "assistant_decision_list", arguments: args } }, c)) as any).result.content[0].text) as any[];
    expect((await list({ status: "cancelled" })).map((d) => [d.question, d.status, d.answer])).toEqual([["Dropped?", "cancelled", null]]);
    expect((await list({ status: "cancelled" }))[0].cancelledAt).toBeTruthy();
    expect((await list({ status: "pending" })).map((d) => d.id)).toEqual([open.id]);
  });
});

describe("short decision ids", () => {
  it("shortId is the first 8 characters; findDecision takes the full id, a prefix or other casing, and refuses short, unknown and ambiguous ones", async () => {
    const { findDecision, shortId } = await import("../shared/decision");
    const ds = [{ id: "b1a3a95d-0000-4000-8000-000000000001" }, { id: "b1a3ffff-0000-4000-8000-000000000002" }, { id: "c0ffee00-0000-4000-8000-000000000003" }];
    expect(shortId(ds[0].id)).toBe("b1a3a95d");
    expect(findDecision(ds, ds[0].id)).toBe(ds[0]);
    expect(findDecision(ds, "b1a3a95d")).toBe(ds[0]);
    expect(findDecision(ds, "C0FFEE00")).toBe(ds[2]);
    expect(() => findDecision(ds, "b1a")).toThrow(/too short/);
    expect(() => findDecision(ds, "b1a3")).toThrow(/matches 2 decisions \(b1a3a95d, b1a3ffff\)/);
    expect(() => findDecision(ds, "deadbeef")).toThrow(/Unknown/);
  });

  it("the store answers, closes and cancels by short id", () => {
    const store = new DecisionStore(path.join(dir, "s.json"));
    const a = store.add(input);
    const b = store.add({ ...input, question: "B?" });
    const c = store.add({ ...input, question: "C?" });
    expect(store.answer(a.id.slice(0, 8), "Yes", false).answer?.text).toBe("Yes");
    expect(store.close(b.id.slice(0, 8), "No").answer?.source).toBe("chat");
    expect(store.cancel(c.id.slice(0, 8)).cancelledAt).not.toBeNull();
  });

  it("the decision tools accept the short id: close, and list one decision; the list shows shortId", async () => {
    const c: ToolContext = {
      capability: { role: "assistant" },
      agentsMail: new AgentsMailClient(path.join(dir, "none.json")),
      decisions: new DecisionStore(path.join(dir, "t.json")),
      items: new ItemStore(path.join(dir, "i.json")),
      paseo: () => null,
      renew: async () => ({ agentId: "x" }),
      nameOf: async () => "x",
    };
    const a = c.decisions.add(input);
    c.decisions.add({ ...input, question: "Other?" });
    const call = async (name: string, args: unknown) => (await new McpServer(mailTools).handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, c)) as any;
    const one = JSON.parse((await call("assistant_decision_list", { id: a.id.slice(0, 8) })).result.content[0].text);
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ id: a.id, shortId: a.id.slice(0, 8), question: "Ship it?" });
    expect((await call("assistant_decision_close", { id: a.id.slice(0, 8), answer: "Yes" })).result.isError).toBeUndefined();
    expect(c.decisions.list().find((d) => d.id === a.id)?.answer?.text).toBe("Yes");
    expect((await call("assistant_decision_list", { id: "zzzzzzzz" })).result.isError).toBe(true);
  });
});
