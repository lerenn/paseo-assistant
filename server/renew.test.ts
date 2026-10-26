import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HandoverStore, RENEW_MIN_GAP_MS, handoverPrompt } from "./handover";
import { claudeProjectKey, memoryDir, memoryRules, ruleCovers } from "./memory";
import { ALLOWED_TOOLS, ASSISTANT_PROMPT, DISALLOWED_TOOLS, KICKOFF_PROMPT } from "./prompt";
import { AssistantSession, BYPASS_MODE, StateFile, type AssistantPaseo } from "./session";

describe("memory scope", () => {
  const home = "/home/paseo";
  const cwd = "/home/paseo/.paseo/plugin-data/overseer/workspace";

  it("derives the memory folder from the working directory the way Claude names project folders", () => {
    expect(claudeProjectKey(cwd)).toBe("-home-paseo--paseo-plugin-data-overseer-workspace");
    expect(memoryDir(cwd, home)).toBe("/home/paseo/.claude/projects/-home-paseo--paseo-plugin-data-overseer-workspace/memory");
  });

  it("allows Edit (which covers Write, NotebookEdit and MultiEdit) and Read only inside it, anchored at the root", () => {
    const { allow } = memoryRules(cwd, home);
    expect(allow).toEqual([
      "Edit(//home/paseo/.claude/projects/-home-paseo--paseo-plugin-data-overseer-workspace/memory/**)",
      "Read(//home/paseo/.claude/projects/-home-paseo--paseo-plugin-data-overseer-workspace/memory/**)",
    ]);
  });

  it("allows no write rule that reaches outside the folder, and denies the places that matter", () => {
    const { allow, deny } = memoryRules(cwd, home);
    for (const rule of allow) {
      expect(rule).toMatch(/\/memory\/\*\*\)$/);
      expect(rule).not.toMatch(/\.\./);
    }
    expect(allow.filter((r) => r.startsWith("Edit("))).toHaveLength(1);
    for (const path of ["Edit(./**)", "Edit(~/.paseo/**)", "Edit(~/src/**)", "Edit(~/.ssh/**)", "Edit(~/.claude/settings.json)"]) expect(deny).toContain(path);
    // A deny covering the memory folder would beat the allow: none may.
    expect(deny.some((r) => r.includes("/.claude/projects"))).toBe(false);
    expect(deny).not.toContain("Edit(~/.claude/**)");
  });

  it("never denies Write or Edit by bare name (that would remove the tools), keeps NotebookEdit and MultiEdit off, and allows no bare write tool", () => {
    for (const bare of ["Write", "Edit"]) {
      expect(DISALLOWED_TOOLS).not.toContain(bare);
      expect(ALLOWED_TOOLS).not.toContain(bare);
    }
    for (const off of ["NotebookEdit", "MultiEdit"]) expect(DISALLOWED_TOOLS).toContain(off);
    expect(ALLOWED_TOOLS.filter((t) => /^(Write|Edit|MultiEdit|NotebookEdit)\b/.test(t))).toEqual([]);
  });
});

class Fake {
  private n = 0;
  options: { allowedTools: string[]; disallowedTools: string[] }[] = [];
  modes: (string | undefined)[] = [];
  sent: { agent: string; text: string }[] = [];
  archived: string[] = [];
  paseo: AssistantPaseo = {
    workspaces: {
      create: async () => ({
        id: `ws-${++this.n}`,
        agents: {
          create: async (a: any) => {
            this.options.push(a.config.options);
            this.modes.push(a.config.modeId);
            return { id: `agent-${++this.n}` };
          },
        },
      }),
      archive: async () => ({}),
    },
    agents: {
      ref: (id: string) => ({
        refresh: async () => ({ agent: { status: "idle" } }),
        archivedAt: null,
        archive: async () => void this.archived.push(id),
        send: async (text: string) => void this.sent.push({ agent: id, text }),
      }),
    },
  };
}

