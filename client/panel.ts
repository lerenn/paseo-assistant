import type { Item } from "../shared/item";
import { countBadge } from "./mail-format";

export type PanelTab = "mailbox" | "decisions" | "actions" | "items";

export interface PanelCounts {
  unreadMail: number;
  openDecisions: number;
  /** Open items with owner human: what the user has to do. */
  yourActions: number;
  /** Open items with owner agent: waits. */
  openItems: number;
}

export const MAIL_HINT = "Agents Mail not installed";

/** Why the Mailbox tab is disabled, by what the Assistant found. */
export const mailHint = (availability: "ok" | "not-installed" | "unreachable" | "outdated"): string | null =>
  availability === "ok" ? null : availability === "unreachable" ? "Agents Mail not answering" : availability === "outdated" ? "Agents Mail needs an update" : MAIL_HINT;

/**
 * The tabs of the right-hand panel, in order, with the count each shows (empty at zero). The Mailbox tab is a view on
 * the Agents Mail plugin: without it the tab is disabled and says why, and the other tabs work as usual.
 */
export function panelTabs(c: PanelCounts, mailAvailable = true, hint: string = MAIL_HINT): { id: PanelTab; label: string; badge: string; disabled: boolean; hint: string | null }[] {
  return [
    { id: "items", label: "Tasks", badge: countBadge(c.openItems), disabled: false, hint: null },
    { id: "decisions", label: "Your Decisions", badge: countBadge(c.openDecisions), disabled: false, hint: null },
    { id: "actions", label: "Your Actions", badge: countBadge(c.yourActions), disabled: false, hint: null },
    { id: "mailbox", label: "Mailbox", badge: mailAvailable ? countBadge(c.unreadMail) : "", disabled: !mailAvailable, hint: mailAvailable ? null : hint },
  ];
}

/** The tab the panel opens on, always: Tasks. Nothing switches tabs by itself. */
export const DEFAULT_TAB: PanelTab = "items";

/** The tab to show: the wanted one, unless it is the disabled Mailbox, then the default. */
export function effectiveTab(wanted: PanelTab, mailAvailable: boolean): PanelTab {
  return wanted === "mailbox" && !mailAvailable ? DEFAULT_TAB : wanted;
}

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
