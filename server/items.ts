import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { findById } from "../shared/id";
import { isWebLink, itemSchema, type Item, type ItemOwner } from "../shared/item";

const MAX_ITEMS = 500;

/** The Assistant's open items: a JSON file in the plugin data directory. */
export class ItemStore {
  private items: Item[];

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
  ) {
    this.items = this.load();
  }

  private load(): Item[] {
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8"));
      return Array.isArray(raw) ? raw.flatMap((i) => (itemSchema.safeParse(i).success ? [itemSchema.parse(i)] : [])) : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(this.items), "utf8");
    renameSync(temp, this.file);
  }

  private checkLink(link: string | null | undefined): string | null {
    if (link === undefined || link === null || link === "") return null;
    if (!isWebLink(link)) throw new Error("link must be an http(s) URL");
    return link;
  }

  /** An item by its full id or a unique prefix of 4+ characters (the short id on its card). */
  private find(ref: string): Item {
    return findById(this.items, ref, "item");
  }

  add(input: { title: string; detail?: string; link?: string; owner?: ItemOwner }): Item {
    const at = this.now();
    const item: Item = {
      id: randomUUID(),
      title: input.title.trim(),
      owner: input.owner ?? "agent",
      detail: input.detail?.trim() || null,
      link: this.checkLink(input.link),
      addedAt: at,
      updatedAt: at,
      closed: null,
    };
    this.items.push(item);
    if (this.items.length > MAX_ITEMS) this.items = this.items.slice(-MAX_ITEMS);
    this.save();
    return item;
  }

  /** Changes the given fields of an open item; `detail` or `link` set to an empty string clears it. */
  update(id: string, input: { title?: string; detail?: string; link?: string; owner?: ItemOwner }): Item {
    const item = this.find(id);
    if (item.closed) throw new Error("Item is closed");
    if (input.title !== undefined) item.title = input.title.trim();
    if (input.owner !== undefined) item.owner = input.owner;
    if (input.detail !== undefined) item.detail = input.detail.trim() || null;
    if (input.link !== undefined) item.link = this.checkLink(input.link);
    item.updatedAt = this.now();
    this.save();
    return item;
  }

  close(id: string, note?: string): Item {
    const item = this.find(id);
    if (item.closed) throw new Error("Item already closed");
    item.closed = { at: this.now(), note: note?.trim() || null };
    item.updatedAt = item.closed.at;
    this.save();
    return item;
  }

  /** Open items first (oldest first), then closed ones (most recently closed first). */
  list(): Item[] {
    const open = this.items.filter((i) => !i.closed).sort((a, b) => a.addedAt - b.addedAt);
    const done = this.items.filter((i) => i.closed).sort((a, b) => b.closed!.at - a.closed!.at);
    return [...open, ...done];
  }
}