describe("session options carry the memory scope", () => {
  let dir: string;
  beforeEach(() => void (dir = mkdtempSync(path.join(tmpdir(), "renew-"))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("adds the folder's Edit/Read allow rules and the denies to a Claude Assistant", async () => {
    const f = new Fake();
    const work = path.join(dir, "ws");
    const session = new AssistantSession(new StateFile(path.join(dir, "s.json")), () => "claude/x", work, async () => null, new HandoverStore(path.join(dir, "h.json")), "/home/paseo");
    await session.ensure(f.paseo);
    const rules = memoryRules(work, "/home/paseo");
    expect(f.options[0].allowedTools).toEqual(expect.arrayContaining(rules.allow));
    expect(f.options[0].disallowedTools).toEqual(expect.arrayContaining(rules.deny));
    // Writing anywhere else is not in the allow list.
    expect(f.options[0].allowedTools.filter((t) => t.startsWith("Edit("))).toEqual([rules.allow[0]]);
  });
});

describe("assistant_session_renew", () => {
  let dir: string;
  let f: Fake;
  let session: AssistantSession;
  let handovers: HandoverStore;
  let clock: number;
  beforeEach(() => {
    vi.useFakeTimers();
    dir = mkdtempSync(path.join(tmpdir(), "renew-"));
    f = new Fake();
    handovers = new HandoverStore(path.join(dir, "h.json"));
    session = new AssistantSession(new StateFile(path.join(dir, "s.json")), () => "claude/x", path.join(dir, "ws"), async () => null, handovers, "/home/paseo", 5_000);
    clock = 1_000_000;
  });
  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });
  const now = () => clock;

  it("saves the handover, starts the new agent with it as the first prompt, and archives the old one a moment later", async () => {
    const first = await session.ensure(f.paseo);
    const next = await session.renew(f.paseo, { handover: "Decisions d1, d2 open. Following Sec Coordinator (abc).", heartbeatId: "hb-1" }, now);
    expect(next.agentId).not.toBe(first.agentId);
    expect(session.currentAgentId()).toBe(next.agentId);
    const prompt = f.sent.filter((s) => s.agent === next.agentId)[0].text;
    expect(prompt).toMatch(/^\[Handover from your previous session/);
    expect(prompt).toContain("Decisions d1, d2 open");
    expect(prompt).toContain("hb-1");
    expect(prompt).toContain(KICKOFF_PROMPT);
    expect(handovers.read()).toMatchObject({ text: expect.stringContaining("d1, d2"), heartbeatId: "hb-1", fromAgentId: first.agentId, toAgentId: next.agentId });
    // The caller is the old agent: it is archived after a delay, so its tool reply gets out first.
    expect(f.archived).toEqual([]);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(f.archived).toContain(first.agentId);
    // Archiving the old one does not start yet another session.
    await session.onAgentArchived(f.paseo, first.agentId);
    expect(session.currentAgentId()).toBe(next.agentId);
  });

  it("tells the new session to delete the old heartbeat before making its own, so there are never two", () => {
    expect(handoverPrompt({ text: "notes", heartbeatId: "hb-9" }, "KICK")).toMatch(/delete it with delete_heartbeat first[\s\S]*create your own once/);
    expect(handoverPrompt({ text: "notes", heartbeatId: null }, "KICK")).toMatch(/left no heartbeat id: create yours once/);
  });

  it("allows at most one renew per 10 minutes", async () => {
    await session.ensure(f.paseo);
    await session.renew(f.paseo, { handover: "first handover text, long enough" }, now);
    clock += 60_000;
    await expect(session.renew(f.paseo, { handover: "second handover text, long enough" }, now)).rejects.toThrow(/wait 9 more min/);
    expect(f.options).toHaveLength(2);
    clock += RENEW_MIN_GAP_MS;
    await expect(session.renew(f.paseo, { handover: "third handover text, long enough" }, now)).resolves.toBeTruthy();
    expect(handovers.wait(clock)).toBeGreaterThan(0);
    expect(existsSync(path.join(dir, "h.json"))).toBe(true);
  });

  it("is in the tools and the prompt, with its limits", () => {
    expect(ALLOWED_TOOLS).toContain("mcp__assistant__assistant_session_renew");
    for (const text of ["assistant_session_renew", "after a plugin deploy", "context is very full", "when asked", "Never call it while you are in the middle of acting", "one renew is allowed per 10 minutes", "[Handover from your previous session"]) {
      expect(ASSISTANT_PROMPT, text).toContain(text);
    }
  });
});

describe("bypassPermissions default and the hardened deny list", () => {
  const home = "/home/paseo";
  const cwd = "/home/paseo/.paseo/plugin-data/overseer/workspace";
  const { allow, deny, dir } = memoryRules(cwd, home);
  const denied = (tool: "Edit" | "Read", p: string) => deny.some((r) => ruleCovers(r, tool, p, home, cwd));

  it("stops writes to credentials, config, shell start-up files and system folders, and leaves the memory folder writable", () => {
    for (const p of [
      "/home/paseo/.aws/credentials", "/home/paseo/.kube/config", "/home/paseo/.config/gh/hosts.yml", "/home/paseo/.ssh/id_rsa", "/home/paseo/.gitconfig",
      "/home/paseo/.bashrc", "/home/paseo/.profile", "/home/paseo/.zshrc", "/home/paseo/.bash_profile", "/home/paseo/.paseo/state.json", "/home/paseo/src/x/y.ts",
      "/etc/passwd", "/usr/bin/node", "/opt/tool", "/var/lib/x", "/root/.bashrc", `${cwd}/note.md`, "/home/paseo/.claude/settings.json", "/home/paseo/.claude/CLAUDE.md",
    ]) {
      expect(denied("Edit", p), `Edit ${p}`).toBe(true);
    }
    expect(denied("Edit", `${dir}/notes.md`)).toBe(false);
    expect(denied("Edit", `${dir}/MEMORY.md`)).toBe(false);
    expect(allow.some((r) => ruleCovers(r, "Edit", `${dir}/notes.md`, home, cwd))).toBe(true);
    expect(allow.some((r) => ruleCovers(r, "Edit", "/home/paseo/.aws/credentials", home, cwd))).toBe(false);
  });

  it("stops reading credentials and configuration, not the memory folder", () => {
    for (const p of ["/home/paseo/.aws/credentials", "/home/paseo/.kube/config", "/home/paseo/.ssh/id_rsa", "/home/paseo/.config/gh/hosts.yml", "/home/paseo/.gitconfig", "/root/x"]) {
      expect(denied("Read", p), `Read ${p}`).toBe(true);
    }
    expect(denied("Read", `${dir}/notes.md`)).toBe(false);
  });

  it("removes the shell: Bash is denied by bare name, and nothing re-allows it", () => {
    expect(DISALLOWED_TOOLS).toContain("Bash");
    expect(ALLOWED_TOOLS.some((t) => t === "Bash" || t.startsWith("Bash("))).toBe(false);
  });

  it("every deny is a rule form Claude reads (Edit or Read, with // ~/ ./ anchors) and none is a bare Write/Edit", () => {
    for (const r of deny) expect(r).toMatch(/^(Edit|Read)\((\/\/|~\/|\.\/)/);
    expect(deny).not.toContain("Write");
    expect(deny).not.toContain("Edit");
  });

  let dirTmp: string;
  beforeEach(() => void (dirTmp = mkdtempSync(path.join(tmpdir(), "bypass-"))));
  afterEach(() => rmSync(dirTmp, { recursive: true, force: true }));

  it("a new Claude session (ensure, and the renew tool) starts in bypassPermissions with the deny list", async () => {
    const f = new Fake();
    const session = new AssistantSession(new StateFile(path.join(dirTmp, "s.json")), () => "claude/x", path.join(dirTmp, "ws"), async () => null, new HandoverStore(path.join(dirTmp, "h.json")), "/home/paseo", 0);
    await session.ensure(f.paseo);
    await session.renew(f.paseo, { handover: "handover text that is long enough" }, () => 1_000_000);
    expect(f.modes).toEqual([BYPASS_MODE, BYPASS_MODE]);
    expect(BYPASS_MODE).toBe("bypassPermissions");
    for (const o of f.options) {
      expect(o.disallowedTools).toContain("Bash");
      expect(o.disallowedTools).toContain("mcp__paseo__create_agent");
      expect(o.disallowedTools).toEqual(expect.arrayContaining(memoryRules(path.join(dirTmp, "ws"), "/home/paseo").deny));
    }
  });

  it("a non-Claude provider gets no mode or tool lists of ours", async () => {
    const f = new Fake();
    const session = new AssistantSession(new StateFile(path.join(dirTmp, "s2.json")), () => "codex/y", path.join(dirTmp, "ws2"), async () => null, new HandoverStore(path.join(dirTmp, "h2.json")), "/home/paseo", 0);
    await session.ensure(f.paseo);
    expect(f.modes).toEqual([undefined]);
    expect(f.options).toEqual([undefined]);
  });
});
