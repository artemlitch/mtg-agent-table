// Undo: per-action snapshots, state rewind, monotonic seq, log notice.
import { describe, test, expect, beforeEach } from "bun:test";
import { game, resetGameState, applyAction, addLog, getNextCardId } from "../server/game";
import { recordSnapshot, dropLastSnapshot, undoLast, redoLast, redoSize, clearHistory, historySize } from "../server/history";

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


describe("redo", () => {
  test("redo walks forward again over what was undone", () => {
    doAction("you", "life", { player: "you", delta: -5 });
    undoLast();
    expect(game.players.you.life).toBe(40);
    const redone = redoLast();
    expect(game.players.you.life).toBe(35);
    expect(redone).toContain("life is now 35");
  });

  test("undo and redo walk a whole run in both directions", () => {
    for (let i = 0; i < 4; i++) doAction("you", "life", { player: "agent", delta: -1 });
    for (let i = 0; i < 4; i++) undoLast();
    expect(game.players.agent.life).toBe(40);
    for (let i = 0; i < 4; i++) redoLast();
    expect(game.players.agent.life).toBe(36);
  });

  test("a new action throws the forward history away", () => {
    doAction("you", "life", { player: "you", delta: -5 });
    undoLast();
    expect(redoSize()).toBe(1);
    doAction("you", "life", { player: "you", delta: -2 }); // branches off
    expect(redoSize()).toBe(0);
    expect(redoLast()).toBeNull();
    expect(game.players.you.life).toBe(38);
  });

  test("a redo is not itself a new action — you can keep stepping", () => {
    doAction("you", "life", { player: "you", delta: -1 });
    doAction("you", "life", { player: "you", delta: -1 });
    undoLast();
    undoLast();
    redoLast();
    expect(redoSize()).toBe(1); // the second step is still ahead of us
    expect(game.players.you.life).toBe(39);
    undoLast(); // and stepping back again re-arms it
    expect(redoSize()).toBe(2);
  });

  test("redo with nothing undone returns null", () => {
    doAction("you", "life", { player: "you", delta: -1 });
    expect(redoLast()).toBeNull();
  });
});

describe("undo reporting and history depth", () => {
  test("repeated undos report the real actions, not previous undo notices", () => {
    doAction("you", "life", { player: "you", delta: -1 });   // 39
    addLog("system", "↩ Player undid: something");            // a notice, not an action
    doAction("you", "life", { player: "you", delta: -1 });   // 38
    const first = undoLast();
    expect(first).toContain("life is now 38");
    const second = undoLast();
    expect(second).not.toContain("↩");                        // never reports a notice
  });

  test("undo walks back through many consecutive actions", () => {
    for (let i = 0; i < 5; i++) doAction("you", "life", { player: "agent", delta: -1 });
    expect(game.players.agent.life).toBe(35);
    for (let i = 0; i < 5; i++) undoLast();
    expect(game.players.agent.life).toBe(40);
  });
});
