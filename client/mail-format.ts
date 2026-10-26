import type { Mail } from "../shared/mail";

const KIND_LABELS: Record<string, string> = {
  start: "Started",
  blocked: "Blocked",
  pr: "PR",
  done: "Done",
  question: "Question",
  info: "Info",
  // Former kinds, shown as the blocked mails they became.
  needs_louis: "Blocked",
  needs_user: "Blocked",
  needs_human: "Blocked",
};

/** A readable label for a mail kind; an unknown tag is shown as sent. */
export const kindLabel = (kind: string): string => KIND_LABELS[kind] ?? kind;

/** A tab's count badge: empty at zero, capped at 99+. */
export const countBadge = (n: number): string => (n <= 0 ? "" : n > 99 ? "99+" : String(n));

/** The unread count the Mailbox tab shows. */
export const unreadBadge = (mails: readonly Mail[]): string => countBadge(mails.filter((m) => !m.read).length);
