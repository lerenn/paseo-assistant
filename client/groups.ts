import { DONE_VISIBLE_MS, statusOf, type Item, type ItemStatus } from "../shared/item";

export interface TaskGroup {
  status: ItemStatus;
  label: string;
  /** A fixed hex colour (the plugin theme has no blue, purple or teal); the view swaps in the theme's danger and success colours for Blocked and Done. */
  color: string;
  items: Item[];
  /** Whether the group starts collapsed. */
  collapsed: boolean;
}

/** The groups of the Tasks tab, in display order. */
export const TASK_GROUPS: readonly { status: ItemStatus; label: string; color: string; collapsed: boolean }[] = [
  { status: "current", label: "Current", color: "#3b82f6", collapsed: false },
  { status: "waiting", label: "Waiting", color: "#9ca3af", collapsed: false },
  { status: "blocked", label: "Blocked", color: "#ef4444", collapsed: false },
  { status: "future", label: "Future", color: "#a855f7", collapsed: false },
  { status: "recurring", label: "Recurring", color: "#14b8a6", collapsed: false },
  { status: "done", label: "Done", color: "#22c55e", collapsed: true },
];

/**
 * The agent-owned items of the Tasks tab grouped by status. Empty groups are dropped. Done holds the items closed in
 * the last 24 hours, newest first; the other groups keep the store's order (oldest first).
 */
export function groupTasks(items: readonly Item[], now: number): TaskGroup[] {
  const mine = items.filter((i) => i.owner !== "human");
  return TASK_GROUPS.map((g) => ({
    ...g,
    items: mine.filter((i) => statusOf(i) === g.status && (g.status !== "done" || now - i.closed!.at <= DONE_VISIBLE_MS)),
  })).filter((g) => g.items.length > 0);
}
