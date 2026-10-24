import type { PluginClientContext } from "@getpaseo/plugin/client";
import { contributeHeaderButtons, PANEL_ID } from "./client/header-buttons";
import { OverseerPanel } from "./client/panel";
import { CAPTAIN_HAT_ICON } from "./shared/icon";

export default function contribute(client: PluginClientContext) {
  client.addAppPanel({ id: PANEL_ID, title: "Overseer", icon: CAPTAIN_HAT_ICON, Component: OverseerPanel });
  const stopButtons = contributeHeaderButtons(client);
  return () => {
    stopButtons();
    client.closeAppPanel();
  };
}
