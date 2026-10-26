import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentsMailClient, toMail } from "./agentsmail";
import { MailStore } from "./mailbox";
import { migrateLegacyMail } from "./migrate";
import { kindLabel } from "../client/mail-format";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "am-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("availability", () => {
  it("is not-installed without the endpoint file", async () => {
    expect(await new AgentsMailClient(path.join(dir, "none.json")).availability()).toEqual({ available: false, reason: "not-installed" });
  });
  it("is outdated for an old api version and unreachable when nothing listens", async () => {
    const file = path.join(dir, "e.json");
    writeFileSync(file, JSON.stringify({ url: "http://127.0.0.1:1", token: "t", apiVersion: 0 }));
    expect(await new AgentsMailClient(file).availability()).toEqual({ available: false, reason: "outdated" });
    writeFileSync(file, JSON.stringify({ url: "http://127.0.0.1:1", token: "t", apiVersion: 1 }));
    expect(await new AgentsMailClient(file).availability()).toEqual({ available: false, reason: "unreachable" });
  });
  it("is ok when the health call answers", async () => {
    const file = path.join(dir, "e.json");
    writeFileSync(file, JSON.stringify({ url: "http://x", token: "t", apiVersion: 1 }));
    const doFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;
    expect(await new AgentsMailClient(file, doFetch).availability()).toEqual({ available: true });
  });
});

describe("mail mapping", () => {
  it("gives the tab the Assistant's mail shape", () => {
    expect(toMail({ id: "1", from: { type: "human", name: "Louis" }, subject: "s", body: "b", kind: "info", createdAt: 9, readAt: 10 })).toEqual({
      id: "1", agentId: "human", agentName: "Louis", subject: "s", body: "b", kind: "info", at: 9, read: true,
    });
  });
  it("labels known kinds, the former kinds as Blocked, and shows unknown tags as sent", () => {
    expect(kindLabel("pr")).toBe("PR");
    expect(kindLabel("needs_louis")).toBe("Blocked");
    expect(kindLabel("weird")).toBe("weird");
  });
});

describe("migrateLegacyMail", () => {
  const file = () => path.join(dir, "mailbox.json");
  it("imports the old mailbox once and renames the file", async () => {
    const store = new MailStore(file());
    store.add({ agentId: "a1", agentName: "A", subject: "one", body: "b", kind: "start" });
    store.add({ agentId: "a2", agentName: "B", subject: "two", body: "b", kind: "done" });
    const importMails = vi.fn(async (m: unknown[]) => m.length);
    const client = { importMails } as unknown as AgentsMailClient;
    expect(await migrateLegacyMail(file(), client)).toBe(2);
    expect(importMails.mock.calls[0][0]).toHaveLength(2);
    expect(existsSync(file())).toBe(false);
    expect(existsSync(`${file()}.migrated`)).toBe(true);
    expect(await migrateLegacyMail(file(), client)).toBeNull();
  });
  it("folds the former needs_louis and needs_user kinds into blocked", async () => {
    const file = path.join(dir, "legacy.json");
    const base = { agentId: "a", agentName: "A", subject: "s", body: "", at: 1, read: false };
    writeFileSync(file, JSON.stringify([{ ...base, id: "1", kind: "needs_louis" }, { ...base, id: "2", kind: "needs_user" }, { ...base, id: "3", kind: "pr" }]));
    const importMails = vi.fn(async (m: unknown[]) => m.length);
    await migrateLegacyMail(file, { importMails } as unknown as AgentsMailClient);
    expect((importMails.mock.calls[0][0] as { kind: string }[]).map((m) => m.kind).sort()).toEqual(["blocked", "blocked", "pr"]);
  });
  it("keeps the file when Agents Mail is not there, so the next try imports it", async () => {
    new MailStore(file()).add({ agentId: "a1", agentName: "A", subject: "one", body: "b", kind: "start" });
    const client = { importMails: async () => { throw new Error("down"); } } as unknown as AgentsMailClient;
    await expect(migrateLegacyMail(file(), client)).rejects.toThrow("down");
    expect(existsSync(file())).toBe(true);
    expect(readFileSync(file(), "utf8")).toMatch(/one/);
  });
});
