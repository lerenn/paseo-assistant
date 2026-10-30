import type { Item } from "../shared/item";

/** A count badge: empty at zero, capped at 99+. */
export const countBadge = (n: number): string => (n <= 0 ? "" : n > 99 ? "99+" : String(n));

export type PanelTab = "decisions" | "actions" | "items";

export interface PanelCounts {
  openDecisions: number;
  /** Open items with owner human: what the user has to do. */
  yourActions: number;
  /** Open items with owner agent: waits. */
  openItems: number;
}

/** The tabs of the right-hand panel, in order, with the count each shows (empty at zero). */
export function panelTabs(c: PanelCounts): { id: PanelTab; label: string; badge: string }[] {
  return [
    { id: "items", label: "Tasks", badge: countBadge(c.openItems) },
    { id: "decisions", label: "Your Decisions", badge: countBadge(c.openDecisions) },
    { id: "actions", label: "Your Actions", badge: countBadge(c.yourActions) },
  ];
}

/** The tab the panel opens on, always: Tasks. Nothing switches tabs by itself. */
export const DEFAULT_TAB: PanelTab = "items";

/** Open (not closed) items by owner: `human` for Your actions, `agent` (also items saved before owners existed) for Tasks. */
export function itemCounts(items: readonly Pick<Item, "owner" | "closed">[]): { yourActions: number; openItems: number } {
  const open = items.filter((i) => !i.closed);
  return { yourActions: open.filter((i) => i.owner === "human").length, openItems: open.filter((i) => i.owner !== "human").length };
}

/** The count on the panel toggle: what needs the human's choice, as on the sidebar row. */
export const toggleBadge = (c: PanelCounts): string => countBadge(c.openDecisions);

/**
 * Where the panel goes. Wide layouts put it beside the chat; compact ones have no room for both, so an
 * open panel takes the chat's place until it is closed.
 */
export function panelLayout(compact: boolean, open: boolean): "hidden" | "side" | "full" {
  return !open ? "hidden" : compact ? "full" : "side";
}

export const MIN_PANEL_WIDTH = 280;
export const DEFAULT_PANEL_WIDTH = 380;
/** The panel may take at most this share of the width available. */
export const MAX_PANEL_SHARE = 0.6;

/** A panel width kept between the minimum and 60% of the width available (the minimum wins on a very narrow window). */
export function clampPanelWidth(width: number, available: number): number {
  const max = Math.max(MIN_PANEL_WIDTH, Math.floor(available * MAX_PANEL_SHARE));
  const w = Number.isFinite(width) ? width : DEFAULT_PANEL_WIDTH;
  return Math.round(Math.min(Math.max(w, MIN_PANEL_WIDTH), max));
}

/** Dragging the left edge left (negative dx) widens the panel; right narrows it. */
export const widthAfterDrag = (startWidth: number, dx: number, available: number): number => clampPanelWidth(startWidth - dx, available);

/** Whether the panel is open is kept for the life of the page; the tab is not: the panel always opens on Tasks. */
export const panelMemory: { open: boolean } = { open: true };
