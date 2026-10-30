import { useRpc } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { isStale, type Item, type ItemOwner } from "../shared/item";
import { groupTasks, type TaskGroup } from "./groups";
import { itemDoneRpc, itemListRpc } from "../shared/rpc";
import { canSend } from "./keys";
import { cardStyle } from "./card";
import { CardHeader } from "./card-header";
import { IdChip } from "./id-chip";
import { RichText } from "./rich-text";
import { metaLine, stampLine } from "./task-detail";

export const ITEMS_KEY = ["assistant", "items"];
const REFRESH_MS = 10_000;

export function useItems() {
  const list = useRpc(itemListRpc);
  return useQuery({ queryKey: ITEMS_KEY, queryFn: () => list({}), refetchInterval: REFRESH_MS });
}

/** Everything of an item below its title: detail, blocked on / since / due, link, timestamp. */
function ItemBody({ theme, item, rich }: { theme: PluginTheme; item: Item; rich?: boolean }) {
  const meta = metaLine(item);
  return (
    <>
      {item.detail ? rich ? <RichText theme={theme} markdown={item.detail} /> : <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>{item.detail}</Text> : null}
      {meta ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{meta}</Text> : null}
      <View style={{ flexDirection: "row", gap: 12 }}>
        {item.link ? (
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(item.link!)}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, textDecorationLine: "underline" }}>{item.link}</Text>
          </Pressable>
        ) : null}
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{stampLine(item)}</Text>
      </View>
    </>
  );
}

function StateBadge({ theme, item }: { theme: PluginTheme; item: Item }) {
  return item.closed ? (
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>closed</Text>
  ) : isStale(item, Date.now()) ? (
    <View accessibilityLabel="No update for 24 hours" style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: theme.colors.statusWarning }}>
      <Text style={{ color: theme.colors.surface0, fontSize: 11, fontWeight: "600" }}>stale?</Text>
    </View>
  ) : null;
}

/**
 * Done and More… under an open action: both queue a message to the Assistant (its id and title, that the user did it, and
 * the text typed in More…). The item stays open: the Assistant checks it and closes it.
 */
function ItemActions({ theme, item }: { theme: PluginTheme; item: Item }) {
  const doneRpc = useRpc(itemDoneRpc);
  const [more, setMore] = useState(false);
  const [text, setText] = useState("");
  // Set synchronously, so a double click sends once even before the disabled state renders (the server dedupes too).
  const inFlight = useRef(false);
  const mutation = useMutation({
    mutationFn: (note: string | undefined) => doneRpc({ id: item.id, text: note }),
    onSuccess: () => {
      setMore(false);
      setText("");
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });
  const submit = (note: string | undefined) => {
    if (inFlight.current) return;
    inFlight.current = true;
    mutation.mutate(note);
  };
  const busy = mutation.isPending;
  const button = { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: theme.colors.surface2 };
  return (
    <View style={{ gap: 6, marginTop: 4 }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Tell the Assistant this is done" disabled={busy} onPress={() => submit(undefined)} style={[button, { opacity: busy ? 0.5 : 1 }]}>
          <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>Done</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: more }} disabled={busy} onPress={() => setMore((v) => !v)} style={[button, { opacity: busy ? 0.5 : 1 }]}>
          <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>More…</Text>
        </Pressable>
      </View>
      {more ? (
        <View style={{ gap: 6 }}>
          <TextInput
            autoFocus
            multiline
            value={text}
            onChangeText={setText}
            placeholder="What you did, or what the Assistant should know"
            placeholderTextColor={theme.colors.foregroundMuted}
            style={{ color: theme.colors.foreground, backgroundColor: theme.colors.surface2, borderRadius: 8, padding: 10, minHeight: 60 }}
          />
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>Don't paste secrets: the text goes to the Assistant as it is.</Text>
          <Pressable accessibilityRole="button" disabled={!canSend(text, busy)} onPress={() => submit(text.trim())} style={[button, { alignSelf: "flex-start", opacity: canSend(text, busy) ? 1 : 0.5 }]}>
            <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>Send</Text>
          </Pressable>
        </View>
      ) : null}
      {busy ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Sending…</Text> : null}
      {mutation.isSuccess && !busy ? <Text style={{ color: theme.colors.statusSuccess, fontSize: 12 }}>Sent to the Assistant</Text> : null}
      {mutation.error && !busy ? <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>Could not send: {mutation.error.message}</Text> : null}
    </View>
  );
}

