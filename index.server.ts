import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { decisionCancelRpc, decisionAnswerRpc, currentRpc, shimsRpc, uiGetRpc, uiSetRpc, decisionListRpc, ensureRpc, itemListRpc, mailListRpc, mailReadRpc, resetRpc } from "./shared/rpc";
import { DEFAULT_PROVIDER, assistantSettings, settingsSchema } from "./shared/settings";
import { MailHttp } from "./server/http";
import { isOpen } from "./shared/decision";
import { DecisionStore, cancelNudge, decisionNudge } from "./server/decisions";
import { noteForTurn } from "./server/ask-check";
import { UiPrefs } from "./server/ui-prefs";
import { ItemStore } from "./server/items";
import { AgentsMailClient, AgentsMailError } from "./server/agentsmail";
import { ShimUsageStore, describeReport, shimReport } from "./server/shims";
import { Delivery, PendingDeliveries, dropStaleOnce, statusOf, titleOf } from "./server/delivery";
import { McpServer } from "./server/mcp";
import { AssistantSession, StateFile, dataDir, type AssistantPaseo } from "./server/session";
import { CAPABILITY_ENV, CapabilityStore } from "./server/tokens";
import { mailTools } from "./server/tools";
import { ReviewScheduler } from "./server/review";
import { NudgeLedger, agentInfos, nudgeCheck } from "./server/nudge";

const DEFAULT_PORT = 47842;

type Settings = ReturnType<typeof settingsSchema.parse>;

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(assistantSettings);
  let latest: Settings = settingsSchema.parse({});
  const apply = (state: Awaited<ReturnType<typeof settings.read>>) => {
    latest = state.status === "ready" ? state.values : settingsSchema.parse({});
    reviews?.reschedule();
  };
  let reviews: ReviewScheduler | null = null;
  const ready = settings.read().then(apply);
  const unsubscribeSettings = settings.subscribe(apply);

  // Mail lives in the Agents Mail plugin; the Assistant stores none of its own.
  const agentsMail = new AgentsMailClient();
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

  /** The periodic task review: queued, never steered, one at a time; the interval is a setting (0 = off). */
  reviews = new ReviewScheduler({
    minutes: () => latest.taskReviewMinutes,
    status: async () => {
      const assistantId = session.currentAgentId();
      if (!assistantId || !paseo) return null;
      return statusOf(await paseo.agents.ref(assistantId).refresh());
    },
    send: nudge,
  });
  void ready.then(() => reviews?.start());
  const nudges = new NudgeLedger(process.env.ASSISTANT_NUDGES ?? join(dataDir, "nudges.json"));

  const http = new MailHttp({
    tokens,
    mcp: new McpServer(mailTools),
    context: () => ({
      agentsMail,
      decisions,
      items,
      shimUsed: (tool) => shimUsage.record(tool),
      nudgeCheck: async ({ agentId, pendingInbox }) => {
        if (!paseo) throw new Error("The Paseo API is not available yet; try again in a moment.");
        const listed = await (paseo as unknown as import("./server/manage").ManagePaseo).agents.list({ filter: { includeArchived: false, includeBackground: true } });
        return nudgeCheck(agentId, { pendingInbox }, {
          agents: async () => agentInfos(listed.entries),
          ledger: nudges,
          pendingDecision: (agent) =>
            decisions.list().some((d) => isOpen(d) && [agent.id, agent.id.slice(0, 8), agent.title].some((k) => k && d.question.includes(k))),
          escalate: (agent, count) =>
            decisions.add({
              question: `${agent.title ?? agent.id} (${agent.id.slice(0, 8)}) stays silent after ${count} nudges from the Assistant. What now?`,
              options: ["Keep waiting", "Look at it myself", "Archive the agent"],
              recommended: "Look at it myself",
            }),
        });
      },
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
    const { entries } = await (paseo as unknown as import("./server/manage").ManagePaseo).agents.list({ filter: { includeArchived: false, includeBackground: true } });
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
  const uiPrefs = new UiPrefs(process.env.ASSISTANT_UI ?? join(dataDir, "ui.json"));
  server.handle(uiGetRpc, async () => ({ panelWidth: uiPrefs.panelWidth() }));
  server.handle(uiSetRpc, async (input) => ({ panelWidth: uiPrefs.setPanelWidth(input.panelWidth) }));
  server.handle(currentRpc, async () => ({ agentId: session.currentAgentId() }));
  server.handle(resetRpc, async (_input, ctx) => {
    capture(ctx);
    await ready;
    return session.reset(ctx.paseo as unknown as AssistantPaseo);
  });
  server.handle(mailListRpc, async () => {
    const state = await agentsMail.availability();
    if (!state.available) return { availability: state.reason, mails: [] };
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
  // A note for the Assistant's next prompt: "you asked the user in chat". Never blocks or changes a reply.
  let pendingNote: string | null = null;
  let promptHookLive = false;
  const checkChatQuestion = async (agentId: string) => {
    const agent = paseo?.agents.ref(agentId) as unknown as { timeline: { refetch(o: unknown): Promise<unknown> } } | undefined;
    if (!agent) return;
    const note = noteForTurn(await agent.timeline.refetch({ direction: "tail", limit: 60 }));
    if (!note || pendingNote) return;
    if (promptHookLive) {
      pendingNote = note;
      return;
    }
    // No prompt hook on this host: a short steered note, only to an idle Assistant, so nothing running is interrupted.
    if (statusOf(await paseo?.agents.ref(agentId).refresh()) === "idle") await nudge(note);
  };
  // The Assistant just finished a turn: deliver what waited for it, and check what it said.
  const removeTurnEnded = server.on("agent.turn_ended", ({ agent, outcome }, ctx) => {
    capture(ctx);
    if (agent.id !== session.currentAgentId()) return;
    delivery.poke();
    if (outcome.kind === "completed") void checkChatQuestion(agent.id).catch((error) => console.error("assistant: chat question check failed", error));
  });
  // Fork hook (feature flag pluginPromptHook): put the note in front of the Assistant's next prompt, once.
  let removePrompt: () => void = () => {};
  try {
    const before = server.before as unknown as (name: string, handler: (input: { request: { agentId: string; prepend?: string } }, ctx: unknown) => unknown) => (() => void) | undefined;
    removePrompt =
      before.call(server, "agent.prompt", ({ request }, ctx) => {
        capture(ctx as { paseo: unknown });
        promptHookLive = true;
        if (!pendingNote || request?.agentId !== session.currentAgentId()) return;
        const note = pendingNote;
        pendingNote = null;
        return { ...request, prepend: request.prepend ? `${request.prepend}\n\n${note}` : note };
      }) ?? (() => {});
  } catch {
    // No agent.prompt hook on this host: the steered note above is used instead.
  }
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
    removePrompt();
    unsubscribeSettings();
    reviews?.stop();
    clearInterval(shimTimer);
    delivery.stop();
    void http.stop();
  };
}
