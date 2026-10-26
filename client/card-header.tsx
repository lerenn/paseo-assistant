import type { PluginTheme } from "@getpaseo/plugin";
import type { ReactNode } from "react";
import { View } from "react-native";
import { IdChip } from "./id-chip";

/** The header row of every card (decision, task, action): the id chip on the left, something small on the right (×, Undo, the state, "stale?"). */
export function CardHeader({ theme, id, right }: { theme: PluginTheme; id: string; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 24 }}>
      <IdChip theme={theme} id={id} />
      {right ?? null}
    </View>
  );
}
