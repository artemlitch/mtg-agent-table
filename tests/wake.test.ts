// The agent thinks once, when you stop moving. Every call it makes resends the
// whole conversation, so a window that only acknowledges what you did is the
// most expensive kind of nothing.
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { WakeScheduler, WAKE_DELAY_MS } from "../server/wake";

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

  test("cancel drops a pending wake", () => {
    s.schedule("window");
    s.cancel();
    vi.advanceTimersByTime(WAKE_DELAY_MS * 2);
    expect(fired).toEqual([]);
    expect(s.wakeAt).toBeNull();
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
});
