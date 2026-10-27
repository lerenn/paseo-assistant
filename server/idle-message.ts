import { REVIEW_POLL_MS } from "./review";

export interface IdleMessageDeps {
  /** The Assistant's real status, or null when unknown. */
  status(): Promise<string | null>;
  send(text: string): Promise<void>;
  pollMs?: number;
}

/**
 * One message for the Assistant that waits for it to be idle (never steers a running turn). A newer request replaces
 * the one still waiting, so a burst of changes gives one message.
 */
export class IdleMessage {
  private text: string | null = null;
  private poll: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(private readonly deps: IdleMessageDeps) {}

  get isQueued(): boolean {
    return this.text !== null;
  }

  request(text: string): void {
    this.text = text;
    if (!this.poll) void this.attempt();
  }

  stop(): void {
    this.stopped = true;
    if (this.poll) clearTimeout(this.poll);
    this.poll = null;
    this.text = null;
  }

  private async attempt(): Promise<void> {
    this.poll = null;
    if (this.stopped || this.text === null) return;
    try {
      if ((await this.deps.status()) === "idle" && (await this.deps.status()) === "idle" && this.text !== null) {
        const text = this.text;
        this.text = null;
        await this.deps.send(text);
        return;
      }
    } catch (error) {
      console.error("assistant: message not sent", error);
    }
    if (!this.stopped && this.text !== null) this.poll = setTimeout(() => void this.attempt(), this.deps.pollMs ?? REVIEW_POLL_MS);
  }
}
