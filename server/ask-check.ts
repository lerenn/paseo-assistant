/** What the Assistant said and did in its last turn, from a timeline page `{ entries: [{ item }] }`. */
export function lastTurn(payload: unknown): { reply: string; queuedDecision: boolean } {
  const entries: unknown[] = Array.isArray((payload as { entries?: unknown[] })?.entries) ? (payload as { entries: unknown[] }).entries : [];
  let reply = "";
  let queued = false;
  for (const entry of entries) {
    const item = ((entry as { item?: unknown }).item ?? entry) as { type?: string; text?: unknown; name?: unknown; detail?: { name?: unknown } };
    if (item?.type === "user_message") {
      // A new turn starts here: only what follows counts.
      reply = "";
      queued = false;
    } else if (item?.type === "assistant_message") {
      reply += String(item.text ?? "");
    } else if (item?.type === "tool_call" && /assistant_decision_add/.test(String(item.name ?? item.detail?.name ?? ""))) {
      queued = true;
    }
  }
  return { reply, queuedDecision: queued };
}

const CHOICE = /(?:^|\n)\s*(?:\(?[a-d1-4][.)]|[-*•])\s+\S/;
const ADDRESSES_USER = /\b(you|your|louis)\b/i;

/**
 * A heuristic: the last paragraph of a reply asks the human something (it ends in a question mark) or offers them
 * options to pick from. Wrong now and then, which is why the answer to it is only a note to the Assistant.
 */
export function asksInChat(reply: string): boolean {
  const paragraphs = reply
    .trim()
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const last = paragraphs[paragraphs.length - 1];
  if (!last) return false;
  const stripped = last.replace(/[\s*_`"'”’)\]>.!\u{1F300}-\u{1FAFF}☀-➿]+$/u, "");
  if (stripped.endsWith("?")) return true;
  // Options listed for the human to choose from, in the last paragraph or just before it.
  const tail = paragraphs.slice(-2).join("\n\n");
  return CHOICE.test(tail) && ADDRESSES_USER.test(tail) && /\b(which|choose|pick|prefer|want|would you|let me know|tell me)\b/i.test(tail);
}

export const CHAT_QUESTION_NOTE =
  "You asked the user in chat; queue it with assistant_decision_add (question, 2 to 4 options, recommended). Questions and choices for the human go in Decisions, never in chat: chat is for status only.";

/** The note to show the Assistant after a turn, or null when none is due. Never changes the reply. */
export function noteForTurn(payload: unknown): string | null {
  const { reply, queuedDecision } = lastTurn(payload);
  return !queuedDecision && asksInChat(reply) ? CHAT_QUESTION_NOTE : null;
}
