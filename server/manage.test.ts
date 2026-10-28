import { describe, expect, it } from "vitest";
import { ALLOWED_TOOLS, ASSISTANT_PROMPT, DISALLOWED_TOOLS } from "./prompt";

/** The names of the Paseo MCP server's tools (checked against the server's tool list). */
const PASEO = (names: string[]) => names.map((n) => `mcp__paseo__${n}`);

describe("managing agents", () => {
  it("pre-approves the agent, workspace, schedule and heartbeat tools Louis listed", () => {
    for (const tool of PASEO([
      "send_agent_prompt", "list_agents", "get_agent_status", "get_agent_activity",
      "update_agent", "set_agent_mode", "cancel_agent", "archive_agent", "archive_workspace", "rename_workspace", "list_workspaces",
      "create_schedule", "list_schedules", "delete_schedule", "create_heartbeat", "delete_heartbeat",
    ])) {
      expect(ALLOWED_TOOLS, tool).toContain(tool);
    }
  });

  it("creates agents and workspaces only through the assistant_* tools: the Paseo ones would make subagents", () => {
    for (const tool of ["mcp__paseo__create_agent", "mcp__paseo__create_workspace"]) {
      expect(DISALLOWED_TOOLS).toContain(tool);
      expect(ALLOWED_TOOLS).not.toContain(tool);
    }
    for (const tool of ["assistant_projects_list", "assistant_workspace_create", "assistant_agent_create", "assistant_agents_list"]) {
      expect(ALLOWED_TOOLS).toContain(`mcp__assistant__${tool}`);
      expect(ASSISTANT_PROMPT).toContain(tool);
    }
  });

  it("never lists a tool as both allowed and disallowed", () => {
    expect(ALLOWED_TOOLS.filter((t) => DISALLOWED_TOOLS.includes(t))).toEqual([]);
  });

  it("keeps off what must stay off: notebook edits (Write and Edit are scoped to the memory folder, see renew.test), permission answers, killing, terminals, scripts, other schedule changes", () => {
    for (const tool of ["NotebookEdit", "MultiEdit", ...PASEO(["kill_agent", "respond_to_permission", "update_schedule", "pause_schedule", "resume_schedule", "run_schedule_once", "create_terminal", "kill_terminal", "send_terminal_keys", "start_workspace_script", "stop_workspace_script"])]) {
      expect(DISALLOWED_TOOLS, tool).toContain(tool);
      expect(ALLOWED_TOOLS, tool).not.toContain(tool);
    }
  });

  it("no longer forbids managing agents, and states every guardrail", () => {
    expect(ASSISTANT_PROMPT).not.toMatch(/do not create, archive, kill, cancel or change agents/);
    expect(ASSISTANT_PROMPT).toContain("## Managing agents");
    for (const rule of [
      "Kubernetes Runtime pods",
      "It is not your child",
      "claude/claude-sonnet-5-5",
      "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>",
      "Coordinator or PCC, or the Security coordinator",
      "Factory Supervisor",
      "in the middle of a turn",
      "Finished helpers can be archived freely",
      "Switching an agent to bypassPermissions is allowed only for agents you created yourself (label paseo.created-by=assistant",
      "Never merge or queue anything on tf-aws prod",
      "never contact people by message (Slack, email, DMs, pings in comments)",
      "GitHub review requests and re-requests are allowed to get an approval",
      "never answer an agent's permission request",
      "asking the owning coordinator",
      "Log every action as a Tasks note",
      'pass labels {"paseo.mail-alias": "<role>"}',
    ]) {
      expect(ASSISTANT_PROMPT, rule).toContain(rule);
    }
  });
});

import { createAgent, createWorkspace, listAgents, listProjects, ManageError, type ManagePaseo } from "./manage";
import { McpServer } from "./mcp";
import { mailTools, type ToolContext } from "./tools";
import { AgentsMailClient } from "./agentsmail";
import { DecisionStore } from "./decisions";
import { ItemStore } from "./items";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function fakePaseo() {
  const calls = { workspace: [] as any[], agent: [] as any[] };
  const paseo: ManagePaseo = {
    projects: { list: async () => ({ projects: [{ projectId: "p1", projectDisplayName: "anyshift-monorepo", projectRootPath: "/repo/mono", projectKind: "git" }, { projectId: "p2", projectDisplayName: "lab", projectRootPath: "/repo/lab" }] }) },
    workspaces: {
      list: async () => ({ entries: [{ id: "w1", projectId: "p1", name: "main", directory: "/repo/mono", status: "running" }, { id: "w9", projectId: "p1", name: "old", archivingAt: "now" }] }),
      create: async (o) => (calls.workspace.push(o), { id: "w-new" }),
      ref: (id) => ({ agents: { create: async (o) => (calls.agent.push({ workspaceId: id, ...o }), { id: "a-new" }) } }),
    },
    agents: {
      list: async () => ({
        entries: [
          { agent: { id: "mine", title: "Helper", status: "idle", workspaceId: "w1", provider: "claude", labels: { "paseo.created-by": "assistant" }, parentAgentId: null } },
          { agent: { id: "other", title: "Coordinator", status: "running", workspaceId: "w1", labels: {} } },
        ],
      }),
    },
  };
  return { paseo, calls };
}

