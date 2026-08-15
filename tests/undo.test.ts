// Undo: per-action snapshots, state rewind, monotonic seq, log notice.
import { describe, test, expect, beforeEach } from "bun:test";
import { game, resetGameState, applyAction, addLog, getNextCardId } from "../server/game";
import { recordSnapshot, dropLastSnapshot, undoLast, clearHistory, historySize } from "../server/history";

function doAction(actor: "you" | "agent", type: string, params: any = {}) {
  recordSnapshot();
  try {
    return applyAction(actor, type, params);
  } catch (e) {
    dropLastSnapshot();
    throw e;
  }
}

beforeEach(() => {
  resetGameState();
  clearHistory();
});

describe("undo", () => {
  test("undo reverts the last action and reports what was undone", () => {
    doAction("you", "life", { player: "you", delta: -5 });
    expect(game.players.you.life).toBe(35);
    const undone = undoLast();
    expect(game.players.you.life).toBe(40);
    expect(undone).toContain("life is now 35");
  });

  test("the undone action's log entry is gone; seq stays monotonic", () => {
    doAction("you", "life", { player: "you", delta: -5 });
    const seqAfter = game.seq;
    undoLast();
    expect(game.log.some((e) => e.text.includes("life is now 35"))).toBe(false);
    const notice = addLog("system", "undo notice");
    expect(notice.seq).toBeGreaterThan(seqAfter);
  });

  test("repeated undo steps back one action at a time", () => {
    doAction("you", "create_token", { name: "Treasure", n: 1 });
    doAction("you", "life", { player: "agent", delta: -3 });
    undoLast();
    expect(game.players.agent.life).toBe(40);
    expect(game.players.you.zones.battlefield.length).toBe(1);
    undoLast();
    expect(game.players.you.zones.battlefield.length).toBe(0);
  });

  test("undo restores stack state", () => {
    doAction("you", "stack_push", { text: "some trigger" });
    expect(game.stack.length).toBe(1);
    undoLast();
    expect(game.stack.length).toBe(0);
  });

  test("card id counter never goes backwards across undo", () => {
    doAction("you", "create_token", { name: "Clue", n: 2 });
    const before = getNextCardId();
    undoLast();
    expect(getNextCardId()).toBeGreaterThanOrEqual(before);
  });

  test("undo with no history returns null", () => {
    expect(undoLast()).toBeNull();
  });

  test("failed actions leave no snapshot behind", () => {
    expect(() => doAction("you", "move", { card: "bogus", toZone: "exile" })).toThrow();
    expect(historySize()).toBe(0);
  });
});

