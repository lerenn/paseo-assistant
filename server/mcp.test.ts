import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DecisionStore } from "./decisions";
import { MailStore } from "./mailbox";
import { McpServer } from "./mcp";
import { CapabilityStore } from "./tokens";
import { mailTools, toolNames, type ToolContext } from "./tools";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mcp-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function setup(capability: ToolContext["capability"]) {
  const mailbox = new MailStore(path.join(dir, "m.json"));
  const onMail = vi.fn();
  const ctx: ToolContext = { capability, mailbox, decisions: new DecisionStore(path.join(dir, "d.json")), nameOf: async (id, hint) => hint ?? `name-${id}`, onMail };
  return { mailbox, onMail, ctx, mcp: new McpServer(mailTools) };
}
const call = (mcp: McpServer, ctx: ToolContext, name: string, args: unknown) =>
  mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx) as Promise<any>;

describe("assistant MCP", () => {
  it("shows agents only assistant_mail and the Assistant only the read tools", async () => {
    expect(toolNames("agent")).toEqual(["assistant_mail"]);
    expect(toolNames("assistant")).toEqual(["assistant_mailbox", "assistant_mark_read", "assistant_decision_add", "assistant_decision_close"]);
    const { mcp, ctx } = setup({ role: "agent", agentId: "a1" });
    const list: any = await mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" }, ctx);
    expect(list.result.tools.map((t: any) => t.name)).toEqual(["assistant_mail"]);
  });

  it("stores a mail with the caller identity, not anything the agent claims", async () => {
    const { mcp, ctx, mailbox, onMail } = setup({ role: "agent", agentId: "a1", name: "Builder" });
    const out = await call(mcp, ctx, "assistant_mail", { subject: "PR opened", body: "#12", kind: "pr", agentId: "evil" });
    expect(out.result.isError).toBeUndefined();
    expect(mailbox.list()[0]).toMatchObject({ agentId: "a1", agentName: "Builder", subject: "PR opened", kind: "pr", read: false });
    expect(onMail).toHaveBeenCalledOnce();
  });

  it("treats the legacy needs_louis and needs_user kinds as blocked", async () => {
    const { mcp, ctx, mailbox } = setup({ role: "agent", agentId: "a1" });
    await call(mcp, ctx, "assistant_mail", { subject: "s", kind: "needs_louis" });
    await call(mcp, ctx, "assistant_mail", { subject: "t", kind: "needs_user" });
    expect(mailbox.list().map((m) => m.kind)).toEqual(["blocked", "blocked"]);
    const list: any = await mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" }, ctx);
    expect(JSON.stringify(list.result.tools)).not.toMatch(/louis|needs_user/i);
  });

  it("rejects an unknown kind and an agent that is not bound yet", async () => {
    const bad = setup({ role: "agent", agentId: "a1" });
    expect((await call(bad.mcp, bad.ctx, "assistant_mail", { subject: "s", kind: "chatty" })).result.isError).toBe(true);
    const unbound = setup({ role: "agent" });
    expect((await call(unbound.mcp, unbound.ctx, "assistant_mail", { subject: "s", kind: "start" })).result.isError).toBe(true);
    expect(unbound.mailbox.list()).toEqual([]);
  });

  it("refuses the Assistant's tools to an agent and mail to the Assistant", async () => {
    const agent = setup({ role: "agent", agentId: "a1" });
    expect((await call(agent.mcp, agent.ctx, "assistant_mailbox", {})).error.code).toBe(-32602);
    const assistant = setup({ role: "assistant" });
    expect((await call(assistant.mcp, assistant.ctx, "assistant_mail", { subject: "s", kind: "start" })).error.code).toBe(-32602);
  });

  it("lets the Assistant read unread mail and mark it read", async () => {
    const { mcp, ctx, mailbox } = setup({ role: "assistant" });
    const m = mailbox.add({ agentId: "a1", agentName: "A", subject: "s", body: "", kind: "done" });
    const unread = await call(mcp, ctx, "assistant_mailbox", {});
    expect(JSON.parse(unread.result.content[0].text)).toHaveLength(1);
    await call(mcp, ctx, "assistant_mark_read", { ids: [m.id] });
    expect(JSON.parse((await call(mcp, ctx, "assistant_mailbox", {})).result.content[0].text)).toHaveLength(0);
  });
});

describe("CapabilityStore", () => {
  it("binds, resolves, persists and revokes", () => {
    const file = path.join(dir, "c.json");
    const store = new CapabilityStore(file);
    const token = store.create({ role: "agent" });
    store.bind(token, "a1");
    expect(new CapabilityStore(file).resolve(token)).toMatchObject({ role: "agent", agentId: "a1" });
    expect(store.resolve("nope")).toBeNull();
    store.revokeAgent("a1");
    expect(new CapabilityStore(file).resolve(token)).toBeNull();
  });
  it("finds the Assistant token", () => {
    const store = new CapabilityStore(path.join(dir, "c.json"));
    expect(store.assistantToken()).toBeNull();
    const token = store.create({ role: "assistant" });
    expect(store.assistantToken()).toBe(token);
  });
});
