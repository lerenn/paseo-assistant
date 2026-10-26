/** The spinner turns in steps of this many degrees every SPIN_MS: 12 steps a turn, about one turn a second. */
export const STEP_DEG = 30;
export const SPIN_MS = 80;

export const nextAngle = (angle: number): number => (angle + STEP_DEG) % 360;

/**
 * Starts turning: calls `onAngle` with each new angle until the returned stop function runs. A plain timer, not an
 * Animated.loop: the loop with the native driver ran once and stopped on the web host, and a timer works the same on
 * every host.
 */
export function startSpinner(onAngle: (angle: number) => void, every: number = SPIN_MS): () => void {
  let angle = 0;
  const timer = setInterval(() => {
    angle = nextAngle(angle);
    onAngle(angle);
  }, every);
  return () => clearInterval(timer);
}
