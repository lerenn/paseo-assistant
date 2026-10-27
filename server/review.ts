/** While a review waits for the Assistant to finish its turn, how often its status is checked. */
export const REVIEW_POLL_MS = 10_000;

export interface ReviewDeps {
  /** Minutes between reviews, read at each scheduling; 0 or less means off. */
  minutes(): number;
  /** The Assistant's real status, or null when unknown. */
  status(): Promise<string | null>;
  /** Sends the review prompt as a message that starts a turn; only called when the Assistant was seen idle, twice. */
  send(text: string): Promise<void>;
  /** The review prompt, built when it is sent so it lists the open tasks at that moment. */
  prompt(): string;
  pollMs?: number;
}

/**
 * Sends the Assistant a task review every N minutes. Like the other deliveries it never steers a running turn: a
 * review that finds the Assistant busy stays queued and goes out when it is idle. While one is queued, further ticks
 * are skipped, so reviews never pile up.
 */
export class ReviewScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private poll: ReturnType<typeof setTimeout> | null = null;
  private queued = false;
  private stopped = true;

  constructor(private readonly deps: ReviewDeps) {}

  /** True while a review waits for the Assistant to become idle. */
  get isQueued(): boolean {
    return this.queued;
  }

  start(): void {
    this.stopped = false;
    this.reschedule();
  }

  /** (Re)starts the countdown with the current interval; call it when the setting changes. */
  reschedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.stopped) return;
    const minutes = this.deps.minutes();
    if (!(minutes > 0)) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.tick();
      this.reschedule();
    }, minutes * 60_000);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.poll) clearTimeout(this.poll);
    this.timer = this.poll = null;
    this.queued = false;
  }

  /** One tick: queue a review unless one is already queued. */
  tick(): void {
    if (this.stopped || this.queued) return;
    this.queued = true;
    void this.attempt();
  }

  private async attempt(): Promise<void> {
    if (this.stopped) return;
    try {
      // Re-check right before sending: if a turn started meanwhile, keep waiting instead of steering.
      if ((await this.deps.status()) === "idle" && (await this.deps.status()) === "idle") {
        await this.deps.send(this.deps.prompt());
        this.queued = false;
        return;
      }
    } catch (error) {
      console.error("assistant: task review not sent", error);
    }
    if (!this.stopped) this.poll = setTimeout(() => void this.attempt(), this.deps.pollMs ?? REVIEW_POLL_MS);
  }
}
