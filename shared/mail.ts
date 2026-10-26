import { z } from "zod";

export const MAIL_KINDS = ["start", "blocked", "pr", "done"] as const;
export type MailKind = (typeof MAIL_KINDS)[number];

/**
 * `needs_louis` and `needs_user` are former kinds: still accepted on input and in stored mails (so they display
 * correctly), and treated as `blocked`.
 */
export const mailKindSchema = z
  .enum([...MAIL_KINDS, "needs_louis", "needs_user"])
  .transform((kind): MailKind => (kind === "needs_louis" || kind === "needs_user" ? "blocked" : kind));

export const mailSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  subject: z.string(),
  body: z.string(),
  kind: mailKindSchema,
  at: z.number(),
  read: z.boolean(),
});
export type Mail = z.output<typeof mailSchema>;
