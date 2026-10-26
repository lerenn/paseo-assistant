export const SHORT_ID_LENGTH = 8;

/** The short id shown on a card: the first 8 characters of the id. */
export const shortId = (id: string): string => id.slice(0, SHORT_ID_LENGTH);

/**
 * Finds a record by its full id or by a prefix of it (4+ characters, case-insensitive). Throws on no match, and on a
 * prefix that fits several records. `noun` words the errors ("decision", "item").
 */
export function findById<T extends { id: string }>(records: readonly T[], ref: string, noun: string): T {
  const wanted = ref.trim().toLowerCase();
  if (wanted.length < 4) throw new Error(`"${ref}" is too short for a ${noun} id; use the 8 character id on its card or the full id`);
  const exact = records.find((r) => r.id.toLowerCase() === wanted);
  if (exact) return exact;
  const hits = records.filter((r) => r.id.toLowerCase().startsWith(wanted));
  if (hits.length === 0) throw new Error(`Unknown ${noun}`);
  if (hits.length > 1) throw new Error(`"${ref}" matches ${hits.length} ${noun}s (${hits.map((r) => shortId(r.id)).join(", ")}); use more characters`);
  return hits[0];
}
