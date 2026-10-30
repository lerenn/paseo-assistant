import { describe, expect, it } from "vitest";
import { DEFAULT_TAB, countBadge, panelLayout, panelTabs, toggleBadge } from "./panel";

describe("panelTabs", () => {
  it("lists Tasks, Your Decisions, and Your Actions, in that order, with their counts, empty at zero", () => {
    expect(panelTabs({ openDecisions: 0, yourActions: 0, openItems: 0 })).toEqual([
      { id: "items", label: "Tasks", badge: "" },
      { id: "decisions", label: "Your Decisions", badge: "" },
      { id: "actions", label: "Your Actions", badge: "" },
    ]);
    expect(panelTabs({ openDecisions: 2, yourActions: 4, openItems: 120 }).map((t) => t.badge)).toEqual(["99+", "2", "4"]);
  });
  it("has no Chat tab: the chat is always shown", () => {
    expect(panelTabs({ openDecisions: 0, yourActions: 0, openItems: 0 }).map((t) => t.id)).not.toContain("chat");
  });
});

describe("toggleBadge", () => {
  it("shows the open decisions only", () => {
    expect(toggleBadge({ openDecisions: 0, yourActions: 9, openItems: 9 })).toBe("");
    expect(toggleBadge({ openDecisions: 4, yourActions: 9, openItems: 9 })).toBe("4");
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

describe("countBadge", () => {
  it("is empty at zero and capped at 99+", () => {
    expect(countBadge(0)).toBe("");
    expect(countBadge(7)).toBe("7");
    expect(countBadge(100)).toBe("99+");
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
  it("is always Tasks, the first tab, even with nothing open", () => {
    expect(DEFAULT_TAB).toBe("items");
    expect(panelTabs({ openDecisions: 9, yourActions: 9, openItems: 0 })[0].id).toBe(DEFAULT_TAB);
  });
});
