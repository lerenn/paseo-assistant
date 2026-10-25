import { z } from "zod";
import { MAIL_KINDS, type Mail } from "../shared/mail";
import type { MailStore } from "./mailbox";
import type { Capability, Role } from "./tokens";

export interface ToolContext {
  capability: Capability;
  mailbox: MailStore;
  /** Best-effort title of an agent; falls back to its id. */
  nameOf(agentId: string, hint?: string): Promise<string>;
  /** Called after a mail is stored, e.g. to wake the Assistant on `needs_louis`. */
  onMail(mail: Mail): void;
}

export interface ToolDef {
  name: string;
  description: string;
  /** Who may see and call it. */
  roles: Role[];
  input: z.ZodType;
  run(input: any, ctx: ToolContext): Promise<unknown>;
}

const mailInput = z.object({
  subject: z.string().min(1).max(200).describe("One line."),
  body: z.string().max(10_000).default("").describe("A few lines."),
  kind: z.enum(MAIL_KINDS).describe("start | blocked | needs_louis | pr | done"),
});

export const mailTools: ToolDef[] = [
  {
    name: "assistant_mail",
    description:
      "Mail the Assistant a status update. Only at milestones: start, blocked, needs Louis, PR opened or merged, done; not every step. The sender is you.",
    roles: ["agent"],
    input: mailInput,
    async run(input: z.output<typeof mailInput>, ctx) {
      const agentId = ctx.capability.agentId;
      if (!agentId) throw new Error("This agent is not known yet; try again after its first turn.");
      const mail = ctx.mailbox.add({
        agentId,
        agentName: await ctx.nameOf(agentId, ctx.capability.name),
        subject: input.subject,
        body: input.body,
        kind: input.kind,
      });
      ctx.onMail(mail);
      return "Mail sent to the Assistant.";
    },
  },
  {
    name: "assistant_mailbox",
    description: "List the mails agents sent to the Assistant, unread first. Pass unreadOnly to skip those already read.",
    roles: ["assistant"],
    input: z.object({ unreadOnly: z.boolean().default(true) }),
    async run(input: { unreadOnly: boolean }, ctx) {
      return ctx.mailbox.list({ unreadOnly: input.unreadOnly });
    },
  },
  {
    name: "assistant_mark_read",
    description: "Mark mails read once you have processed them. Pass ids, or omit them to mark every mail read.",
    roles: ["assistant"],
    input: z.object({ ids: z.array(z.string()).optional() }),
    async run(input: { ids?: string[] }, ctx) {
      return { marked: ctx.mailbox.markRead(input.ids) };
    },
  },
];

export const toolNames = (role: Role) => mailTools.filter((t) => t.roles.includes(role)).map((t) => t.name);
