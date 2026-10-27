import { describe, expect, it } from "vitest";
import { settingsSchema } from "../shared/settings";
import { SETTING_FIELDS, applyEdits, parseField } from "./settings";

describe("settings form", () => {
  it("defaults: heartbeat 15, review 30, idle 30, 1 per hour, escalate after 2", () => {
    expect(settingsSchema.parse({})).toMatchObject({ mailboxHeartbeatMinutes: 15, taskReviewMinutes: 30, nudgeIdleMinutes: 30, nudgeMaxPerHour: 1, nudgeEscalateAfter: 2 });
  });

  it("accepts 0 only for the task review (off)", () => {
    expect(parseField("taskReviewMinutes", "0")).toEqual({ value: 0 });
    expect(parseField("mailboxHeartbeatMinutes", "0")).toHaveProperty("error");
  });

  it("rejects text, decimals and out of range values", () => {
    for (const f of SETTING_FIELDS) {
      expect(parseField(f.key, "abc")).toHaveProperty("error");
      expect(parseField(f.key, "1.5")).toHaveProperty("error");
      expect(parseField(f.key, String(f.max + 1))).toHaveProperty("error");
    }
  });

  it("applies valid edits and reports the invalid ones without touching them", () => {
    const current = settingsSchema.parse({});
    const { values, errors } = applyEdits(current, { mailboxHeartbeatMinutes: " 5 ", nudgeMaxPerHour: "x" });
    expect(values.mailboxHeartbeatMinutes).toBe(5);
    expect(values.nudgeMaxPerHour).toBe(1);
    expect(Object.keys(errors)).toEqual(["nudgeMaxPerHour"]);
  });
});
