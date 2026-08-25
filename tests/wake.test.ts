// The agent thinks once, when you stop moving. Every call it makes resends the
// whole conversation, so a window that only acknowledges what you did is the
// most expensive kind of nothing.
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { WakeScheduler, WAKE_DELAY_MS, TYPING_DELAY_MS, wakeDelayFor, wakePlanFor } from "../server/wake";

describe("what your action buys the agent", () => {
  const onYourTurn = (a: string) => wakePlanFor(a, false).reason;
  const onTheirTurn = (a: string) => wakePlanFor(a, true).reason;

  test("declaring attackers does not wake it — they are not locked in until you say so", () => {
    // tapping creature after creature used to fire a reaction window each time,
    // and the agent would resolve the declaration while you were still adding
    // to it. Finishing is now an explicit press.
    expect(onYourTurn("attack")).toBeNull();
  });

  test("and declaring blockers does not either — the same rule, other seat", () => {
    // block WAS reactive, which is why a multi-block could not be declared at
    // all: the first blocker woke the agent, and it locked the declaration in
    // before the second one had been named.
    expect(onYourTurn("block")).toBeNull();
  });

  test("but a spell cast in the middle of declaring still does", () => {
    expect(onYourTurn("cast")).toBe("react");
    expect(onYourTurn("stack_push")).toBe("react");
  });

  test("finishing, or saying something, is a full window", () => {
    expect(onYourTurn("done")).toBe("window");
    expect(onYourTurn("chat")).toBe("window");
  });

  test("during the agent's turn anything hands the table back — including an attack", () => {
    expect(onTheirTurn("tap")).toBe("window");
    expect(onTheirTurn("attack")).toBe("window");
  });

  test("moving your own cards around only pushes the countdown back", () => {
    for (const a of ["tap", "move", "draw", "life", "set_phase"]) expect(onYourTurn(a)).toBeNull();
  });

  test("passing again when you have already passed wakes nothing", () => {
    // seen in play: the prompt does not change until the agent answers, so a
    // second press looks reasonable — and each one preempted the agent
    // mid-thought and restarted it. Four presses, four interrupted windows,
    // nothing ever finished. A pass that changes nothing must wake nothing.
    expect(wakePlanFor("done", false, "agent").reason).toBeNull();
  });

  test("...but the first pass still hands over", () => {
    expect(wakePlanFor("done", false, "you").reason).toBe("window");
  });

  // Closing an attack declaration is its own action, not a pass — and the
  // wake policy is the one place the two must behave alike. Miss it and the
  // press hands the window over with nothing scheduled to answer it.
  test("finishing a declaration hands over exactly like a pass", () => {
    expect(wakePlanFor("finish_attacks", false, "you").reason).toBe("window");
    expect(wakePlanFor("finish_attacks", false, "agent").reason).toBeNull();
    expect(wakeDelayFor("finish_attacks")).toBe(WAKE_DELAY_MS);
  });

  test("...and so does finishing the blocks — it is the same kind of move", () => {
    expect(wakePlanFor("finish_blocks", false, "you").reason).toBe("window");
    expect(wakePlanFor("finish_blocks", true, "you").reason).toBe("window");
    expect(wakeDelayFor("finish_blocks")).toBe(WAKE_DELAY_MS);
  });

  test("the plan carries the delay too, so the caller asks once", () => {
    expect(wakePlanFor("chat", false)).toEqual({ reason: "window", delay: TYPING_DELAY_MS });
    expect(wakePlanFor("cast", false)).toEqual({ reason: "react", delay: WAKE_DELAY_MS });
    expect(wakePlanFor("attack", false)).toEqual({ reason: null, delay: WAKE_DELAY_MS });
  });
});

describe("how long each trigger buys", () => {
  test("a sent message only waits out a fast second message", () => {
    expect(wakeDelayFor("chat")).toBe(TYPING_DELAY_MS);
    expect(TYPING_DELAY_MS).toBeLessThan(WAKE_DELAY_MS);
  });

  test("everything you do at the table gets the full wait", () => {
    for (const t of ["cast", "done", "tap", "stack_push", "move", "attack"]) {
      expect(wakeDelayFor(t)).toBe(WAKE_DELAY_MS);
    }
  });
});

