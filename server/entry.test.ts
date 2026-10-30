import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_QUESTION_NOTE } from "./ask-check";

type Handler = (input: any, ctx: any) => any;
const ASSISTANT = "assistant-agent";

/** Loads the real plugin entry against a fake server context, as the daemon does. */
async function load(opts: { promptHook: boolean; status?: () => string; seed?: (dir: string) => void }) {
  const dir = mkdtempSync(path.join(tmpdir(), "entry-"));
  opts.seed?.(dir);
  writeFileSync(path.join(dir, "state.json"), JSON.stringify({ agentId: ASSISTANT, workspaceId: "ws" }));
  Object.assign(process.env, {
    PASEO_ASSISTANT_PORT: "0",
    ASSISTANT_STATE: path.join(dir, "state.json"),
    ASSISTANT_DECISIONS: path.join(dir, "d.json"),
    ASSISTANT_CAPABILITIES: path.join(dir, "c.json"),
    ASSISTANT_PENDING: path.join(dir, "p.json"),
    ASSISTANT_ITEMS: path.join(dir, "i.json"),
    ASSISTANT_ITEM_NOTES: path.join(dir, "n.json"),
    ASSISTANT_SHIM_USAGE: path.join(dir, "u.json"),
    AGENTS_MAIL_ENDPOINT: path.join(dir, "none.json"),
  });
  const ons = new Map<string, Handler>();
  const befores = new Map<string, Handler>();
  const handlers = new Map<string, Handler>();
  const server: any = {
    registerSettings: () => ({ read: async () => ({ status: "ready", revision: "1", values: { provider: "claude/x", mailIncludeLabels: "", mailExcludeLabels: "" } }), subscribe: () => () => {} }),
    handle: (rpc: { name: string }, h: Handler) => void handlers.set(rpc.name, h),
    on: (name: string, h: Handler) => (ons.set(name, h), () => {}),
    before: (name: string, h: Handler) => {
      if (name === "agent.prompt" && !opts.promptHook) throw new Error("unknown hook");
      befores.set(name, h);
      return () => {};
    },
  };
  const sent: string[] = [];
  let timeline: unknown = { entries: [] };
  const ctx = {
    paseo: {
      agents: {
        ref: () => ({
          refresh: async () => ({ agent: { status: opts.status?.() ?? "idle" } }),
          timeline: { refetch: async () => timeline },
          send: async (text: string) => void sent.push(text),
        }),
      },
    },
  };
  vi.resetModules();
  const { default: contribute } = await import("../index.server");
  const cleanup = contribute(server) as () => void;
  return { ons, befores, handlers, ctx, sent, setTimeline: (t: unknown) => (timeline = t), cleanup, dir };
}

const turn = (...items: Record<string, unknown>[]) => ({ entries: items.map((item) => ({ item })) });
const ended = { agent: { id: ASSISTANT }, outcome: { kind: "completed" } };
const settle = () => new Promise((r) => setTimeout(r, 20));
const prompt = (o: Record<string, unknown> = {}) => ({ agentId: ASSISTANT, prompt: "hi", ...o });

let live: Awaited<ReturnType<typeof load>>;
afterEach(() => {
  live?.cleanup();
  rmSync(live?.dir ?? "", { recursive: true, force: true });
  vi.useRealTimers();
});

