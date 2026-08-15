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

describe("combat goes through the stack", () => {
  test("attack declaration is a stack item; flags apply only on resolve", () => {
    const k = seedCard("Kotis", "you", "battlefield");
    applyAction("you", "attack", { pairs: [{ attacker: k.id, target: "agent" }] });
    expect(game.stack.length).toBe(1);
    expect(k.attacking).toBeNull();
    expect(k.tapped).toBe(false);
    applyAction("agent", "stack_resolve", {});
    expect(k.attacking).toBe("agent");
    expect(k.tapped).toBe(true);
    expect(game.phase).toBe("combat");
    expect(game.stack.length).toBe(0);
  });

  test("block declaration is a stack item; flags apply on resolve", () => {
    const att = seedCard("Attacker", "agent", "battlefield", { attacking: "you" });
    const blk = seedCard("Blocker", "you", "battlefield");
    applyAction("you", "block", { pairs: [{ blocker: blk.id, attacker: att.id }] });
    expect(blk.blocking).toBeNull();
    applyAction("agent", "stack_resolve", {});
    expect(blk.blocking).toBe(att.id);
  });

  test("an unresolved attack declaration can be taken back cleanly", () => {
    const k = seedCard("Kotis", "you", "battlefield");
    applyAction("you", "attack", { pairs: [{ attacker: k.id, target: "agent" }] });
    applyAction("you", "stack_remove", {});
    expect(game.stack.length).toBe(0);
    expect(k.attacking).toBeNull();
    expect(k.tapped).toBe(false);
  });

  test("responses can go on top of an attack declaration and resolve first", () => {
    const k = seedCard("Kotis", "you", "battlefield");
    applyAction("you", "attack", { pairs: [{ attacker: k.id, target: "agent" }] });
    const spell = seedCard("Removal", "agent", "hand", { typeLine: "Instant" });
    applyAction("agent", "cast", { card: spell.id });
    expect(game.stack.length).toBe(2);
    applyAction("you", "stack_resolve", {}); // instant resolves first
    expect(spell.zone).toBe("graveyard");
    expect(k.attacking).toBeNull(); // attack still pending
    applyAction("agent", "stack_resolve", {});
    expect(k.attacking).toBe("agent");
  });
});

describe("MDFC / split card resolution", () => {
  test("a card whose type line contains Land resolves to the battlefield, not the graveyard", () => {
    const c = seedCard("Valakut Awakening // Valakut Stoneforge", "you", "hand", { typeLine: "Instant // Land" });
    applyAction("you", "cast", { card: c.id, note: "playing the land face" });
    applyAction("agent", "stack_resolve", {});
    expect(c.zone).toBe("battlefield");
  });

  test("cast can declare its resolution destination explicitly", () => {
    const c = seedCard("Valakut Awakening // Valakut Stoneforge", "you", "hand", { typeLine: "Instant // Land" });
    applyAction("you", "cast", { card: c.id, resolveTo: "graveyard", note: "casting the instant face" });
    applyAction("agent", "stack_resolve", {});
    expect(c.zone).toBe("graveyard");
  });

  test("an explicit stack_resolve destination still wins over the declared one", () => {
    const c = seedCard("Weird Spell", "you", "hand", { typeLine: "Instant" });
    applyAction("you", "cast", { card: c.id });
    applyAction("agent", "stack_resolve", { to: "exile" });
    expect(c.zone).toBe("exile");
  });
});
