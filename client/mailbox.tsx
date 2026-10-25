import { useRpc } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { Mail } from "../shared/mail";
import { mailListRpc, mailReadRpc } from "../shared/rpc";
import { KIND_LABEL } from "./mail-format";

export const MAIL_KEY = ["assistant", "mail"];
const REFRESH_MS = 10_000;

export function useMail() {
  const list = useRpc(mailListRpc);
  return useQuery({ queryKey: MAIL_KEY, queryFn: () => list({}), refetchInterval: REFRESH_MS });
}

interface Props {
  theme: PluginTheme;
  mails: readonly Mail[];
  openAgent?: (target: { agentId: string }) => void;
}

export function MailboxView({ theme, mails, openAgent }: Props) {
  const markRead = useRpc(mailReadRpc);
  const queryClient = useQueryClient();
  const mark = useMutation({
    mutationFn: (ids?: string[]) => markRead({ ids }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MAIL_KEY }),
  });
  const unread = mails.filter((m) => !m.read).length;
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 6 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>{unread ? `${unread} unread` : "No unread mail"}</Text>
        {unread ? (
          <Pressable accessibilityRole="button" onPress={() => mark.mutate(undefined)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: theme.colors.surface2 }}>
            <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>Mark all read</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView>
        {mails.length === 0 ? <Text style={{ color: theme.colors.foregroundMuted, padding: 16 }}>No mail yet. Agents write here at milestones.</Text> : null}
        {mails.map((mail) => (
          <View key={mail.id} style={{ paddingHorizontal: 16, paddingVertical: 10, gap: 2, opacity: mail.read ? 0.6 : 1 }}>
            <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: mail.read ? "400" : "600" }}>
              {KIND_LABEL[mail.kind]}: {mail.subject}
            </Text>
            {mail.body ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>{mail.body}</Text> : null}
            <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
              <Pressable accessibilityRole="link" disabled={!openAgent} onPress={() => openAgent?.({ agentId: mail.agentId })}>
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, textDecorationLine: openAgent ? "underline" : "none" }}>
                  {mail.agentName} · {new Date(mail.at).toLocaleString()}
                </Text>
              </Pressable>
              {mail.read ? null : (
                <Pressable accessibilityRole="button" onPress={() => mark.mutate([mail.id])}>
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Mark read</Text>
                </Pressable>
              )}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
