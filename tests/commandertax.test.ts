// Commander tax: the {2}-per-previous-cast surcharge, tracked as a plain
// per-player counter. The table does not enforce it — it remembers it, and
// both seats read the same number.
import { describe, test, expect, beforeEach } from "vitest";
import { game, resetGameState, applyAction, viewFor } from "../server/game";

beforeEach(() => {
  resetGameState();
});

describe("commander tax", () => {
  test("a new game starts both players at zero", () => {
    expect(game.players.you.commanderTax).toBe(0);
    expect(game.players.agent.commanderTax).toBe(0);
  });

  test("delta moves it by the amount given", () => {
    const r = applyAction("you", "commander_tax", { player: "you", delta: 2 });
    expect(r.commanderTax).toBe(2);
    applyAction("you", "commander_tax", { player: "you", delta: 2 });
    expect(game.players.you.commanderTax).toBe(4);
  });

  test("it never goes below zero", () => {
    applyAction("you", "commander_tax", { player: "you", delta: 2 });
    applyAction("you", "commander_tax", { player: "you", delta: -6 });
    expect(game.players.you.commanderTax).toBe(0);
  });

  test("set writes an absolute value", () => {
    applyAction("agent", "commander_tax", { player: "agent", set: 6 });
    expect(game.players.agent.commanderTax).toBe(6);
    applyAction("agent", "commander_tax", { player: "agent", set: 0 });
    expect(game.players.agent.commanderTax).toBe(0);
  });

  test("either seat may set the other's — the same rule as life", () => {
    applyAction("agent", "commander_tax", { player: "you", delta: 2 });
    expect(game.players.you.commanderTax).toBe(2);
    expect(game.players.agent.commanderTax).toBe(0);
  });

  test("the change is logged with the new total", () => {
    applyAction("you", "commander_tax", { player: "you", delta: 2 });
    expect(game.log[game.log.length - 1].text).toContain("commander tax is now 2");
  });

  test("it needs a delta or a set", () => {
    expect(() => applyAction("you", "commander_tax", { player: "you" })).toThrow();
  });

  test("both players' tax is on every state view, for either viewer", () => {
    applyAction("you", "commander_tax", { player: "you", delta: 4 });
    applyAction("you", "commander_tax", { player: "agent", delta: 2 });
    for (const viewer of ["you", "agent"] as const) {
      const v = viewFor(viewer);
      expect(v.players.you.commanderTax).toBe(4);
      expect(v.players.agent.commanderTax).toBe(2);
    }
  });

  test("a new game clears it", () => {
    applyAction("you", "commander_tax", { player: "you", delta: 8 });
    resetGameState();
    expect(game.players.you.commanderTax).toBe(0);
  });
});
