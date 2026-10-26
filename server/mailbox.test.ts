import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MailStore } from "./mailbox";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mailbox-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const mail = (subject: string) => ({ agentId: "a1", agentName: "Agent", subject, body: "b", kind: "start" as const });

describe("MailStore", () => {
  it("lists unread first, then newest first", () => {
    let t = 0;
    const store = new MailStore(path.join(dir, "m.json"), () => ++t);
    const first = store.add(mail("first"));
    store.add(mail("second"));
    store.add(mail("third"));
    store.markRead([first.id]);
    expect(store.list().map((m) => m.subject)).toEqual(["third", "second", "first"]);
    store.markRead([store.list()[0].id]);
    expect(store.list().map((m) => m.subject)).toEqual(["second", "third", "first"]);
  });

  it("filters unread and marks all read when no ids are given", () => {
    const store = new MailStore(path.join(dir, "m.json"));
    store.add(mail("one"));
    store.add(mail("two"));
    expect(store.list({ unreadOnly: true })).toHaveLength(2);
    expect(store.markRead()).toBe(2);
    expect(store.markRead()).toBe(0);
    expect(store.list({ unreadOnly: true })).toHaveLength(0);
  });

  it("persists across instances and ignores a corrupt file", () => {
    const file = path.join(dir, "m.json");
    new MailStore(file).add(mail("kept"));
    expect(new MailStore(file).list().map((m) => m.subject)).toEqual(["kept"]);
    const empty = path.join(dir, "bad.json");
    new MailStore(empty).add(mail("x"));
    writeFileSync(empty, "{nope");
    expect(new MailStore(empty).list()).toEqual([]);
  });

  it("keeps only the latest 1000 mails", () => {
    const store = new MailStore(path.join(dir, "m.json"));
    for (let i = 0; i < 1005; i++) store.add(mail(`m${i}`));
    const all = store.list();
    expect(all).toHaveLength(1000);
    expect(all.some((m) => m.subject === "m0")).toBe(false);
  });
});

describe("legacy kinds", () => {
  it("shows stored needs_louis and needs_user mails as blocked", () => {
    const file = path.join(dir, "legacy.json");
    const base = { agentId: "a", agentName: "A", subject: "s", body: "", at: 1, read: false };
    writeFileSync(file, JSON.stringify([{ ...base, id: "1", kind: "needs_louis" }, { ...base, id: "2", kind: "needs_user" }]));
    expect(new MailStore(file).list().map((m) => m.kind).sort()).toEqual(["blocked", "blocked"]);
  });
});
