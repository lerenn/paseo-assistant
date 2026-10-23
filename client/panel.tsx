import { useRpc } from "@getpaseo/plugin/client";
import type { PluginAppPanelProps } from "@getpaseo/plugin/client";
import { AgentChat } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { ensureRpc, resetRpc } from "../shared/rpc";

const SESSION_KEY = ["overseer", "session"];

export function OverseerPanel({ theme, layout }: PluginAppPanelProps) {
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
      note: { color: theme.colors.foregroundMuted, padding: 16 },
      error: { color: theme.colors.foreground, padding: 16 },
    }),
    [theme, layout.compact],
  );

  const error = session.error ?? restart.error;
  return (
    <View style={styles.screen}>
      <View style={styles.bar}>
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
      {session.data ? (
        <AgentChat key={session.data.agentId} agentId={session.data.agentId} />
      ) : error ? (
        <Text style={styles.error}>Overseer could not start: {error.message}</Text>
      ) : (
        <Text style={styles.note}>Starting Overseer…</Text>
      )}
    </View>
  );
}
