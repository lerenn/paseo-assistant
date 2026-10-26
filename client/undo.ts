/**
 * Actions that wait out an undo window before they run: `start` begins the wait, `undo` cancels it, and when the
 * time is up `commit` runs once. Used by the × on a decision card: the Assistant is told only after the window.
 */
export class UndoQueue {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private listeners = new Set<() => void>();
  private ids: readonly string[] = [];

  constructor(
    private commitFn: (id: string) => void | Promise<void>,
    readonly delayMs = 5_000,
  ) {}

  /** The latest commit handler; the queue outlives the component that renders it. */
  setCommit(fn: (id: string) => void | Promise<void>): void {
    this.commitFn = fn;
  }

  start(id: string): void {
    if (this.timers.has(id)) return;
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        this.publish();
        void Promise.resolve(this.commitFn(id)).catch((error) => console.error("assistant: could not cancel the decision", error));
      }, this.delayMs),
    );
    this.publish();
  }

  undo(id: string): void {
    const timer = this.timers.get(id);
    if (!timer) return;
    clearTimeout(timer);
    this.timers.delete(id);
    this.publish();
  }

  /** Ids waiting out their window; a stable array until it changes (for useSyncExternalStore). */
  pending = (): readonly string[] => this.ids;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  private publish(): void {
    this.ids = [...this.timers.keys()];
    for (const l of this.listeners) l();
  }
}
