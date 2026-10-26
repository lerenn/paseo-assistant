import { z } from "zod";
import { mailKindSchema } from "../shared/mail";
import { DECISION_STATUSES, MAX_OPTIONS, MIN_OPTIONS, decisionStatus } from "../shared/decision";
import type { DecisionStore } from "./decisions";
import type { ItemStore } from "./items";
import { ManageError, createAgent, createWorkspace, listAgents, listProjects, type ManagePaseo } from "./manage";
import { AgentsMailError, type AgentsMailClient } from "./agentsmail";
import type { Capability, Role } from "./tokens";

export interface ToolContext {
  capability: Capability;
  /** The Agents Mail plugin, where the mail lives now. */
  agentsMail: AgentsMailClient;
  decisions: DecisionStore;
  items: ItemStore;
  /** The Paseo SDK, once a hook or RPC has handed it over; null before. */
  paseo(): ManagePaseo | null;
  /** Starts a new Assistant session with this handover (see AssistantSession.renew). */
  renew(input: { handover: string; heartbeatId?: string }): Promise<{ agentId: string }>;
  /** Best-effort title of an agent; falls back to its id. */
  nameOf(agentId: string, hint?: string): Promise<string>;
}

const DEPRECATED = "Deprecated: the Agents Mail plugin replaces this tool; use mail_send(to=\"@assistant\", ...), mail_list and mail_read.";

function needPaseo(ctx: ToolContext): ManagePaseo {
  const paseo = ctx.paseo();
  if (!paseo) throw new ManageError("The Paseo API is not available yet; try again in a moment.");
  return paseo;
}

/** Runs a call to Agents Mail and turns "not there" into a message the agent can act on. */
async function viaAgentsMail<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AgentsMailError) throw new Error(`${error.message} Nothing was changed.`);
    throw error;
  }
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
  kind: mailKindSchema.describe("start | blocked | pr | done"),
});

