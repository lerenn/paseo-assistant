import type { PluginTheme } from "@getpaseo/plugin";
import * as hostUi from "@getpaseo/plugin/client/ui";
import { useEffect, useState, type ComponentType } from "react";
import { Pressable, Text, View } from "react-native";
import { splitFences } from "./markdown";

/** The host's markdown renderer and clipboard; a host without them gets plain text and selectable code. */
const Markdown = (hostUi as { Markdown?: ComponentType<{ children: string }> }).Markdown;
const copyText = (hostUi as { copyText?: (text: string) => Promise<void> }).copyText;

function CodeBlock({ theme, code, lang }: { theme: PluginTheme; code: string; lang: string | null }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1_500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <View style={{ borderRadius: 8, backgroundColor: theme.colors.surface2, padding: 8, gap: 4 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{lang ?? "code"}</Text>
        {copyText ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Copy this code" onPress={() => void copyText(code).then(() => setCopied(true), () => undefined)} style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: theme.colors.surface1 }}>
            <Text style={{ color: theme.colors.foreground, fontSize: 11 }}>{copied ? "Copied" : "Copy"}</Text>
          </Pressable>
        ) : null}
      </View>
      <Text selectable style={{ color: theme.colors.foreground, fontSize: 12, fontFamily: "monospace" }}>
        {code}
      </Text>
    </View>
  );
}

/** Markdown with copyable code blocks: prose through the host's renderer, each fenced block as a block with a Copy button. */
export function RichText({ theme, markdown }: { theme: PluginTheme; markdown: string }) {
  return (
    <View style={{ gap: 8 }}>
      {splitFences(markdown).map((seg, i) =>
        seg.kind === "code" ? (
          <CodeBlock key={i} theme={theme} code={seg.text} lang={seg.lang} />
        ) : Markdown ? (
          <Markdown key={i}>{seg.text}</Markdown>
        ) : (
          <Text key={i} selectable style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
            {seg.text}
          </Text>
        ),
      )}
    </View>
  );
}
