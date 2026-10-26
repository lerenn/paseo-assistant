import { useRpc } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import type { Item } from "../shared/item";
import { itemListRpc } from "../shared/rpc";
import { cardStyle } from "./card";

export const ITEMS_KEY = ["assistant", "items"];
const REFRESH_MS = 10_000;

export function useItems() {
  const list = useRpc(itemListRpc);
  return useQuery({ queryKey: ITEMS_KEY, queryFn: () => list({}), refetchInterval: REFRESH_MS });
}

function ItemRow({ theme, item }: { theme: PluginTheme; item: Item }) {
  return (
    <View style={[cardStyle(theme, { muted: !!item.closed }), { gap: 2 }]}>
      <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: item.closed ? "400" : "600" }}>{item.title}</Text>
      {item.detail ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>{item.detail}</Text> : null}
      <View style={{ flexDirection: "row", gap: 12 }}>
        {item.link ? (
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(item.link!)}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, textDecorationLine: "underline" }}>{item.link}</Text>
          </Pressable>
        ) : null}
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          {item.closed ? `closed ${new Date(item.closed.at).toLocaleString()}${item.closed.note ? ` · ${item.closed.note}` : ""}` : `since ${new Date(item.addedAt).toLocaleString()}`}
        </Text>
      </View>
    </View>
  );
}

export function ItemsView({ theme, items }: { theme: PluginTheme; items: readonly Item[] }) {
  const [showClosed, setShowClosed] = useState(false);
  const open = items.filter((i) => !i.closed);
  const closed = items.filter((i) => i.closed);
  return (
    <ScrollView>
      {open.length === 0 ? <Text style={{ color: theme.colors.foregroundMuted, padding: 16 }}>Nothing open. The Assistant lists here what you are waiting on.</Text> : null}
      {open.map((i) => (
        <ItemRow key={i.id} theme={theme} item={i} />
      ))}
      {closed.length ? (
        <View>
          <Pressable accessibilityRole="button" onPress={() => setShowClosed((v) => !v)} style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
              {showClosed ? "▾" : "▸"} Closed ({closed.length})
            </Text>
          </Pressable>
          {showClosed ? closed.map((i) => <ItemRow key={i.id} theme={theme} item={i} />) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}