describe("chat-question check (prompt hook present)", () => {
  beforeEach(async () => {
    live = await load({ promptHook: true });
    // The hook fires once for any prompt: that is how the plugin learns the host has it.
    live.befores.get("agent.prompt")!({ request: prompt({ agentId: "someone" }) }, live.ctx);
  });

  it("puts a note in front of the Assistant's next prompt, once, when it asked in chat and queued nothing", async () => {
    live.setTimeline(turn({ type: "user_message", text: "status" }, { type: "assistant_message", text: "All quiet.\n\nShould I archive the helpers?" }));
    live.ons.get("agent.turn_ended")!(ended, live.ctx);
    await settle();
    expect(live.sent).toEqual([]); // nothing is sent: the reply and the turn are untouched
    const hook = live.befores.get("agent.prompt")!;
    const out = hook({ request: prompt({ prepend: "from another plugin" }) }, live.ctx);
    expect(out.prepend).toBe(`from another plugin\n\n${CHAT_QUESTION_NOTE}`);
    expect(out.prompt).toBe("hi");
    expect(hook({ request: prompt() }, live.ctx)).toBeUndefined(); // once
  });

  it("is silent when a decision was queued in the turn, for plain status, for other agents' prompts, and after a failed turn", async () => {
    live.setTimeline(turn({ type: "user_message", text: "x" }, { type: "tool_call", name: "mcp__assistant__assistant_decision_add" }, { type: "assistant_message", text: "Queued. Anything else?" }));
    live.ons.get("agent.turn_ended")!(ended, live.ctx);
    live.setTimeline(turn({ type: "user_message", text: "x" }, { type: "assistant_message", text: "Nothing needs you." }));
    live.ons.get("agent.turn_ended")!(ended, live.ctx);
    live.setTimeline(turn({ type: "user_message", text: "x" }, { type: "assistant_message", text: "Ok?" }));
    live.ons.get("agent.turn_ended")!({ agent: { id: "other" }, outcome: { kind: "completed" } }, live.ctx);
    live.ons.get("agent.turn_ended")!({ agent: { id: ASSISTANT }, outcome: { kind: "failed", error: { message: "x" } } }, live.ctx);
    await settle();
    expect(live.befores.get("agent.prompt")!({ request: prompt() }, live.ctx)).toBeUndefined();
  });

  it("does not add the note to another agent's prompt", async () => {
    live.setTimeline(turn({ type: "user_message", text: "x" }, { type: "assistant_message", text: "Which one?" }));
    live.ons.get("agent.turn_ended")!(ended, live.ctx);
    await settle();
    expect(live.befores.get("agent.prompt")!({ request: prompt({ agentId: "someone-else" }) }, live.ctx)).toBeUndefined();
    expect(live.befores.get("agent.prompt")!({ request: prompt() }, live.ctx).prepend).toBe(CHAT_QUESTION_NOTE);
  });
});

describe("chat-question check (no prompt hook on the host)", () => {
  it("sends the note as a steered message, to an idle Assistant only", async () => {
    live = await load({ promptHook: false });
    live.setTimeline(turn({ type: "user_message", text: "x" }, { type: "assistant_message", text: "Do you want me to proceed?" }));
    live.ons.get("agent.turn_ended")!(ended, live.ctx);
    await settle();
    expect(live.sent).toEqual([CHAT_QUESTION_NOTE]);
  });
});

describe("Done on a Your Actions card", () => {
  const ID = "0123abcd-1111-2222-3333-444455556666";
  const loadWithItem = (opts: { status?: () => string; item?: Record<string, unknown> } = {}) =>
    load({
      promptHook: true,
      status: opts.status,
      seed: (dir) =>
        writeFileSync(path.join(dir, "i.json"), JSON.stringify([{ id: ID, title: "Rotate the key", owner: "human", detail: null, link: null, addedAt: 1, updatedAt: 1, closed: null, ...opts.item }])),
    });

  it("queues one message with the short id and title, and leaves the item open", async () => {
    vi.useFakeTimers();
    live = await loadWithItem();
    const done = live.handlers.get("assistant.item.done")!;
    expect(await done({ id: ID }, live.ctx)).toEqual({ duplicate: false });
    expect(await done({ id: ID }, live.ctx)).toEqual({ duplicate: true });
    await vi.advanceTimersByTimeAsync(6_000);
    expect(live.sent).toHaveLength(1);
    expect(live.sent[0]).toContain("Louis marked an action done (id 0123abcd): Rotate the key");
    const { items } = await live.handlers.get("assistant.item.list")!({}, live.ctx);
    expect(items[0].closed).toBeNull();
  });

  it("waits for the running turn to end instead of steering it, and carries the More… text", async () => {
    vi.useFakeTimers();
    let status = "running";
    live = await loadWithItem({ status: () => status });
    await live.handlers.get("assistant.item.done")!({ id: ID, text: "revoked the old one" }, live.ctx);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(live.sent).toEqual([]);
    status = "idle";
    live.ons.get("agent.turn_ended")!(ended, live.ctx);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(live.sent).toHaveLength(1);
    expect(live.sent[0]).toContain("Note from Louis: revoked the old one");
  });

  it("refuses an unknown or closed item", async () => {
    live = await loadWithItem({ item: { closed: { at: 2, note: null } } });
    const done = live.handlers.get("assistant.item.done")!;
    await expect(done({ id: ID }, live.ctx)).rejects.toThrow(/already closed/);
    await expect(done({ id: "nope" }, live.ctx)).rejects.toThrow(/Unknown item/);
  });
});
