import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { Mail } from "../shared/mail";

export const ASSISTANT_MAILBOX = "alias:assistant";
const REQUIRED_API = 1;
const TIMEOUT_MS = 3_000;

/** A mail as the Agents Mail admin API returns it (only the fields the Assistant uses). */
interface RemoteMail {
  id: string;
  from: { type: string; agentId?: string; name: string };
  subject: string;
  body: string;
  kind: string;
  createdAt: number;
  readAt: number | null;
}

export const defaultEndpointFile = () => process.env.AGENTS_MAIL_ENDPOINT ?? path.join(process.env.PASEO_HOME ?? path.join(homedir(), ".paseo"), "agents-mail", "endpoint.json");

/** The Assistant's mail shape for a mail of Agents Mail. */
export const toMail = (m: RemoteMail): Mail => ({
  id: m.id,
  agentId: m.from.agentId ?? m.from.type,
  agentName: m.from.name,
  subject: m.subject,
  body: m.body,
  kind: m.kind,
  at: m.createdAt,
  read: m.readAt !== null,
});

export class AgentsMailError extends Error {
  constructor(readonly reason: "not-installed" | "unreachable" | "outdated" | "rejected", message: string) {
    super(message);
  }
}

/**
 * Talks to the Agents Mail plugin over its loopback admin API, found through `endpoint.json`. No code is shared
 * with that plugin: if the file is missing or nothing answers, Agents Mail is simply not installed.
 */
export class AgentsMailClient {
  constructor(
    private readonly endpointFile: string = defaultEndpointFile(),
    private readonly doFetch: typeof fetch = fetch,
  ) {}

  private endpoint(): { url: string; token: string; apiVersion: number } {
    let raw: { url?: unknown; token?: unknown; apiVersion?: unknown };
    try {
      raw = JSON.parse(readFileSync(this.endpointFile, "utf8"));
    } catch {
      throw new AgentsMailError("not-installed", "Agents Mail is not installed.");
    }
    if (typeof raw.url !== "string" || typeof raw.token !== "string") throw new AgentsMailError("not-installed", "Agents Mail is not installed.");
    const apiVersion = typeof raw.apiVersion === "number" ? raw.apiVersion : 0;
    if (apiVersion < REQUIRED_API) throw new AgentsMailError("outdated", "Agents Mail is too old; update it.");
    return { url: raw.url, token: raw.token, apiVersion };
  }

  private async call<T>(method: "GET" | "POST", route: string, body?: unknown): Promise<T> {
    const { url, token } = this.endpoint();
    let res: Response;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
      res = await this.doFetch(`${url}${route}`, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: abort.signal as never,
      });
    } catch {
      throw new AgentsMailError("unreachable", "Agents Mail does not answer.");
    } finally {
      clearTimeout(timer);
    }
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (res.status === 401 || res.status === 404) throw new AgentsMailError("unreachable", "Agents Mail refused the request; it may have restarted.");
    if (!res.ok) throw new AgentsMailError("rejected", json.error ?? `Agents Mail answered ${res.status}.`);
    return json;
  }

  /** The Assistant's mailbox: unread first, then newest first. */
  async list(o: { unreadOnly?: boolean } = {}): Promise<Mail[]> {
    const q = o.unreadOnly ? "?unreadOnly=true" : "";
    const { mails } = await this.call<{ mails: RemoteMail[] }>("GET", `/api/mailboxes/${encodeURIComponent(ASSISTANT_MAILBOX)}/mails${q}`);
    return mails.map(toMail);
  }

  async markRead(ids?: string[]): Promise<number> {
    return (await this.call<{ marked: number }>("POST", "/api/mails/read", { mailbox: ASSISTANT_MAILBOX, ids })).marked;
  }

  /** Mail on behalf of an agent that still uses the old `assistant_mail` tool. */
  async sendAsAgent(o: { agentId: string; name: string; subject: string; body: string; kind: string }): Promise<void> {
    await this.call("POST", "/api/mails", { to: "@assistant", subject: o.subject, body: o.body, kind: o.kind, asAgent: { agentId: o.agentId, name: o.name } });
  }
}
