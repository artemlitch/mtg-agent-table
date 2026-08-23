// Commander tax: the {2}-per-previous-cast surcharge, tracked as a plain
// per-player counter. The table does not enforce it — it remembers it, and
// both seats read the same number.
import { describe, test, expect, beforeEach } from "vitest";
import { game, resetGameState, applyAction, viewFor, makeCard, newCardId } from "../server/game";

beforeEach(() => {
  resetGameState();
});

describe("commander tax charges itself", () => {
  // it was a counter both seats had to remember to bump, and in a real game
  // neither did: Marchesa was recast with the tax still reading zero
  const commander = (owner: "you" | "agent") => {
    const c = makeCard({ id: newCardId(), name: "Test Commander", owner, controller: owner, zone: "command", typeLine: "Legendary Creature — Test", isCommander: true });
    game.cards[c.id] = c;
    game.players[owner].zones.command.push(c.id);
    game.agentSeen[c.id] = true;
    return c;
  };

  test("casting from the command zone bumps the owner's tax by two", () => {
    const c = commander("you");
    applyAction("you", "cast", { card: c.id });
    expect(game.players.you.commanderTax).toBe(2);
    expect(game.players.agent.commanderTax).toBe(0);
  });

  test("casting from anywhere else leaves it alone", () => {
    const c = commander("you");
    // a commander cast out of hand (Command Beacon, a bounce) is not the
    // command-zone cast the tax counts
    c.zone = "hand";
    game.players.you.zones.command = [];
    game.players.you.zones.hand.push(c.id);
    applyAction("you", "cast", { card: c.id });
    expect(game.players.you.commanderTax).toBe(0);
  });

  test("a land played off the command zone is not a cast", () => {
    const c = commander("you");
    c.typeLine = "Legendary Land";
    applyAction("you", "cast", { card: c.id });
    expect(game.players.you.commanderTax).toBe(0);
  });
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
