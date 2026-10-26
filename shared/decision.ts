import { z } from "zod";

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;

export const decisionSchema = z.object({
  id: z.string(),
  question: z.string(),
  /** 2 to 4 options, the recommended one first. The UI adds "Other…" last. */
  options: z.array(z.string()).min(MIN_OPTIONS).max(MAX_OPTIONS),
  askedAt: z.number(),
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
