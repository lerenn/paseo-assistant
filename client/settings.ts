import type { AssistantSettings } from "../shared/settings";

/** The numeric settings the Settings view edits, with their bounds, as the form shows them. */
export const SETTING_FIELDS = [
  { key: "mailboxHeartbeatMinutes", label: "Mailbox heartbeat (minutes)", hint: "How often the Assistant processes its mailbox. Default 15. Changing it re-creates the heartbeat.", min: 1, max: 1440 },
  { key: "taskReviewMinutes", label: "Task review (minutes)", hint: "How often it reviews the current tasks and nudges stuck agents. Default 30, 0 turns it off.", min: 0, max: 1440 },
  { key: "nudgeIdleMinutes", label: "Nudge only after silence of (minutes)", hint: "An agent must be idle or silent this long. Default 30.", min: 1, max: 1440 },
  { key: "nudgeMaxPerHour", label: "Max nudges per agent per hour", hint: "Default 1.", min: 1, max: 60 },
  { key: "nudgeEscalateAfter", label: "Ask me after this many nudges without progress", hint: "Instead of nudging again, a decision is queued. Default 2.", min: 1, max: 20 },
] as const;

export type SettingKey = (typeof SETTING_FIELDS)[number]["key"];

/** Parses a field's text: a whole number within the bounds, or an error message. */
export function parseField(key: SettingKey, text: string): { value: number } | { error: string } {
  const field = SETTING_FIELDS.find((f) => f.key === key)!;
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return { error: "Enter a whole number." };
  const value = Number(trimmed);
  return value < field.min || value > field.max ? { error: `Between ${field.min} and ${field.max}.` } : { value };
}

/** The settings with the edited texts applied, or the first error per field. */
export function applyEdits(current: AssistantSettings, edits: Partial<Record<SettingKey, string>>): { values: AssistantSettings; errors: Partial<Record<SettingKey, string>> } {
  const values = { ...current };
  const errors: Partial<Record<SettingKey, string>> = {};
  for (const [key, text] of Object.entries(edits) as [SettingKey, string][]) {
    const parsed = parseField(key, text);
    if ("error" in parsed) errors[key] = parsed.error;
    else values[key] = parsed.value;
  }
  return { values, errors };
}
