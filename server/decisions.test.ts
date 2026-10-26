import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { orderOptions } from "../shared/decision";
import { McpServer } from "./mcp";
import { DecisionStore, decisionNudge } from "./decisions";
import { MailStore } from "./mailbox";
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
    mailbox: new MailStore(path.join(dir, "m.json")),
    decisions: new DecisionStore(path.join(dir, "d.json")),
    nameOf: async () => "x",
    onMail: () => undefined,
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
