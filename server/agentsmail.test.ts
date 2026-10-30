import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentsMailClient, toMail } from "./agentsmail";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "am-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("mail mapping", () => {
  it("gives the Assistant its mail shape", () => {
    expect(toMail({ id: "1", from: { type: "human", name: "Louis" }, subject: "s", body: "b", kind: "info", createdAt: 9, readAt: 10 })).toEqual({
      id: "1", agentId: "human", agentName: "Louis", subject: "s", body: "b", kind: "info", at: 9, read: true,
    });
  });
});
