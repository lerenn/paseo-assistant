import { describe, expect, it, vi } from "vitest";
import { contributeHeaderButtons } from "./header-buttons";

function fakeClient() {
  const buttons = new Map<string, { workspaceId: string; onPress: () => void; removed: boolean }>();
  let handlers: { snapshot: (r: { entries: { id: string }[] }) => void; update: (m: unknown) => void } | null = null;
  const release = vi.fn();
  const toggleAppPanel = vi.fn();
  const client = {
    toggleAppPanel,
    addHeaderButton(contribution: { workspaceId: string; button: { behavior: { onPress: () => void } } }) {
      const entry = { workspaceId: contribution.workspaceId, onPress: contribution.button.behavior.onPress, removed: false };
      buttons.set(contribution.workspaceId, entry);
      return { update() {}, remove: () => { entry.removed = true; buttons.delete(contribution.workspaceId); } };
    },
    paseo: {
      workspaces: {
        list: async () => ({ subscription: { release, subscribe: (h: typeof handlers) => { handlers = h; } } }),
      },
    },
  };
  return { client, buttons, release, toggleAppPanel, handlers: () => handlers! };
}

describe("contributeHeaderButtons", () => {
  it("adds a button per workspace, follows updates and toggles the dock", async () => {
    const f = fakeClient();
    const stop = contributeHeaderButtons(f.client as never);
    await vi.waitFor(() => expect(f.handlers()).not.toBeNull());

    f.handlers().snapshot({ entries: [{ id: "a" }, { id: "b" }] });
    expect([...f.buttons.keys()]).toEqual(["a", "b"]);

    f.handlers().update({ type: "workspace_update", payload: { kind: "upsert", workspace: { id: "c" } } });
    f.handlers().update({ type: "workspace_update", payload: { kind: "remove", id: "a" } });
    expect([...f.buttons.keys()]).toEqual(["b", "c"]);

    f.buttons.get("b")!.onPress();
    expect(f.toggleAppPanel).toHaveBeenCalledWith("chat");

    stop();
    expect(f.buttons.size).toBe(0);
    expect(f.release).toHaveBeenCalled();
  });
});
