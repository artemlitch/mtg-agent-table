// The Magic stack: cast → stack zone, LIFO resolution, countering, triggers.
import { describe, test, expect, beforeEach } from "bun:test";
import { game, resetGameState, applyAction, viewFor, cardVisibleTo, newCardId, type Card, type PlayerId, type Zone } from "../server/game";

function seedCard(name: string, owner: PlayerId, zone: Zone, extra: Partial<Card> = {}): Card {
  const id = newCardId();
  const card: Card = {
    id, name, owner, controller: owner, zone,
    tapped: false, faceDown: false, counters: {}, attachedTo: null,
    isToken: false, isCommander: false, visibleTo: [], attacking: null, blocking: null,
    typeLine: "Creature — Test", ...extra,
  };
  game.cards[id] = card;
  game.players[extra.controller ?? owner].zones[zone].push(id);
  return card;
}

beforeEach(() => resetGameState());

describe("casting onto the stack", () => {
  test("cast moves the card to the stack, publicly visible, and records a stack item", () => {
    const c = seedCard("Counterspell", "agent", "hand", { typeLine: "Instant" });
    applyAction("agent", "cast", { card: c.id });
    expect(c.zone).toBe("stack");
    expect(cardVisibleTo(c, "you")).toBe(true);
    expect(game.stack.length).toBe(1);
    expect(game.stack[0].cardId).toBe(c.id);
    expect(game.log.at(-1)!.text).toContain("cast Counterspell");
  });

  test("stack is LIFO: resolving pops the most recent item", () => {
    const a = seedCard("Big Sorcery", "you", "hand", { typeLine: "Sorcery" });
    const b = seedCard("Response", "agent", "hand", { typeLine: "Instant" });
    applyAction("you", "cast", { card: a.id });
    applyAction("agent", "cast", { card: b.id });
    applyAction("you", "stack_resolve", {});
    expect(b.zone).toBe("graveyard");
    expect(a.zone).toBe("stack");
    expect(game.stack.length).toBe(1);
  });

  test("resolution destination inferred from type line: permanents hit the battlefield", () => {
    const cr = seedCard("Bear", "you", "hand", { typeLine: "Creature — Bear" });
    applyAction("you", "cast", { card: cr.id });
    applyAction("you", "stack_resolve", {});
    expect(cr.zone).toBe("battlefield");
    expect(game.players.you.zones.battlefield).toContain(cr.id);

    const sorc = seedCard("Damnation", "you", "hand", { typeLine: "Sorcery" });
    applyAction("you", "cast", { card: sorc.id });
    applyAction("you", "stack_resolve", {});
    expect(sorc.zone).toBe("graveyard");
  });

  test("explicit destination overrides inference", () => {
    const c = seedCard("Beast Within", "you", "hand", { typeLine: "Instant" });
    applyAction("you", "cast", { card: c.id });
    applyAction("you", "stack_resolve", { to: "exile" });
    expect(c.zone).toBe("exile");
  });

  test("countering sends the top card to its owner's graveyard", () => {
    const spell = seedCard("Threat", "you", "hand", { typeLine: "Sorcery" });
    applyAction("you", "cast", { card: spell.id });
    applyAction("agent", "stack_counter", {});
    expect(spell.zone).toBe("graveyard");
    expect(game.players.you.zones.graveyard).toContain(spell.id);
    expect(game.stack.length).toBe(0);
    expect(game.log.at(-1)!.text.toLowerCase()).toContain("counter");
  });

  test("text-only items (triggers/abilities) push and resolve", () => {
    applyAction("agent", "stack_push", { text: "Gonti trigger — exile top of Artem's library" });
    expect(game.stack.length).toBe(1);
    expect(game.stack[0].cardId).toBeNull();
    applyAction("agent", "stack_resolve", {});
    expect(game.stack.length).toBe(0);
  });

  test("manually moving a card off the stack cleans up its stack item", () => {
    const c = seedCard("Spell", "you", "hand", { typeLine: "Instant" });
    applyAction("you", "cast", { card: c.id });
    applyAction("you", "move", { card: c.id, toZone: "hand", toPlayer: "you" });
    expect(game.stack.length).toBe(0);
  });

  test("resolving an empty stack throws", () => {
    expect(() => applyAction("you", "stack_resolve", {})).toThrow();
  });

  test("stack appears in both players' views with card details", () => {
    const c = seedCard("Bribery", "agent", "hand", { typeLine: "Sorcery" });
    applyAction("agent", "cast", { card: c.id });
    const v = viewFor("you");
    expect(v.stack.length).toBe(1);
    expect(v.stack[0].card.name).toBe("Bribery");
    expect(v.stack[0].player).toBe("agent");
  });
});

describe("stack_remove (illegal interaction take-back)", () => {
  test("removes the top card item back to its owner's hand", () => {
    const c = seedCard("Illegal Play", "agent", "hand", { typeLine: "Instant" });
    applyAction("agent", "cast", { card: c.id });
    applyAction("you", "stack_remove", {});
    expect(c.zone).toBe("hand");
    expect(game.players.agent.zones.hand).toContain(c.id);
    expect(game.stack.length).toBe(0);
  });

  test("removes a text item outright and can target by index", () => {
    applyAction("you", "stack_push", { text: "trigger A" });
    applyAction("you", "stack_push", { text: "trigger B" });
    applyAction("you", "stack_remove", { index: 0 });
    expect(game.stack.length).toBe(1);
    expect(game.stack[0].text).toContain("trigger B");
  });
});

describe("everything goes through the stack", () => {
  test("land plays go on the stack and resolve to the battlefield", () => {
    const land = seedCard("Swamp", "you", "hand", { typeLine: "Basic Land — Swamp" });
    applyAction("you", "cast", { card: land.id });
    expect(land.zone).toBe("stack");
    expect(game.log.at(-1)!.text).toContain("played Swamp");
    applyAction("agent", "stack_resolve", {});
    expect(land.zone).toBe("battlefield");
  });

  test("the opponent resolving the caster's item keeps the caster as controller", () => {
    const cr = seedCard("Bear", "agent", "hand", { typeLine: "Creature — Bear" });
    applyAction("agent", "cast", { card: cr.id });
    applyAction("you", "stack_resolve", {});
    expect(cr.controller).toBe("agent");
    expect(game.players.agent.zones.battlefield).toContain(cr.id);
  });
});
