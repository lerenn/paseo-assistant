import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { shortId } from "../shared/id";

const MAX_NOTES = 500;
/** Note ids share the delivery queue with decision ids; the prefix keeps them apart. */
export const NOTE_PREFIX = "item-note:";

const noteSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  title: z.string(),
  /** What the user typed in the More… box, or null for a plain Done. */
  text: z.string().nullable(),
  at: z.number(),
  deliveredAt: z.number().nullable(),
});
export type ItemNote = z.output<typeof noteSchema>;

export const isNoteId = (id: string): boolean => id.startsWith(NOTE_PREFIX);

/**
 * What the user sent from a Your Actions card (Done, or More… with a text), waiting to reach the Assistant: a JSON file
 * in the plugin data directory. The item itself is left open: the Assistant checks it and closes it.
 */
export class ItemNoteStore {
  private notes: ItemNote[];

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
  ) {
    this.notes = this.load();
  }

  private load(): ItemNote[] {
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8"));
      return Array.isArray(raw) ? raw.flatMap((n) => (noteSchema.safeParse(n).success ? [noteSchema.parse(n)] : [])) : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(this.notes), "utf8");
    renameSync(temp, this.file);
  }

  /** Records a note; the same note for the same item, not delivered yet (a double click), is returned instead of a second one. */
  add(input: { itemId: string; title: string; text?: string | null }): { note: ItemNote; duplicate: boolean } {
    const text = input.text?.trim() || null;
    const pending = this.notes.find((n) => n.deliveredAt === null && n.itemId === input.itemId && n.text === text);
    if (pending) return { note: pending, duplicate: true };
    const note: ItemNote = { id: `${NOTE_PREFIX}${randomUUID()}`, itemId: input.itemId, title: input.title, text, at: this.now(), deliveredAt: null };
    this.notes.push(note);
    if (this.notes.length > MAX_NOTES) this.notes = this.notes.slice(-MAX_NOTES);
    this.save();
    return { note, duplicate: false };
  }

  get(id: string): ItemNote | null {
    return this.notes.find((n) => n.id === id) ?? null;
  }

  /** Records that these notes reached the Assistant. */
  markDelivered(ids: readonly string[]): void {
    const at = this.now();
    let changed = false;
    for (const n of this.notes) {
      if (ids.includes(n.id) && n.deliveredAt === null) {
        n.deliveredAt = at;
        changed = true;
      }
    }
    if (changed) this.save();
  }
}

/** What the Assistant is told: the short id and title of the item, that the user marked it done, and their text if any. */
export function itemNoteNudge(note: ItemNote): string {
  return [
    `Louis marked an action done (id ${shortId(note.itemId)}): ${note.title}`,
    ...(note.text ? [`Note from Louis: ${note.text}`] : []),
    "Check that it is really done, then close it with assistant_item_close; if it is not, tell Louis what is missing.",
  ].join("\n");
}
