import { z } from "zod";

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;

export const decisionSchema = z.object({
  id: z.string(),
  question: z.string(),
  /** 2 to 4 options, the recommended one first. The UI adds "Other…" last. */
  options: z.array(z.string()).min(MIN_OPTIONS).max(MAX_OPTIONS),
  askedAt: z.number(),
  /** When the answer was passed on to the Assistant (answers given in the tab); null until then, and for ones closed in chat. */
  deliveredAt: z.number().nullable().default(null),
  /** Set when the user cancelled it (the × on its card); it then has no answer and is no longer open. */
  cancelledAt: z.number().nullable().default(null),
  answer: z
    .object({
      text: z.string(),
      other: z.boolean(),
      at: z.number(),
      /** Where it was answered: the Decisions tab, or in chat (closed by the Assistant). */
      source: z.enum(["tab", "chat"]).default("tab"),
    }).nullable(),
});
export type Decision = z.output<typeof decisionSchema>;

/** The recommended option first, the others in the order given. Throws when it is not one of them. */
export function orderOptions(options: readonly string[], recommended: string): string[] {
  const trimmed = options.map((o) => o.trim());
  const index = trimmed.indexOf(recommended.trim());
  if (index < 0) throw new Error(`recommended must be one of the options: ${trimmed.join(" | ")}`);
  return [trimmed[index], ...trimmed.filter((_, i) => i !== index)];
}

export const DECISION_STATUSES = ["pending", "answered", "delivered", "closed", "cancelled"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

/** pending: unanswered. cancelled: the user dropped it. answered: answered in the tab, not yet told to the Assistant. delivered: told. closed: answered in chat. */
export function decisionStatus(d: Decision): DecisionStatus {
  if (d.cancelledAt !== null) return "cancelled";
  if (!d.answer) return "pending";
  if (d.answer.source === "chat") return "closed";
  return d.deliveredAt !== null ? "delivered" : "answered";
}

/** Still waiting for the user: neither answered nor cancelled. */
export const isOpen = (d: Decision): boolean => !d.answer && d.cancelledAt === null;

export const SHORT_ID_LENGTH = 8;

/** The short id shown on a card: the first 8 characters of the id. */
export const shortId = (id: string): string => id.slice(0, SHORT_ID_LENGTH);

/**
 * Finds a decision by its full id or by a prefix of it (the short id on its card is the first 8 characters).
 * Throws on no match, and on a prefix that fits several decisions.
 */
export function findDecision<T extends { id: string }>(decisions: readonly T[], ref: string): T {
  const wanted = ref.trim().toLowerCase();
  if (wanted.length < 4) throw new Error(`"${ref}" is too short for a decision id; use the 8 character id on its card or the full id`);
  const exact = decisions.find((d) => d.id.toLowerCase() === wanted);
  if (exact) return exact;
  const hits = decisions.filter((d) => d.id.toLowerCase().startsWith(wanted));
  if (hits.length === 0) throw new Error("Unknown decision");
  if (hits.length > 1) throw new Error(`"${ref}" matches ${hits.length} decisions (${hits.map((d) => shortId(d.id)).join(", ")}); use more characters`);
  return hits[0];
}
