import { useRpc } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { Decision } from "../shared/decision";
import { decisionStatus, isOpen } from "../shared/decision";
import { decisionAnswerRpc, decisionCancelRpc, decisionListRpc } from "../shared/rpc";
import { UndoQueue } from "./undo";
import { cardStyle } from "./card";
import { CardHeader } from "./card-header";
import { canSend, isSendKey } from "./keys";

export const DECISIONS_KEY = ["assistant", "decisions"];
const REFRESH_MS = 10_000;

/** The × on a card waits this long for an Undo before the Assistant is told. Module-level: it outlives tab switches. */
export const cancelQueue = new UndoQueue(() => undefined, 5_000);

/** The pending-decisions count shown beside the sidebar row. */
export function DecisionsBadge({ theme, text }: { theme: PluginTheme; text: string }) {
  return (
    <View accessibilityLabel={`${text} pending decisions`} style={{ minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.accent }}>
      <Text style={{ color: theme.colors.accentForeground, fontSize: 11, fontWeight: "600" }}>{text}</Text>
    </View>
  );
}

export function useDecisions() {
  const list = useRpc(decisionListRpc);
  return useQuery({ queryKey: DECISIONS_KEY, queryFn: () => list({}), refetchInterval: REFRESH_MS });
}

function OpenDecision({ theme, decision, busy, onAnswer, onCancel }: { theme: PluginTheme; decision: Decision; busy: boolean; onAnswer: (answer: string, other: boolean) => void; onCancel: () => void }) {
  const [other, setOther] = useState(false);
  const [text, setText] = useState("");
  const button = { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: theme.colors.surface2 };
  return (
    <View style={cardStyle(theme)}>
      <CardHeader
        theme={theme}
        id={decision.id}
        right={
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel this decision" onPress={onCancel} hitSlop={8} style={{ width: 24, height: 24, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 18, lineHeight: 20 }}>×</Text>
          </Pressable>
        }
      />
      <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "600" }}>{decision.question}</Text>
      {decision.options.map((option, i) => (
        <Pressable key={option} accessibilityRole="button" disabled={busy} onPress={() => onAnswer(option, false)} style={button}>
          <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>
            {option}
            {i === 0 ? "  (recommended)" : ""}
          </Text>
        </Pressable>
      ))}
      {other ? (
        <View style={{ gap: 6 }}>
          <TextInput
            autoFocus
            multiline
            value={text}
            onChangeText={setText}
            // Enter sends, Shift+Enter is a newline (web keyboards; a phone keyboard's Enter is a newline and Send is the button).
            onKeyPress={(e) => {
              if (!isSendKey(e.nativeEvent as { key?: string; shiftKey?: boolean; isComposing?: boolean })) return;
              (e as { preventDefault?: () => void }).preventDefault?.();
              if (canSend(text, busy)) onAnswer(text.trim(), true);
            }}
            placeholder="Your answer (Enter sends, Shift+Enter adds a line)"
            placeholderTextColor={theme.colors.foregroundMuted}
            style={{ color: theme.colors.foreground, backgroundColor: theme.colors.surface2, borderRadius: 8, padding: 10, minHeight: 60 }}
          />
          <Pressable accessibilityRole="button" disabled={!canSend(text, busy)} onPress={() => onAnswer(text.trim(), true)} style={[button, { opacity: canSend(text, busy) ? 1 : 0.5 }]}>
            <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>Send</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => setOther(true)} style={button}>
          <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>Other…</Text>
        </Pressable>
      )}
    </View>
  );
}

export function DecisionsView({ theme, decisions }: { theme: PluginTheme; decisions: readonly Decision[] }) {
  const answerRpc = useRpc(decisionAnswerRpc);
  const queryClient = useQueryClient();
  const [showAnswered, setShowAnswered] = useState(false);
  const answer = useMutation({
    mutationFn: (v: { id: string; answer: string; other: boolean }) => answerRpc(v),
    onSettled: () => queryClient.invalidateQueries({ queryKey: DECISIONS_KEY }),
  });
  const cancelRpc = useRpc(decisionCancelRpc);
  cancelQueue.setCommit(async (id) => {
    try {
      await cancelRpc({ id });
    } finally {
      void queryClient.invalidateQueries({ queryKey: DECISIONS_KEY });
    }
  });
  const waiting = useSyncExternalStore(cancelQueue.subscribe, cancelQueue.pending);
  const open = decisions.filter(isOpen);
  const answered = decisions.filter((d) => !isOpen(d));
  return (
    <ScrollView>
      {open.length === 0 ? <Text style={{ color: theme.colors.foregroundMuted, padding: 16 }}>No open decisions.</Text> : null}
      {answer.error ? <Text style={{ color: theme.colors.foreground, padding: 16 }}>Could not send the answer: {answer.error.message}</Text> : null}
      {open.map((d) =>
        waiting.includes(d.id) ? (
          <View key={d.id} style={cardStyle(theme, { muted: true })}>
            <CardHeader
              theme={theme}
              id={d.id}
              right={
                <Pressable accessibilityRole="button" onPress={() => cancelQueue.undo(d.id)} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: theme.colors.surface2 }}>
                  <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>Undo</Text>
                </Pressable>
              }
            />
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>Cancelling: {d.question}</Text>
          </View>
        ) : (
          <OpenDecision key={d.id} theme={theme} decision={d} busy={answer.isPending} onAnswer={(a, other) => answer.mutate({ id: d.id, answer: a, other })} onCancel={() => cancelQueue.start(d.id)} />
        ),
      )}
      {answered.length ? (
        <View>
          <Pressable accessibilityRole="button" onPress={() => setShowAnswered((v) => !v)} style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
              {showAnswered ? "▾" : "▸"} Answered ({answered.length})
            </Text>
          </Pressable>
          {showAnswered
            ? answered.map((d) => (
                <View key={d.id} style={[cardStyle(theme, { muted: true }), { gap: 4 }]}>
                  <CardHeader theme={theme} id={d.id} right={<Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{decisionStatus(d)}</Text>} />
                  <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{d.question}</Text>
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                    {d.cancelledAt !== null
                      ? `Cancelled · ${new Date(d.cancelledAt).toLocaleString()}`
                      : `${d.answer!.text} · ${d.answer!.source === "chat" ? "answered in chat · " : ""}${new Date(d.answer!.at).toLocaleString()}`}
                  </Text>
                </View>
              ))
            : null}
        </View>
      ) : null}
    </ScrollView>
  );
}
