import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const sessionSchema = z.object({ agentId: z.string(), workspaceId: z.string() });

/** The Overseer conversation, created when it is missing or archived. */
export const ensureRpc = defineRpc({
  name: "overseer.ensure",
  input: z.object({}),
  output: sessionSchema,
});

/** Archives the current conversation and starts a fresh one. */
export const resetRpc = defineRpc({
  name: "overseer.reset",
  input: z.object({}),
  output: sessionSchema,
});
