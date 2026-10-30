import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { DecisionsBadge, useDecisions } from "./client/decisions";
import { BusyIcon, IdleIcon, useAssistantBusy } from "./client/busy-icon";
import { isOpen } from "./shared/decision";
import { countBadge } from "./client/mail-format";
import { AssistantScreen } from "./client/screen";

export const SCREEN_ID = "assistant";

function AssistantItem({ theme, currentScreen, openScreen }: PluginSidebarItemProps) {
  const busy = useAssistantBusy();
  const open = (useDecisions().data?.decisions ?? []).filter(isOpen).length;
  return (
    <SidebarRow
      icon={busy ? BusyIcon : IdleIcon}
      active={currentScreen?.screenId === SCREEN_ID}
      onPress={() => openScreen({ screenId: SCREEN_ID })}
      trailing={open > 0 ? <DecisionsBadge theme={theme} text={countBadge(open)} /> : undefined}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: SCREEN_ID, title: "Assistant", Component: AssistantScreen });
  client.addSidebarHeaderItem({ id: SCREEN_ID, title: "Assistant", Component: AssistantItem });
  return () => {};
}
