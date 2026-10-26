import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface ShimUsage {
  uses: number;
  lastAt: number | null;
  byTool: Record<string, number>;
}

/** A tiny counter of calls to the forwarding mail tools, kept on disk so a restart does not forget it. */
export class ShimUsageStore {
  private usage: ShimUsage;

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
  ) {
    this.usage = this.load();
  }

  private load(): ShimUsage {
    try {
      const v = JSON.parse(readFileSync(this.file, "utf8")) as Partial<ShimUsage>;
      return { uses: Number(v.uses) || 0, lastAt: typeof v.lastAt === "number" ? v.lastAt : null, byTool: v.byTool ?? {} };
    } catch {
      return { uses: 0, lastAt: null, byTool: {} };
    }
  }

  record(tool: string): void {
    this.usage = { uses: this.usage.uses + 1, lastAt: this.now(), byTool: { ...this.usage.byTool, [tool]: (this.usage.byTool[tool] ?? 0) + 1 } };
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(this.usage), "utf8");
    renameSync(temp, this.file);
  }

  read(): ShimUsage {
    return this.usage;
  }
}

export interface ShimReport {
  /** Live agents whose MCP config still has the old `assistant_mail` tool. */
  liveHolders: string[];
  /** Capabilities of any agent, live or not (archived agents' are revoked, so these should be live ones). */
  capabilities: number;
  uses: number;
  lastUsedAt: number | null;
  /** True when no live agent holds the tool, so the forwarders can be removed. */
  removable: boolean;
}

/** Which live agents still hold the old tool, from the capability store's bound agent ids and the live agent ids. */
export function shimReport(boundAgentIds: readonly string[], liveAgentIds: readonly string[], usage: ShimUsage): ShimReport {
  const live = new Set(liveAgentIds);
  const liveHolders = [...new Set(boundAgentIds.filter((id) => live.has(id)))];
  return { liveHolders, capabilities: boundAgentIds.length, uses: usage.uses, lastUsedAt: usage.lastAt, removable: liveHolders.length === 0 };
}

export const describeReport = (r: ShimReport): string =>
  r.removable
    ? `no live agent holds the old assistant_mail tool (${r.uses} forwarded calls so far): the forwarders can be removed`
    : `${r.liveHolders.length} live agent(s) still hold the old assistant_mail tool (${r.liveHolders.join(", ")}); ${r.uses} forwarded calls so far, last ${r.lastUsedAt ? new Date(r.lastUsedAt).toISOString() : "never"}`;
