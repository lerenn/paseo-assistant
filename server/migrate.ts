import { existsSync, renameSync } from "node:fs";
import { readLegacyMail } from "./legacy";
import type { AgentsMailClient } from "./agentsmail";

/**
 * Moves the Assistant's own mailbox file into Agents Mail, once. The file is renamed afterwards so it is never
 * imported twice (the import is idempotent anyway). Without Agents Mail the file stays and the next try imports it.
 */
export async function migrateLegacyMail(file: string, client: AgentsMailClient): Promise<number | null> {
  if (!existsSync(file)) return null;
  const mails = readLegacyMail(file);
  // The former kinds were folded into `blocked`; Agents Mail has no use for them.
  const normalized = mails.map((m) => ({ ...m, kind: m.kind === "needs_louis" || m.kind === "needs_user" ? "blocked" : m.kind }));
  if (normalized.length > 0) await client.importMails(normalized);
  renameSync(file, `${file}.migrated`);
  return mails.length;
}
