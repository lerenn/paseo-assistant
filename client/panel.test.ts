import { describe, expect, it } from "vitest";
import { DEFAULT_TAB, MAIL_HINT, effectiveTab, mailHint, panelLayout, panelTabs, toggleBadge } from "./panel";

describe("panelTabs", () => {
  it("lists Tasks, Your Decisions, Your Actions and Mailbox, in that order, with their counts, empty at zero", () => {
    expect(panelTabs({ unreadMail: 0, openDecisions: 0, yourActions: 0, openItems: 0 })).toEqual([
      { id: "items", label: "Tasks", badge: "", disabled: false, hint: null },
      { id: "decisions", label: "Your Decisions", badge: "", disabled: false, hint: null },
      { id: "actions", label: "Your Actions", badge: "", disabled: false, hint: null },
      { id: "mailbox", label: "Mailbox", badge: "", disabled: false, hint: null },
    ]);
    expect(panelTabs({ unreadMail: 3, openDecisions: 2, yourActions: 4, openItems: 120 }).map((t) => t.badge)).toEqual(["99+", "2", "4", "3"]);
  });
  it("has no Chat tab: the chat is always shown", () => {
    expect(panelTabs({ unreadMail: 0, openDecisions: 0, yourActions: 0, openItems: 0 }).map((t) => t.id)).not.toContain("chat");
  });
});

describe("toggleBadge", () => {
  it("shows the open decisions only", () => {
    expect(toggleBadge({ unreadMail: 9, openDecisions: 0, yourActions: 9, openItems: 9 })).toBe("");
    expect(toggleBadge({ unreadMail: 9, openDecisions: 4, yourActions: 9, openItems: 9 })).toBe("4");
  });
});

describe("panelLayout", () => {
  it("is beside the chat when wide, in place of it when compact, and gone when closed", () => {
    expect(panelLayout(false, true)).toBe("side");
    expect(panelLayout(true, true)).toBe("full");
    expect(panelLayout(false, false)).toBe("hidden");
    expect(panelLayout(true, false)).toBe("hidden");
  });
});

describe("Mailbox tab without Agents Mail", () => {
  const counts = { unreadMail: 5, openDecisions: 2, yourActions: 3, openItems: 1 };
  it("is disabled with the hint and no count, while the other tabs work", () => {
    const tabs = panelTabs(counts, false);
    expect(tabs[3]).toEqual({ id: "mailbox", label: "Mailbox", badge: "", disabled: true, hint: MAIL_HINT });
    expect(MAIL_HINT).toBe("Agents Mail not installed");
    expect(tabs.slice(0, 3).every((t) => !t.disabled && t.hint === null)).toBe(true);
    expect(tabs.slice(0, 3).map((t) => t.badge)).toEqual(["1", "2", "3"]);
  });
  it("falls back to Tasks, the default, when the wanted tab is the disabled Mailbox", () => {
    expect(effectiveTab("mailbox", false)).toBe("items");
    expect(effectiveTab("mailbox", true)).toBe("mailbox");
    expect(effectiveTab("items", false)).toBe("items");
  });
});

describe("mailHint", () => {
  it("names why the tab is disabled", () => {
    expect(mailHint("ok")).toBeNull();
    expect(mailHint("not-installed")).toBe("Agents Mail not installed");
    expect(mailHint("unreachable")).toBe("Agents Mail not answering");
    expect(mailHint("outdated")).toBe("Agents Mail needs an update");
  });
});

import { isOpen, decisionStatus, type Decision } from "../shared/decision";

describe("cancelled decisions are not open", () => {
  const base: Decision = { id: "1", question: "q", options: ["a", "b"], askedAt: 1, deliveredAt: null, cancelledAt: null, answer: null };
  it("counts only decisions that are neither answered nor cancelled", () => {
    expect(isOpen(base)).toBe(true);
    expect(isOpen({ ...base, cancelledAt: 5 })).toBe(false);
    expect(isOpen({ ...base, answer: { text: "a", other: false, at: 2, source: "tab" } })).toBe(false);
    expect(decisionStatus({ ...base, cancelledAt: 5 })).toBe("cancelled");
  });
});

import { DEFAULT_PANEL_WIDTH, MIN_PANEL_WIDTH, clampPanelWidth, widthAfterDrag } from "./panel";

describe("panel width clamping", () => {
  it("keeps the width between 280 px and 60% of the width available", () => {
    expect(clampPanelWidth(100, 1500)).toBe(MIN_PANEL_WIDTH);
    expect(clampPanelWidth(400, 1500)).toBe(400);
    expect(clampPanelWidth(5000, 1500)).toBe(900);
    expect(clampPanelWidth(900, 1500)).toBe(900);
    expect(clampPanelWidth(901, 1500)).toBe(900);
  });
  it("the minimum wins on a very narrow window, and a bad width falls back to the default", () => {
    expect(clampPanelWidth(500, 300)).toBe(MIN_PANEL_WIDTH);
    expect(clampPanelWidth(Number.NaN, 2000)).toBe(DEFAULT_PANEL_WIDTH);
    expect(clampPanelWidth(Number.POSITIVE_INFINITY, 2000)).toBe(DEFAULT_PANEL_WIDTH);
  });
  it("dragging the left edge left widens, right narrows, and both stop at the limits", () => {
    expect(widthAfterDrag(380, -100, 1500)).toBe(480);
    expect(widthAfterDrag(380, 60, 1500)).toBe(320);
    expect(widthAfterDrag(380, 500, 1500)).toBe(MIN_PANEL_WIDTH);
    expect(widthAfterDrag(380, -2000, 1500)).toBe(900);
    expect(widthAfterDrag(380, 0, 1500)).toBe(380);
  });
});

import { itemCounts } from "./panel";

describe("itemCounts (Your Actions and Tasks)", () => {
  const item = (owner: "human" | "agent" | undefined, closed = false) => ({ owner: owner as "human" | "agent", closed: closed ? { at: 1, note: null } : null });
  it("splits open items by owner, ignores closed ones, and counts an item without an owner as the agent's", () => {
    expect(itemCounts([item("human"), item("human"), item("agent"), item(undefined), item("human", true), item("agent", true)])).toEqual({ yourActions: 2, openItems: 2 });
    expect(itemCounts([])).toEqual({ yourActions: 0, openItems: 0 });
  });
});

describe("default tab", () => {
  it("is always Tasks, and nothing in the tab list or the fallback switches away from it by itself", () => {
    expect(DEFAULT_TAB).toBe("items");
    expect(panelTabs({ unreadMail: 9, openDecisions: 9, yourActions: 9, openItems: 0 })[0].id).toBe(DEFAULT_TAB);
    expect(effectiveTab(DEFAULT_TAB, true)).toBe(DEFAULT_TAB);
    expect(effectiveTab(DEFAULT_TAB, false)).toBe(DEFAULT_TAB);
  });
});
