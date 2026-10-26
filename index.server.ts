import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { decisionCancelRpc, decisionAnswerRpc, currentRpc, shimsRpc, decisionListRpc, ensureRpc, itemListRpc, mailListRpc, mailReadRpc, resetRpc } from "./shared/rpc";
import { DEFAULT_PROVIDER, assistantSettings, settingsSchema } from "./shared/settings";
import { MailHttp } from "./server/http";
import { DecisionStore, cancelNudge, decisionNudge } from "./server/decisions";
import { ItemStore } from "./server/items";
import { AgentsMailClient, AgentsMailError } from "./server/agentsmail";
import { migrateLegacyMail } from "./server/migrate";
import { ShimUsageStore, describeReport, shimReport } from "./server/shims";
import { Delivery, PendingDeliveries, dropStaleOnce, statusOf, titleOf } from "./server/delivery";
import { McpServer } from "./server/mcp";
import { AssistantSession, StateFile, dataDir, type AssistantPaseo } from "./server/session";
import { CAPABILITY_ENV, CapabilityStore } from "./server/tokens";
import { mailTools } from "./server/tools";

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

  // Mail lives in the Agents Mail plugin; the old mailbox file is imported there once.
  const agentsMail = new AgentsMailClient();
  const legacyMailbox = process.env.ASSISTANT_MAILBOX ?? join(dataDir, "mailbox.json");
  let lastMigrationTry = 0;
  const migrate = async (): Promise<void> => {
    if (Date.now() - lastMigrationTry < 30_000) return;
    lastMigrationTry = Date.now();
    try {
      const n = await migrateLegacyMail(legacyMailbox, agentsMail);
      if (n !== null) console.log(`assistant: moved ${n} mails to Agents Mail`);
    } catch (error) {
      // Not installed yet, or not answering: the file stays and the next list tries again.
      if (!(error instanceof AgentsMailError)) console.error("assistant: mail import failed", error);
    }
  };
  void migrate();
  const shimUsage = new ShimUsageStore(process.env.ASSISTANT_SHIM_USAGE ?? join(dataDir, "shim-usage.json"));
  const items = new ItemStore(process.env.ASSISTANT_ITEMS ?? join(dataDir, "items.json"));
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

  /** Messages the Assistant; "steer" starts a turn on an idle agent. Callers check that it is idle first. Rejects when it cannot send. */
  const nudge = async (text: string): Promise<void> => {
    const assistantId = session.currentAgentId();
    const send = assistantId && paseo ? paseo.agents.ref(assistantId).send : undefined;
    if (!assistantId || !paseo || !send) throw new Error("the Assistant is not reachable yet");
    await send.call(paseo.agents.ref(assistantId), text, { activeTurnBehavior: "steer" });
  };

  const pendingQueue = new PendingDeliveries(process.env.ASSISTANT_PENDING ?? join(dataDir, "pending-deliveries.json"));

  /** New mail and answered decisions reach the Assistant only when it is idle; see Delivery. */
  const delivery = new Delivery({
    queue: pendingQueue,
    delivered: (ids) => decisions.markDelivered(ids),
    status: async () => {
      const assistantId = session.currentAgentId();
      if (!assistantId || !paseo) return null;
      return statusOf(await paseo.agents.ref(assistantId).refresh());
    },
    decisionText: (id) => {
      const decision = decisions.list().find((d) => d.id === id);
      if (!decision) return null;
      return decision.cancelledAt !== null ? cancelNudge(decision) : decision.answer ? decisionNudge(decision) : null;
    },
    send: nudge,
  });

  // Answers queued before a restart are delivered once the Assistant is reachable and idle.
  const pendingFile = process.env.ASSISTANT_PENDING ?? join(dataDir, "pending-deliveries.json");
  const dropped = dropStaleOnce(pendingQueue, `${pendingFile}.cleared-v1`);
  if (dropped.length) {
    decisions.markDelivered(dropped);
    console.log(`assistant: dropped ${dropped.length} stale queued answers (already handled)`);
  }
  delivery.poke();

  const http = new MailHttp({
    tokens,
    mcp: new McpServer(mailTools),
    context: () => ({
      agentsMail,
      decisions,
      items,
      shimUsed: (tool) => shimUsage.record(tool),
      paseo: () => paseo as unknown as import("./server/manage").ManagePaseo | null,
      renew: async (input) => {
        if (!paseo) throw new Error("The Paseo API is not available yet; try again in a moment.");
        return session.renew(paseo, input);
      },
      nameOf: async (agentId, hint) => {
        if (hint) return hint;
        try {
          return titleOf(await paseo?.agents.ref(agentId).refresh()) ?? agentId;
        } catch {
          return agentId;
        }
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
  /** Who still holds the old mail tool; the answer to "can the forwarders go". */
  const reportShims = async () => {
    if (!paseo) return null;
    const { entries } = await (paseo as unknown as import("./server/manage").ManagePaseo).agents.list({ filter: { includeArchived: false } });
    const live = (entries as { agent: { id: string } }[]).map((e) => e.agent.id);
    return shimReport(tokens.agentIds(), live, shimUsage.read());
  };
  const logShims = () =>
    void reportShims().then(
      (r) => r && console.log(`assistant: ${describeReport(r)}`),
      (error) => console.error("assistant: shim report failed", error),
    );
  const shimTimer = setInterval(logShims, 3_600_000);
  setTimeout(logShims, 60_000);
  server.handle(shimsRpc, async (_input, ctx) => {
    capture(ctx);
    const report = await reportShims();
    if (!report) throw new Error("The Paseo API is not available yet.");
    return report;
  });
  server.handle(currentRpc, async () => ({ agentId: session.currentAgentId() }));
  server.handle(resetRpc, async (_input, ctx) => {
    capture(ctx);
    await ready;
    return session.reset(ctx.paseo as unknown as AssistantPaseo);
  });
  server.handle(mailListRpc, async () => {
    const state = await agentsMail.availability();
    if (!state.available) return { availability: state.reason, mails: [] };
    await migrate();
    try {
      return { availability: "ok" as const, mails: await agentsMail.list() };
    } catch (error) {
      if (error instanceof AgentsMailError) return { availability: error.reason === "rejected" ? ("unreachable" as const) : error.reason, mails: [] };
      throw error;
    }
  });
  server.handle(itemListRpc, async () => ({ items: items.list() }));
  server.handle(decisionListRpc, async () => ({ decisions: decisions.list() }));
  server.handle(decisionCancelRpc, async (input, ctx) => {
    capture(ctx);
    const decision = decisions.cancel(input.id);
    delivery.enqueueDecision(decision.id);
    return { decision };
  });
  server.handle(decisionAnswerRpc, async (input, ctx) => {
    capture(ctx);
    const decision = decisions.answer(input.id, input.answer, input.other);
    delivery.enqueueDecision(decision.id);
    return { decision };
  });
  server.handle(mailReadRpc, async (input) => {
    try {
      return { marked: await agentsMail.markRead(input.ids) };
    } catch (error) {
      if (error instanceof AgentsMailError) return { marked: 0 };
      throw error;
    }
  });

  const removeOpen = server.before("agent.session_open", ({ request }, ctx) => {
    capture(ctx);
    const capability = request.env[CAPABILITY_ENV];
    if (capability) tokens.bind(capability, request.agentId);
  });
  // The Assistant just finished a turn: deliver what waited for it.
  const removeTurnEnded = server.on("agent.turn_ended", ({ agent }, ctx) => {
    capture(ctx);
    if (agent.id === session.currentAgentId()) delivery.poke();
  });
  const removeArchived = server.on("agent.archived", ({ agent }, ctx) => {
    capture(ctx);
    tokens.revokeAgent(agent.id);
    return session
      .onAgentArchived(ctx.paseo as unknown as AssistantPaseo, agent.id)
      .catch((error) => console.error("assistant: recreate failed", error));
  });

  return () => {
    removeOpen();
    removeArchived();
    removeTurnEnded();
    unsubscribeSettings();
    clearInterval(shimTimer);
    delivery.stop();
    void http.stop();
  };
}
