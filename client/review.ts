export type ReviewResult = "sent" | "queued" | "no-assistant";

export type ReviewState = { phase: "idle" } | { phase: "sending" } | { phase: "done"; result: "sent" | "queued" } | { phase: "error"; message: string };

export const REVIEW_NO_ASSISTANT_HINT = "The Assistant has not started yet";

/** The label of the Review tasks button for its state. */
export function reviewLabel(state: ReviewState): string {
  switch (state.phase) {
    case "sending":
      return "Sending…";
    case "done":
      return state.result === "queued" ? "Queued" : "Sent";
    case "error":
      return "Not sent";
    default:
      return "Review tasks";
  }
}

/** Disabled while a request is in flight, and when there is no Assistant agent to message (the tooltip says why). */
export function reviewDisabled(hasAssistant: boolean, state: ReviewState): { disabled: boolean; hint: string | null } {
  if (!hasAssistant) return { disabled: true, hint: REVIEW_NO_ASSISTANT_HINT };
  return { disabled: state.phase === "sending", hint: null };
}

/** The click: asks the server to message the Assistant, reporting each state through `setState`. Never throws. */
export async function runReview(hasAssistant: boolean, call: () => Promise<{ result: ReviewResult }>, setState: (s: ReviewState) => void): Promise<void> {
  if (!hasAssistant) return;
  setState({ phase: "sending" });
  try {
    const { result } = await call();
    setState(result === "no-assistant" ? { phase: "error", message: REVIEW_NO_ASSISTANT_HINT } : { phase: "done", result });
  } catch (error) {
    setState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
  }
}
