import { describe, expect, it } from "vitest";
import { CHAT_QUESTION_NOTE, asksInChat, lastTurn, noteForTurn } from "./ask-check";

const page = (...items: Record<string, unknown>[]) => ({ entries: items.map((item) => ({ item })) });
const say = (text: string) => ({ type: "assistant_message", text });
const user = (text: string) => ({ type: "user_message", text });
const tool = (name: string) => ({ type: "tool_call", name });

describe("asksInChat", () => {
  it("is true when the last paragraph ends in a question, through markdown and trailing marks", () => {
    expect(asksInChat("Status: done.\n\nDo you want me to archive them?")).toBe(true);
    expect(asksInChat("Blocked on the key rotation. Shall I proceed? **")).toBe(true);
    expect(asksInChat("OK?)")).toBe(true);
    expect(asksInChat("Ready for the next step? 🙂")).toBe(true);
  });

  it("is true when options are offered to the user to pick from", () => {
    expect(asksInChat("I can do either:\n\n- archive the helpers\n- keep them\n\nTell me which you prefer.")).toBe(true);
    expect(asksInChat("Options for you:\n(a) archive\n(b) keep\nWhich one do you want")).toBe(true);
  });

  it("is false for plain status, a question mark only mid-reply, quoted text, and empty replies", () => {
    expect(asksInChat("Done. Archived 3 helpers and closed 2 items.")).toBe(false);
    expect(asksInChat("Why did it fail? The key had expired.\n\nRenewed it; all green.")).toBe(false);
    expect(asksInChat("- built\n- tested\n- merged")).toBe(false);
    expect(asksInChat("")).toBe(false);
    expect(asksInChat("   \n\n ")).toBe(false);
  });
});

describe("lastTurn", () => {
  it("joins the assistant text of the last turn only and sees a decision queued in it", () => {
    const p = page(user("old"), say("Old question?"), tool("mcp__assistant__assistant_decision_add"), user("go"), say("Doing "), say("it."));
    expect(lastTurn(p)).toEqual({ reply: "Doing it.", queuedDecision: false });
    const q = page(user("go"), tool("mcp__assistant__assistant_decision_add"), say("Queued; is that OK?"));
    expect(lastTurn(q)).toEqual({ reply: "Queued; is that OK?", queuedDecision: true });
  });
  it("accepts bare items and an empty page", () => {
    expect(lastTurn({ entries: [say("hi")] })).toEqual({ reply: "hi", queuedDecision: false });
    expect(lastTurn({})).toEqual({ reply: "", queuedDecision: false });
    expect(lastTurn(null)).toEqual({ reply: "", queuedDecision: false });
  });
});

describe("noteForTurn", () => {
  it("warns when the Assistant asked in chat and queued no decision", () => {
    expect(noteForTurn(page(user("status?"), say("All quiet.\n\nShould I archive the helpers?")))).toBe(CHAT_QUESTION_NOTE);
  });
  it("stays quiet when a decision was queued in the turn, or the reply is plain status", () => {
    expect(noteForTurn(page(user("x"), tool("assistant_decision_add"), say("Decision queued. Anything else?")))).toBeNull();
    expect(noteForTurn(page(user("x"), say("Nothing needs you.")))).toBeNull();
  });
  it("the note says what to do and does not touch the reply", () => {
    expect(CHAT_QUESTION_NOTE).toMatch(/assistant_decision_add/);
    expect(CHAT_QUESTION_NOTE).toMatch(/chat is for status only/);
  });
});
