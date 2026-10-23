import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const DEFAULT_PROVIDER = "claude/claude-sonnet-5-5";

export const settingsSchema = z.object({
  /** Provider and model of the Overseer agent, as `provider/model`. Applies to the next new session. */
  provider: z.string().min(1).default(DEFAULT_PROVIDER),
});
export type OverseerSettings = z.output<typeof settingsSchema>;

export const overseerSettings = defineSettings({
  id: "overseer",
  scope: "host",
  version: 1,
  schema: settingsSchema,
});
