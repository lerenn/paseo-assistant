import { describe, expect, it } from "vitest";
import type { Mail } from "../shared/mail";
import { countBadge, unreadBadge } from "./mail-format";

const mail = (read: boolean): Mail => ({ id: String(Math.random()), agentId: "a", agentName: "A", subject: "s", body: "", kind: "done", at: 0, read });

describe("unreadBadge", () => {
  it("is empty when all are read, the count otherwise, capped at 99+", () => {
    expect(unreadBadge([])).toBe("");
    expect(unreadBadge([mail(true)])).toBe("");
    expect(unreadBadge([mail(false), mail(true), mail(false)])).toBe("2");
    expect(unreadBadge(Array.from({ length: 100 }, () => mail(false)))).toBe("99+");
  });
});

describe("countBadge", () => {
  it("is empty at zero and capped at 99+", () => {
    expect(countBadge(0)).toBe("");
    expect(countBadge(3)).toBe("3");
    expect(countBadge(100)).toBe("99+");
  });
});
