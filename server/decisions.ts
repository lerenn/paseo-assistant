import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { decisionSchema, isOpen, orderOptions, type Decision } from "../shared/decision";

const MAX_DECISIONS = 500;

/** Decisions the Assistant queued for the human: a JSON file in the plugin data directory. */
export class DecisionStore {
  private decisions: Decision[];

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
  ) {
    this.decisions = this.load();
  }

  private load(): Decision[] {
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8"));
      return Array.isArray(raw) ? raw.flatMap((d) => (decisionSchema.safeParse(d).success ? [decisionSchema.parse(d)] : [])) : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(this.decisions), "utf8");
    renameSync(temp, this.file);
  }

  add(input: { question: string; options: string[]; recommended: string }): Decision {
    const decision: Decision = {
      id: randomUUID(),
      question: input.question.trim(),
      options: orderOptions(input.options, input.recommended),
      askedAt: this.now(),
      deliveredAt: null,
      cancelledAt: null,
      answer: null,
    };
    if (new Set(decision.options).size !== decision.options.length) throw new Error("options must be distinct");
    this.decisions.push(decision);
    if (this.decisions.length > MAX_DECISIONS) this.decisions = this.decisions.slice(-MAX_DECISIONS);
    this.save();
    return decision;
  }

  /** Open decisions first (oldest first), then answered ones (newest first). */
  list(): Decision[] {
    const open = this.decisions.filter(isOpen).sort((a, b) => a.askedAt - b.askedAt);
    const doneAt = (d: Decision) => d.answer?.at ?? d.cancelledAt ?? 0;
    const done = this.decisions.filter((d) => !isOpen(d)).sort((a, b) => doneAt(b) - doneAt(a));
    return [...open, ...done];
  }

  /** Records that these answers reached the Assistant. */
  markDelivered(ids: readonly string[]): void {
    const at = this.now();
    let changed = false;
    for (const d of this.decisions) {
      if (ids.includes(d.id) && (d.answer || d.cancelledAt !== null) && d.deliveredAt === null) {
        d.deliveredAt = at;
        changed = true;
      }
    }
    if (changed) this.save();
  }

  openCount(): number {
    return this.decisions.filter(isOpen).length;
  }

  /** The user dropped it: it is no longer open and the Assistant is told. Refused once answered or already cancelled. */
  cancel(id: string): Decision {
    const decision = this.decisions.find((d) => d.id === id);
    if (!decision) throw new Error("Unknown decision");
    if (decision.answer) throw new Error("Decision already answered");
    if (decision.cancelledAt !== null) throw new Error("Decision already cancelled");
    decision.cancelledAt = this.now();
    this.save();
    return decision;
  }

  /** Records the answer once; a second answer to the same decision is refused. */
  answer(id: string, text: string, other: boolean, source: "tab" | "chat" = "tab"): Decision {
    const decision = this.decisions.find((d) => d.id === id);
    if (!decision) throw new Error("Unknown decision");
    if (decision.answer) throw new Error("Decision already answered");
    if (decision.cancelledAt !== null) throw new Error("Decision was cancelled");
    if (!other && !decision.options.includes(text)) throw new Error("Not one of the options");
    decision.answer = { text, other, at: this.now(), source };
    this.save();
    return decision;
  }

  /** Records an answer the human gave in chat; one outside the options is kept as free text. */
  close(id: string, text: string): Decision {
    const decision = this.decisions.find((d) => d.id === id);
    if (!decision) throw new Error("Unknown decision");
    return this.answer(id, text, !decision.options.includes(text), "chat");
  }
}

/** What the Assistant is told when the human answers: the id, the question and the answer. */
export function decisionNudge(decision: Decision): string {
  const a = decision.answer!;
  return [
    `Decision answered by the human (id ${decision.id}).`,
    `Question: ${decision.question}`,
    `Answer: ${a.text}${a.other ? " (free text)" : ""}`,
    "Act on it, and tell the agent concerned if it is waiting.",
  ].join("\n");
}

/** What the Assistant is told when the user cancels: the id and the question, so it can tell anyone waiting not to wait. */
export function cancelNudge(decision: Decision): string {
  return [`Decision cancelled by the user (id ${decision.id}): ${decision.question}`, "Do not wait for an answer; tell any agent that is waiting on it not to wait."].join("\n");
}
