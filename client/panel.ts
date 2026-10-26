import { countBadge } from "./mail-format";

export type PanelTab = "mailbox" | "decisions" | "items";

export interface PanelCounts {
  unreadMail: number;
  openDecisions: number;
  openItems: number;
}

/** The tabs of the right-hand panel, in order, with the count each shows (empty at zero). */
export function panelTabs(c: PanelCounts): { id: PanelTab; label: string; badge: string }[] {
  return [
    { id: "mailbox", label: "Mailbox", badge: countBadge(c.unreadMail) },
    { id: "decisions", label: "Decisions", badge: countBadge(c.openDecisions) },
    { id: "items", label: "Open items", badge: countBadge(c.openItems) },
  ];
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

/** Kept for the life of the page, so switching screens and coming back finds the panel as it was. */
export const panelMemory: { open: boolean; tab: PanelTab } = { open: true, tab: "mailbox" };
