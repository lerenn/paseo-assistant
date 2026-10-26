import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { decisionAnswerRpc, decisionListRpc, ensureRpc, mailListRpc, mailReadRpc, resetRpc } from "./shared/rpc";
import { DEFAULT_PROVIDER, assistantSettings, settingsSchema } from "./shared/settings";
import { MailHttp } from "./server/http";
import { CAPABILITY_ENV, createContext, injectMail, parseLabelRules, shouldInject } from "./server/inject";
import { DecisionStore, decisionNudge } from "./server/decisions";
import { MailStore } from "./server/mailbox";
import { McpServer } from "./server/mcp";
import { AssistantSession, StateFile, dataDir, type AssistantPaseo } from "./server/session";
import { CapabilityStore } from "./server/tokens";
import { mailTools, toolNames } from "./server/tools";

const DEFAULT_PORT = 47842;

type Settings = ReturnType<typeof settingsSchema.parse>;

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(assistantSettings);
  let latest: Settings = settingsSchema.parse({});
  const apply = (state: Awaited<ReturnType<typeof settings.read>>) => {
    latest = state.status === "ready" ? state.values : settingsSchema.parse({});
  };
  const ready = settings.read().then(apply);
  const unsubscribeSettings = settings.subscribe(apply);

  const mailbox = new MailStore(process.env.ASSISTANT_MAILBOX ?? join(dataDir, "mailbox.json"));
  const decisions = new DecisionStore(process.env.ASSISTANT_DECISIONS ?? join(dataDir, "decisions.json"));
  const tokens = new CapabilityStore(process.env.ASSISTANT_CAPABILITIES ?? join(dataDir, "capabilities.json"));

  // The Paseo API only reaches a plugin through hook and RPC contexts; keep the first one seen.
  let paseo: AssistantPaseo | null = null;
  const capture = (ctx: { paseo: unknown } | undefined) => {
    if (ctx?.paseo && !paseo) paseo = ctx.paseo as AssistantPaseo;
  };

  const session = new AssistantSession(
    new StateFile(process.env.ASSISTANT_STATE ?? undefined),
    () => latest.provider ?? DEFAULT_PROVIDER,
    undefined,
    async () => {
      await started;
      if (!url) return null;
      return { url, token: tokens.assistantToken() ?? tokens.create({ role: "assistant" }) };
    },
  );

  /** Messages the Assistant now: "steer" joins a running turn and starts one when it is idle. */
  const nudge = (text: string): Promise<void> => {
    const assistantId = session.currentAgentId();
    const send = assistantId && paseo ? paseo.agents.ref(assistantId).send : undefined;
    if (!assistantId || !paseo || !send) return Promise.resolve();
    return send.call(paseo.agents.ref(assistantId), text, { activeTurnBehavior: "steer" }).then(
      () => undefined,
      (error) => console.error("assistant: could not message the Assistant", error),
    );
  };

  const http = new MailHttp({
    tokens,
    mcp: new McpServer(mailTools),
    context: () => ({
      mailbox,
      decisions,
      nameOf: async (agentId, hint) => {
        if (hint) return hint;
        try {
          const snapshot = (await paseo?.agents.ref(agentId).refresh()) as { title?: string | null } | null | undefined;
          return snapshot?.title || agentId;
        } catch {
          return agentId;
        }
      },
      onMail: (mail) => {
        if (mail.kind !== "needs_louis") return;
        nudge(`A needs_louis mail arrived from ${mail.agentName}: "${mail.subject}". Read the mailbox and surface it now.`);
      },
    }),
  });
  let url: string | null = null;
  const port = Number(process.env.PASEO_ASSISTANT_PORT ?? DEFAULT_PORT);
  const started = http.start(port).then(
    (u) => {
      url = u;
    },
    (err: Error) => {
      console.error(`assistant: mailbox cannot listen on 127.0.0.1:${port}: ${err.message}. Set PASEO_ASSISTANT_PORT on the daemon.`);
    },
  );

  server.handle(ensureRpc, async (_input, ctx) => {
    capture(ctx);
    await ready;
    return session.ensure(ctx.paseo as unknown as AssistantPaseo);
  });
  server.handle(resetRpc, async (_input, ctx) => {
    capture(ctx);
    await ready;
    return session.reset(ctx.paseo as unknown as AssistantPaseo);
  });
  server.handle(mailListRpc, async () => ({ mails: mailbox.list() }));
  server.handle(decisionListRpc, async () => ({ decisions: decisions.list() }));
  server.handle(decisionAnswerRpc, async (input, ctx) => {
    capture(ctx);
    const decision = decisions.answer(input.id, input.answer, input.other);
    await nudge(decisionNudge(decision));
    return { decision };
  });
  server.handle(mailReadRpc, async (input) => ({ marked: mailbox.markRead(input.ids) }));

  const removeCreate = server.before("agent.create", async ({ request }, ctx) => {
    capture(ctx);
    // Daemons without the create context give no labels or parent: inject nothing rather than everywhere.
    const agent = createContext(request);
    if (!agent) return;
    await ready;
    const rules = { include: parseLabelRules(latest.mailIncludeLabels), exclude: parseLabelRules(latest.mailExcludeLabels) };
    if (!shouldInject(agent, rules)) return;
    await started;
    // Without the endpoint the agent just does not get the tool; creating it must not fail.
    if (!url) return;
    const capability = tokens.create({ role: "agent", name: request.config.title ?? undefined });
    return injectMail(request, { url, capability, tools: toolNames("agent") });
  });
  const removeOpen = server.before("agent.session_open", ({ request }, ctx) => {
    capture(ctx);
    const capability = request.env[CAPABILITY_ENV];
    if (capability) tokens.bind(capability, request.agentId);
  });
  const removeArchived = server.on("agent.archived", ({ agent }, ctx) => {
    capture(ctx);
    tokens.revokeAgent(agent.id);
    return session
      .onAgentArchived(ctx.paseo as unknown as AssistantPaseo, agent.id)
      .catch((error) => console.error("assistant: recreate failed", error));
  });

  return () => {
    removeCreate();
    removeOpen();
    removeArchived();
    unsubscribeSettings();
    void http.stop();
  };
}
