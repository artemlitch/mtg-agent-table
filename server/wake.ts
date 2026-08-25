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
//
// How long the wait is depends on what you just did, because the actions mean
// different things. A card moving on the table says you are mid-sequence. A
// message you pressed enter on says you are finished.

export const WAKE_DELAY_MS = 3000;

/** A sent message is a finished thought — you pressed enter. The only thing
 *  left to wait out is a second message arriving right behind the first. */
export const TYPING_DELAY_MS = 300;

/** How long each thing you can do buys before the agent thinks. Absent from
 *  the table means the full wait: at the table you are usually mid-sequence. */
const TRIGGER_DELAYS: Record<string, number> = {
  chat: TYPING_DELAY_MS,
};

export const wakeDelayFor = (action: string) => TRIGGER_DELAYS[action] ?? WAKE_DELAY_MS;

export type WakeReason = "window" | "react";

/** Things you can do on YOUR turn that the agent gets priority over: stack
 *  traffic and blocks. Everything else lands in the log and is read at its
 *  next wake.
 *
 *  Declaring attackers is deliberately not here. Tapping creature after
 *  creature used to buy a reaction window each time, and the agent would
 *  resolve the declaration while you were still adding to it — the attack is
 *  on the stack, but it is not locked in until you say you are finished. The
 *  "Finish declaring attackers" prompt is how you say so, and it sends
 *  finish_attacks, which hands over like a pass (see HANDS_OVER).
 *
 *  Declaring blockers is not here either, and for the identical reason from
 *  the other side of the combat: block used to be reactive, so the first
 *  blocker woke the agent, which locked the declaration in before a second
 *  one could be declared. Two creatures could not gang up on one attacker at
 *  all. "Finish declaring blockers" sends finish_blocks. */
const REACTIVE = new Set([
  "cast", "stack_push", "stack_batch", "stack_resolve", "stack_resolve_all",
  "stack_counter", "stack_remove", "set_turn", "create_token",
]);

/** What one of your actions buys the agent: a full window, a reaction window,
 *  or nothing but a nudge to the countdown — and how long it waits either way.
 *
 *  Acting during the agent's turn always hands the table back, whatever the
 *  action was, because it is the agent's to continue. */
/** The ways you say "over to you". A pass on any stack, and the closing move
 *  of either combat declaration — different events, same effect on whose
 *  window it is, so the wake policy treats them alike and nothing else has to. */
const HANDS_OVER = new Set(["done", "finish_attacks", "finish_blocks"]);

export function wakePlanFor(
  action: string,
  agentsTurn: boolean,
  /** who held priority BEFORE this action — game.waitingOn as it was */
  heldPriority?: string
): { reason: WakeReason | null; delay: number } {
  const delay = wakeDelayFor(action);
  // Passing when you have already passed changes nothing, so it must wake
  // nothing. The prompt does not change until the agent answers, which makes a
  // second press look reasonable, and a wake while the agent is mid-thought
  // preempts it and starts it over. Four presses in a row meant four
  // interrupted windows and no progress at all — the fix has to be here rather
  // than in the button, because the button is only one way to send a pass.
  if (HANDS_OVER.has(action) && heldPriority === "agent") return { reason: null, delay };
  if (HANDS_OVER.has(action) || action === "chat" || agentsTurn) return { reason: "window", delay };
  return { reason: REACTIVE.has(action) ? "react" : null, delay };
}

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
  schedule(reason: WakeReason, delay = WAKE_DELAY_MS) {
    // the burst resolves to one window, so it has to be the more thorough of
    // the reasons raised in it
    if (!this.timer) this.reason = reason;
    else if (reason === "window") this.reason = "window";
    this.arm(delay);
  }

  /** Anything else you did. Not worth a window on its own, but you are clearly
   *  still moving, so an already-pending wake waits for you to finish. */
  defer(delay = WAKE_DELAY_MS) {
    if (this.timer) this.arm(delay);
  }

  cancel() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.wakeAt = null;
    this.reason = "react";
    this.onChange();
  }

  // the wait always comes from the most recent action: saying something after a
  // play means you are done, and playing after saying something means you are not
  private arm(delay: number) {
    if (this.timer) clearTimeout(this.timer);
    this.wakeAt = Date.now() + delay;
    this.timer = setTimeout(() => this.fire(), delay);
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
