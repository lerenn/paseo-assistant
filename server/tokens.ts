import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";

/** Set in the environment of agents that still hold a capability for the old `assistant_mail` tool. */
export const CAPABILITY_ENV = "PASEO_ASSISTANT_CAPABILITY";

export type Role = "agent" | "assistant";

export interface Capability {
  role: Role;
  /** Bound when the agent's session opens; unset for the Assistant. */
  agentId?: string;
  /** The agent's title at creation, when it had one. */
  name?: string;
}

/** Per-agent capability tokens, persisted so agents resumed after a daemon restart keep working. */
export class CapabilityStore {
  private tokens: Record<string, Capability>;

  constructor(private readonly file: string) {
    this.tokens = this.load();
  }

  private load(): Record<string, Capability> {
    try {
      return JSON.parse(readFileSync(this.file, "utf8"));
    } catch {
      return {};
    }
  }

  private save(): void {
    mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(this.tokens), { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, this.file);
  }

  create(capability: Capability): string {
    const token = randomBytes(24).toString("base64url");
    this.tokens[token] = capability;
    this.save();
    return token;
  }

  /** Binds the agent id once the session opens. */
  bind(token: string, agentId: string): void {
    const found = this.tokens[token];
    if (found && found.agentId !== agentId) {
      found.agentId = agentId;
      this.save();
    }
  }

  /** Drops the capability of an archived agent. */
  revokeAgent(agentId: string): void {
    for (const [token, c] of Object.entries(this.tokens)) if (c.role === "agent" && c.agentId === agentId) delete this.tokens[token];
    this.save();
  }

  /** The Assistant's token for the one it was created with, or null. */
  assistantToken(): string | null {
    return Object.entries(this.tokens).find(([, c]) => c.role === "assistant")?.[0] ?? null;
  }

  resolve(token: string | undefined): Capability | null {
    if (!token) return null;
    const candidate = Buffer.from(token);
    let found: Capability | null = null;
    for (const [known, capability] of Object.entries(this.tokens)) {
      const k = Buffer.from(known);
      if (k.length === candidate.length && timingSafeEqual(k, candidate)) found = capability;
    }
    return found;
  }
}
