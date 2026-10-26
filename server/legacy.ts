import { readFileSync } from "node:fs";
import { mailSchema, type Mail } from "../shared/mail";

/** The mails of the old `mailbox.json`, for the one-time import into Agents Mail. Read only: nothing is stored here any more. */
export function readLegacyMail(file: string): Mail[] {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(raw) ? raw.flatMap((m) => (mailSchema.safeParse(m).success ? [mailSchema.parse(m)] : [])) : [];
  } catch {
    return [];
  }
}