function ItemRow({ theme, item, rich }: { theme: PluginTheme; item: Item; rich?: boolean }) {
  return (
    <View style={[cardStyle(theme, { muted: !!item.closed }), { gap: 4 }]}>
      <CardHeader theme={theme} id={item.id} right={<StateBadge theme={theme} item={item} />} />
      <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: item.closed ? "400" : "600" }}>{item.title}</Text>
      <ItemBody theme={theme} item={item} rich={rich} />
      {item.owner === "human" && !item.closed ? <ItemActions theme={theme} item={item} /> : null}
    </View>
  );
}

/** A task of the Tasks tab: one line (chevron, id chip, title cut with an ellipsis); a click expands the rest. Collapsed by default. */
function TaskRow({ theme, item }: { theme: PluginTheme; item: Item }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={[cardStyle(theme, { muted: !!item.closed }), { gap: 4 }]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{open ? "▾" : "▸"}</Text>
        <IdChip theme={theme} id={item.id} />
        <Text numberOfLines={open ? undefined : 1} style={{ flex: 1, color: theme.colors.foreground, fontSize: 14, fontWeight: item.closed ? "400" : "600" }}>
          {item.title}
        </Text>
      </Pressable>
      {open ? (
        <>
          <StateBadge theme={theme} item={item} />
          <ItemBody theme={theme} item={item} />
        </>
      ) : null}
    </View>
  );
}

function GroupSection({ theme, group, color }: { theme: PluginTheme; group: TaskGroup; color: string }) {
  const [collapsed, setCollapsed] = useState(group.collapsed);
  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: !collapsed }} onPress={() => setCollapsed((v) => !v)} style={{ paddingHorizontal: 16, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
        <Text style={{ color, fontSize: 13, fontWeight: "600" }}>
          {collapsed ? "▸" : "▾"} {group.label} ({group.items.length})
        </Text>
      </Pressable>
      {collapsed ? null : group.items.map((i) => <TaskRow key={i.id} theme={theme} item={i} />)}
    </View>
  );
}

/** The agent-owned tasks, in collapsible coloured groups by status (the Tasks tab). */
function TasksView({ theme, items }: { theme: PluginTheme; items: readonly Item[] }) {
  const groups = groupTasks(items, Date.now());
  return (
    <ScrollView>
      {groups.length === 0 ? <Text style={{ color: theme.colors.foregroundMuted, padding: 16 }}>Nothing in progress. The Assistant lists here what it is working on and what you are waiting on.</Text> : null}
      {groups.map((g) => (
        <GroupSection key={g.status} theme={theme} group={g} color={g.status === "blocked" ? theme.colors.statusDanger : g.status === "done" ? theme.colors.statusSuccess : g.color} />
      ))}
    </ScrollView>
  );
}

/** Your Actions (`human`: open items with their steps rendered as markdown) or Tasks (`agent`: grouped by status). */
export function ItemsView({ theme, items, owner = "agent" }: { theme: PluginTheme; items: readonly Item[]; owner?: ItemOwner }) {
  const [showClosed, setShowClosed] = useState(false);
  if (owner === "agent") return <TasksView theme={theme} items={items} />;
  const mine = items.filter((i) => i.owner === owner);
  const open = mine.filter((i) => !i.closed);
  const closed = mine.filter((i) => i.closed);
  return (
    <ScrollView>
      {open.length === 0 ? <Text style={{ color: theme.colors.foregroundMuted, padding: 16 }}>Nothing for you to do. The Assistant lists here what you have to do, with the steps.</Text> : null}
      {open.map((i) => (
        <ItemRow key={i.id} theme={theme} item={i} rich />
      ))}
      {closed.length ? (
        <View>
          <Pressable accessibilityRole="button" onPress={() => setShowClosed((v) => !v)} style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
              {showClosed ? "▾" : "▸"} Closed ({closed.length})
            </Text>
          </Pressable>
          {showClosed ? closed.map((i) => <ItemRow key={i.id} theme={theme} item={i} rich />) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}
