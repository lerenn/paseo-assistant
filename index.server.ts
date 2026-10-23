import type { PluginServerContext } from "@getpaseo/plugin/server";
import { ensureRpc, resetRpc } from "./shared/rpc";
import { DEFAULT_PROVIDER, overseerSettings } from "./shared/settings";
import { OverseerSession, StateFile, type OverseerPaseo } from "./server/session";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(overseerSettings);
  let provider = DEFAULT_PROVIDER;
  const apply = (state: Awaited<ReturnType<typeof settings.read>>) => {
    provider = state.status === "ready" ? state.values.provider : DEFAULT_PROVIDER;
  };
  const ready = settings.read().then(apply);
  const unsubscribeSettings = settings.subscribe(apply);

  const session = new OverseerSession(new StateFile(process.env.OVERSEER_STATE ?? undefined), () => provider);

  server.handle(ensureRpc, async (_input, { paseo }) => {
    await ready;
    return session.ensure(paseo as unknown as OverseerPaseo);
  });
  server.handle(resetRpc, async (_input, { paseo }) => {
    await ready;
    return session.reset(paseo as unknown as OverseerPaseo);
  });
  const removeArchived = server.on("agent.archived", ({ agent }, { paseo }) =>
    session
      .onAgentArchived(paseo as unknown as OverseerPaseo, agent.id)
      .catch((error) => console.error("overseer: recreate failed", error)),
  );

  return () => {
    removeArchived();
    unsubscribeSettings();
  };
}
