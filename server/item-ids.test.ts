import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findById, shortId } from "../shared/id";
import { STALE_AFTER_MS, isStale } from "../shared/item";
import { AgentsMailClient } from "./agentsmail";
import { DecisionStore } from "./decisions";
import { ItemStore } from "./items";
import { McpServer } from "./mcp";
import { ASSISTANT_PROMPT } from "./prompt";
import { mailTools, type ToolContext } from "./tools";

let dir: string;
beforeEach(() => void (dir = mkdtempSync(path.join(tmpdir(), "item-ids-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("findById", () => {
  const rs = [{ id: "b1a3a95d-1" }, { id: "b1a3ffff-2" }, { id: "c0ffee00-3" }];
  it("takes the full id, the 8 character id, a unique prefix of 4+ characters, any case", () => {
    expect(findById(rs, "b1a3a95d-1", "item")).toBe(rs[0]);
    expect(findById(rs, "b1a3a95d", "item")).toBe(rs[0]);
    expect(findById(rs, "C0FF", "item")).toBe(rs[2]);
    expect(shortId("b1a3a95d-1")).toBe("b1a3a95d");
  });
  it("refuses a short, unknown or ambiguous reference, naming the noun", () => {
    expect(() => findById(rs, "b1a", "item")).toThrow(/too short for a item id|too short for an? item id/);
    expect(() => findById(rs, "b1a3", "item")).toThrow(/matches 2 items \(b1a3a95d, b1a3ffff\)/);
    expect(() => findById(rs, "dead", "item")).toThrow(/Unknown item/);
  });
});

describe("items by short id", () => {
  it("update and close accept the short id or a unique prefix", () => {
    const store = new ItemStore(path.join(dir, "i.json"));
    const a = store.add({ title: "a" });
    const b = store.add({ title: "b" });
    expect(store.update(shortId(a.id), { title: "a2" }).title).toBe("a2");
    expect(store.close(b.id.slice(0, 5), "done").closed?.note).toBe("done");
    expect(() => store.close("zzzz")).toThrow(/Unknown item/);
    expect(() => store.update("ab", { title: "x" })).toThrow(/too short/);
  });

  const ctx = (): ToolContext => ({
    capability: { role: "assistant" },
    agentsMail: new AgentsMailClient(path.join(dir, "none.json")),
    decisions: new DecisionStore(path.join(dir, "d.json")),
    items: new ItemStore(path.join(dir, "t.json")),
    paseo: () => null,
    renew: async () => ({ agentId: "x" }),
    nameOf: async () => "x",
  });
  const call = async (c: ToolContext, name: string, args: unknown) => (await new McpServer(mailTools).handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, c)) as any;
  const text = (r: any) => JSON.parse(r.result.content[0].text);

  it("the tools accept the short id; add reports it", async () => {
    const c = ctx();
    const added = text(await call(c, "assistant_item_add", { title: "Merge PR 3", owner: "human" }));
    expect(added.shortId).toBe(added.id.slice(0, 8));
    expect((await call(c, "assistant_item_update", { id: added.shortId, detail: "steps" })).result.isError).toBeUndefined();
    expect(c.items.list()[0].detail).toBe("steps");
    expect((await call(c, "assistant_item_close", { id: added.shortId, note: "merged" })).result.isError).toBeUndefined();
    expect(c.items.list()[0].closed?.note).toBe("merged");
    expect((await call(c, "assistant_item_close", { id: "nope-nope" })).result.isError).toBe(true);
  });

  it("assistant_item_list gives id, shortId, title, owner, status, times, stale; filters by status and owner", async () => {
    const c = ctx();
    const a = c.items.add({ title: "wait", owner: "agent" });
    const h = c.items.add({ title: "do", owner: "human" });
    c.items.close(h.id);
    const open = text(await call(c, "assistant_item_list", {}));
    expect(open.map((i: any) => i.title)).toEqual(["wait"]);
    expect(open[0]).toMatchObject({ id: a.id, shortId: shortId(a.id), owner: "agent", status: "open", stale: false });
    expect(open[0].createdAt).toBeTruthy();
    expect(open[0].updatedAt).toBeTruthy();
    expect(text(await call(c, "assistant_item_list", { status: "closed" })).map((i: any) => [i.title, i.status])).toEqual([["do", "closed"]]);
    expect(text(await call(c, "assistant_item_list", { status: "all" }))).toHaveLength(2);
    expect(text(await call(c, "assistant_item_list", { status: "all", owner: "human" })).map((i: any) => i.title)).toEqual(["do"]);
    expect((await call({ ...c, capability: { role: "agent", agentId: "a1" } }, "assistant_item_list", {})).error.code).toBe(-32602);
  });
});

describe("stale items (24 h without an update)", () => {
  const item = (age: number, closed = false) => ({ updatedAt: 1_000_000 - age, closed: closed ? { at: 1, note: null } : null });
  it("flags an open item after 24 hours, not before, never a closed one", () => {
    const now = 1_000_000;
    expect(STALE_AFTER_MS).toBe(24 * 3_600_000);
    expect(isStale(item(STALE_AFTER_MS - 1), now)).toBe(false);
    expect(isStale(item(STALE_AFTER_MS + 1), now)).toBe(true);
    expect(isStale(item(STALE_AFTER_MS * 5, true), now)).toBe(false);
  });
  it("an update resets it", () => {
    let t = 0;
    const store = new ItemStore(path.join(dir, "s.json"), () => t);
    const a = store.add({ title: "x" });
    t = STALE_AFTER_MS + 10;
    expect(isStale(store.list()[0], t)).toBe(true);
    store.update(a.id, { detail: "still true" });
    expect(isStale(store.list()[0], t)).toBe(false);
  });
});

describe("the heartbeat review rule", () => {
  it("rides on the existing heartbeat text, and says what to check and do", () => {
    expect(ASSISTANT_PROMPT).toContain("## Review on every heartbeat");
    for (const text of ["assistant_item_list", "list_agents, get_agent_status", "the PR or run it links to", "assistant_item_close", "assistant_item_update", "stale?", "stays as it is"]) {
      expect(ASSISTANT_PROMPT, text).toContain(text);
    }
    expect(ASSISTANT_PROMPT).toContain('"Process the Assistant mailbox"');
  });
});
