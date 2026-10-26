import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentsMailClient } from "./agentsmail";
import { DecisionStore } from "./decisions";
import { ItemStore } from "./items";
import { McpServer } from "./mcp";
import { ShimUsageStore, describeReport, shimReport } from "./shims";
import { CapabilityStore } from "./tokens";
import { mailTools, type ToolContext } from "./tools";

let dir: string;
beforeEach(() => void (dir = mkdtempSync(path.join(tmpdir(), "shims-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("shimReport", () => {
  it("lists the live agents that still hold the old tool and says whether the forwarders can go", () => {
    const usage = { uses: 3, lastAt: 1000, byTool: { assistant_mail: 3 } };
    const r = shimReport(["a1", "a2", "gone", "a1"], ["a1", "a2", "other"], usage);
    expect(r).toEqual({ liveHolders: ["a1", "a2"], capabilities: 4, uses: 3, lastUsedAt: 1000, removable: false });
    expect(describeReport(r)).toMatch(/2 live agent\(s\) still hold the old assistant_mail tool \(a1, a2\)/);
  });
  it("is removable when no live agent holds it", () => {
    const r = shimReport(["gone"], ["other"], { uses: 0, lastAt: null, byTool: {} });
    expect(r.removable).toBe(true);
    expect(describeReport(r)).toMatch(/can be removed/);
    expect(shimReport([], [], { uses: 0, lastAt: null, byTool: {} }).removable).toBe(true);
  });
});

describe("capabilities and usage", () => {
  it("CapabilityStore.agentIds lists the bound agent capabilities only", () => {
    const store = new CapabilityStore(path.join(dir, "c.json"));
    const bound = store.create({ role: "agent" });
    store.bind(bound, "a1");
    store.create({ role: "agent" });
    store.create({ role: "assistant" });
    expect(store.agentIds()).toEqual(["a1"]);
    store.revokeAgent("a1");
    expect(store.agentIds()).toEqual([]);
  });

  it("counts the calls to the forwarding tools, and survives a restart", async () => {
    const file = path.join(dir, "u.json");
    let t = 0;
    const usage = new ShimUsageStore(file, () => ++t);
    const ctx = (role: "agent" | "assistant"): ToolContext => ({
      capability: { role, agentId: "a1" },
      agentsMail: new AgentsMailClient(path.join(dir, "none.json")),
      decisions: new DecisionStore(path.join(dir, "d.json")),
      items: new ItemStore(path.join(dir, "i.json")),
      paseo: () => null,
      renew: async () => ({ agentId: "x" }),
      shimUsed: (tool) => usage.record(tool),
      nameOf: async () => "x",
    });
    const call = (c: ToolContext, name: string, args: unknown) => new McpServer(mailTools).handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, c);
    await call(ctx("agent"), "assistant_mail", { subject: "s", kind: "done" }); // fails (no Agents Mail) but is still a use
    await call(ctx("assistant"), "assistant_mailbox", {});
    await call(ctx("assistant"), "assistant_mark_read", {});
    expect(usage.read()).toEqual({ uses: 3, lastAt: 3, byTool: { assistant_mail: 1, assistant_mailbox: 1, assistant_mark_read: 1 } });
    expect(new ShimUsageStore(file).read().uses).toBe(3);
  });
});
