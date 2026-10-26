import { describe, expect, it } from "vitest";
import { canSend, isSendKey } from "./keys";

describe("isSendKey", () => {
  it("Enter sends", () => expect(isSendKey({ key: "Enter" })).toBe(true));
  it("Shift+Enter is a newline, not a send", () => expect(isSendKey({ key: "Enter", shiftKey: true })).toBe(false));
  it("Enter that confirms an IME composition is not a send", () => expect(isSendKey({ key: "Enter", isComposing: true })).toBe(false));
  it("other keys never send", () => {
    for (const key of ["a", "Tab", "Escape", " ", "NumpadEnter"]) expect(isSendKey({ key })).toBe(false);
    expect(isSendKey({})).toBe(false);
  });
});

describe("canSend", () => {
  it("needs some text and no answer in flight", () => {
    expect(canSend("hello", false)).toBe(true);
    expect(canSend("  \n ", false)).toBe(false);
    expect(canSend("", false)).toBe(false);
    expect(canSend("hello", true)).toBe(false);
  });
});
