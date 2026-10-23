import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OVERSEER_PROMPT } from "./prompt";
import { OverseerSession, StateFile, type OverseerPaseo } from "./session";

class FakePaseo {
  agents = new Map<string, { archivedAt: string | null }>();
  workspaces = new Map<string, { archived: boolean }>();
  created: { provider: string; systemPrompt: string; tools: string[]; background: boolean; title: string }[] = [];
  private next = 0;

  workspacesApi = this.buildWorkspaces();

  private buildWorkspaces() {
    return {
      create: async (options: { source: { path: string }; title: string; background: boolean }) => {
        const id = `ws-${++this.next}`;
        this.workspaces.set(id, { archived: false });
        return {
          id,
          agents: {
            create: async (agent: { title: string; config: { provider: string; systemPrompt: string; toolPolicy: { preapproved: { tool: string }[] } } }) => {
              const agentId = `agent-${++this.next}`;
              this.agents.set(agentId, { archivedAt: null });
              this.created.push({ provider: agent.config.provider, systemPrompt: agent.config.systemPrompt, tools: agent.config.toolPolicy.preapproved.map((t) => t.tool), background: options.background, title: agent.title });
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

function adapt(fake: FakePaseo): OverseerPaseo {
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

describe("OverseerSession", () => {
  let dir: string;
  let fake: FakePaseo;
  let paseo: OverseerPaseo;
  let session: OverseerSession;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "overseer-"));
    fake = new FakePaseo();
    paseo = adapt(fake);
    session = new OverseerSession(new StateFile(path.join(dir, "state.json")), () => "claude/test", path.join(dir, "ws"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("creates one hidden conversation with the prompt and the configured provider", async () => {
    const state = await session.ensure(paseo);
    expect(state).toEqual({ agentId: "agent-2", workspaceId: "ws-1" });
    expect(fake.created).toEqual([
      {
        provider: "claude/test",
        systemPrompt: OVERSEER_PROMPT,
        tools: expect.arrayContaining(["list_agents", "get_agent_status", "list_pending_permissions"]),
        background: true,
        title: "Overseer",
      },
    ]);
  });

  it("never creates two under concurrent calls", async () => {
    const results = await Promise.all([session.ensure(paseo), session.ensure(paseo), session.ensure(paseo)]);
    expect(new Set(results.map((r) => r.agentId)).size).toBe(1);
    expect(fake.created).toHaveLength(1);
  });

  it("keeps the conversation across instances through the state file", async () => {
    const first = await session.ensure(paseo);
    const again = new OverseerSession(new StateFile(path.join(dir, "state.json")), () => "x", path.join(dir, "ws"));
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

describe("OVERSEER_PROMPT", () => {
  it("stays read-only and degrades without the optional tools", () => {
    expect(OVERSEER_PROMPT).toContain("read-only");
    expect(OVERSEER_PROMPT).toContain("inbox_ask");
    expect(OVERSEER_PROMPT).toContain("exist only if their plugins are installed");
  });
});
