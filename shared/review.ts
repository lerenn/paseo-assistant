import { shortId } from "./id";
import type { Item } from "./item";

/**
 * What the Assistant is told to start a task review: the 30-minute heartbeat and the "Review tasks" button send the
 * same text. It lists ALL open tasks (the ones the Tasks and Your Actions tabs render), human items first,
 * each as `short id: title`, then the rules of the reply.
 */
export function buildTaskReviewPrompt(items: readonly Pick<Item, "id" | "title" | "owner" | "closed">[]): string {
  const open = items.filter((i) => !i.closed);
  const ordered = [...open.filter((i) => i.owner === "human"), ...open.filter((i) => i.owner !== "human")];
  const list = ordered.length
    ? `Open tasks (${ordered.length}, yours first):\n${ordered.map((i) => `- ${shortId(i.id)} [${i.owner === "human" ? "human" : "agent"}] ${i.title}`).join("\n")}`
    : "There are no open tasks.";
  return [
    "Look over each current task, check its status and nudge the agents if needed.",
    list,
    "Check every open task above: its status, and the agent or run it waits on. Do not skip or merge tasks. Nudge an agent only through assistant_nudge_check (nudge with send_agent_prompt only when it says allowed). In your reply, list only the tasks that need the human or changed since the last review, one line each (what you saw, the next step). If no task qualifies, reply with exactly one line: \"nothing new\".",
  ].join("\n\n");
}

export const DEFAULT_TASK_REVIEW_MINUTES = 30;

export const DEFAULT_MAILBOX_HEARTBEAT_MINUTES = 15;
