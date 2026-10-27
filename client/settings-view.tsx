import { SettingsCard, SettingsInput, SettingsSection } from "@getpaseo/plugin/client/ui";
import { useSettings } from "@getpaseo/plugin/client";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { assistantSettings } from "../shared/settings";
import { SETTING_FIELDS, applyEdits, type SettingKey } from "./settings";

/** The Assistant plugin settings: intervals and nudge guard rails. Saving updates the daemon at once, no restart. */
export function SettingsView({ theme, onClose }: { theme: PluginScreenProps["theme"]; onClose(): void }) {
  const settings = useSettings(assistantSettings);
  const [edits, setEdits] = useState<Partial<Record<SettingKey, string>>>({});
  const button = { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: theme.colors.surface2 };
  if (settings.status !== "ready") {
    return <Text style={{ color: theme.colors.foregroundMuted, padding: 16 }}>{settings.status === "loading" ? "Loading settings…" : `Settings unavailable: ${"error" in settings ? settings.error : ""}`}</Text>;
  }
  const { values, errors } = applyEdits(settings.values, edits);
  const dirty = Object.keys(edits).length > 0;
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <SettingsSection title="Heartbeats and nudges">
        <SettingsCard>
          {SETTING_FIELDS.map((f) => (
            <SettingsInput
              key={f.key}
              label={f.label}
              hint={f.hint}
              error={errors[f.key] ?? null}
              initialValue={String(settings.values[f.key])}
              onChangeText={(text) => setEdits((prev) => ({ ...prev, [f.key]: text }))}
            />
          ))}
        </SettingsCard>
      </SettingsSection>
      {settings.saveError ? <Text style={{ color: theme.colors.foreground }}>{settings.saveError}</Text> : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save settings"
          disabled={!dirty || Object.keys(errors).length > 0 || settings.saving}
          onPress={() => void settings.save(values, settings.revision).then((ok) => ok && setEdits({}))}
          style={[button, { opacity: !dirty || Object.keys(errors).length > 0 ? 0.5 : 1 }]}
        >
          <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{settings.saving ? "Saving…" : "Save"}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Close settings" onPress={onClose} style={button}>
          <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>Close</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
