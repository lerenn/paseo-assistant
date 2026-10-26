import type { PluginBeforeRequests } from "@getpaseo/plugin/server";

type CreateRequest = PluginBeforeRequests["agent.create"];

export const SERVER_NAME = "assistant";
export const CAPABILITY_ENV = "PASEO_ASSISTANT_CAPABILITY";
/** The Assistant itself: it reads the mailbox, so it never gets the sender instruction. */
export const ASSISTANT_LABEL = ["paseo.assistant", "1"] as const;

export const MAIL_INSTRUCTION = `Mail the Assistant with the assistant_mail tool (subject, body, kind) only at milestones: start, blocked, needs the user, PR opened or merged, done. Not at every step. kind is one of start | blocked | needs_user | pr | done. Keep the subject to one line and the body to a few lines.`;

export interface LabelRule {
  key: string;
  /** `*` accepts any value. */
  value: string;
}

/** `a=1, b=*` or one rule per line; a bare key means any value. */
export function parseLabelRules(text: string): LabelRule[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf("=");
      return i < 0 ? { key: s, value: "*" } : { key: s.slice(0, i).trim(), value: s.slice(i + 1).trim() || "*" };
    });
}

const matches = (labels: Record<string, string>, rules: LabelRule[]) =>
  rules.some((r) => (r.value === "*" ? r.key in labels : labels[r.key] === r.value));

/**
 * Whether a new agent gets the mail tool and instruction. Subagents never do. Otherwise an include
 * rule wins over an exclude rule, and an agent matching neither is included.
 */
export function shouldInject(
  agent: { labels: Record<string, string>; parentAgentId: string | null },
  rules: { include: LabelRule[]; exclude: LabelRule[] },
): boolean {
  if (agent.parentAgentId) return false;
  if (agent.labels[ASSISTANT_LABEL[0]] === ASSISTANT_LABEL[1]) return false;
  if (matches(agent.labels, rules.include)) return true;
  return !matches(agent.labels, rules.exclude);
}

/** `labels` and `parentAgentId` come from daemons with the create context; older ones lack them. */
export function createContext(request: CreateRequest): { labels: Record<string, string>; parentAgentId: string | null } | null {
  const r = request as CreateRequest & { labels?: Record<string, string>; parentAgentId?: string | null };
  if (r.labels === undefined || r.parentAgentId === undefined) return null;
  return { labels: r.labels, parentAgentId: r.parentAgentId };
}

/** Gives a new agent the mailbox tool and the milestone-only instruction. */
export function injectMail(request: CreateRequest, o: { url: string; capability: string; tools: string[] }): CreateRequest {
  const prompt = request.config.systemPrompt;
  return {
    ...request,
    config: {
      ...request.config,
      systemPrompt: prompt ? `${prompt}\n\n${MAIL_INSTRUCTION}` : MAIL_INSTRUCTION,
      mcpServers: {
        ...(request.config.mcpServers ?? {}),
        [SERVER_NAME]: { type: "http", url: `${o.url}/mcp`, headers: { authorization: `Bearer ${o.capability}` }, alwaysLoad: true },
      },
      toolPolicy: {
        preapproved: [
          ...(request.config.toolPolicy?.preapproved ?? []),
          ...o.tools.map((tool) => ({ kind: "mcp" as const, server: SERVER_NAME, tool })),
        ],
      },
    },
    env: { ...(request.env ?? {}), [CAPABILITY_ENV]: o.capability },
  };
}
