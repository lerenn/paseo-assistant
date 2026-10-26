import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALLOWED_TOOLS, ASSISTANT_PROMPT, DISALLOWED_TOOLS } from "./prompt";
import { AssistantSession, StateFile, type AssistantPaseo } from "./session";

class FakePaseo {
  agents = new Map<string, { archivedAt: string | null }>();
  workspaces = new Map<string, { archived: boolean }>();
  created: { labels?: Record<string, string>; provider: string; systemPrompt: string; tools: string[]; background: boolean; title: string }[] = [];
  runtimes: unknown[] = [];
  private next = 0;

  workspacesApi = this.buildWorkspaces();

  private buildWorkspaces() {
    return {
      create: async (options: { source: { path: string }; title: string; background: boolean; runtime: { id: string } }) => {
        this.runtimes.push(options.runtime);
        const id = `ws-${++this.next}`;
        this.workspaces.set(id, { archived: false });
        return {
          id,
          agents: {
            create: async (agent: { title: string; labels?: Record<string, string>; config: { provider: string; systemPrompt: string; options?: { allowedTools: string[] } } }) => {
              const agentId = `agent-${++this.next}`;
              this.agents.set(agentId, { archivedAt: null });
              this.created.push({ labels: agent.labels, provider: agent.config.provider, systemPrompt: agent.config.systemPrompt, tools: agent.config.options?.allowedTools ?? [], background: options.background, title: agent.title });
              return { id: agentId };
            },
          },
        };
      },
      archive: async (id: string) => {
        this.workspaces.get(id)!.archived = true;
      },
    };
  }
}

function adapt(fake: FakePaseo): AssistantPaseo {
  return {
    workspaces: fake.workspacesApi,
    agents: {
      ref: (id) => {
        const record = fake.agents.get(id);
        return {
          get archivedAt() {
            return record?.archivedAt ?? null;
          },
          refresh: async () => {
            if (!record) throw new Error("not found");
            return {};
          },
          archive: async () => {
            if (record) record.archivedAt = "now";
          },
        };
      },
    },
  };
}

describe("AssistantSession", () => {
  let dir: string;
  let fake: FakePaseo;
  let paseo: AssistantPaseo;
  let session: AssistantSession;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "assistant-"));
    fake = new FakePaseo();
    paseo = adapt(fake);
    session = new AssistantSession(new StateFile(path.join(dir, "state.json")), () => "claude/test", path.join(dir, "ws"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("creates one hidden conversation with the prompt and the configured provider", async () => {
    const state = await session.ensure(paseo);
    expect(state).toEqual({ agentId: "agent-2", workspaceId: "ws-1" });
    expect(fake.created).toEqual([
      {
        labels: { "paseo.assistant": "1" },
        provider: "claude/test",
        systemPrompt: ASSISTANT_PROMPT,
        tools: expect.arrayContaining(["mcp__paseo__list_agents", "mcp__paseo__list_pending_permissions"]),
        background: true,
        title: "Assistant",
      },
    ]);
  });

  it("always asks for the local runtime, so it runs on the daemon whatever the defaults", async () => {
    await session.ensure(paseo);
    expect(fake.runtimes).toEqual([{ id: "local" }]);
  });

  it("leaves other providers to their own approval flow", async () => {
    const other = new AssistantSession(new StateFile(path.join(dir, "other.json")), () => "codex/x", path.join(dir, "ws"));
    await other.ensure(paseo);
    expect(fake.created[0]?.tools).toEqual([]);
  });

  it("gives the Assistant the mailbox endpoint with its own capability and kicks off the heartbeat", async () => {
    const sent: string[] = [];
    const mcp: unknown[] = [];
    const withMail = new AssistantSession(new StateFile(path.join(dir, "mail.json")), () => "claude/test", path.join(dir, "ws"), async () => ({ url: "http://127.0.0.1:9", token: "tok" }));
    const inner = paseo.workspaces.create;
    const spied: AssistantPaseo = {
      agents: { ref: (id) => ({ ...paseo.agents.ref(id), send: async (text: string) => void sent.push(text) }) },
      workspaces: {
        archive: paseo.workspaces.archive,
        create: async (options) => {
          const ws = await inner(options);
          return { id: ws.id, agents: { create: (agent) => (mcp.push(agent.config.mcpServers), ws.agents.create(agent)) } };
        },
      },
    };
    await withMail.ensure(spied);
    expect(mcp).toEqual([{ assistant: { type: "http", url: "http://127.0.0.1:9/mcp", headers: { authorization: "Bearer tok" }, alwaysLoad: true } }]);
    expect(sent).toHaveLength(1);
    expect(ASSISTANT_PROMPT).toContain("mail_list");
    expect(ALLOWED_TOOLS).toContain("mcp__agents-mail__mail_list");
    expect(ALLOWED_TOOLS).toContain("mcp__assistant__assistant_item_add");
    expect(ASSISTANT_PROMPT).toContain("Open items");
    expect(ALLOWED_TOOLS).toContain("mcp__assistant__assistant_mailbox");
    expect(ALLOWED_TOOLS).toContain("mcp__assistant__assistant_decision_add");
    expect(ASSISTANT_PROMPT).toContain("assistant_decision_add");
    expect(ALLOWED_TOOLS).toContain("mcp__paseo__create_heartbeat");
    expect(DISALLOWED_TOOLS).not.toContain("mcp__paseo__create_heartbeat");
  });

  it("never creates two under concurrent calls", async () => {
    const results = await Promise.all([session.ensure(paseo), session.ensure(paseo), session.ensure(paseo)]);
    expect(new Set(results.map((r) => r.agentId)).size).toBe(1);
    expect(fake.created).toHaveLength(1);
  });

  it("keeps the conversation across instances through the state file", async () => {
    const first = await session.ensure(paseo);
    const again = new AssistantSession(new StateFile(path.join(dir, "state.json")), () => "x", path.join(dir, "ws"));
    expect(await again.ensure(paseo)).toEqual(first);
    expect(fake.created).toHaveLength(1);
  });

  it("recreates it when archived or unknown", async () => {
    const first = await session.ensure(paseo);
    fake.agents.get(first.agentId)!.archivedAt = "yesterday";
    const second = await session.ensure(paseo);
    expect(second.agentId).not.toBe(first.agentId);
    fake.agents.delete(second.agentId);
    expect((await session.ensure(paseo)).agentId).not.toBe(second.agentId);
  });

  it("recreates it as soon as its agent is archived, and ignores other agents", async () => {
    const first = await session.ensure(paseo);
    await session.onAgentArchived(paseo, "someone-else");
    expect(fake.created).toHaveLength(1);
    fake.agents.get(first.agentId)!.archivedAt = "now";
    await session.onAgentArchived(paseo, first.agentId);
    expect(fake.created).toHaveLength(2);
  });

  it("reset archives the old conversation and starts a fresh one", async () => {
    const first = await session.ensure(paseo);
    const second = await session.reset(paseo);
    expect(second.agentId).not.toBe(first.agentId);
    expect(fake.agents.get(first.agentId)!.archivedAt).not.toBeNull();
    expect(fake.workspaces.get(first.workspaceId)!.archived).toBe(true);
    expect(await session.ensure(paseo)).toEqual(second);
  });
});

