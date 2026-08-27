// The standing self-reveal (reveal_top): play with the top card of your own
// library showing — to you alone. The flag is public bookkeeping; the FACE is
// the secret, and it must only ever ride in the owner's own view.
import { beforeEach, describe, expect, test } from "vitest";
import { applyAction, game, makeCard, newCardId, resetGameState, viewFor } from "../server/game";

beforeEach(() => {
  resetGameState();
});

const stock = (owner: "you" | "agent", names: string[]) => {
  for (const name of names) {
    const c = makeCard({ id: newCardId(), name, owner, controller: owner, zone: "library" });
    game.cards[c.id] = c;
    game.players[owner].zones.library.push(c.id);
  }
};

describe("reveal_top", () => {
  test("shows the owner the top card and nobody else", () => {
    stock("you", ["Sensei's Divining Top", "Island"]);
    applyAction("you", "reveal_top", {});
    const mine = viewFor("you").players.you;
    expect(mine.topRevealed).toBe(true);
    expect(mine.zones.library[0].name).toBe("Sensei's Divining Top");
    // the second card is as hidden as it ever was — the grant is the top alone
    expect(mine.zones.library[1].hidden).toBe(true);
    // the agent sees the flag, never the face
    const theirs = viewFor("agent").players.you;
    expect(theirs.topRevealed).toBe(true);
    expect(theirs.zones.library[0].hidden).toBe(true);
  });

  test("tracks whatever is on top as the library changes", () => {
    stock("you", ["Sensei's Divining Top", "Island"]);
    applyAction("you", "reveal_top", {});
    applyAction("you", "draw", { n: 1 });
    expect(viewFor("you").players.you.zones.library[0].name).toBe("Island");
  });

  test("toggles off, and the top goes back to a card back", () => {
    stock("you", ["Sensei's Divining Top"]);
    applyAction("you", "reveal_top", {});
    applyAction("you", "reveal_top", {});
    const mine = viewFor("you").players.you;
    expect(mine.topRevealed).toBe(false);
    expect(mine.zones.library[0].hidden).toBe(true);
  });

  test("the log states the fact and never the card", () => {
    stock("you", ["Sensei's Divining Top"]);
    applyAction("you", "reveal_top", {});
    const line = game.log[game.log.length - 1].text;
    expect(line).toMatch(/top card of their library revealed/);
    expect(line).not.toMatch(/Sensei/);
  });

  test("a cast off the top says so in the log", () => {
    const c = makeCard({ id: newCardId(), name: "Sol Ring", owner: "you", controller: "you", zone: "library", typeLine: "Artifact" });
    game.cards[c.id] = c;
    game.players.you.zones.library.push(c.id);
    applyAction("you", "cast", { card: c.id });
    expect(game.log.map((l) => l.text).join("\n")).toMatch(/from the top of the library/);
  });

  test("a batch casts the top card with its trigger — the ability-box path", () => {
    stock("you", ["Aetherflux Reservoir"]);
    const id = game.players.you.zones.library[0];
    game.cards[id].typeLine = "Artifact";
    applyAction("you", "stack_batch", { items: [{ card: id }, { text: "Aetherflux Reservoir enters the battlefield: gains ride the storm", source: id }] });
    // the card left the library onto the stack, trigger riding above it
    expect(game.players.you.zones.library).not.toContain(id);
    expect(game.stack.length).toBe(2);
  });

  test("your own reveal never marks the agent seat", () => {
    stock("agent", ["Mountain"]);
    applyAction("you", "reveal_top", {});
    expect(game.players.agent.topRevealed).toBeFalsy();
    expect(viewFor("agent").players.agent.zones.library[0].hidden).toBe(true);
  });
});
