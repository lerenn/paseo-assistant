import { z } from "zod";

export const MAIL_KINDS = ["start", "blocked", "needs_louis", "pr", "done"] as const;
export type MailKind = (typeof MAIL_KINDS)[number];

export const mailSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  subject: z.string(),
  body: z.string(),
  kind: z.enum(MAIL_KINDS),
  at: z.number(),
  read: z.boolean(),
});
export type Mail = z.output<typeof mailSchema>;
