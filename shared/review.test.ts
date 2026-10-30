import { describe, expect, it } from "vitest";
import type { Item } from "./item";
import { buildTaskReviewPrompt } from "./review";

const item = (id: string, title: string, owner: Item["owner"], closed: Item["closed"] = null): Item => ({ id, title, owner, detail: null, link: null, addedAt: 0, updatedAt: 0, closed, status: "current", blockedOn: null, since: null, due: null });

describe("buildTaskReviewPrompt", () => {
  it("lists every open task, human items first, then agent items in order", () => {
    const prompt = buildTaskReviewPrompt([item("aaaaaaaa1111", "agent one", "agent"), item("bbbbbbbb2222", "human one", "human"), item("cccccccc3333", "agent two", "agent"), item("dddddddd4444", "human two", "human")]);
    const lines = prompt.split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toEqual(["- bbbbbbbb [human] human one", "- dddddddd [human] human two", "- aaaaaaaa [agent] agent one", "- cccccccc [agent] agent two"]);
    expect(prompt).toContain("Open tasks (4");
  });
  it("leaves closed tasks out", () => {
    const prompt = buildTaskReviewPrompt([item("aaaaaaaa1111", "open", "agent"), item("bbbbbbbb2222", "done", "agent", { at: 1, note: null })]);
    expect(prompt).toContain("aaaaaaaa");
    expect(prompt).not.toContain("bbbbbbbb");
  });
  it("says so when there are no open tasks", () => {
    const prompt = buildTaskReviewPrompt([]);
    expect(prompt).toContain("There are no open tasks.");
    expect(prompt).not.toContain("- ");
  });
  it("states the reply rules", () => {
    const prompt = buildTaskReviewPrompt([]);
    expect(prompt).toContain("Look over each current task");
    expect(prompt).toContain("Do not skip or merge tasks");
    expect(prompt).toContain("need the human or changed since the last review");
    expect(prompt).toContain('exactly one line: "nothing new"');
    expect(prompt).not.toContain("one line per task");
    expect(prompt).toContain("assistant_nudge_check");
  });
  it("still tells the Assistant to check every task", () => {
    expect(buildTaskReviewPrompt([item("aaaaaaaa1111", "a", "agent")])).toContain("Check every open task above");
  });
});
