import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";

export const PANEL_ID = "chat";

/** One header button per workspace, kept in step with the workspace list. */
export function contributeHeaderButtons(client: PluginClientContext): () => void {
  const buttons = new Map<string, PluginButtonRegistration>();
  const lifetime = new AbortController();
  let release: () => void = () => undefined;
  const register = (workspaceId: string) => {
    if (lifetime.signal.aborted || buttons.has(workspaceId)) return;
    buttons.set(
      workspaceId,
      client.addHeaderButton({
        id: "assistant",
        workspaceId,
        button: {
          title: "Assistant",
          icon: "ConciergeBell",
          behavior: { kind: "action", onPress: () => client.toggleAppPanel(PANEL_ID) },
        },
      }),
    );
  };
  const unregister = (workspaceId: string) => {
    buttons.get(workspaceId)?.remove();
    buttons.delete(workspaceId);
  };
  const removeAll = () => {
    for (const button of buttons.values()) button.remove();
    buttons.clear();
  };

  void client.paseo.workspaces
    .list({ subscribe: {} })
    .then(({ subscription }) => {
      if (lifetime.signal.aborted) {
        subscription.release();
        return undefined;
      }
      release = () => subscription.release();
      subscription.subscribe({
        snapshot: ({ entries }) => {
          removeAll();
          for (const workspace of entries) register(workspace.id);
        },
        update: (message) => {
          if (message.type !== "workspace_update") return;
          const update = message.payload;
          if (update.kind === "upsert") register(update.workspace.id);
          else unregister(update.id);
        },
      });
      return undefined;
    })
    .catch((error) => {
      if (!lifetime.signal.aborted) console.error("Assistant: workspace observation failed", error);
    });

  return () => {
    lifetime.abort();
    release();
    removeAll();
  };
}
