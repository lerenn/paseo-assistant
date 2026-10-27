import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface NudgeLimits {
  /** An agent must have been silent this long (ms). */
  idleMs: number;
  /** Window of the per-agent limit (ms). */
  windowMs: number;
  /** Nudges allowed per agent per window. */
  maxPerWindow: number;
  /** After this many nudges without progress the human is asked instead. */
  escalateAfter: number;
}

export const DEFAULT_NUDGE_LIMITS: NudgeLimits = { idleMs: 30 * 60_000, windowMs: 60 * 60_000, maxPerWindow: 1, escalateAfter: 2 };

interface Entry {
  /** When the agent was nudged (epoch ms), newest last. */
  nudges: number[];
  /** Nudges since the agent last showed progress. */
  unanswered: number;
  escalatedAt: number | null;
}

/** Per-agent nudge history, a JSON file in the plugin data directory. */
export class NudgeLedger {
  private data: Record<string, Entry>;

  constructor(private readonly file: string) {
    this.data = this.load();
  }

  private load(): Record<string, Entry> {
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8"));
      return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    } catch {
      return {};
    }
  }

  get(agentId: string): Entry {
    return this.data[agentId] ?? { nudges: [], unanswered: 0, escalatedAt: null };
  }

  set(agentId: string, entry: Entry): void {
    this.data[agentId] = { ...entry, nudges: entry.nudges.slice(-20) };
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(this.data), "utf8");
    renameSync(temp, this.file);
  }
}

/** What the guard needs to know about an agent; `lastActivityAt` is epoch ms, or null when unknown. */
export interface AgentInfo {
  id: string;
  title: string | null;
  status: string | null;
  labels: Record<string, string>;
  parentAgentId: string | null;
  lastActivityAt: number | null;
}

export interface NudgeVerdict {
  allowed: boolean;
  why: string;
  /** Set when the agent is a coordinator's subagent: ask this agent instead. */
  askInstead?: { agentId: string; title: string | null };
  /** True when the human was asked (a decision was queued) instead of nudging again. */
  escalated?: boolean;
  /** What is left of this agent's budget. */
  budget: { nudgesInWindow: number; remainingInWindow: number; unanswered: number; escalateAfter: number; nextNudgeAt: number | null };
}

export interface NudgeDeps {
  /** Live agents (not archived). */
  agents(): Promise<AgentInfo[]>;
  ledger: NudgeLedger;
  /** True when the human has an open decision or inbox item about this agent. */
  pendingDecision(agent: AgentInfo): boolean;
  /** Queues a decision for the human about an agent that stays silent after the nudges. */
  escalate(agent: AgentInfo, nudges: number): void;
  limits?: () => NudgeLimits;
  now?: () => number;
}

const ACTIVE = new Set(["running", "initializing"]);
export const PARENT_LABEL = "paseo.parent-agent-id";

/** Whether the Assistant may nudge this agent now. When it may, the nudge is recorded: call it right before nudging. */
export async function nudgeCheck(agentId: string, input: { pendingInbox?: boolean }, deps: NudgeDeps): Promise<NudgeVerdict> {
  const now = (deps.now ?? Date.now)();
  const limits = deps.limits?.() ?? DEFAULT_NUDGE_LIMITS;
  const agents = await deps.agents();
  const agent = agents.find((a) => a.id === agentId);
  const entry = deps.ledger.get(agentId);
  const inWindow = (e: Entry) => e.nudges.filter((t) => now - t < limits.windowMs);
  const budgetOf = (e: Entry): NudgeVerdict["budget"] => {
    const recent = inWindow(e);
    return {
      nudgesInWindow: recent.length,
      remainingInWindow: Math.max(0, limits.maxPerWindow - recent.length),
      unanswered: e.unanswered,
      escalateAfter: limits.escalateAfter,
      nextNudgeAt: recent.length >= limits.maxPerWindow ? recent[0] + limits.windowMs : null,
    };
  };
  const no = (why: string, extra: Partial<NudgeVerdict> = {}, e: Entry = entry): NudgeVerdict => ({ allowed: false, why, budget: budgetOf(e), ...extra });

  if (!agent) return no("No live agent with this id.");

  const parentId = agent.labels[PARENT_LABEL] || agent.parentAgentId;
  const parent = parentId ? agents.find((a) => a.id === parentId) : undefined;
  if (parent) return no(`Subagent of the coordinator ${parent.title ?? parent.id}: ask that coordinator instead of nudging it.`, { askInstead: { agentId: parent.id, title: parent.title } });

  if (agent.status && ACTIVE.has(agent.status)) return no(`The agent is in the middle of a turn (${agent.status}).`);
  if (input.pendingInbox || deps.pendingDecision(agent)) return no("A human decision (inbox item) about this agent is pending.");

  const silentMs = agent.lastActivityAt === null ? null : now - agent.lastActivityAt;
  if (silentMs !== null && silentMs < limits.idleMs) return no(`The agent was active ${Math.round(silentMs / 60_000)} min ago; nudge only after ${Math.round(limits.idleMs / 60_000)} min of silence.`);

  // Progress since the last nudge ends the streak of unanswered nudges.
  let current = entry;
  const last = entry.nudges.at(-1);
  if (last !== undefined && agent.lastActivityAt !== null && agent.lastActivityAt > last && entry.unanswered > 0) {
    current = { ...entry, unanswered: 0, escalatedAt: null };
    deps.ledger.set(agentId, current);
  }

  if (current.unanswered >= limits.escalateAfter) {
    if (current.escalatedAt === null) {
      deps.escalate(agent, current.unanswered);
      current = { ...current, escalatedAt: now };
      deps.ledger.set(agentId, current);
      return no(`${current.unanswered} nudges without progress: a decision was queued for the human. Do not nudge again.`, { escalated: true }, current);
    }
    return no(`${current.unanswered} nudges without progress and the human was already asked. Do not nudge again.`, {}, current);
  }

  const recent = inWindow(current);
  if (recent.length >= limits.maxPerWindow) {
    const next = new Date(recent[0] + limits.windowMs).toISOString();
    return no(`Already nudged ${recent.length} time(s) in the last ${Math.round(limits.windowMs / 60_000)} min; next allowed at ${next}.`, {}, current);
  }

  const updated: Entry = { ...current, nudges: [...current.nudges, now], unanswered: current.unanswered + 1 };
  deps.ledger.set(agentId, updated);
  return { allowed: true, why: "Allowed; this nudge is now recorded.", budget: budgetOf(updated) };
}

/** Parses the agents of `paseo.agents.list` into what the guard needs. */
export function agentInfos(entries: unknown[]): AgentInfo[] {
  const time = (v: unknown): number | null => {
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const t = Date.parse(v);
      return Number.isNaN(t) ? null : t;
    }
    return null;
  };
  return entries.flatMap((e) => {
    const a = (e as { agent?: Record<string, unknown> }).agent;
    if (!a || typeof a.id !== "string") return [];
    return [
      {
        id: a.id,
        title: typeof a.title === "string" && a.title ? a.title : null,
        status: typeof a.status === "string" ? a.status : null,
        labels: (a.labels as Record<string, string> | undefined) ?? {},
        parentAgentId: typeof a.parentAgentId === "string" && a.parentAgentId ? a.parentAgentId : null,
        lastActivityAt: time(a.lastActivityAt) ?? time(a.updatedAt),
      },
    ];
  });
}
