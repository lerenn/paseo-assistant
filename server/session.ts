import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { OVERSEER_PROMPT } from "./prompt";

export const TITLE = "Overseer";
export const dataDir = path.join(homedir(), ".paseo", "plugin-data", "overseer");

export interface OverseerState {
  agentId: string;
  workspaceId: string;
}

/** The slice of the Paseo SDK the Overseer needs; the real `PaseoApi` satisfies it. */
export interface OverseerPaseo {
  workspaces: {
    create(options: {
      source: { kind: "directory"; path: string };
      title: string;
      background: boolean;
    }): Promise<{
      id: string;
      agents: {
        create(options: {
          cwd: string;
          title: string;
          config: { provider: string; systemPrompt: string };
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
    };
  };
}

export class StateFile {
  constructor(private readonly file = path.join(dataDir, "state.json")) {}

  read(): OverseerState | null {
    try {
      const value = JSON.parse(readFileSync(this.file, "utf8")) as Partial<OverseerState>;
      return typeof value.agentId === "string" && typeof value.workspaceId === "string"
        ? { agentId: value.agentId, workspaceId: value.workspaceId }
        : null;
    } catch {
      return null;
    }
  }

  write(state: OverseerState | null): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(state ?? {}), "utf8");
    renameSync(temp, this.file);
  }
}

/**
 * Owns the one Overseer conversation of this daemon: it lives in a background workspace, is
 * created when missing and recreated when archived. Calls are serialized, so concurrent panels
 * and hooks never create two.
 */
export class OverseerSession {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly state: StateFile,
    private readonly provider: () => string,
    private readonly workDir = path.join(dataDir, "workspace"),
  ) {}

  ensure(paseo: OverseerPaseo): Promise<OverseerState> {
    return this.serialize(() => this.ensureNow(paseo));
  }

  /** Archives the current conversation and starts a fresh one. */
  reset(paseo: OverseerPaseo): Promise<OverseerState> {
    return this.serialize(async () => {
      const current = this.state.read();
      if (current) await this.archive(paseo, current);
      this.state.write(null);
      return this.create(paseo);
    });
  }

  /** An archived Overseer is recreated at once, so the next panel open finds it ready. */
  async onAgentArchived(paseo: OverseerPaseo, agentId: string): Promise<void> {
    await this.serialize(async () => {
      if (this.state.read()?.agentId !== agentId) return;
      this.state.write(null);
      await this.create(paseo);
    });
  }

  private async ensureNow(paseo: OverseerPaseo): Promise<OverseerState> {
    const current = this.state.read();
    if (current && (await this.isAlive(paseo, current.agentId))) return current;
    return this.create(paseo);
  }

  private async isAlive(paseo: OverseerPaseo, agentId: string): Promise<boolean> {
    const handle = paseo.agents.ref(agentId);
    try {
      const snapshot = await handle.refresh();
      return snapshot !== null && handle.archivedAt === null;
    } catch {
      return false;
    }
  }

  private async archive(paseo: OverseerPaseo, state: OverseerState): Promise<void> {
    // Best effort: the old conversation may already be gone.
    await paseo.agents.ref(state.agentId).archive().catch(() => undefined);
    await paseo.workspaces.archive(state.workspaceId).catch(() => undefined);
  }

  private async create(paseo: OverseerPaseo): Promise<OverseerState> {
    mkdirSync(this.workDir, { recursive: true });
    const workspace = await paseo.workspaces.create({
      source: { kind: "directory", path: this.workDir },
      title: TITLE,
      background: true,
    });
    const agent = await workspace.agents.create({
      cwd: this.workDir,
      title: TITLE,
      config: { provider: this.provider(), systemPrompt: OVERSEER_PROMPT },
    });
    const created = { agentId: agent.id, workspaceId: workspace.id };
    this.state.write(created);
    return created;
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
