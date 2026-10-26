import { useRpc } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { Decision } from "../shared/decision";
import { isOpen } from "../shared/decision";
import { decisionAnswerRpc, decisionCancelRpc, decisionListRpc } from "../shared/rpc";
import { UndoQueue } from "./undo";
import { cardStyle } from "./card";
import { IdChip } from "./id-chip";

export const DECISIONS_KEY = ["assistant", "decisions"];
const REFRESH_MS = 10_000;

/** The × on a card waits this long for an Undo before the Assistant is told. Module-level: it outlives tab switches. */
export const cancelQueue = new UndoQueue(() => undefined, 5_000);

/** The pending-decisions count shown beside the sidebar row. */
export function DecisionsBadge({ text }: { text: string }) {
  return (
    <View accessibilityLabel={`${text} pending decisions`} style={{ minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, alignItems: "center", justifyContent: "center", backgroundColor: "#d33" }}>
      <Text style={{ color: "#fff", fontSize: 11, fontWeight: "600" }}>{text}</Text>
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
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel this decision" onPress={onCancel} hitSlop={8} style={{ position: "absolute", top: 6, right: 8, width: 24, height: 24, alignItems: "center", justifyContent: "center", zIndex: 1 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 18, lineHeight: 20 }}>×</Text>
      </Pressable>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, paddingRight: 28 }}>
        <IdChip theme={theme} id={decision.id} />
        <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "600", flexShrink: 1 }}>{decision.question}</Text>
      </View>
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
            placeholder="Your answer"
            placeholderTextColor={theme.colors.foregroundMuted}
            style={{ color: theme.colors.foreground, backgroundColor: theme.colors.surface2, borderRadius: 8, padding: 10, minHeight: 60 }}
          />
          <Pressable accessibilityRole="button" disabled={busy || !text.trim()} onPress={() => onAnswer(text.trim(), true)} style={[button, { opacity: text.trim() ? 1 : 0.5 }]}>
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
          <View key={d.id} style={[cardStyle(theme, { muted: true }), { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13, flexShrink: 1 }}>Cancelling: {d.question}</Text>
            <Pressable accessibilityRole="button" onPress={() => cancelQueue.undo(d.id)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: theme.colors.surface2 }}>
              <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>Undo</Text>
            </Pressable>
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
                <View key={d.id} style={[cardStyle(theme, { muted: true }), { gap: 2 }]}>
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                    <IdChip theme={theme} id={d.id} />
                    <Text style={{ color: theme.colors.foreground, fontSize: 13, flexShrink: 1 }}>{d.question}</Text>
                  </View>
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
