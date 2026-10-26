import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UiPrefs, validWidth } from "./ui-prefs";

let dir: string;
beforeEach(() => void (dir = mkdtempSync(path.join(tmpdir(), "ui-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("panel width persistence", () => {
  it("is null before anything is saved, then survives a restart", () => {
    const file = path.join(dir, "ui.json");
    expect(new UiPrefs(file).panelWidth()).toBeNull();
    expect(new UiPrefs(file).setPanelWidth(512.4)).toBe(512);
    expect(new UiPrefs(file).panelWidth()).toBe(512);
  });
  it("can be reset to the default with null", () => {
    const prefs = new UiPrefs(path.join(dir, "ui.json"));
    prefs.setPanelWidth(500);
    expect(prefs.setPanelWidth(null)).toBeNull();
    expect(prefs.panelWidth()).toBeNull();
  });
  it("ignores a width that no drag could produce, and a corrupt file", () => {
    const prefs = new UiPrefs(path.join(dir, "ui.json"));
    expect(prefs.setPanelWidth(5)).toBeNull();
    expect(prefs.setPanelWidth(1e9)).toBeNull();
    expect(validWidth("400")).toBeNull();
    expect(validWidth(Number.NaN)).toBeNull();
    writeFileSync(path.join(dir, "bad.json"), "{nope");
    expect(new UiPrefs(path.join(dir, "bad.json")).panelWidth()).toBeNull();
  });
});
