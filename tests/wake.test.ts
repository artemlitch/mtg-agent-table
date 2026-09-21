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
    expect(wakePlanFor("chat", false)).toEqual({ reason: "window", delay: TYPING_DELAY_MS, preempt: true });
    expect(wakePlanFor("cast", false)).toEqual({ reason: "react", delay: WAKE_DELAY_MS, preempt: true });
    expect(wakePlanFor("attack", false)).toEqual({ reason: null, delay: WAKE_DELAY_MS, preempt: true });
  });

  // Live, twice in one game: the agent asked Player to fix their life total
  // and went on with its turn; Player clicked the total down four times, and
  // since anything on the agent's turn is a window, each click cut the turn
  // in flight and restarted it from the top. Then Player moved a creature the
  // agent had just killed from graveyard to exile — two clicks, two more cuts.
  // Bookkeeping still hands the table back to an agent that is WAITING, but it
  // never interrupts one that is WORKING: what changed rides back inside its
  // next tool result anyway.
  test("bookkeeping on the agent's turn still wakes an idle agent, but does not preempt a busy one", () => {
    for (const a of ["life", "counters", "tap", "untap", "move", "tuck", "set_pt", "commander_damage"]) {
      expect(wakePlanFor(a, true)).toEqual({ reason: "window", delay: WAKE_DELAY_MS, preempt: false });
    }
  });

  test("...while a spell, a stack item, a pass or a word on the agent's turn preempts as before", () => {
    for (const a of ["cast", "stack_push", "done", "chat", "attack", "block"]) {
      expect(wakePlanFor(a, true).preempt).toBe(true);
    }
  });

  test("...and on your own turn bookkeeping wakes nothing at all, as before", () => {
    expect(wakePlanFor("life", false).reason).toBeNull();
    expect(wakePlanFor("move", false).reason).toBeNull();
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

  // A pending countdown lives in this object and nowhere else, so a restart
  // eats it. Live: Player resolved combat damage (reactive, countdown armed),
  // the server restarted seconds later, and the table came back on the AGENT's
  // turn with an empty stack, the window on Player and nothing scheduled —
  // neither seat had a move that would wake anything. Ten minutes on the
  // manual Pass button.
  test("a restart does not eat the wake the agent's own turn owes", () => {
    s.rearmAfterRestore({ started: true, turn: "agent" });
    expect(s.wakeAt).toBe(Date.now() + WAKE_DELAY_MS);
    vi.advanceTimersByTime(WAKE_DELAY_MS);
    expect(fired).toEqual(["window"]);
  });

  // Every other shape is waiting on PLAYER, whose next action arms a countdown
  // the ordinary way. Arming one here would wake the agent into a table where
  // nothing had happened since its last window.
  test("...and does not conjure one where Player is the seat to move", () => {
    s.rearmAfterRestore({ started: true, turn: "you" });
    expect(s.wakeAt).toBeNull();
    vi.advanceTimersByTime(WAKE_DELAY_MS * 2);
    expect(fired).toEqual([]);
  });

  // nothing has been dealt yet: the wake that starts a game is the deal's, and
  // a restore of an unstarted table must not fire one into an empty board
  test("...nor before the game has started at all", () => {
    s.rearmAfterRestore({ started: false, turn: "agent" });
    expect(s.wakeAt).toBeNull();
    vi.advanceTimersByTime(WAKE_DELAY_MS * 2);
    expect(fired).toEqual([]);
  });

  // SPACE on a "waiting for the agent" prompt: you are done, skip the wait
  test("fireNow skips the rest of a countdown and fires the reason it was armed with", () => {
    s.schedule("window");
    vi.advanceTimersByTime(500);
    expect(s.fireNow()).toBe(true);
    expect(fired).toEqual(["window"]);
    expect(s.wakeAt).toBeNull();
    // fired once — the old timer must not go off again at its own deadline
    vi.advanceTimersByTime(WAKE_DELAY_MS * 2);
    expect(fired).toEqual(["window"]);
  });

  test("fireNow with nothing pending wakes nothing — it hurries, it never summons", () => {
    expect(s.fireNow()).toBe(false);
    vi.advanceTimersByTime(WAKE_DELAY_MS * 2);
    expect(fired).toEqual([]);
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

describe("whether a wake may cut a window in flight", () => {
  let fired: { reason: string; preempt: boolean }[];
  let s: WakeScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    fired = [];
    s = new WakeScheduler((reason, preempt) => fired.push({ reason, preempt }));
  });
  afterEach(() => vi.useRealTimers());

  test("a wake preempts unless every action in its burst said not to", () => {
    s.schedule("window", WAKE_DELAY_MS, false);
    vi.advanceTimersByTime(WAKE_DELAY_MS);
    expect(fired).toEqual([{ reason: "window", preempt: false }]);
  });

  test("one preempting action in the burst makes the whole burst preempt", () => {
    s.schedule("window", WAKE_DELAY_MS, false); // a life click
    vi.advanceTimersByTime(1000);
    s.schedule("react", WAKE_DELAY_MS, true); // then a spell
    vi.advanceTimersByTime(WAKE_DELAY_MS);
    expect(fired).toEqual([{ reason: "window", preempt: true }]);
  });

  test("the choice does not leak into the next burst", () => {
    s.schedule("window", WAKE_DELAY_MS, false);
    vi.advanceTimersByTime(WAKE_DELAY_MS);
    s.schedule("react");
    vi.advanceTimersByTime(WAKE_DELAY_MS);
    expect(fired.map((f) => f.preempt)).toEqual([false, true]);
  });
});

// Live, three times in one game: a countdown armed by an earlier reaction
// fired while Player was still tapping attackers one at a time, and the agent
// woke into a window whose prompt told it to do nothing but wait. Each
// declaration action only pushed the deadline back three seconds, which is
// less than a person takes to think between creatures. While a declaration
// of Player's is open on top of the stack, the countdown waits for the finish
// press instead of guessing.
describe("holding the countdown while Player is declaring", () => {
  let fired: string[];
  let held: boolean;
  let s: WakeScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    fired = [];
    held = false;
    s = new WakeScheduler((r) => fired.push(r), () => {}, () => held);
  });
  afterEach(() => vi.useRealTimers());

  test("a countdown that comes due mid-declaration waits, and fires once the declaration is finished", () => {
    s.schedule("react");
    held = true; // Player started declaring inside the countdown
    vi.advanceTimersByTime(WAKE_DELAY_MS * 4);
    expect(fired).toEqual([]);
    expect(s.wakeAt).not.toBeNull(); // still owed, still visible
    held = false; // finish_attacks
    vi.advanceTimersByTime(WAKE_DELAY_MS);
    expect(fired).toEqual(["react"]);
  });

  test("the reason it was armed with survives the hold", () => {
    s.schedule("window");
    held = true;
    vi.advanceTimersByTime(WAKE_DELAY_MS * 2);
    held = false;
    vi.advanceTimersByTime(WAKE_DELAY_MS);
    expect(fired).toEqual(["window"]);
  });

  test("SPACE still fires through the hold — a press that says now beats a guess", () => {
    s.schedule("react");
    held = true;
    expect(s.fireNow()).toBe(true);
    expect(fired).toEqual(["react"]);
  });

  test("with nothing to hold, the scheduler behaves exactly as before", () => {
    s.schedule("react");
    vi.advanceTimersByTime(WAKE_DELAY_MS);
    expect(fired).toEqual(["react"]);
  });
});
