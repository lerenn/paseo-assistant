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

/** Every mail, unread first, then newest first. */
export const mailListRpc = defineRpc({
  name: "assistant.mail.list",
  input: z.object({}),
  output: z.object({ mails: z.array(mailSchema) }),
});

/** Marks the given mails read, or all of them when no ids are given. */
export const mailReadRpc = defineRpc({
  name: "assistant.mail.read",
  input: z.object({ ids: z.array(z.string()).optional() }),
  output: z.object({ marked: z.number() }),
});
