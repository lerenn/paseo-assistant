import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const sessionSchema = z.object({ agentId: z.string(), workspaceId: z.string() });

/** The Assistant conversation, created when it is missing or archived. */
export const ensureRpc = defineRpc({
  name: "assistant.ensure",
  input: z.object({}),
  output: sessionSchema,
});

/** The current Assistant agent, or null when none exists yet. Never creates one: the sidebar row asks it. */
export const currentRpc = defineRpc({
  name: "assistant.current",
  input: z.object({}),
  output: z.object({ agentId: z.string().nullable() }),
});

/** Archives the current conversation and starts a fresh one. */
export const resetRpc = defineRpc({
  name: "assistant.reset",
  input: z.object({}),
  output: sessionSchema,
});

import { decisionSchema } from "./decision";

/** Open decisions first (oldest first), then answered ones (newest first). */
export const decisionListRpc = defineRpc({
  name: "assistant.decision.list",
  input: z.object({}),
  output: z.object({ decisions: z.array(decisionSchema) }),
});

/** Answers a decision with one of its options, or free text when `other` is true. */
export const decisionAnswerRpc = defineRpc({
  name: "assistant.decision.answer",
  input: z.object({ id: z.string(), answer: z.string().min(1).max(5000), other: z.boolean() }),
  output: z.object({ decision: decisionSchema }),
});

import { itemSchema } from "./item";

/** Open items first (oldest first), then closed ones (newest first). */
export const itemListRpc = defineRpc({
  name: "assistant.item.list",
  input: z.object({}),
  output: z.object({ items: z.array(itemSchema) }),
});

/** Whether the forwarding `assistant_mail*` tools are still needed: which live agents hold them and how often they are called. */
export const shimsRpc = defineRpc({
  name: "assistant.shims",
  input: z.object({}),
  output: z.object({
    liveHolders: z.array(z.string()),
    capabilities: z.number(),
    uses: z.number(),
    lastUsedAt: z.number().nullable(),
    removable: z.boolean(),
  }),
});

/** Cancels an open decision (the × on its card); the Assistant is told through the delivery queue. */
export const decisionCancelRpc = defineRpc({
  name: "assistant.decision.cancel",
  input: z.object({ id: z.string() }),
  output: z.object({ decision: decisionSchema }),
});

/** The user's saved panel width, or null for the default. Kept on the daemon, so it follows the user across reloads and devices. */
export const uiGetRpc = defineRpc({
  name: "assistant.ui.get",
  input: z.object({}),
  output: z.object({ panelWidth: z.number().nullable() }),
});

export const uiSetRpc = defineRpc({
  name: "assistant.ui.set",
  input: z.object({ panelWidth: z.number().nullable() }),
  output: z.object({ panelWidth: z.number().nullable() }),
});

/**
 * The Review tasks button: asks the Assistant to look over its current tasks, as if the user had typed it. `sent` when it
 * was idle, `queued` when it is mid-turn (the message goes out once the turn ends), `no-assistant` when none exists yet.
 */
export const reviewTasksRpc = defineRpc({
  name: "assistant.review-tasks",
  input: z.object({}),
  output: z.object({ result: z.enum(["sent", "queued", "no-assistant"]) }),
});

/**
 * Done (and More…, with a text) on a Your Actions card: tells the Assistant the user marked the item done, queued until
 * its turn (the same delivery as decision answers, never steering a running turn). The item stays open: the Assistant
 * checks it and closes it. `duplicate` when the same note for the item was still waiting (a double click).
 */
export const itemDoneRpc = defineRpc({
  name: "assistant.item.done",
  input: z.object({ id: z.string(), text: z.string().max(5000).optional() }),
  output: z.object({ duplicate: z.boolean() }),
});
