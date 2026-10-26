import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const sessionSchema = z.object({ agentId: z.string(), workspaceId: z.string() });

/** The Assistant conversation, created when it is missing or archived. */
export const ensureRpc = defineRpc({
  name: "assistant.ensure",
  input: z.object({}),
  output: sessionSchema,
});

/** Archives the current conversation and starts a fresh one. */
export const resetRpc = defineRpc({
  name: "assistant.reset",
  input: z.object({}),
  output: sessionSchema,
});

import { mailSchema } from "./mail";

/**
 * Every mail to the Assistant, unread first, then newest first. The mail lives in the Agents Mail plugin: when it
 * is not installed or does not answer, `availability` says why and `mails` is empty.
 */
export const mailListRpc = defineRpc({
  name: "assistant.mail.list",
  input: z.object({}),
  output: z.object({
    availability: z.enum(["ok", "not-installed", "unreachable", "outdated"]).default("ok"),
    mails: z.array(mailSchema),
  }),
});

/** Marks the given mails read, or all of them when no ids are given. */
export const mailReadRpc = defineRpc({
  name: "assistant.mail.read",
  input: z.object({ ids: z.array(z.string()).optional() }),
  output: z.object({ marked: z.number() }),
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