describe("agent management tools", () => {
  it("lists projects with their live workspaces", async () => {
    const out = await listProjects(fakePaseo().paseo);
    expect(out[0]).toMatchObject({ projectId: "p1", name: "anyshift-monorepo", rootPath: "/repo/mono" });
    expect(out[0].workspaces.map((w) => w.id)).toEqual(["w1"]);
    expect(out[1].workspaces).toEqual([]);
  });

  it("creates a pod workspace by default, from a project id, name or path, as a plugin call with no parent", async () => {
    for (const ref of ["p1", "anyshift-monorepo", "/repo/mono"]) {
      const { paseo, calls } = fakePaseo();
      expect(await createWorkspace(paseo, { project: ref, title: "Security Coordinator" })).toEqual({ workspaceId: "w-new", projectId: "p1", runtime: "kubernetes" });
      expect(calls.workspace[0]).toEqual({
        source: { kind: "directory", path: "/repo/mono" },
        title: "Security Coordinator",
        runtime: { id: "kubernetes", options: { cwd: "/repo/mono", slug: "security-coordinator", ref: null, title: "Security Coordinator" } },
      });
    }
  });

  it("passes the profile in the Kubernetes options, next to cwd, only when set", async () => {
    const { paseo, calls } = fakePaseo();
    await createWorkspace(paseo, { project: "p1", title: "Big Build", profile: "builder" });
    expect(calls.workspace[0].runtime).toEqual({ id: "kubernetes", options: { cwd: "/repo/mono", slug: "big-build", ref: null, title: "Big Build", profile: "builder" } });
    await createWorkspace(paseo, { project: "p1", title: "Plain" });
    expect(calls.workspace[1].runtime.options).not.toHaveProperty("profile");
    await createWorkspace(paseo, { project: "p1", title: "Local", runtime: "local", profile: "builder" });
    expect(calls.workspace[2].runtime).toEqual({ id: "local" });
  });

  it("validates the profile argument of the tool", async () => {
    const { paseo, calls } = fakePaseo();
    const dir = mkdtempSync(path.join(tmpdir(), "manage-"));
    const c: ToolContext = { capability: { role: "assistant" }, agentsMail: new AgentsMailClient(path.join(dir, "n.json")), decisions: new DecisionStore(path.join(dir, "d.json")), items: new ItemStore(path.join(dir, "i.json")), paseo: () => paseo, renew: async () => ({ agentId: "new" }), nameOf: async () => "x" };
    const call = (args: unknown) => new McpServer(mailTools).handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "assistant_workspace_create", arguments: args } }, c) as Promise<any>;
    const bad = await call({ project: "p1", title: "t", profile: "Bad_Name" });
    expect(bad.error?.code === -32602 || bad.result?.isError).toBeTruthy();
    expect(calls.workspace).toHaveLength(0);
    await call({ project: "p1", title: "t", profile: "builder" });
    expect(calls.workspace[0].runtime.options.profile).toBe("builder");
  });

  it("can create a local workspace, and refuses an unknown or ambiguous project", async () => {
    const { paseo, calls } = fakePaseo();
    await createWorkspace(paseo, { project: "lab", title: "Daemon work", runtime: "local" });
    expect(calls.workspace[0].runtime).toEqual({ id: "local" });
    await expect(createWorkspace(paseo, { project: "nope", title: "x" })).rejects.toThrow(/No project/);
    const twin = fakePaseo().paseo;
    twin.projects.list = async () => ({ projects: [{ projectId: "a", projectDisplayName: "same", projectRootPath: "/a" }, { projectId: "b", projectDisplayName: "same", projectRootPath: "/b" }] });
    await expect(createWorkspace(twin, { project: "same", title: "x" })).rejects.toThrow(/2 projects/);
  });

  it("creates a TOP-LEVEL agent: no parent, labelled as the Assistant's, default provider, system labels protected", async () => {
    const { paseo, calls } = fakePaseo();
    expect(await createAgent(paseo, { workspaceId: "w-new", title: "Sec", prompt: "do it", labels: { team: "sec" } })).toEqual({ agentId: "a-new", workspaceId: "w-new" });
    const sent = calls.agent[0];
    expect(sent).toMatchObject({ workspaceId: "w-new", title: "Sec", prompt: "do it", config: { provider: "claude/claude-sonnet-5-5" }, labels: { team: "sec", "paseo.created-by": "assistant" } });
    expect(sent).not.toHaveProperty("parent");
    expect(sent.labels).not.toHaveProperty("paseo.parent-agent-id");
    await createAgent(paseo, { workspaceId: "w", title: "t", prompt: "p", provider: "codex/gpt", mode: "bypassPermissions" });
    expect(calls.agent[1].config).toEqual({ provider: "codex/gpt", modeId: "bypassPermissions" });
    await expect(createAgent(paseo, { workspaceId: "w", title: "t", prompt: "p", labels: { "paseo.created-by": "x" } })).rejects.toThrow(ManageError);
    await expect(createAgent(paseo, { workspaceId: "w", title: "t", prompt: "p", labels: { "paseo.parent-agent-id": "x" } })).rejects.toThrow(/set by the system/);
  });

  it("asks for agents of background workspaces too (regression: the Assistant itself lives in one)", async () => {
    const { paseo } = fakePaseo();
    const seen: unknown[] = [];
    const original = paseo.agents.list;
    paseo.agents.list = async (o?: unknown) => (seen.push(o), original(o));
    await listAgents(paseo);
    expect(seen[0]).toEqual({ filter: { includeArchived: false, includeBackground: true } });
  });

  it("passes a role's mail alias label through to the agent it creates, without letting it override the system labels", async () => {
    const { paseo, calls } = fakePaseo();
    await createAgent(paseo, { workspaceId: "w", title: "PCC", prompt: "p", labels: { "paseo.mail-alias": "pcc" } });
    expect(calls.agent[0].labels).toEqual({ "paseo.mail-alias": "pcc", "paseo.created-by": "assistant" });
  });

  it("lists only what the Assistant created unless asked for all", async () => {
    const { paseo } = fakePaseo();
    expect((await listAgents(paseo)).map((a) => a.id)).toEqual(["mine"]);
    expect((await listAgents(paseo, { createdByAssistant: false })).map((a) => [a.id, a.createdByAssistant])).toEqual([["mine", true], ["other", false]]);
  });

  describe("as MCP tools", () => {
    const ctx = (role: "agent" | "assistant", paseo: ManagePaseo | null): ToolContext => {
      const dir = mkdtempSync(path.join(tmpdir(), "manage-"));
      return { capability: { role }, agentsMail: new AgentsMailClient(path.join(dir, "n.json")), decisions: new DecisionStore(path.join(dir, "d.json")), items: new ItemStore(path.join(dir, "i.json")), paseo: () => paseo, renew: async () => ({ agentId: "new" }), nameOf: async () => "x" };
    };
    const call = (c: ToolContext, name: string, args: unknown) => new McpServer(mailTools).handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, c) as Promise<any>;

    it("create a workspace then an agent in it, for the Assistant only", async () => {
      const { paseo, calls } = fakePaseo();
      const c = ctx("assistant", paseo);
      const ws = JSON.parse((await call(c, "assistant_workspace_create", { project: "p1", title: "Sec" })).result.content[0].text);
      const ag = JSON.parse((await call(c, "assistant_agent_create", { workspaceId: ws.workspaceId, title: "Sec", prompt: "go" })).result.content[0].text);
      expect(ag.agentId).toBe("a-new");
      expect(calls.agent[0].labels["paseo.created-by"]).toBe("assistant");
      expect(JSON.parse((await call(c, "assistant_agents_list", {})).result.content[0].text)).toHaveLength(1);
      expect((await call(ctx("agent", paseo), "assistant_agent_create", { workspaceId: "w", title: "t", prompt: "p" })).error.code).toBe(-32602);
    });

    it("say so when the Paseo API is not available yet", async () => {
      const out = await call(ctx("assistant", null), "assistant_projects_list", {});
      expect(out.result.isError).toBe(true);
      expect(out.result.content[0].text).toMatch(/not available yet/);
    });
  });
});
