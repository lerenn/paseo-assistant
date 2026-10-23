// The app dock ships with the Paseo fork's 0.13 line and is not in the published
// @getpaseo/plugin types yet. Delete this file once the pinned types include it.
import type { ComponentType } from "react";
import type { PluginCleanup, PluginTheme } from "@getpaseo/plugin";
import type { PluginIcon } from "@getpaseo/plugin/client";

declare module "@getpaseo/plugin/client" {
  interface PluginAppPanelProps {
    theme: PluginTheme;
    host: { id: string; label: string };
    layout: { compact: boolean; platform: "ios" | "android" | "web" };
  }
  interface PluginAppPanelContribution {
    id: string;
    title: string;
    icon: PluginIcon;
    Component: ComponentType<PluginAppPanelProps>;
  }
  interface PluginClientContext {
    addAppPanel(contribution: PluginAppPanelContribution): PluginCleanup;
    openAppPanel(id: string): void;
    toggleAppPanel(id: string): void;
    closeAppPanel(): void;
  }
}

declare module "@getpaseo/plugin/client/ui" {
  export const AgentChat: ComponentType<{ agentId: string; workspaceId?: string }>;
}
