import type { Mail } from "../shared/mail";

export const KIND_LABEL: Record<Mail["kind"], string> = {
  start: "Started",
  blocked: "Blocked",
  needs_louis: "Needs you",
  pr: "PR",
  done: "Done",
};

/** A tab's count badge: empty at zero, capped at 99+. */
export const countBadge = (n: number): string => (n <= 0 ? "" : n > 99 ? "99+" : String(n));

/** The unread count the Mailbox tab shows. */
export const unreadBadge = (mails: readonly Mail[]): string => countBadge(mails.filter((m) => !m.read).length);
