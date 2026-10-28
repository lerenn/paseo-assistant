import type { Item } from "../shared/item";

/** The small line under an item's detail: what it is blocked on, since when, and the due date; null when there is none. */
export function metaLine(item: Item): string | null {
  const parts = [item.blockedOn ? `on ${item.blockedOn}` : null, item.since && !item.closed ? `since ${new Date(item.since).toLocaleString()}` : null, item.due ? `due ${item.due}` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** The timestamp of an item: when it was closed (with the note), or when it was added. */
export function stampLine(item: Item): string {
  return item.closed ? `closed ${new Date(item.closed.at).toLocaleString()}${item.closed.note ? ` · ${item.closed.note}` : ""}` : `since ${new Date(item.addedAt).toLocaleString()}`;
}
