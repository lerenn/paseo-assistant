import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { decisionSchema, orderOptions, type Decision } from "../shared/decision";

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
    const open = this.decisions.filter((d) => !d.answer).sort((a, b) => a.askedAt - b.askedAt);
    const done = this.decisions.filter((d) => d.answer).sort((a, b) => b.answer!.at - a.answer!.at);
    return [...open, ...done];
  }

  openCount(): number {
    return this.decisions.filter((d) => !d.answer).length;
  }

  /** Records the answer once; a second answer to the same decision is refused. */
  answer(id: string, text: string, other: boolean): Decision {
    const decision = this.decisions.find((d) => d.id === id);
    if (!decision) throw new Error("Unknown decision");
    if (decision.answer) throw new Error("Decision already answered");
    if (!other && !decision.options.includes(text)) throw new Error("Not one of the options");
    decision.answer = { text, other, at: this.now() };
    this.save();
    return decision;
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
