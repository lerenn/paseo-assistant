import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Debounce for a burst of mails or answers, so they give one message. */
export const DELIVERY_DEBOUNCE_MS = 5_000;
/** While something is queued and the Assistant is busy, how often its status is checked again. */
export const DELIVERY_POLL_MS = 10_000;
/** What the Review tasks button says to the Assistant, as if the user had typed it. */
export const REVIEW_PROMPT = "Look over each current task, check its status and nudge the agents if needed";
export const WAKE_PROMPT = "New mail in the Assistant mailbox. Process the Assistant mailbox.";

/** Ids of answered decisions the Assistant has not been told about yet; survives a restart. */
export class PendingDeliveries {
  private ids: string[];

  constructor(private readonly file: string) {
    this.ids = this.load();
  }

  private load(): string[] {
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8"));
      return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(this.ids), "utf8");
    renameSync(temp, this.file);
  }

  add(id: string): void {
    if (this.ids.includes(id)) return;
    this.ids.push(id);
    this.save();
  }

  list(): string[] {
    return [...this.ids];
  }

  remove(ids: readonly string[]): void {
    this.ids = this.ids.filter((id) => !ids.includes(id));
    this.save();
  }
}

/**
 * The agent status in what `ref(id).refresh()` returns: `{ agent: { status } }` (older code read `.status` off
 * the result itself, which is always undefined, so nothing was ever seen idle).
 */
export function statusOf(snapshot: unknown): string | null {
  const s = snapshot as { agent?: { status?: unknown }; status?: unknown } | null | undefined;
  const status = s?.agent?.status ?? s?.status;
  return typeof status === "string" ? status : null;
}

/** The agent title in what `ref(id).refresh()` returns (`{ agent: { title } }`), or null. */
export function titleOf(snapshot: unknown): string | null {
  const s = snapshot as { agent?: { title?: unknown }; title?: unknown } | null | undefined;
  const title = s?.agent?.title ?? s?.title;
  return typeof title === "string" && title ? title : null;
}

/**
 * Drops the queued answers once, the first time it runs with this marker file: answers stuck before the status fix
 * were handled by hand. Later starts keep the queue as it is.
 */
export function dropStaleOnce(queue: PendingDeliveries, marker: string): string[] {
  if (existsSync(marker)) return [];
  const ids = queue.list();
  queue.remove(ids);
  mkdirSync(path.dirname(marker), { recursive: true });
  writeFileSync(marker, new Date().toISOString(), "utf8");
  return ids;
}

export interface DeliveryDeps {
  queue: PendingDeliveries;
  /** The Assistant's real status from the Paseo API, or null when unknown. */
  status(): Promise<string | null>;
  /** The text for one queued decision id, or null when it is gone. */
  decisionText(id: string): string | null;
  /** Sends a message that starts a turn; only called once the Assistant was seen idle, twice. */
  send(text: string): Promise<void>;
  /** Called with the queued ids once their message was sent. */
  delivered?(ids: string[]): void;
  debounceMs?: number;
  pollMs?: number;
}

/**
 * Tells the Assistant about new mail and answered decisions, only when it is idle: a running turn is never
 * steered or interrupted. Mail is best effort (the Assistant finds it on its next mailbox read); answers stay
 * queued, on disk, until delivered. Everything pending goes out as one message.
 */
export class Delivery {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private mailPending = false;
  private reviewPending = false;
  private sending = false;
  private stopped = false;

  constructor(private readonly deps: DeliveryDeps) {}

  /** A new mail of any kind arrived. */
  notifyMail(): void {
    this.mailPending = true;
    this.schedule(this.deps.debounceMs ?? DELIVERY_DEBOUNCE_MS);
  }

  /** The user pressed Review tasks: send REVIEW_PROMPT as its own message once the Assistant is idle (queued behind a running turn, never steering it). */
  requestReview(): void {
    this.reviewPending = true;
    this.schedule(0);
  }

  /** A decision was answered in the tab: queue it for delivery. */
  enqueueDecision(id: string): void {
    this.deps.queue.add(id);
    this.schedule(this.deps.debounceMs ?? DELIVERY_DEBOUNCE_MS);
  }

  /** Something may have changed (turn ended, startup): deliver what is queued. */
  poke(): void {
    if (this.mailPending || this.reviewPending || this.deps.queue.list().length) this.schedule(this.deps.debounceMs ?? DELIVERY_DEBOUNCE_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.attempt();
    }, ms);
  }

  private async attempt(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      if ((await this.deps.status()) !== "idle") {
        // Busy or unknown: never interrupt. Mail is picked up on the next mailbox read; answers are retried.
        this.mailPending = false;
        if (this.deps.queue.list().length || this.reviewPending) this.schedule(this.deps.pollMs ?? DELIVERY_POLL_MS);
        return;
      }
      if (this.reviewPending) {
        // Alone, so the Assistant reads exactly what the user asked; anything else waits for the next idle.
        this.reviewPending = false;
        try {
          await this.deps.send(REVIEW_PROMPT);
        } catch (error) {
          console.error("assistant: could not send the task review", error);
          this.reviewPending = true;
        }
        if (this.reviewPending || this.mailPending || this.deps.queue.list().length) this.schedule(this.deps.pollMs ?? DELIVERY_POLL_MS);
        return;
      }
      const ids = this.deps.queue.list();
      const texts = ids.flatMap((id) => {
        const text = this.deps.decisionText(id);
        return text ? [text] : [];
      });
      const mail = this.mailPending;
      this.mailPending = false;
      const parts = [...texts, ...(mail ? [WAKE_PROMPT] : [])];
      if (!parts.length) {
        this.deps.queue.remove(ids);
        return;
      }
      // Re-check right before sending: if the Assistant started a turn meanwhile, wait instead of steering.
      if ((await this.deps.status()) !== "idle") {
        if (ids.length) this.schedule(this.deps.pollMs ?? DELIVERY_POLL_MS);
        return;
      }
      try {
        await this.deps.send(parts.join("\n\n"));
        this.deps.queue.remove(ids);
        this.deps.delivered?.(ids);
      } catch (error) {
        console.error("assistant: could not message the Assistant", error);
        if (ids.length) this.schedule(this.deps.pollMs ?? DELIVERY_POLL_MS);
      }
    } catch (error) {
      console.error("assistant: could not check the Assistant", error);
      if (this.deps.queue.list().length) this.schedule(this.deps.pollMs ?? DELIVERY_POLL_MS);
    } finally {
      this.sending = false;
    }
  }
}
