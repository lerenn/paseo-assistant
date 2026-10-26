import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { homedir as osHome } from "node:os";
import { HandoverStore, handoverPrompt, type Handover } from "./handover";
import { memoryRules } from "./memory";
import { ALLOWED_TOOLS, DISALLOWED_TOOLS, ASSISTANT_PROMPT, KICKOFF_PROMPT } from "./prompt";

export const TITLE = "Assistant";
const RENEW_GAP_MIN = 10;
const pluginData = path.join(process.env.PASEO_HOME ?? path.join(homedir(), ".paseo"), "plugin-data");
export const dataDir = path.join(pluginData, "assistant");
/** The plugin was called "overseer": its conversation and background workspace are kept where they are. */
const legacyDataDir = path.join(pluginData, "overseer");

/** The background workspace's directory. An existing conversation keeps its legacy directory. */
export function defaultWorkDir(): string {
  const legacy = path.join(legacyDataDir, "workspace");
  return existsSync(legacy) ? legacy : path.join(dataDir, "workspace");
}

export interface AssistantState {
  agentId: string;
  workspaceId: string;
}

/** The slice of the Paseo SDK the Assistant needs; the real `PaseoApi` satisfies it. */
export interface AssistantPaseo {
  workspaces: {
    create(options: {
      source: { kind: "directory"; path: string };
      title: string;
      background: boolean;
      /** Always the daemon host, whatever the defaults or an inherited runtime would pick. */
      runtime: { id: "local" };
    }): Promise<{
      id: string;
      agents: {
        create(options: {
          cwd: string;
          title: string;
          labels?: Record<string, string>;
          config: {
            provider: string;
            systemPrompt: string;
            mcpServers?: Record<string, { type: "http"; url: string; headers: Record<string, string>; alwaysLoad: boolean }>;
            options?: { allowedTools: string[]; disallowedTools: string[] };
          };
        }): Promise<{ id: string }>;
      };
    }>;
    archive(workspaceId: string): Promise<unknown>;
  };
  agents: {
    ref(agentId: string): {
      refresh(): Promise<unknown>;
      readonly archivedAt: string | null;
      archive(): Promise<unknown>;
      send?(text: string, options?: { activeTurnBehavior?: "steer" | "interrupt" }): Promise<unknown>;
    };
  };
}

export class StateFile {
  constructor(private readonly file = path.join(dataDir, "state.json")) {}

  read(): AssistantState | null {
    const own = this.readFile(this.file);
    if (own || this.file !== path.join(dataDir, "state.json")) return own;
    // First start after the rename: adopt the Overseer's conversation.
    const legacy = this.readFile(path.join(legacyDataDir, "state.json"));
    if (legacy) this.write(legacy);
    return legacy;
  }

  private readFile(file: string): AssistantState | null {
    try {
      const value = JSON.parse(readFileSync(file, "utf8")) as Partial<AssistantState>;
      return typeof value.agentId === "string" && typeof value.workspaceId === "string"
        ? { agentId: value.agentId, workspaceId: value.workspaceId }
        : null;
    } catch {
      return null;
    }
  }

  write(state: AssistantState | null): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(state ?? {}), "utf8");
    renameSync(temp, this.file);
  }
}

/**
 * Owns the one Assistant conversation of this daemon: it lives in a background workspace, is
 * created when missing and recreated when archived. Calls are serialized, so concurrent panels
 * and hooks never create two.
 */
