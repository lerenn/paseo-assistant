import { z } from "zod";

export const MAIL_KINDS = ["start", "blocked", "needs_user", "pr", "done"] as const;
export type MailKind = (typeof MAIL_KINDS)[number];

/** `needs_louis` is the former name of `needs_user`: still accepted on input and in stored mails, mapped to `needs_user`. */
export const mailKindSchema = z
  .enum([...MAIL_KINDS, "needs_louis"])
  .transform((kind): MailKind => (kind === "needs_louis" ? "needs_user" : kind));

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
