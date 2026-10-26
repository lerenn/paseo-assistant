import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
