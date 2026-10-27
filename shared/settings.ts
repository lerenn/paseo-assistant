import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { DEFAULT_MAILBOX_HEARTBEAT_MINUTES, DEFAULT_TASK_REVIEW_MINUTES } from "./review";

export const DEFAULT_PROVIDER = "claude/claude-sonnet-5-5";

export const settingsSchema = z.object({
  /** Provider and model of the Assistant agent, as `provider/model`. Applies to the next new session. */
  provider: z.string().min(1).default(DEFAULT_PROVIDER),
  /**
   * Deprecated and ignored: who is told to mail the Assistant is now a setting of the Agents Mail plugin
   * (milestoneIncludeLabels, milestoneExcludeLabels). Kept so saved settings stay valid.
   *
   * Label rules (`key=value` or `key`, comma or newline separated) for which new top-level agents
   * are told to mail the Assistant. An agent with a label matching an include rule is always
   * included; one matching an exclude rule is left out. Subagents are always left out.
   */
  /** Minutes between task reviews of the Assistant ("Look over each current task..."); 0 turns them off. */
  taskReviewMinutes: z.number().int().min(0).max(1440).default(DEFAULT_TASK_REVIEW_MINUTES),
  /** Minutes between the mailbox heartbeats ("Process the Assistant mailbox"). A change re-creates the heartbeat. */
  mailboxHeartbeatMinutes: z.number().int().min(1).max(1440).default(DEFAULT_MAILBOX_HEARTBEAT_MINUTES),
  /** Nudge guard rails (see assistant_nudge_check): minutes of silence before an agent may be nudged. */
  nudgeIdleMinutes: z.number().int().min(1).max(1440).default(30),
  /** At most this many nudges per agent per hour. */
  nudgeMaxPerHour: z.number().int().min(1).max(60).default(1),
  /** After this many nudges without progress the human is asked instead. */
  nudgeEscalateAfter: z.number().int().min(1).max(20).default(2),
  mailIncludeLabels: z.string().default("paseo.factory.supervisor=1"),
  mailExcludeLabels: z.string().default("paseo.factory=1"),
});
export type AssistantSettings = z.output<typeof settingsSchema>;

export const assistantSettings = defineSettings({
  id: "assistant",
  scope: "host",
  version: 1,
  schema: settingsSchema,
});
