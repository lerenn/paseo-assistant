import type { PluginClientContext } from "@getpaseo/plugin/client";
import { contributeHeaderButtons, PANEL_ID } from "./client/header-buttons";
import { AssistantPanel } from "./client/panel";

export default function contribute(client: PluginClientContext) {
  client.addAppPanel({ id: PANEL_ID, title: "Assistant", icon: "Sparkles", Component: AssistantPanel });
  const stopButtons = contributeHeaderButtons(client);
  return () => {
    stopButtons();
    client.closeAppPanel();
  };
}
