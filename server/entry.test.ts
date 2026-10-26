import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_QUESTION_NOTE } from "./ask-check";

type Handler = (input: any, ctx: any) => any;
const ASSISTANT = "assistant-agent";

/** Loads the real plugin entry against a fake server context, as the daemon does. */
async function load(opts: { promptHook: boolean }) {
  const dir = mkdtempSync(path.join(tmpdir(), "entry-"));
  writeFileSync(path.join(dir, "state.json"), JSON.stringify({ agentId: ASSISTANT, workspaceId: "ws" }));
  Object.assign(process.env, {
    PASEO_ASSISTANT_PORT: "0",
    ASSISTANT_STATE: path.join(dir, "state.json"),
    ASSISTANT_DECISIONS: path.join(dir, "d.json"),
    ASSISTANT_CAPABILITIES: path.join(dir, "c.json"),
    ASSISTANT_PENDING: path.join(dir, "p.json"),
    ASSISTANT_ITEMS: path.join(dir, "i.json"),
    ASSISTANT_SHIM_USAGE: path.join(dir, "u.json"),
    AGENTS_MAIL_ENDPOINT: path.join(dir, "none.json"),
  });
  const ons = new Map<string, Handler>();
  const befores = new Map<string, Handler>();
  const server: any = {
    registerSettings: () => ({ read: async () => ({ status: "ready", revision: "1", values: { provider: "claude/x", mailIncludeLabels: "", mailExcludeLabels: "" } }), subscribe: () => () => {} }),
    handle: () => {},
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
          refresh: async () => ({ agent: { status: "idle" } }),
          timeline: { refetch: async () => timeline },
          send: async (text: string) => void sent.push(text),
        }),
      },
    },
  };
  vi.resetModules();
  const { default: contribute } = await import("../index.server");
  const cleanup = contribute(server) as () => void;
  return { ons, befores, ctx, sent, setTimeline: (t: unknown) => (timeline = t), cleanup, dir };
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
