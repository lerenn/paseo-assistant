/** Wakes the Assistant for new mail, only when it is idle, and one wake per burst of mails. */
export const WAKE_DEBOUNCE_MS = 5_000;
export const WAKE_PROMPT = "New mail in the Assistant mailbox. Process the Assistant mailbox.";

export interface WakeDeps {
  /** The Assistant's real status from the Paseo API, or null when unknown. */
  status(): Promise<string | null>;
  /** Starts a turn; only called once the Assistant was seen idle. */
  wake(text: string): Promise<void>;
  debounceMs?: number;
}

export class MailWaker {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: WakeDeps) {}

  /** Call for every new mail, whatever its kind. */
  notify(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.fire();
    }, this.deps.debounceMs ?? WAKE_DEBOUNCE_MS);
  }

  private async fire(): Promise<void> {
    try {
      // A running Assistant is never interrupted: it reads the mail on its next mailbox read.
      // Unknown or failing status counts as not idle, for the same reason.
      if ((await this.deps.status()) !== "idle") return;
      await this.deps.wake(WAKE_PROMPT);
    } catch (error) {
      console.error("assistant: could not wake the Assistant", error);
    }
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
