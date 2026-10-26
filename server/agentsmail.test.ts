import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentsMailClient, toMail } from "./agentsmail";
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