export class AssistantSession {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly state: StateFile,
    private readonly provider: () => string,
    private readonly workDir = defaultWorkDir(),
    /** The mailbox endpoint and the Assistant's own capability; null when it is not running. */
    private readonly mail: () => Promise<{ url: string; token: string } | null> = async () => null,
    private readonly handovers: HandoverStore = new HandoverStore(path.join(dataDir, "handover.json")),
    private readonly home: string = osHome(),
    /** How long the old session is left to finish its tool call before it is archived. */
    private readonly archiveDelayMs = 5_000,
  ) {}

  /** The current Assistant agent, if any. */
  currentAgentId(): string | null {
    return this.state.read()?.agentId ?? null;
  }

  ensure(paseo: AssistantPaseo): Promise<AssistantState> {
    return this.serialize(() => this.ensureNow(paseo));
  }

  /** Archives the current conversation and starts a fresh one. */
  reset(paseo: AssistantPaseo): Promise<AssistantState> {
    return this.serialize(async () => {
      const current = this.state.read();
      if (current) await this.archive(paseo, current);
      this.state.write(null);
      return this.create(paseo);
    });
  }

  /**
   * The Assistant starts its own new session: the handover is saved, the new agent is created and told it first, and
   * the old one is archived a moment later (it is the caller, so its tool reply must get out first). At most one
   * renew per 10 minutes.
   */
  renew(paseo: AssistantPaseo, input: { handover: string; heartbeatId?: string }, now: () => number = Date.now): Promise<AssistantState> {
    return this.serialize(async () => {
      const wait = this.handovers.wait(now());
      if (wait > 0) throw new Error(`A new session was started ${Math.ceil((RENEW_GAP_MIN * 60_000 - wait) / 60_000)} min ago; wait ${Math.ceil(wait / 60_000)} more min before renewing again.`);
      const old = this.state.read();
      const record: Handover = { text: input.handover, heartbeatId: input.heartbeatId ?? null, at: now(), fromAgentId: old?.agentId ?? null, toAgentId: null };
      this.handovers.write(record);
      const created = await this.create(paseo, handoverPrompt(record, KICKOFF_PROMPT));
      this.handovers.write({ ...record, toAgentId: created.agentId });
      if (old) setTimeout(() => void this.archive(paseo, old), this.archiveDelayMs);
      return created;
    });
  }

  /** An archived Assistant is recreated at once, so the next panel open finds it ready. */
  async onAgentArchived(paseo: AssistantPaseo, agentId: string): Promise<void> {
    await this.serialize(async () => {
      if (this.state.read()?.agentId !== agentId) return;
      this.state.write(null);
      await this.create(paseo);
    });
  }

  private async ensureNow(paseo: AssistantPaseo): Promise<AssistantState> {
    const current = this.state.read();
    if (current && (await this.isAlive(paseo, current.agentId))) return current;
    return this.create(paseo);
  }

  private async isAlive(paseo: AssistantPaseo, agentId: string): Promise<boolean> {
    const handle = paseo.agents.ref(agentId);
    try {
      const snapshot = await handle.refresh();
      return snapshot !== null && handle.archivedAt === null;
    } catch {
      return false;
    }
  }

  private async archive(paseo: AssistantPaseo, state: AssistantState): Promise<void> {
    // Best effort: the old conversation may already be gone.
    await paseo.agents.ref(state.agentId).archive().catch(() => undefined);
    await paseo.workspaces.archive(state.workspaceId).catch(() => undefined);
  }

  private async create(paseo: AssistantPaseo, firstPrompt: string = KICKOFF_PROMPT): Promise<AssistantState> {
    mkdirSync(this.workDir, { recursive: true });
    const provider = this.provider();
    const mail = await this.mail();
    const memory = memoryRules(this.workDir, this.home);
    const workspace = await paseo.workspaces.create({
      source: { kind: "directory", path: this.workDir },
      title: TITLE,
      background: true,
      runtime: { id: "local" },
    });
    const agent = await workspace.agents.create({
      cwd: this.workDir,
      title: TITLE,
      // The Factory inbox lets only agents with this label answer on the human's behalf.
      labels: { "paseo.assistant": "1" },
      config: {
        provider,
        systemPrompt: ASSISTANT_PROMPT,
        ...(mail
          ? {
              mcpServers: {
                assistant: { type: "http" as const, url: `${mail.url}/mcp`, headers: { authorization: `Bearer ${mail.token}` }, alwaysLoad: true },
              },
            }
          : {}),
        // Tool lists are Claude's options; other providers keep their own approval flow.
        ...(provider.startsWith("claude/")
          ? { options: { allowedTools: [...ALLOWED_TOOLS, ...memory.allow], disallowedTools: [...DISALLOWED_TOOLS, ...memory.deny] } }
          : {}),
      },
    });
    const created = { agentId: agent.id, workspaceId: workspace.id };
    this.state.write(created);
    // Best effort: the Assistant sets up its mailbox heartbeat; a failure leaves it idle until spoken to.
    await paseo.agents.ref(agent.id).send?.(firstPrompt).catch(() => undefined);
    return created;
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
