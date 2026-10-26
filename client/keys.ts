/** The key event fields we read; a web key event has them, a native one has `key` only. */
export interface KeyEventLike {
  key?: string;
  shiftKey?: boolean;
  /** True while an input method (IME) is composing text: Enter then confirms the composition, not the answer. */
  isComposing?: boolean;
}

/** Enter sends the answer; Shift+Enter inserts a newline; Enter confirming an IME composition does neither. */
export const isSendKey = (e: KeyEventLike): boolean => e.key === "Enter" && !e.shiftKey && !e.isComposing;

/** Whether an answer can go out now: something typed, and no answer in flight. */
export const canSend = (text: string, busy: boolean): boolean => !busy && text.trim().length > 0;