describe("ASSISTANT_PROMPT", () => {
  it("stays read-only and degrades without the optional tools", () => {
    expect(ASSISTANT_PROMPT).toContain("send_agent_prompt");
    expect(ASSISTANT_PROMPT).toContain("on the human's behalf");
    expect(ASSISTANT_PROMPT).toContain("Nothing beyond messaging");
    expect(ASSISTANT_PROMPT).toContain("inbox_ask");
    expect(ASSISTANT_PROMPT).toContain("exist only if their plugins are installed");
  });
});

describe("inbox answers", () => {
  it("labels the Assistant for the Factory inbox and allows its inbox tools", async () => {
    const fake = new FakePaseo();
    const state = new StateFile(path.join(mkdtempSync(path.join(tmpdir(), "assistant-")), "state.json"));
    await new AssistantSession(state, () => "claude/sonnet").ensure(adapt(fake));
    expect(fake.created[0].labels).toEqual({ "paseo.assistant": "1" });
    expect(ALLOWED_TOOLS).toContain("mcp__factory__inbox_pending");
    expect(ALLOWED_TOOLS).toContain("mcp__factory__inbox_answer");
    expect(ASSISTANT_PROMPT).toContain("only when the human explicitly tells you");
  });
});

describe("tools", () => {
  it("lets the Assistant message agents and nothing that changes them", () => {
    expect(ALLOWED_TOOLS).toContain("mcp__paseo__send_agent_prompt");
    for (const mutating of [
      "create_agent",
      "archive_agent",
      "kill_agent",
      "cancel_agent",
      "update_agent",
      "set_agent_mode",
      "respond_to_permission",
    ]) {
      expect(DISALLOWED_TOOLS).toContain(`mcp__paseo__${mutating}`);
      expect(ALLOWED_TOOLS).not.toContain(`mcp__paseo__${mutating}`);
    }
  });
});

describe("after the rename from Overseer", () => {
  const originalHome = process.env.PASEO_HOME;
  afterEach(() => {
    if (originalHome === undefined) delete process.env.PASEO_HOME;
    else process.env.PASEO_HOME = originalHome;
    vi.resetModules();
  });

  it("adopts the Overseer's conversation and keeps its workspace directory", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "assistant-home-"));
    try {
      const legacy = path.join(home, "plugin-data", "overseer");
      mkdirSync(path.join(legacy, "workspace"), { recursive: true });
      writeFileSync(path.join(legacy, "state.json"), JSON.stringify({ agentId: "agent-9", workspaceId: "ws-9" }));
      process.env.PASEO_HOME = home;
      vi.resetModules();
      const fresh = await import("./session");
      expect(fresh.defaultWorkDir()).toBe(path.join(legacy, "workspace"));
      expect(new fresh.StateFile().read()).toEqual({ agentId: "agent-9", workspaceId: "ws-9" });
      const adopted = path.join(home, "plugin-data", "assistant", "state.json");
      expect(existsSync(adopted)).toBe(true);
      expect(JSON.parse(readFileSync(adopted, "utf8"))).toEqual({ agentId: "agent-9", workspaceId: "ws-9" });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("uses its own directory on a fresh install", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "assistant-home-"));
    try {
      process.env.PASEO_HOME = home;
      vi.resetModules();
      const fresh = await import("./session");
      expect(fresh.defaultWorkDir()).toBe(path.join(home, "plugin-data", "assistant", "workspace"));
      expect(new fresh.StateFile().read()).toBeNull();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
