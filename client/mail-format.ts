import type { Mail } from "../shared/mail";

export const KIND_LABEL: Record<Mail["kind"], string> = {
  start: "Started",
  blocked: "Blocked",
  needs_louis: "Needs you",
  pr: "PR",
  done: "Done",
};

/** The unread count the tab shows; empty when everything is read. */
export const unreadBadge = (mails: readonly Mail[]): string => {
  const n = mails.filter((m) => !m.read).length;
  return n === 0 ? "" : n > 99 ? "99+" : String(n);
};
