import { useRpc } from "@getpaseo/plugin/client";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import * as hostUi from "@getpaseo/plugin/client/ui";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState, type ComponentType } from "react";
import { PanResponder, Pressable, Text, View, useWindowDimensions } from "react-native";
import { isOpen } from "../shared/decision";
import { ensureRpc, resetRpc, uiGetRpc, uiSetRpc } from "../shared/rpc";
import { DecisionsBadge, DecisionsView, useDecisions } from "./decisions";
import { ItemsView, useItems } from "./items";
import { MailboxView, useMail } from "./mailbox";
import { DEFAULT_PANEL_WIDTH, DEFAULT_TAB, clampPanelWidth, effectiveTab, itemCounts, mailHint, panelLayout, panelMemory, panelTabs, toggleBadge, widthAfterDrag, type PanelTab } from "./panel";

const SESSION_KEY = ["assistant", "session"];

/** AgentChat comes from the fork; other hosts lack it and get a button that opens the conversation instead. */
const AgentChat = (hostUi as { AgentChat?: ComponentType<{ agentId: string }> }).AgentChat;

export function AssistantScreen(props: PluginScreenProps) {
  const { theme, layout } = props;
  // Screens get `navigation` on hosts that provide it; the link is inert without it.
  const openAgent = props.navigation?.openAgent;
  const [open, setOpenState] = useState(panelMemory.open);
  const [wantedTab, setTabState] = useState<PanelTab>(DEFAULT_TAB);
  const setOpen = (value: boolean) => {
    panelMemory.open = value;
    setOpenState(value);
  };
  const setTab = (value: PanelTab) => setTabState(value);
  // The panel's width: dragged live, saved on release, restored from the daemon.
  const { width: windowWidth } = useWindowDimensions();
  const getUi = useRpc(uiGetRpc);
  const setUi = useRpc(uiSetRpc);
  const savedWidth = useQuery({ queryKey: ["assistant", "ui"], queryFn: () => getUi({}), staleTime: Infinity }).data?.panelWidth ?? null;
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const panelWidth = clampPanelWidth(dragWidth ?? savedWidth ?? DEFAULT_PANEL_WIDTH, windowWidth);
  const dragStart = useRef(panelWidth);
  const latest = useRef({ width: panelWidth, windowWidth });
  latest.current = { width: panelWidth, windowWidth };
  const resizer = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          dragStart.current = latest.current.width;
        },
        onPanResponderMove: (_e, g) => setDragWidth(widthAfterDrag(dragStart.current, g.dx, latest.current.windowWidth)),
        onPanResponderRelease: (_e, g) => {
          const width = widthAfterDrag(dragStart.current, g.dx, latest.current.windowWidth);
          setDragWidth(width);
          void setUi({ panelWidth: width }).then(() => queryClient.setQueryData(["assistant", "ui"], { panelWidth: width }));
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const mail = useMail();
  const mails = mail.data?.mails ?? [];
  // While the first answer is pending the tab counts as available; once Agents Mail is missing or silent it is not.
  const mailAvailable = (mail.data?.availability ?? "ok") === "ok";
  const tab = effectiveTab(wantedTab, mailAvailable);
  const decisions = useDecisions().data?.decisions ?? [];
  const items = useItems().data?.items ?? [];
  const counts = {
    unreadMail: mails.filter((m) => !m.read).length,
    openDecisions: decisions.filter(isOpen).length,
    ...itemCounts(items),
  };
  const ensure = useRpc(ensureRpc);
  const reset = useRpc(resetRpc);
  const queryClient = useQueryClient();
  const session = useQuery({ queryKey: SESSION_KEY, queryFn: () => ensure({}), retry: false });
  const restart = useMutation({
    mutationFn: () => reset({}),
    onSuccess: (next) => queryClient.setQueryData(SESSION_KEY, next),
  });

  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      bar: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "flex-end" as const,
        gap: 8,
        paddingHorizontal: layout.compact ? 12 : 16,
        paddingVertical: 6,
      },
      button: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        backgroundColor: theme.colors.surface2,
      },
      buttonText: { color: theme.colors.foreground, fontSize: 13 },
      chat: { gap: 8 },
      note: { color: theme.colors.foregroundMuted, padding: 16 },
      error: { color: theme.colors.foreground, padding: 16 },
    }),
    [theme, layout.compact],
  );

  const error = session.error ?? restart.error;
  const mode = panelLayout(layout.compact, open);
  const badge = toggleBadge(counts);

  const chat = session.data && AgentChat ? (
    <AgentChat key={session.data.agentId} agentId={session.data.agentId} />
  ) : session.data ? (
    <View style={styles.chat}>
      <Text style={styles.note}>The Assistant is a regular agent. Open its conversation to talk to it; current tasks, your decisions, your actions and the mailbox are in the panel on the right.</Text>
      <Pressable
        accessibilityRole="button"
        disabled={!openAgent}
        onPress={() => openAgent?.({ agentId: session.data!.agentId })}
        style={[styles.button, { alignSelf: "flex-start", marginHorizontal: 16, opacity: openAgent ? 1 : 0.5 }]}
      >
        <Text style={styles.buttonText}>Open the Assistant conversation</Text>
      </Pressable>
    </View>
  ) : error ? (
    <Text style={styles.error}>Assistant could not start: {error.message}</Text>
  ) : (
    <Text style={styles.note}>Starting Assistant…</Text>
  );

  const panel = (
    <View style={{ width: mode === "side" ? panelWidth : undefined, flex: mode === "side" ? undefined : 1, borderLeftWidth: mode === "side" ? 1 : 0, borderLeftColor: theme.colors.border }}>
      {mode === "side" ? (
        <View
          {...resizer.panHandlers}
          accessibilityRole="adjustable"
          accessibilityLabel="Resize the side panel"
          style={[{ position: "absolute", left: -5, top: 0, bottom: 0, width: 10, zIndex: 2, alignItems: "center", justifyContent: "center" }, { cursor: "col-resize" } as object]}
        >
          <View style={{ width: 4, height: 36, borderRadius: 2, backgroundColor: theme.colors.border }} />
        </View>
      ) : null}
      <View style={{ flexDirection: "row", paddingHorizontal: 12, paddingVertical: 6, gap: 6, flexWrap: "wrap" }}>
        {panelTabs(counts, mailAvailable, mailHint(mail.data?.availability ?? "ok") ?? undefined).map((t) => (
          <Pressable
            key={t.id}
            accessibilityRole="tab"
            accessibilityState={{ disabled: t.disabled, selected: tab === t.id }}
            accessibilityHint={t.hint ?? undefined}
            disabled={t.disabled}
            onPress={() => setTab(t.id)}
            style={[styles.button, { opacity: t.disabled ? 0.4 : tab === t.id ? 1 : 0.6 }]}
          >
            <Text style={styles.buttonText}>
              {t.label}
              {t.badge ? ` (${t.badge})` : ""}
            </Text>
          </Pressable>
        ))}
        {mailAvailable ? null : <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, alignSelf: "center" }}>Mailbox: {mailHint(mail.data?.availability ?? "ok")}</Text>}
      </View>
      <View style={{ flex: 1 }}>
        {tab === "mailbox" ? (
          <MailboxView theme={theme} mails={mails} availability={mail.data?.availability} openAgent={openAgent} />
        ) : tab === "decisions" ? (
          <DecisionsView theme={theme} decisions={decisions} />
        ) : tab === "actions" ? (
          <ItemsView theme={theme} items={items} owner="human" />
        ) : (
          <ItemsView theme={theme} items={items} owner="agent" />
        )}
      </View>
    </View>
  );

  return (
    <View style={styles.screen}>
      <View style={styles.bar}>
        <Pressable accessibilityRole="button" accessibilityLabel="New session" disabled={restart.isPending} onPress={() => restart.mutate()} style={styles.button}>
          <Text style={styles.buttonText}>{restart.isPending ? "Starting…" : "New session"}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? "Hide the side panel" : "Show the side panel"}
          onPress={() => setOpen(!open)}
          style={[styles.button, { flexDirection: "row", alignItems: "center", gap: 6, opacity: open ? 1 : 0.7 }]}
        >
          <Icon name={open ? "PanelRightClose" : "PanelRight"} size={16} color={theme.colors.foreground} />
          {badge && !open ? <DecisionsBadge text={badge} /> : null}
        </Pressable>
      </View>
      <View style={{ flex: 1, flexDirection: "row" }}>
        {mode === "full" ? null : <View style={{ flex: 1 }}>{chat}</View>}
        {mode === "hidden" ? null : panel}
      </View>
    </View>
  );
}
