import type { PluginTheme } from "@getpaseo/plugin";

/** One card per decision, open item or mail: a themed border and background, padding, and room between cards. */
export function cardStyle(theme: PluginTheme, o: { muted?: boolean } = {}) {
  return {
    marginHorizontal: 12,
    marginVertical: 5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    opacity: o.muted ? 0.7 : 1,
  };
}
