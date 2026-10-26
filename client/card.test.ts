import { describe, expect, it } from "vitest";
import type { PluginTheme } from "@getpaseo/plugin";
import { cardStyle } from "./card";

const theme = { colors: { border: "#333", surface1: "#111" } } as unknown as PluginTheme;

describe("cardStyle", () => {
  it("is a bordered, padded card on the theme's colors with room between cards", () => {
    const c = cardStyle(theme);
    expect(c).toMatchObject({ borderColor: "#333", backgroundColor: "#111", borderWidth: 1, borderRadius: 10, opacity: 1 });
    expect(c.paddingHorizontal).toBeGreaterThan(0);
    expect(c.marginVertical).toBeGreaterThan(0);
  });
  it("dims a muted card (answered, closed, read)", () => {
    expect(cardStyle(theme, { muted: true }).opacity).toBeLessThan(1);
  });
});
