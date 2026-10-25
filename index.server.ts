import type { PluginServerContext } from "@getpaseo/plugin/server";
import { ensureRpc, resetRpc } from "./shared/rpc";
import { DEFAULT_PROVIDER, assistantSettings } from "./shared/settings";
import { AssistantSession, StateFile, type AssistantPaseo } from "./server/session";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(assistantSettings);
  let provider = DEFAULT_PROVIDER;
  const apply = (state: Awaited<ReturnType<typeof settings.read>>) => {
    provider = state.status === "ready" ? state.values.provider : DEFAULT_PROVIDER;
  };
  const ready = settings.read().then(apply);
  const unsubscribeSettings = settings.subscribe(apply);

  const session = new AssistantSession(new StateFile(process.env.ASSISTANT_STATE ?? undefined), () => provider);

  server.handle(ensureRpc, async (_input, { paseo }) => {
    await ready;
    return session.ensure(paseo as unknown as AssistantPaseo);
  });
  server.handle(resetRpc, async (_input, { paseo }) => {
    await ready;
    return session.reset(paseo as unknown as AssistantPaseo);
  });
  const removeArchived = server.on("agent.archived", ({ agent }, { paseo }) =>
    session
      .onAgentArchived(paseo as unknown as AssistantPaseo, agent.id)
      .catch((error) => console.error("assistant: recreate failed", error)),
  );

  return () => {
    removeArchived();
    unsubscribeSettings();
  };
}
