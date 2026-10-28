import { describe, expect, it } from "vitest";
import { itemSchema, type Item } from "../shared/item";
import { groupTasks, TASK_GROUPS } from "./groups";

const NOW = 100 * 3_600_000;
const make = (o: Record<string, unknown>): Item =>
  itemSchema.parse({ id: String(Math.random()), title: "t", owner: "agent", detail: null, link: null, addedAt: 1, updatedAt: 1, closed: null, ...o });

describe("groupTasks", () => {
  it("groups agent items by status in the display order and drops empty groups", () => {
    const groups = groupTasks([make({ status: "blocked" }), make({}), make({ status: "future" }), make({ status: "recurring" }), make({ status: "waiting" })], NOW);
    expect(groups.map((g) => g.status)).toEqual(["current", "waiting", "blocked", "future", "recurring"]);
  });

  it("puts items saved without a status in Current and leaves out human items", () => {
    const old = itemSchema.parse({ id: "x", title: "old", detail: null, link: null, addedAt: 1, updatedAt: 1, closed: null });
    const groups = groupTasks([old, make({ owner: "human" })], NOW);
    expect(groups.map((g) => [g.status, g.items.length])).toEqual([["current", 1]]);
  });

  it("keeps closed items in Done for 24 hours only, and Done starts collapsed", () => {
    const fresh = make({ title: "fresh", closed: { at: NOW - 3_600_000, note: null } });
    const old = make({ title: "old", closed: { at: NOW - 25 * 3_600_000, note: null } });
    const done = groupTasks([fresh, old], NOW);
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ status: "done", collapsed: true });
    expect(done[0].items.map((i) => i.title)).toEqual(["fresh"]);
    expect(TASK_GROUPS.filter((g) => g.collapsed).map((g) => g.status)).toEqual(["done"]);
  });
});
