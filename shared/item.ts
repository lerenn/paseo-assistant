import { z } from "zod";

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
