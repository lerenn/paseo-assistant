import { useRpc } from "@getpaseo/plugin/client";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import * as hostUi from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ComponentType } from "react";
import { Pressable, Text, View } from "react-native";
import { ensureRpc, resetRpc } from "../shared/rpc";
import { DecisionsView, useDecisions } from "./decisions";
import { countBadge, unreadBadge } from "./mail-format";
import { MailboxView, useMail } from "./mailbox";

const SESSION_KEY = ["assistant", "session"];

/** AgentChat comes from the fork; other hosts lack it and get a button that opens the conversation instead. */
const AgentChat = (hostUi as { AgentChat?: ComponentType<{ agentId: string }> }).AgentChat;

type Tab = "chat" | "mailbox" | "decisions";

export function AssistantScreen(props: PluginScreenProps) {
  const { theme, layout } = props;
  // Screens get `navigation` on hosts that provide it; the link is inert without it.
  const openAgent = props.navigation?.openAgent;
  const [tab, setTab] = useState<Tab>("chat");
  const mail = useMail();
  const mails = mail.data?.mails ?? [];
  const decisions = useDecisions().data?.decisions ?? [];
  const openDecisions = decisions.filter((d) => !d.answer).length;
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
        justifyContent: "flex-start" as const,
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
  return (
    <View style={styles.screen}>
      <View style={styles.bar}>
        {(["chat", "mailbox", "decisions"] as const).map((t) => {
          const badge = t === "mailbox" ? unreadBadge(mails) : t === "decisions" ? countBadge(openDecisions) : "";
          return (
            <Pressable key={t} accessibilityRole="tab" onPress={() => setTab(t)} style={[styles.button, { marginRight: 6, opacity: tab === t ? 1 : 0.6 }]}>
              <Text style={styles.buttonText}>
                {t === "chat" ? "Chat" : t === "mailbox" ? "Mailbox" : "Decisions"}
                {badge ? ` (${badge})` : ""}
              </Text>
            </Pressable>
          );
        })}
        <View style={{ flex: 1 }} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New session"
          disabled={restart.isPending}
          onPress={() => restart.mutate()}
          style={styles.button}
        >
          <Text style={styles.buttonText}>{restart.isPending ? "Starting…" : "New session"}</Text>
        </Pressable>
      </View>
      {tab === "mailbox" ? (
        <MailboxView theme={theme} mails={mails} openAgent={openAgent} />
      ) : tab === "decisions" ? (
        <DecisionsView theme={theme} decisions={decisions} />
      ) : session.data && AgentChat ? (
        <AgentChat key={session.data.agentId} agentId={session.data.agentId} />
      ) : session.data ? (
        <View style={styles.chat}>
          <Text style={styles.note}>
            The Assistant is a regular agent. Open its conversation to talk to it; mail and decisions are in the other tabs.
          </Text>
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
      )}
    </View>
  );
}
