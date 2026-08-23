// When the agent gets to think.
//
// The Messages API keeps nothing between calls, so every wake resends the whole
// conversation — around 100k tokens by the middle of a game. Waking per action
// meant a run of three taps bought three of those, and 46% of the windows in a
// measured game took no state-changing action at all: they looked at the board,
// maybe said something, and passed.
//
// So the agent waits for you to stop. Any action pushes the deadline back to a
// full delay, and the wake fires once the table has been quiet for it. The
// deadline is public because the client draws it as a countdown above the
// composer — the wait has to be visible or it reads as the agent being asleep.

export const WAKE_DELAY_MS = 3000;

export type WakeReason = "window" | "react";

export class WakeScheduler {
  /** epoch ms the agent will wake at, or null when nothing is pending */
  wakeAt: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private reason: WakeReason = "react";

  constructor(
    private onFire: (reason: WakeReason) => void,
    private onChange: () => void = () => {},
  ) {}

  /** A response-worthy action happened: start or restart the countdown. */
  schedule(reason: WakeReason) {
    // the burst resolves to one window, so it has to be the more thorough of
    // the reasons raised in it
    if (!this.timer) this.reason = reason;
    else if (reason === "window") this.reason = "window";
    this.arm();
  }

  /** Anything else you did. Not worth a window on its own, but you are clearly
   *  still moving, so an already-pending wake waits for you to finish. */
  defer() {
    if (this.timer) this.arm();
  }

  cancel() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.wakeAt = null;
    this.reason = "react";
    this.onChange();
  }

  private arm() {
    if (this.timer) clearTimeout(this.timer);
    this.wakeAt = Date.now() + WAKE_DELAY_MS;
    this.timer = setTimeout(() => this.fire(), WAKE_DELAY_MS);
    this.onChange();
  }

  private fire() {
    const reason = this.reason;
    this.timer = null;
    this.wakeAt = null;
    this.reason = "react";
    this.onChange();
    this.onFire(reason);
  }
}
