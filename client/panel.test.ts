import { describe, expect, it } from "vitest";
import { MAIL_HINT, effectiveTab, mailHint, panelLayout, panelTabs, toggleBadge } from "./panel";

describe("panelTabs", () => {
  it("lists Mailbox, Decisions and Open items with their counts, empty at zero", () => {
    expect(panelTabs({ unreadMail: 0, openDecisions: 0, openItems: 0 })).toEqual([
      { id: "mailbox", label: "Mailbox", badge: "", disabled: false, hint: null },
      { id: "decisions", label: "Decisions", badge: "", disabled: false, hint: null },
      { id: "items", label: "Open items", badge: "", disabled: false, hint: null },
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

describe("Mailbox tab without Agents Mail", () => {
  const counts = { unreadMail: 5, openDecisions: 2, openItems: 1 };
  it("is disabled with the hint and no count, while the other tabs work", () => {
    const tabs = panelTabs(counts, false);
    expect(tabs[0]).toEqual({ id: "mailbox", label: "Mailbox", badge: "", disabled: true, hint: MAIL_HINT });
    expect(MAIL_HINT).toBe("Agents Mail not installed");
    expect(tabs.slice(1).every((t) => !t.disabled && t.hint === null)).toBe(true);
    expect(tabs.slice(1).map((t) => t.badge)).toEqual(["2", "1"]);
  });
  it("falls back to Decisions when the wanted tab is the disabled Mailbox", () => {
    expect(effectiveTab("mailbox", false)).toBe("decisions");
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
