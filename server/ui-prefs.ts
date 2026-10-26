import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Saved widths outside this range are ignored: they cannot come from a drag. */
const MIN_SAVED = 100;
const MAX_SAVED = 10_000;

export const validWidth = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= MIN_SAVED && v <= MAX_SAVED ? Math.round(v) : null);

/** The user's interface preferences (the side panel's width), a small JSON file in the plugin data directory. */
export class UiPrefs {
  constructor(private readonly file: string) {}

  panelWidth(): number | null {
    try {
      return validWidth((JSON.parse(readFileSync(this.file, "utf8")) as { panelWidth?: unknown }).panelWidth);
    } catch {
      return null;
    }
  }

  setPanelWidth(width: number | null): number | null {
    const value = validWidth(width);
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify({ panelWidth: value }), "utf8");
    renameSync(temp, this.file);
    return value;
  }
}
