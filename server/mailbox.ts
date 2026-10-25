import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mailSchema, type Mail, type MailKind } from "../shared/mail";

const MAX_MAILS = 1000;

export interface NewMail {
  agentId: string;
  agentName: string;
  subject: string;
  body: string;
  kind: MailKind;
}

/** The Assistant's mailbox: a JSON file in the plugin data directory. */
export class MailStore {
  private mails: Mail[];

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
  ) {
    this.mails = this.load();
  }

  private load(): Mail[] {
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8"));
      return Array.isArray(raw) ? raw.flatMap((m) => (mailSchema.safeParse(m).success ? [mailSchema.parse(m)] : [])) : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(this.mails), "utf8");
    renameSync(temp, this.file);
  }

  add(mail: NewMail): Mail {
    const added: Mail = { ...mail, id: randomUUID(), at: this.now(), read: false };
    this.mails.push(added);
    if (this.mails.length > MAX_MAILS) this.mails = this.mails.slice(-MAX_MAILS);
    this.save();
    return added;
  }

  /** Unread first, then newest first. */
  list(options: { unreadOnly?: boolean } = {}): Mail[] {
    return this.mails
      .filter((m) => !options.unreadOnly || !m.read)
      .sort((a, b) => Number(a.read) - Number(b.read) || b.at - a.at);
  }

  /** Marks the given mails (all when `ids` is omitted) read; returns how many changed. */
  markRead(ids?: string[]): number {
    let marked = 0;
    for (const m of this.mails) {
      if (!m.read && (!ids || ids.includes(m.id))) {
        m.read = true;
        marked++;
      }
    }
    if (marked) this.save();
    return marked;
  }
}
