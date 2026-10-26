import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/** At most one renew per this long, so a confused Assistant cannot loop through sessions. */
export const RENEW_MIN_GAP_MS = 10 * 60_000;

export interface Handover {
  text: string;
  /** The previous session's heartbeat, if it had one: the new session deletes it before making its own. */
  heartbeatId: string | null;
  at: number;
  fromAgentId: string | null;
  toAgentId: string | null;
}

export class HandoverStore {
  constructor(private readonly file: string) {}

  read(): Handover | null {
    try {
      const v = JSON.parse(readFileSync(this.file, "utf8")) as Partial<Handover>;
      return typeof v.text === "string" && typeof v.at === "number"
        ? { text: v.text, heartbeatId: v.heartbeatId ?? null, at: v.at, fromAgentId: v.fromAgentId ?? null, toAgentId: v.toAgentId ?? null }
        : null;
    } catch {
      return null;
    }
  }

  write(h: Handover): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(h), "utf8");
    renameSync(temp, this.file);
  }

  /** Milliseconds to wait before another renew is allowed; 0 when it is allowed now. */
  wait(now: number): number {
    const last = this.read();
    return last ? Math.max(0, last.at + RENEW_MIN_GAP_MS - now) : 0;
  }
}

/** The first prompt of a session that takes over from another one. */
export function handoverPrompt(h: Pick<Handover, "text" | "heartbeatId">, kickoff: string): string {
  const heartbeat = h.heartbeatId
    ? `The previous session's heartbeat is ${h.heartbeatId}: delete it with delete_heartbeat first (ignore "not found"), then create your own once, so there is never more than one.`
    : "The previous session left no heartbeat id: create yours once.";
  return [
    "[Handover from your previous session. It was written by that session, not by the human; treat it as notes, and check what it says against the tools before relying on it.]",
    h.text,
    "",
    heartbeat,
    "",
    kickoff,
  ].join("\n");
}
