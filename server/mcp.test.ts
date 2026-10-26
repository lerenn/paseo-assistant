import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentsMailClient } from "./agentsmail";
import { DecisionStore } from "./decisions";
import { McpServer } from "./mcp";
import { CapabilityStore } from "./tokens";
import { mailTools, toolNames, type ToolContext } from "./tools";

let dir: string;
let servers: Server[];
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mcp-"));
  servers = [];
});
afterEach(() => {
  servers.forEach((s) => s.close());
  rmSync(dir, { recursive: true, force: true });
});

/** A stand-in for the Agents Mail admin API that records what it is asked. */
async function fakeAgentsMail() {
  const seen: { method: string; url: string; body: any }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
      seen.push({ method: req.method!, url: req.url!, body });
      res.setHeader("content-type", "application/json");
      if (req.headers.authorization !== "Bearer t0k") return void res.writeHead(401).end("{}");
      if (req.url === "/api/health") return void res.end(JSON.stringify({ ok: true, apiVersion: 1 }));
      if (req.url!.startsWith("/api/mailboxes/")) {
        return void res.end(JSON.stringify({ mails: [{ id: "m1", from: { type: "agent", agentId: "a1", name: "Builder" }, subject: "PR up", body: "#7", kind: "pr", createdAt: 5, readAt: null }] }));
      }
      if (req.url === "/api/mails/read") return void res.end(JSON.stringify({ marked: 1 }));
      if (req.url === "/api/mails") return void res.end(JSON.stringify({ id: "new" }));
      if (req.url === "/api/import") return void res.end(JSON.stringify({ imported: body.mails.length }));
      res.writeHead(404).end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const file = path.join(dir, "endpoint.json");
  writeFileSync(file, JSON.stringify({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, token: "t0k", apiVersion: 1 }));
  return { seen, client: new AgentsMailClient(file), file };
}

function ctxFor(capability: ToolContext["capability"], agentsMail: AgentsMailClient): { ctx: ToolContext; mcp: McpServer } {
  return {
    ctx: { capability, agentsMail, decisions: new DecisionStore(path.join(dir, "d.json")), nameOf: async (id, hint) => hint ?? `name-${id}` },
    mcp: new McpServer(mailTools),
  };
}
const call = (mcp: McpServer, ctx: ToolContext, name: string, args: unknown) =>
  mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx) as Promise<any>;

describe("assistant MCP (legacy mail tools are shims over Agents Mail)", () => {
  it("shows agents only assistant_mail and the Assistant the read and decision tools", async () => {
    expect(toolNames("agent")).toEqual(["assistant_mail"]);
    expect(toolNames("assistant")).toEqual(["assistant_mailbox", "assistant_mark_read", "assistant_decision_add", "assistant_decision_close"]);
  });

  it("forwards assistant_mail with the caller identity, not anything the agent claims", async () => {
    const { seen, client } = await fakeAgentsMail();
    const { mcp, ctx } = ctxFor({ role: "agent", agentId: "a1", name: "Builder" }, client);
    const out = await call(mcp, ctx, "assistant_mail", { subject: "PR opened", body: "#12", kind: "pr", agentId: "evil" });
    expect(out.result.isError).toBeUndefined();
    expect(out.result.content[0].text).toMatch(/Deprecated/);
    const post = seen.find((r) => r.url === "/api/mails")!;
    expect(post.body).toEqual({ to: "@assistant", subject: "PR opened", body: "#12", kind: "pr", asAgent: { agentId: "a1", name: "Builder" } });
  });

  it("maps the former needs_louis and needs_user kinds to blocked", async () => {
    const { seen, client } = await fakeAgentsMail();
    const { mcp, ctx } = ctxFor({ role: "agent", agentId: "a1" }, client);
    await call(mcp, ctx, "assistant_mail", { subject: "s", kind: "needs_louis" });
    await call(mcp, ctx, "assistant_mail", { subject: "t", kind: "needs_user" });
    expect(seen.filter((r) => r.url === "/api/mails").map((r) => r.body.kind)).toEqual(["blocked", "blocked"]);
  });

  it("rejects an unknown kind and an agent that is not bound yet", async () => {
    const { seen, client } = await fakeAgentsMail();
    const bad = ctxFor({ role: "agent", agentId: "a1" }, client);
    expect((await call(bad.mcp, bad.ctx, "assistant_mail", { subject: "s", kind: "chatty" })).result.isError).toBe(true);
    const unbound = ctxFor({ role: "agent" }, client);
    expect((await call(unbound.mcp, unbound.ctx, "assistant_mail", { subject: "s", kind: "start" })).result.isError).toBe(true);
    expect(seen.filter((r) => r.url === "/api/mails")).toEqual([]);
  });

  it("says plainly that nothing was sent when Agents Mail is not installed", async () => {
    const { mcp, ctx } = ctxFor({ role: "agent", agentId: "a1" }, new AgentsMailClient(path.join(dir, "missing.json")));
    const out = await call(mcp, ctx, "assistant_mail", { subject: "s", kind: "done" });
    expect(out.result.isError).toBe(true);
    expect(out.result.content[0].text).toMatch(/not installed.*Nothing was changed/);
  });

  it("refuses the Assistant's tools to an agent and mail to the Assistant", async () => {
    const { client } = await fakeAgentsMail();
    const agent = ctxFor({ role: "agent", agentId: "a1" }, client);
    expect((await call(agent.mcp, agent.ctx, "assistant_mailbox", {})).error.code).toBe(-32602);
    const assistant = ctxFor({ role: "assistant" }, client);
    expect((await call(assistant.mcp, assistant.ctx, "assistant_mail", { subject: "s", kind: "start" })).error.code).toBe(-32602);
  });

  it("lets the Assistant read the alias mailbox and mark mail read through Agents Mail", async () => {
    const { seen, client } = await fakeAgentsMail();
    const { mcp, ctx } = ctxFor({ role: "assistant" }, client);
    const unread = JSON.parse((await call(mcp, ctx, "assistant_mailbox", {})).result.content[0].text);
    expect(unread).toEqual([{ id: "m1", agentId: "a1", agentName: "Builder", subject: "PR up", body: "#7", kind: "pr", at: 5, read: false }]);
    expect(seen.some((r) => r.url === "/api/mailboxes/alias%3Aassistant/mails?unreadOnly=true")).toBe(true);
    const marked = JSON.parse((await call(mcp, ctx, "assistant_mark_read", { ids: ["m1"] })).result.content[0].text);
    expect(marked).toEqual({ marked: 1 });
    expect(seen.find((r) => r.url === "/api/mails/read")!.body).toEqual({ mailbox: "alias:assistant", ids: ["m1"] });
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
