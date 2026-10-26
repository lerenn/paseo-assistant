import { countBadge } from "./mail-format";

export type PanelTab = "mailbox" | "decisions" | "items";

export interface PanelCounts {
  unreadMail: number;
  openDecisions: number;
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
    { id: "mailbox", label: "Mailbox", badge: mailAvailable ? countBadge(c.unreadMail) : "", disabled: !mailAvailable, hint: mailAvailable ? null : hint },
    { id: "decisions", label: "Decisions", badge: countBadge(c.openDecisions), disabled: false, hint: null },
    { id: "items", label: "Open items", badge: countBadge(c.openItems), disabled: false, hint: null },
  ];
}

/** The tab to show: the wanted one, unless it is disabled, then Decisions. */
export function effectiveTab(wanted: PanelTab, mailAvailable: boolean): PanelTab {
  return wanted === "mailbox" && !mailAvailable ? "decisions" : wanted;
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

/** Kept for the life of the page, so switching screens and coming back finds the panel as it was. */
export const panelMemory: { open: boolean; tab: PanelTab } = { open: true, tab: "mailbox" };
