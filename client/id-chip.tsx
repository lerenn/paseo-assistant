import type { PluginTheme } from "@getpaseo/plugin";
import * as hostUi from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Pressable, Text } from "react-native";
import { shortId } from "../shared/decision";

/** The host's clipboard helper; a host without it leaves the chip as selectable text. */
const copyText = (hostUi as { copyText?: (text: string) => Promise<void> }).copyText;

/** A small chip with a decision's 8 character id. Click copies it (host clipboard); without one the text is selectable. */
export function IdChip({ theme, id }: { theme: PluginTheme; id: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1_500);
    return () => clearTimeout(t);
  }, [copied]);
  const label = shortId(id);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Decision id ${label}, press to copy`}
      disabled={!copyText}
      onPress={() => void copyText?.(label).then(() => setCopied(true), () => undefined)}
      style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: theme.colors.surface2, alignSelf: "flex-start" }}
    >
      <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontFamily: "monospace" }}>
        {copied ? "copied" : label}
      </Text>
    </Pressable>
  );
}