describe("wake debounce", () => {
  let fired: string[];
  let changes: number;
  let s: WakeScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    fired = [];
    changes = 0;
    s = new WakeScheduler((r) => fired.push(r), () => changes++);
  });
  afterEach(() => vi.useRealTimers());

  test("one action wakes the agent once the table goes quiet", () => {
    s.schedule("react");
    vi.advanceTimersByTime(WAKE_DELAY_MS - 1);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(fired).toEqual(["react"]);
  });

  test("a burst of actions collapses into a single wake", () => {
    s.schedule("react");
    vi.advanceTimersByTime(2000);
    s.schedule("react");
    vi.advanceTimersByTime(2000);
    s.schedule("react");
    vi.advanceTimersByTime(WAKE_DELAY_MS);
    expect(fired).toEqual(["react"]); // three actions, one window
  });

  test("an action that would not wake on its own still pushes the countdown back", () => {
    s.schedule("react");
    vi.advanceTimersByTime(2000);
    s.defer(); // tapping a land mid-thought: not worth a window, but you are still busy
    vi.advanceTimersByTime(2000);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(fired).toEqual(["react"]);
  });

  test("deferring with nothing pending never conjures a wake", () => {
    s.defer();
    vi.advanceTimersByTime(WAKE_DELAY_MS * 3);
    expect(fired).toEqual([]);
    expect(s.wakeAt).toBeNull();
  });

  test("a full window outranks a reaction raised in the same burst", () => {
    s.schedule("react");
    s.schedule("window");
    s.schedule("react");
    vi.advanceTimersByTime(WAKE_DELAY_MS);
    expect(fired).toEqual(["window"]);
  });

  test("the upgraded reason does not leak into the next burst", () => {
    s.schedule("window");
    vi.advanceTimersByTime(WAKE_DELAY_MS);
    s.schedule("react");
    vi.advanceTimersByTime(WAKE_DELAY_MS);
    expect(fired).toEqual(["window", "react"]);
  });

  // what undo does: the action being rewound is the one that armed the wake,
  // so after the rewind there is nothing left to answer
  test("cancel drops a pending wake, and no later tick revives it", () => {
    s.schedule("window");
    s.cancel();
    vi.advanceTimersByTime(WAKE_DELAY_MS * 2);
    expect(fired).toEqual([]);
    expect(s.wakeAt).toBeNull();
    // a cancelled wake is gone, not paused: deferring must not bring it back
    s.defer();
    vi.advanceTimersByTime(WAKE_DELAY_MS * 2);
    expect(fired).toEqual([]);
  });

  test("wakeAt carries the deadline so the client can draw the countdown", () => {
    const t0 = Date.now();
    s.schedule("react");
    expect(s.wakeAt).toBe(t0 + WAKE_DELAY_MS);
    vi.advanceTimersByTime(1000);
    s.defer();
    expect(s.wakeAt).toBe(t0 + 1000 + WAKE_DELAY_MS); // reset to full, not topped up
    vi.advanceTimersByTime(WAKE_DELAY_MS);
    expect(s.wakeAt).toBeNull();
  });

  test("every move of the deadline announces itself, so the bar can follow", () => {
    s.schedule("react"); // start
    vi.advanceTimersByTime(500);
    s.defer(); // reset
    vi.advanceTimersByTime(WAKE_DELAY_MS); // fire
    expect(changes).toBe(3);
  });

  test("the deadline is null before anything is pending", () => {
    expect(s.wakeAt).toBeNull();
  });

  test("a sent message answers almost at once", () => {
    s.schedule("window", TYPING_DELAY_MS);
    vi.advanceTimersByTime(TYPING_DELAY_MS);
    expect(fired).toEqual(["window"]);
  });

  test("the most recent action sets the wait, so a message after a play is still quick", () => {
    s.schedule("react"); // a play: three seconds
    vi.advanceTimersByTime(1000);
    s.schedule("window", TYPING_DELAY_MS); // then you say something: you are done
    vi.advanceTimersByTime(TYPING_DELAY_MS);
    expect(fired).toEqual(["window"]);
  });

  test("...and a play after a message goes back to the full wait", () => {
    s.schedule("window", TYPING_DELAY_MS);
    vi.advanceTimersByTime(100);
    s.defer(); // still moving
    vi.advanceTimersByTime(TYPING_DELAY_MS);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(WAKE_DELAY_MS);
    expect(fired).toEqual(["window"]); // the reason survives, the wait does not
  });
});
