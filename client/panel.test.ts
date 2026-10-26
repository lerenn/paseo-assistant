import { describe, expect, it } from "vitest";
import { panelLayout, panelTabs, toggleBadge } from "./panel";

describe("panelTabs", () => {
  it("lists Mailbox, Decisions and Open items with their counts, empty at zero", () => {
    expect(panelTabs({ unreadMail: 0, openDecisions: 0, openItems: 0 })).toEqual([
      { id: "mailbox", label: "Mailbox", badge: "" },
      { id: "decisions", label: "Decisions", badge: "" },
      { id: "items", label: "Open items", badge: "" },
    ]);
    expect(panelTabs({ unreadMail: 3, openDecisions: 2, openItems: 120 }).map((t) => t.badge)).toEqual(["3", "2", "99+"]);
  });
  it("has no Chat tab: the chat is always shown", () => {
    expect(panelTabs({ unreadMail: 0, openDecisions: 0, openItems: 0 }).map((t) => t.id)).not.toContain("chat");
  });
});

describe("toggleBadge", () => {
  it("shows the open decisions only", () => {
    expect(toggleBadge({ unreadMail: 9, openDecisions: 0, openItems: 9 })).toBe("");
    expect(toggleBadge({ unreadMail: 9, openDecisions: 4, openItems: 9 })).toBe("4");
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
