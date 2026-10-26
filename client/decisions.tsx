import { useRpc } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { Decision } from "../shared/decision";
import { decisionAnswerRpc, decisionListRpc } from "../shared/rpc";

export const DECISIONS_KEY = ["assistant", "decisions"];
const REFRESH_MS = 10_000;

export function useDecisions() {
  const list = useRpc(decisionListRpc);
  return useQuery({ queryKey: DECISIONS_KEY, queryFn: () => list({}), refetchInterval: REFRESH_MS });
}

function OpenDecision({ theme, decision, busy, onAnswer }: { theme: PluginTheme; decision: Decision; busy: boolean; onAnswer: (answer: string, other: boolean) => void }) {
  const [other, setOther] = useState(false);
  const [text, setText] = useState("");
  const button = { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: theme.colors.surface2 };
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
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
  const open = decisions.filter((d) => !d.answer);
  const answered = decisions.filter((d) => d.answer);
  return (
    <ScrollView>
      {open.length === 0 ? <Text style={{ color: theme.colors.foregroundMuted, padding: 16 }}>No open decisions.</Text> : null}
      {answer.error ? <Text style={{ color: theme.colors.foreground, padding: 16 }}>Could not send the answer: {answer.error.message}</Text> : null}
      {open.map((d) => (
        <OpenDecision key={d.id} theme={theme} decision={d} busy={answer.isPending} onAnswer={(a, other) => answer.mutate({ id: d.id, answer: a, other })} />
      ))}
      {answered.length ? (
        <View>
          <Pressable accessibilityRole="button" onPress={() => setShowAnswered((v) => !v)} style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
              {showAnswered ? "▾" : "▸"} Answered ({answered.length})
            </Text>
          </Pressable>
          {showAnswered
            ? answered.map((d) => (
                <View key={d.id} style={{ paddingHorizontal: 16, paddingVertical: 8, gap: 2, opacity: 0.7 }}>
                  <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{d.question}</Text>
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                    {d.answer!.text} · {new Date(d.answer!.at).toLocaleString()}
                  </Text>
                </View>
              ))
            : null}
        </View>
      ) : null}
    </ScrollView>
  );
}
