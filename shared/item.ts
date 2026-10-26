import { z } from "zod";

/** Something the human is waiting on but does not have to decide: "waiting for the cluster rework PR 3". */
export const itemSchema = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string().nullable(),
  /** An http(s) link to what is awaited (a PR, a run), or null. */
  link: z.string().nullable(),
  addedAt: z.number(),
  updatedAt: z.number(),
  closed: z.object({ at: z.number(), note: z.string().nullable() }).nullable(),
});
export type Item = z.output<typeof itemSchema>;

export const isWebLink = (link: string): boolean => {
  try {
    const u = new URL(link);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
};