export const mailTools: ToolDef[] = [
  {
    name: "assistant_mail",
    description:
      `Mail the Assistant a status update. Only at milestones: start, blocked (stuck), PR opened or merged, done; not every step. The sender is you. ${DEPRECATED}`,
    roles: ["agent"],
    input: mailInput,
    async run(input: z.output<typeof mailInput>, ctx) {
      const agentId = ctx.capability.agentId;
      if (!agentId) throw new Error("This agent is not known yet; try again after its first turn.");
      const name = await ctx.nameOf(agentId, ctx.capability.name);
      await viaAgentsMail(() => ctx.agentsMail.sendAsAgent({ agentId, name, subject: input.subject, body: input.body, kind: input.kind }));
      return `Mail sent to the Assistant. ${DEPRECATED}`;
    },
  },
  {
    name: "assistant_mailbox",
    description: `List the mails agents sent to the Assistant, unread first. Pass unreadOnly to skip those already read. ${DEPRECATED}`,
    roles: ["assistant"],
    input: z.object({ unreadOnly: z.boolean().default(true) }),
    async run(input: { unreadOnly: boolean }, ctx) {
      return viaAgentsMail(() => ctx.agentsMail.list({ unreadOnly: input.unreadOnly }));
    },
  },
  {
    name: "assistant_mark_read",
    description: `Mark mails read once you have processed them. Pass ids, or omit them to mark every mail read. ${DEPRECATED}`,
    roles: ["assistant"],
    input: z.object({ ids: z.array(z.string()).optional() }),
    async run(input: { ids?: string[] }, ctx) {
      return { marked: await viaAgentsMail(() => ctx.agentsMail.markRead(input.ids)) };
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
    name: "assistant_decision_list",
    description:
      "List the decisions you queued, with status: pending (unanswered), answered (answered in the tab, not yet passed to you), delivered (passed to you) or closed (answered in chat). Each has id, question, options, the recommended option (the first), the answer and its source (tab or chat), and timestamps (created, answered, delivered). Filter by status and by created time (since, until: ISO dates or epoch milliseconds). Check it when asked what is waiting and before queueing a decision, to avoid duplicates and catch answers not yet delivered.",
    roles: ["assistant"],
    input: z.object({
      status: z.enum(DECISION_STATUSES).optional(),
      since: z.union([z.string(), z.number()]).optional(),
      until: z.union([z.string(), z.number()]).optional(),
    }),
    async run(input: { status?: (typeof DECISION_STATUSES)[number]; since?: string | number; until?: string | number }, ctx) {
      const at = (v: string | number | undefined): number | null => {
        if (v === undefined) return null;
        const t = typeof v === "number" ? v : Number.isNaN(Number(v)) ? Date.parse(v) : Number(v);
        if (Number.isNaN(t)) throw new Error(`Not a date: ${v}`);
        return t;
      };
      const since = at(input.since);
      const until = at(input.until);
      const iso = (t: number | null | undefined) => (t == null ? null : new Date(t).toISOString());
      return ctx.decisions
        .list()
        .filter((d) => (!input.status || decisionStatus(d) === input.status) && (since === null || d.askedAt >= since) && (until === null || d.askedAt <= until))
        .map((d) => ({
          id: d.id,
          question: d.question,
          options: d.options,
          recommended: d.options[0],
          status: decisionStatus(d),
          answer: d.answer?.text ?? null,
          answerIsFreeText: d.answer?.other ?? null,
          source: d.answer?.source ?? null,
          createdAt: iso(d.askedAt),
          answeredAt: iso(d.answer?.at),
          deliveredAt: iso(d.deliveredAt),
        }));
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
  {
    name: "assistant_item_add",
    description:
      "Track something the human is waiting on but does not have to decide, for example \"waiting for the cluster rework PR 3\" or \"pin PR pending restart\". It shows in the Open items tab. For a real choice use assistant_decision_add instead. Title is one line; detail and an http(s) link are optional.",
    roles: ["assistant"],
    input: z.object({ title: z.string().min(1).max(200), detail: z.string().max(2000).optional(), link: z.string().max(500).optional() }),
    async run(input: { title: string; detail?: string; link?: string }, ctx) {
      const item = ctx.items.add(input);
      return { id: item.id };
    },
  },
  {
    name: "assistant_item_update",
    description: "Change the title, detail or link of an open item (an empty detail or link clears it). Fails on an unknown or closed id.",
    roles: ["assistant"],
    input: z.object({ id: z.string().min(1), title: z.string().min(1).max(200).optional(), detail: z.string().max(2000).optional(), link: z.string().max(500).optional() }),
    async run(input: { id: string; title?: string; detail?: string; link?: string }, ctx) {
      const { id, ...changes } = input;
      const item = ctx.items.update(id, changes);
      return { id: item.id, title: item.title };
    },
  },
  {
    name: "assistant_item_close",
    description: "Close an open item when what the human was waiting for happened. An optional note says how it ended. Fails on an unknown or already closed id.",
    roles: ["assistant"],
    input: z.object({ id: z.string().min(1), note: z.string().max(1000).optional() }),
    async run(input: { id: string; note?: string }, ctx) {
      const item = ctx.items.close(input.id, input.note);
      return { id: item.id, closed: true };
    },
  },
  {
    name: "assistant_projects_list",
    description: "List the Paseo projects (id, name, root path) with their live workspaces, to pick a workspace or the project for a new one.",
    roles: ["assistant"],
    input: z.object({}),
    async run(_input: object, ctx) {
      return listProjects(needPaseo(ctx));
    },
  },
  {
    name: "assistant_workspace_create",
    description:
      "Create a workspace in a project (by id, name or root path), in a Kubernetes Runtime pod by default (runtime \"local\" runs it on the daemon, only for daemon work). It is made by the plugin, not as your child, and outlives your session. Returns the workspace id for assistant_agent_create.",
    roles: ["assistant"],
    input: z.object({
      project: z.string().min(1),
      title: z.string().min(1).max(100),
      runtime: z.enum(["kubernetes", "local"]).default("kubernetes"),
      slug: z.string().min(1).max(40).optional(),
    }),
    async run(input: { project: string; title: string; runtime: "kubernetes" | "local"; slug?: string }, ctx) {
      return createWorkspace(needPaseo(ctx), input);
    },
  },
  {
    name: "assistant_agent_create",
    description:
      "Create a TOP-LEVEL agent in a workspace (not your subagent: it keeps running after your session and stays manageable with the Paseo tools). It is labelled paseo.created-by=assistant. Give a self-contained prompt; provider defaults to claude/claude-sonnet-5-5. Do not use the Paseo create_agent tool for this: it would make a subagent.",
    roles: ["assistant"],
    input: z.object({
      workspaceId: z.string().min(1),
      title: z.string().min(1).max(100),
      prompt: z.string().min(1).max(20_000),
      provider: z.string().min(1).optional(),
      mode: z.string().min(1).optional(),
      labels: z.record(z.string(), z.string()).optional(),
    }),
    async run(input: { workspaceId: string; title: string; prompt: string; provider?: string; mode?: string; labels?: Record<string, string> }, ctx) {
      return createAgent(needPaseo(ctx), input);
    },
  },
  {
    name: "assistant_agents_list",
    description: "List live agents. By default only the ones you created (label paseo.created-by=assistant); pass createdByAssistant=false for all. Use it to find what you made and to check the bypassPermissions rule.",
    roles: ["assistant"],
    input: z.object({ createdByAssistant: z.boolean().default(true) }),
    async run(input: { createdByAssistant: boolean }, ctx) {
      return listAgents(needPaseo(ctx), input);
    },
  },
  {
    name: "assistant_session_renew",
    description:
      "Start your own new session and hand over your context. Write the handover first: open decision ids, the agents you follow with their ids, what the human is waiting on, and your heartbeat id (pass it as heartbeatId so the new session deletes it before making its own: never two). The plugin saves it, creates the new session with it as the first message, and archives this one a few seconds later. At most once per 10 minutes. Use it after a plugin deploy, when your context is very full, or when asked; never while acting for the human.",
    roles: ["assistant"],
    input: z.object({ handover: z.string().min(20).max(20_000), heartbeatId: z.string().min(1).max(200).optional() }),
    async run(input: { handover: string; heartbeatId?: string }, ctx) {
      await ctx.renew(input);
      return "A new session is starting with your handover. This one will be archived in a few seconds: stop now, do not start new work.";
    },
  },
];

export const toolNames = (role: Role) => mailTools.filter((t) => t.roles.includes(role)).map((t) => t.name);
