import { z } from "zod";

export const ITEM_STATUSES = ["current", "waiting", "blocked", "future", "recurring", "done"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** Something the human is waiting on but does not have to decide: "waiting for the cluster rework PR 3". */
export const itemSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** Who has to act: `human` items are things the user must DO (shown in Your actions); `agent` ones are waits. Items saved before this field are `agent`. */
  owner: z.enum(["human", "agent"]).default("agent"),
  detail: z.string().nullable(),
  /** An http(s) link to what is awaited (a PR, a run), or null. */
  link: z.string().nullable(),
  addedAt: z.number(),
  updatedAt: z.number(),
  closed: z.object({ at: z.number(), note: z.string().nullable() }).nullable(),
  /** Where the task stands. Items saved before this field are `current`; closing an item makes it `done` (see `statusOf`). */
  status: z.enum(ITEM_STATUSES).default("current"),
  /** What a `blocked` or `waiting` task is stuck on, free text. */
  blockedOn: z.string().nullable().default(null),
  /** When it became `blocked` or `waiting` (set automatically on that change, editable). */
  since: z.number().nullable().default(null),
  /** Free text: a date, or a trigger such as "when the idle gate opens". */
  due: z.string().nullable().default(null),
});
export type Item = z.output<typeof itemSchema>;
export type ItemOwner = Item["owner"];

export const isWebLink = (link: string): boolean => {
  try {
    const u = new URL(link);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
};

/** An open item nobody has touched for this long is flagged "stale?" in the panel. */
export const STALE_AFTER_MS = 24 * 3_600_000;

export const isStale = (item: Pick<Item, "updatedAt" | "closed">, now: number): boolean => !item.closed && now - item.updatedAt > STALE_AFTER_MS;

/** The status of an item: a closed item is always `done`, whatever was stored. */
export const statusOf = (item: Pick<Item, "status" | "closed">): ItemStatus => (item.closed ? "done" : item.status);

/** The Done group of the Tasks tab keeps closed items for this long. */
export const DONE_VISIBLE_MS = 24 * 3_600_000;

/** Statuses whose `since` is set automatically when an item enters them. */
export const SINCE_STATUSES: readonly ItemStatus[] = ["blocked", "waiting"];
