import { describe, expect, it } from "vitest";
import type { Item } from "../shared/item";
import { metaLine, stampLine } from "./task-detail";

const item = (o: Partial<Item> = {}): Item => ({ id: "abcdef123456", title: "t", owner: "agent", addedAt: 1_000, ...o }) as Item;

describe("metaLine", () => {
  it("is null with nothing to say", () => {
    expect(metaLine(item())).toBeNull();
  });
  it("joins blockedOn, since and due", () => {
    const since = 2_000;
    expect(metaLine(item({ blockedOn: "Louis", since, due: "2026-11-01" }))).toBe(`on Louis · since ${new Date(since).toLocaleString()} · due 2026-11-01`);
  });
  it("omits since once closed", () => {
    expect(metaLine(item({ since: 2_000, due: "2026-11-01", closed: { at: 3_000, note: null } }))).toBe("due 2026-11-01");
  });
});

describe("stampLine", () => {
  it("says since when it was added", () => {
    expect(stampLine(item())).toBe(`since ${new Date(1_000).toLocaleString()}`);
  });
  it("says when it was closed, with the note", () => {
    expect(stampLine(item({ closed: { at: 3_000, note: "shipped" } }))).toBe(`closed ${new Date(3_000).toLocaleString()} · shipped`);
  });
});
