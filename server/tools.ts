import { z } from "zod";
import { mailKindSchema, type Mail } from "../shared/mail";
import { MAX_OPTIONS, MIN_OPTIONS } from "../shared/decision";
import type { DecisionStore } from "./decisions";
import type { MailStore } from "./mailbox";
import type { Capability, Role } from "./tokens";

export interface ToolContext {
  capability: Capability;
  mailbox: MailStore;
  decisions: DecisionStore;
  /** Best-effort title of an agent; falls back to its id. */
  nameOf(agentId: string, hint?: string): Promise<string>;
  /** Called after a mail is stored, e.g. to wake the Assistant. */
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
  kind: mailKindSchema.describe("start | blocked | needs_user | pr | done"),
});

export const mailTools: ToolDef[] = [
  {
    name: "assistant_mail",
    description:
      "Mail the Assistant a status update. Only at milestones: start, blocked, needs the user, PR opened or merged, done; not every step. The sender is you.",
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
  {
    name: "assistant_decision_add",
    description:
      "Queue a decision for the human, who answers whenever they like in the Decisions tab. Give a question, 2 to 4 distinct options and the recommended one (it must be one of the options). The human can also answer in free text. Their answer comes back to you as a message with the decision id, question and answer.",
    roles: ["assistant"],
    input: z.object({
      question: z.string().min(1).max(1000),
      options: z.array(z.string().min(1).max(300)).min(MIN_OPTIONS).max(MAX_OPTIONS),
      recommended: z.string().min(1).describe("One of the options."),
    }),
    async run(input: { question: string; options: string[]; recommended: string }, ctx) {
      const decision = ctx.decisions.add(input);
      return { id: decision.id, options: decision.options };
    },
  },
  {
    name: "assistant_decision_close",
    description:
      "Close a pending decision the user answered directly in chat: records their answer and marks it answered in chat. Does not message you. Fails on an unknown or already answered id.",
    roles: ["assistant"],
    input: z.object({ id: z.string().min(1), answer: z.string().min(1).max(1000) }),
    async run(input: { id: string; answer: string }, ctx) {
      const decision = ctx.decisions.close(input.id, input.answer);
      return { id: decision.id, answer: decision.answer };
    },
  },
];

export const toolNames = (role: Role) => mailTools.filter((t) => t.roles.includes(role)).map((t) => t.name);
