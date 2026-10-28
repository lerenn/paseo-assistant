import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { findById } from "../shared/id";
import { isWebLink, itemSchema, SINCE_STATUSES, type Item, type ItemOwner, type ItemStatus } from "../shared/item";

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

  /** An ISO timestamp (or an empty string, which clears) as epoch ms. */
  private parseSince(since: string): number | null {
    if (since === "") return null;
    const t = Date.parse(since);
    if (Number.isNaN(t)) throw new Error("since must be an ISO timestamp");
    return t;
  }

  add(input: { title: string; detail?: string; link?: string; owner?: ItemOwner; status?: ItemStatus; blockedOn?: string; since?: string; due?: string }): Item {
    if (input.status === "done") throw new Error("Add the item, then close it with assistant_item_close");
    const at = this.now();
    const status = input.status ?? "current";
    const item: Item = {
      id: randomUUID(),
      title: input.title.trim(),
      owner: input.owner ?? "agent",
      detail: input.detail?.trim() || null,
      link: this.checkLink(input.link),
      addedAt: at,
      updatedAt: at,
      closed: null,
      status,
      blockedOn: input.blockedOn?.trim() || null,
      since: input.since !== undefined ? this.parseSince(input.since) : SINCE_STATUSES.includes(status) ? at : null,
      due: input.due?.trim() || null,
    };
    this.items.push(item);
    if (this.items.length > MAX_ITEMS) this.items = this.items.slice(-MAX_ITEMS);
    this.save();
    return item;
  }

  /**
   * Changes the given fields of an open item; `detail`, `link`, `blockedOn`, `due` or `since` set to an empty string
   * clears it. Status `done` closes the item. Entering `blocked` or `waiting` sets `since` to now unless it is given;
   * leaving both clears `since`.
   */
  update(id: string, input: { title?: string; detail?: string; link?: string; owner?: ItemOwner; status?: ItemStatus; blockedOn?: string; since?: string; due?: string }): Item {
    const item = this.find(id);
    if (item.closed) throw new Error("Item is closed");
    if (input.status === "done") return this.close(id);
    if (input.title !== undefined) item.title = input.title.trim();
    if (input.owner !== undefined) item.owner = input.owner;
    if (input.detail !== undefined) item.detail = input.detail.trim() || null;
    if (input.link !== undefined) item.link = this.checkLink(input.link);
    if (input.blockedOn !== undefined) item.blockedOn = input.blockedOn.trim() || null;
    if (input.due !== undefined) item.due = input.due.trim() || null;
    if (input.status !== undefined && input.status !== item.status) {
      item.status = input.status;
      item.since = SINCE_STATUSES.includes(input.status) ? this.now() : null;
    }
    if (input.since !== undefined) item.since = this.parseSince(input.since);
    item.updatedAt = this.now();
    this.save();
    return item;
  }

  close(id: string, note?: string): Item {
    const item = this.find(id);
    if (item.closed) throw new Error("Item already closed");
    item.closed = { at: this.now(), note: note?.trim() || null };
    item.status = "done";
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
