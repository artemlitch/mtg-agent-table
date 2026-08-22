// Undo: per-action snapshots, state rewind, monotonic seq, log notice.
import { describe, test, expect, beforeEach } from "vitest";
import { game, resetGameState, applyAction, addLog, getNextCardId, makeCard, newCardId } from "../server/game";
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

describe("undo leaves the table's layout alone", () => {
  // sliding a card around makes no undo step, so no undo step may slide one:
  // rewinding an unrelated action must not drag the board back to an old
  // arrangement.
  // a restore rebuilds every card object, so the id is the only durable
  // handle — re-read through it rather than holding the card
  const bear = () => {
    const c = makeCard({ id: newCardId(), name: "Bear", owner: "you", controller: "you", zone: "hand", typeLine: "Creature — Bear" });
    game.cards[c.id] = c;
    game.players.you.zones.hand.push(c.id);
    return c.id;
  };

  test("a card keeps where you put it when an unrelated action is undone", () => {
    const id = bear();
    doAction("you", "move", { card: id, toZone: "battlefield" });
    applyAction("you", "place", { positions: [{ card: id, x: 0.8, y: 0.7 }] }); // cosmetic: no snapshot
    doAction("you", "life", { player: "you", delta: -5 });

    undoLast();
    expect(game.players.you.life).toBe(40);
    expect(game.cards[id].pos).toEqual({ x: 0.8, y: 0.7 });
  });

  test("undoing the move that put it there takes its position with it", () => {
    const id = bear();
    doAction("you", "move", { card: id, toZone: "battlefield" });
    applyAction("you", "place", { positions: [{ card: id, x: 0.8, y: 0.7 }] });

    undoLast();
    expect(game.cards[id].zone).toBe("hand");
    // off the table is off the coordinate system
    expect(game.cards[id].pos).toBeNull();
  });

  test("a rewind leaves the layout alone — where you put a card is not a move", () => {
    const id = bear();
    doAction("you", "move", { card: id, toZone: "battlefield" });
    doAction("you", "place", { positions: [{ card: id, x: 0.42, y: 0.66 }] });
    doAction("you", "life", { player: "you", delta: -3 });

    undoLast();
    expect(game.players.you.life).toBe(40);
    expect(game.cards[id].pos).toEqual({ x: 0.42, y: 0.66 });
  });

  test("a card the rewind brings back onto the table comes back unplaced", () => {
    const id = bear();
    doAction("you", "move", { card: id, toZone: "battlefield" });
    doAction("you", "move", { card: id, toZone: "graveyard" });
    expect(game.cards[id].pos).toBeNull();

    undoLast();
    expect(game.cards[id].zone).toBe("battlefield");
    expect(game.cards[id].pos).toBeNull();
  });
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
