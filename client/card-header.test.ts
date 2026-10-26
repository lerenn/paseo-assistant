import { describe, expect, it, vi } from "vitest";
import type { PluginTheme } from "@getpaseo/plugin";

vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => async () => ({}) }));
vi.mock("@getpaseo/plugin/client/ui", () => ({ SidebarRow: () => null, Icon: () => null, copyText: async () => undefined }));
vi.mock("react-native", () => ({ Pressable: "Pressable", Text: "Text", View: "View", ScrollView: "ScrollView", TextInput: "TextInput", PanResponder: {}, useWindowDimensions: () => ({ width: 1200 }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({}), useMutation: () => ({}), useQueryClient: () => ({}) }));

const theme = { colors: { surface2: "#222", foregroundMuted: "#999", foreground: "#fff", surface1: "#111", border: "#333" } } as unknown as PluginTheme;

describe("CardHeader (layout of every decision card)", () => {
  it("is one row: the id chip on the left and the ×/Undo/state on the right, space between", async () => {
    const { CardHeader } = await import("./decisions");
    const { IdChip } = await import("./id-chip");
    const right = { type: "Text", props: { children: "×" } } as never;
    const el = CardHeader({ theme, id: "b1a3a95d-0000-4000-8000-000000000001", right }) as { props: { style: Record<string, unknown>; children: unknown[] } };
    expect(el.props.style).toMatchObject({ flexDirection: "row", justifyContent: "space-between" });
    const [chip, rightSlot] = el.props.children as [{ type: unknown; props: { id: string } }, unknown];
    expect(chip.type).toBe(IdChip);
    expect(chip.props.id).toBe("b1a3a95d-0000-4000-8000-000000000001");
    expect(rightSlot).toBe(right);
  });

  it("keeps the chip alone on the left when there is nothing on the right", async () => {
    const { CardHeader } = await import("./decisions");
    const el = CardHeader({ theme, id: "abcd1234-x" }) as { props: { children: unknown[] } };
    expect(el.props.children[1]).toBeNull();
  });
});
