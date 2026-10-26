import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { DecisionsBadge, useDecisions } from "./client/decisions";
import { countBadge } from "./client/mail-format";
import { AssistantScreen } from "./client/screen";

export const SCREEN_ID = "assistant";

function AssistantItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const open = (useDecisions().data?.decisions ?? []).filter((d) => !d.answer).length;
  return (
    <SidebarRow
      icon="Sparkles"
      active={currentScreen?.screenId === SCREEN_ID}
      onPress={() => openScreen({ screenId: SCREEN_ID })}
      trailing={open > 0 ? <DecisionsBadge text={countBadge(open)} /> : undefined}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: SCREEN_ID, title: "Assistant", Component: AssistantScreen });
  client.addSidebarHeaderItem({ id: SCREEN_ID, title: "Assistant", Component: AssistantItem });
  return () => {};
}
