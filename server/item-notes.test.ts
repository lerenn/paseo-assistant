import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ItemNoteStore, NOTE_PREFIX, isNoteId, itemNoteNudge } from "./item-notes";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "item-notes-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const ITEM = "0123abcd-1111-2222-3333-444455556666";

describe("ItemNoteStore", () => {
  it("records a note with a prefixed id, apart from decision ids", () => {
    const store = new ItemNoteStore(path.join(dir, "n.json"), () => 42);
    const { note, duplicate } = store.add({ itemId: ITEM, title: "Rotate the key", text: "  " });
    expect(duplicate).toBe(false);
    expect(note).toMatchObject({ itemId: ITEM, title: "Rotate the key", text: null, at: 42, deliveredAt: null });
    expect(note.id.startsWith(NOTE_PREFIX)).toBe(true);
    expect(isNoteId(note.id)).toBe(true);
    expect(isNoteId("6f1c2d3e-0000-0000-0000-000000000000")).toBe(false);
  });

  it("returns the waiting note on a double click instead of adding a second one", () => {
    const store = new ItemNoteStore(path.join(dir, "n.json"));
    const first = store.add({ itemId: ITEM, title: "T" });
    const again = store.add({ itemId: ITEM, title: "T" });
    expect(again).toEqual({ note: first.note, duplicate: true });
    // A different text is a different note.
    expect(store.add({ itemId: ITEM, title: "T", text: "done on prod too" }).duplicate).toBe(false);
  });

  it("accepts the same note again once the first was delivered", () => {
    const store = new ItemNoteStore(path.join(dir, "n.json"), () => 7);
    const first = store.add({ itemId: ITEM, title: "T" });
    store.markDelivered([first.note.id]);
    expect(store.get(first.note.id)?.deliveredAt).toBe(7);
    const second = store.add({ itemId: ITEM, title: "T" });
    expect(second.duplicate).toBe(false);
    expect(second.note.id).not.toBe(first.note.id);
  });

  it("persists across instances", () => {
    const file = path.join(dir, "n.json");
    const { note } = new ItemNoteStore(file).add({ itemId: ITEM, title: "T", text: "x" });
    const reopened = new ItemNoteStore(file);
    expect(reopened.get(note.id)).toEqual(note);
    expect(reopened.add({ itemId: ITEM, title: "T", text: "x" }).duplicate).toBe(true);
  });
});

describe("itemNoteNudge", () => {
  it("gives the short id and title, says it was marked done, and leaves the closing to the Assistant", () => {
    const store = new ItemNoteStore(path.join(dir, "n.json"));
    const text = itemNoteNudge(store.add({ itemId: ITEM, title: "Rotate the key" }).note);
    expect(text).toContain("Louis marked an action done (id 0123abcd): Rotate the key");
    expect(text).toContain("assistant_item_close");
    expect(text).not.toContain("Note from Louis");
  });

  it("adds the text typed in More…", () => {
    const store = new ItemNoteStore(path.join(dir, "n.json"));
    expect(itemNoteNudge(store.add({ itemId: ITEM, title: "T", text: "rotated in Vault, old key revoked" }).note)).toContain("Note from Louis: rotated in Vault, old key revoked");
  });
});
