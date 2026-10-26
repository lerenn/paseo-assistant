import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentsMailClient } from "./agentsmail";
import { DecisionStore } from "./decisions";
import { ItemStore } from "./items";
import { McpServer } from "./mcp";
import { mailTools, toolNames, type ToolContext } from "./tools";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "items-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("ItemStore", () => {
  it("adds, lists open items oldest first and closed ones newest first, and survives a restart", () => {
    let t = 0;
    const file = path.join(dir, "i.json");
    const store = new ItemStore(file, () => ++t);
    const a = store.add({ title: " waiting for PR 3 ", link: "https://github.com/x/y/pull/3" });
    const b = store.add({ title: "pin PR pending restart", detail: "after the window" });
    const c = store.add({ title: "third" });
    store.close(a.id, "merged");
    store.close(c.id);
    expect(store.list().map((i) => i.title)).toEqual(["pin PR pending restart", "third", "waiting for PR 3"]);
    expect(new ItemStore(file).list().map((i) => i.id)).toEqual([b.id, c.id, a.id]);
    expect(store.list()[2].closed).toMatchObject({ note: "merged" });
    expect(store.list()[2].title).toBe("waiting for PR 3");
  });

  it("updates open items, clears fields with an empty string, and refuses closed or unknown ones", () => {
    const store = new ItemStore(path.join(dir, "i.json"));
    const item = store.add({ title: "t", detail: "d", link: "https://example.com" });
    const updated = store.update(item.id, { title: "t2", detail: "", link: "" });
    expect(updated).toMatchObject({ title: "t2", detail: null, link: null });
    store.close(item.id);
    expect(() => store.update(item.id, { title: "x" })).toThrow(/closed/);
    expect(() => store.close(item.id)).toThrow(/already closed/);
    expect(() => store.close("nope")).toThrow(/Unknown/);
  });

  it("accepts only http(s) links", () => {
    const store = new ItemStore(path.join(dir, "i.json"));
    expect(() => store.add({ title: "t", link: "javascript:alert(1)" })).toThrow(/http/);
    expect(() => store.add({ title: "t", link: "not a url" })).toThrow(/http/);
  });

  it("ignores a corrupt file", () => {
    const store = new ItemStore(path.join(dir, "missing", "i.json"));
    expect(store.list()).toEqual([]);
  });
});

describe("item tools", () => {
  const ctx = (role: "agent" | "assistant"): ToolContext => ({
    capability: { role },
    agentsMail: new AgentsMailClient(path.join(dir, "none.json")),
    decisions: new DecisionStore(path.join(dir, "d.json")),
    items: new ItemStore(path.join(dir, "i.json")),
    nameOf: async () => "x",
  });
  const call = (c: ToolContext, name: string, args: unknown) =>
    new McpServer(mailTools).handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, c) as Promise<any>;

  it("are for the Assistant only", async () => {
    expect(toolNames("agent")).toEqual(["assistant_mail"]);
    expect(toolNames("assistant")).toEqual(expect.arrayContaining(["assistant_item_add", "assistant_item_update", "assistant_item_close"]));
    expect((await call(ctx("agent"), "assistant_item_add", { title: "x" })).error.code).toBe(-32602);
  });

  it("add, update and close an item end to end, and report errors as tool errors", async () => {
    const c = ctx("assistant");
    const added = JSON.parse((await call(c, "assistant_item_add", { title: "waiting", link: "https://example.com/pr/1" })).result.content[0].text);
    expect(c.items.list()[0]).toMatchObject({ id: added.id, title: "waiting" });
    expect((await call(c, "assistant_item_update", { id: added.id, detail: "still" })).result.isError).toBeUndefined();
    expect(c.items.list()[0].detail).toBe("still");
    expect((await call(c, "assistant_item_close", { id: added.id, note: "done" })).result.isError).toBeUndefined();
    expect(c.items.list()[0].closed?.note).toBe("done");
    expect((await call(c, "assistant_item_close", { id: added.id })).result.isError).toBe(true);
    expect((await call(c, "assistant_item_add", { title: "x", link: "ftp://bad" })).result.isError).toBe(true);
    expect((await call(c, "assistant_item_add", { title: "" })).result.isError).toBe(true);
  });
});
