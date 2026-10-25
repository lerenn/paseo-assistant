import { describe, expect, it } from "vitest";
import { CAPABILITY_ENV, MAIL_INSTRUCTION, createContext, injectMail, parseLabelRules, shouldInject } from "./inject";

const rules = (include: string, exclude: string) => ({ include: parseLabelRules(include), exclude: parseLabelRules(exclude) });
const factoryRules = rules("paseo.factory.supervisor=1", "paseo.factory=1");

describe("parseLabelRules", () => {
  it("reads key=value, bare keys and mixed separators", () => {
    expect(parseLabelRules("a=1, b\nc=*,, ")).toEqual([
      { key: "a", value: "1" },
      { key: "b", value: "*" },
      { key: "c", value: "*" },
    ]);
    expect(parseLabelRules("")).toEqual([]);
  });
});

describe("shouldInject", () => {
  const top = (labels: Record<string, string>) => ({ labels, parentAgentId: null });
  it("includes plain top-level agents", () => {
    expect(shouldInject(top({}), factoryRules)).toBe(true);
  });
  it("never includes subagents, even when an include rule matches", () => {
    expect(shouldInject({ labels: { "paseo.factory.supervisor": "1" }, parentAgentId: "p" }, factoryRules)).toBe(false);
  });
  it("excludes by label and lets include win", () => {
    expect(shouldInject(top({ "paseo.factory": "1" }), factoryRules)).toBe(false);
    expect(shouldInject(top({ "paseo.factory": "1", "paseo.factory.supervisor": "1" }), factoryRules)).toBe(true);
  });
  it("compares values unless the rule is a wildcard", () => {
    expect(shouldInject(top({ "paseo.factory": "0" }), factoryRules)).toBe(true);
    expect(shouldInject(top({ team: "x" }), rules("", "team"))).toBe(false);
  });
  it("never includes the Assistant itself", () => {
    expect(shouldInject(top({ "paseo.assistant": "1" }), rules("paseo.assistant=1", ""))).toBe(false);
  });
});

describe("createContext", () => {
  const config = { provider: "claude", cwd: "/w" } as never;
  it("is null on a daemon without the create context", () => {
    expect(createContext({ config })).toBeNull();
  });
  it("reads labels and parent when present", () => {
    expect(createContext({ config, labels: { a: "1" }, parentAgentId: null } as never)).toEqual({ labels: { a: "1" }, parentAgentId: null });
  });
});

describe("injectMail", () => {
  it("adds the server, preapproval, instruction and capability env, keeping what was there", () => {
    const out = injectMail(
      { config: { provider: "claude", cwd: "/w", systemPrompt: "Base.", mcpServers: { x: { type: "http", url: "u" } } } as never, env: { A: "1" } },
      { url: "http://127.0.0.1:1", capability: "tok", tools: ["assistant_mail"] },
    );
    expect(out.config.systemPrompt).toBe(`Base.\n\n${MAIL_INSTRUCTION}`);
    expect(Object.keys(out.config.mcpServers ?? {})).toEqual(["x", "assistant"]);
    expect(out.config.toolPolicy?.preapproved).toEqual([{ kind: "mcp", server: "assistant", tool: "assistant_mail" }]);
    expect(out.env).toEqual({ A: "1", [CAPABILITY_ENV]: "tok" });
  });
  it("uses the instruction alone when there is no system prompt", () => {
    const out = injectMail({ config: { provider: "claude", cwd: "/w" } as never }, { url: "u", capability: "t", tools: [] });
    expect(out.config.systemPrompt).toBe(MAIL_INSTRUCTION);
  });
});
