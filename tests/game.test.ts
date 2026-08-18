// Core game logic tests: zones, moves, redaction, combat annotations, log privacy.
// Run: bun test

import { describe, test, expect, beforeEach } from "bun:test";
import {
  game,
  resetGameState,
  applyAction,
  viewFor,
  newCardId,
  cardVisibleTo,
  renderLogFor,
  type Card,
  type PlayerId,
  type Zone,
} from "../server/game";

function seedCard(
  name: string,
  owner: PlayerId,
  zone: Zone,
  extra: Partial<Card> = {}
): Card {
  const id = newCardId();
  const card: Card = {
    id,
    name,
    owner,
    controller: owner,
    zone,
    tapped: false,
    faceDown: false,
    counters: {},
    attachedTo: null,
    isToken: false,
    isCommander: false,
    visibleTo: [],
    attacking: null,
    blocking: null,
    typeLine: "Creature — Test",
    ...extra,
  };
  game.cards[id] = card;
  game.players[extra.controller ?? owner].zones[zone].push(id);
  return card;
}

function seedLibrary(owner: PlayerId, names: string[]): Card[] {
  // first name = top of library
  return names.map((n) => seedCard(n, owner, "library"));
}

beforeEach(() => {
  resetGameState();
});

describe("drawing", () => {
  test("draw moves top cards to hand in order", () => {
    seedLibrary("you", ["A", "B", "C"]);
    const r = applyAction("you", "draw", { n: 2 });
    expect(r.drawn).toEqual(["A", "B"]);
    expect(game.players.you.zones.hand.length).toBe(2);
    expect(game.players.you.zones.library.length).toBe(1);
  });

  test("draw on empty library does not throw", () => {
    const r = applyAction("you", "draw", { n: 3 });
    expect(r.ok).toBe(true);
    expect(game.players.you.zones.hand.length).toBe(0);
  });

  test("drawn card names are private to the drawing player", () => {
    seedLibrary("agent", ["Secret Tech"]);
    applyAction("agent", "draw", { player: "agent", n: 1 });
    const entry = game.log.at(-1)!;
    expect(renderLogFor(entry, "you").text).not.toContain("Secret Tech");
    expect(renderLogFor(entry, "agent").text).toContain("Secret Tech");
  });
});

describe("redaction", () => {
  test("opponent hand and library are hidden; own hand is visible", () => {
    const c = seedCard("My Secret", "you", "hand");
    seedLibrary("you", ["Lib Card"]);
    const agentView = viewFor("agent");
    const youView = viewFor("you");
    const agentSeesHand = agentView.players.you.zones.hand[0];
    expect(agentSeesHand.hidden).toBe(true);
    expect(agentSeesHand.name).toBeUndefined();
    expect(agentView.players.you.zones.library[0].hidden).toBe(true);
    expect(youView.players.you.zones.hand[0].name).toBe("My Secret");
    expect(cardVisibleTo(c, "agent")).toBe(false);
  });

  test("battlefield is public", () => {
    seedCard("Bear", "you", "battlefield");
    expect(viewFor("agent").players.you.zones.battlefield[0].name).toBe("Bear");
  });

  test("reveal to one player grants only that player visibility", () => {
    const c = seedCard("Peekaboo", "you", "hand");
    applyAction("you", "reveal", { cards: [c.id], to: "agent" });
    expect(cardVisibleTo(c, "agent")).toBe(true);
    const entry = game.log.at(-1)!;
    expect(renderLogFor(entry, "agent").text).toContain("Peekaboo");
    // public log line does not name the card
    expect(entry.text).not.toContain("Peekaboo");
  });

  test("face-down exile with revealTo keeps the card private to the thief", () => {
    seedLibrary("you", ["Stolen Goods"]);
    applyAction("agent", "move", {
      card: "top:you",
      toZone: "exile",
      toPlayer: "you",
      faceDown: true,
      revealTo: "agent",
    });
    const c = Object.values(game.cards).find((x) => x.name === "Stolen Goods")!;
    expect(c.zone).toBe("exile");
    expect(cardVisibleTo(c, "agent")).toBe(true);
    expect(cardVisibleTo(c, "you")).toBe(false);
    expect(viewFor("you").players.you.zones.exile[0].hidden).toBe(true);
    expect(viewFor("agent").players.you.zones.exile[0].name).toBe("Stolen Goods");
  });

  test("mover always sees a card it placed face-down", () => {
    const c = seedCard("Morph", "agent", "hand");
    applyAction("agent", "move", { card: c.id, toZone: "battlefield", faceDown: true });
    expect(cardVisibleTo(c, "agent")).toBe(true);
    expect(cardVisibleTo(c, "you")).toBe(false);
  });

  test("visibility grants reset when a card changes zones", () => {
    const c = seedCard("Flash", "you", "hand");
    applyAction("you", "reveal", { cards: [c.id], to: "agent" });
    applyAction("you", "move", { card: c.id, toZone: "library", position: "top" });
    expect(cardVisibleTo(c, "agent")).toBe(false);
    expect(cardVisibleTo(c, "you")).toBe(false);
  });
});

describe("moves", () => {
  test("hand to battlefield (playing a card)", () => {
    const c = seedCard("Bear", "you", "hand");
    applyAction("you", "move", { card: c.id, toZone: "battlefield" });
    expect(c.zone).toBe("battlefield");
    expect(game.players.you.zones.battlefield).toContain(c.id);
    expect(game.players.you.zones.hand).not.toContain(c.id);
  });

  test("top:player selector takes the top of the library", () => {
    seedLibrary("agent", ["Top", "Under"]);
    applyAction("you", "move", { card: "top:agent", toZone: "graveyard", toPlayer: "agent" });
    expect(game.players.agent.zones.graveyard.map((id) => game.cards[id].name)).toEqual(["Top"]);
    expect(game.players.agent.zones.library.map((id) => game.cards[id].name)).toEqual(["Under"]);
  });

  test("library placement: top is default, bottom and index work", () => {
    seedLibrary("you", ["L1", "L2", "L3"]);
    const a = seedCard("New Top", "you", "hand");
    const b = seedCard("New Bottom", "you", "hand");
    applyAction("you", "move", { card: a.id, toZone: "library" });
    applyAction("you", "move", { card: b.id, toZone: "library", position: "bottom" });
    const names = game.players.you.zones.library.map((id) => game.cards[id].name);
    expect(names[0]).toBe("New Top");
    expect(names.at(-1)).toBe("New Bottom");
  });

  test("stealing: moving an opponent card to my battlefield changes controller, not owner", () => {
    const c = seedCard("Their Guy", "agent", "battlefield");
    applyAction("you", "move", { card: c.id, toZone: "battlefield", toPlayer: "you" });
    expect(c.controller).toBe("you");
    expect(c.owner).toBe("agent");
    expect(game.players.you.zones.battlefield).toContain(c.id);
  });

  test("moving off the battlefield resets tap/attach/combat state", () => {
    const c = seedCard("Sword", "you", "battlefield", { tapped: true });
    const t = seedCard("Bearer", "you", "battlefield");
    c.attachedTo = t.id;
    t.attacking = "agent";
    applyAction("you", "move", { card: c.id, toZone: "graveyard" });
    expect(c.tapped).toBe(false);
    expect(c.attachedTo).toBe(null);
  });

  test("tokens cease to exist when leaving the battlefield", () => {
    applyAction("you", "create_token", { name: "Treasure", n: 2 });
    const ids = [...game.players.you.zones.battlefield];
    expect(ids.length).toBe(2);
    applyAction("you", "move", { card: ids[0], toZone: "graveyard" });
    expect(game.cards[ids[0]]).toBeUndefined();
    expect(game.players.you.zones.graveyard.length).toBe(0);
    expect(game.players.you.zones.battlefield.length).toBe(1);
  });

  test("unknown card id throws a clean error", () => {
    expect(() => applyAction("you", "move", { card: "nope", toZone: "exile" })).toThrow();
  });
});

describe("tap, counters, attach", () => {
  test("tap and untap_all", () => {
    const a = seedCard("A", "you", "battlefield");
    const b = seedCard("B", "you", "battlefield");
    applyAction("you", "tap", { cards: [a.id, b.id] });
    expect(a.tapped && b.tapped).toBe(true);
    applyAction("you", "untap_all", {});
    expect(a.tapped || b.tapped).toBe(false);
  });

  test("tapping a non-battlefield card throws", () => {
    const c = seedCard("Handcard", "you", "hand");
    expect(() => applyAction("you", "tap", { cards: [c.id] })).toThrow();
  });

  test("counters accumulate and disappear at zero", () => {
    const c = seedCard("Kotis", "you", "battlefield");
    applyAction("you", "counters", { card: c.id, kind: "+1/+1", delta: 2 });
    applyAction("you", "counters", { card: c.id, kind: "+1/+1", delta: -2 });
    expect(c.counters["+1/+1"]).toBeUndefined();
  });

  test("counters set overrides instead of adding", () => {
    const c = seedCard("Kotis", "you", "battlefield");
    applyAction("you", "counters", { card: c.id, kind: "+1/+1", delta: 5 });
    applyAction("you", "counters", { card: c.id, kind: "+1/+1", set: 1 });
    expect(c.counters["+1/+1"]).toBe(1);
    applyAction("you", "counters", { card: c.id, kind: "+1/+1", set: 0 });
    expect(c.counters["+1/+1"]).toBeUndefined();
  });

  test("tap with tapped:false untaps, and untap is an alias", () => {
    const c = seedCard("A", "you", "battlefield");
    applyAction("you", "tap", { cards: [c.id] });
    applyAction("you", "tap", { cards: [c.id], tapped: false });
    expect(c.tapped).toBe(false);
    applyAction("you", "tap", { cards: [c.id] });
    applyAction("you", "untap", { cards: [c.id] });
    expect(c.tapped).toBe(false);
  });

  test("attach and unattach", () => {
    const eq = seedCard("Fireshrieker", "you", "battlefield");
    const cr = seedCard("Kotis", "you", "battlefield");
    applyAction("you", "attach", { card: eq.id, target: cr.id });
    expect(eq.attachedTo).toBe(cr.id);
    applyAction("you", "attach", { card: eq.id, target: "" });
    expect(eq.attachedTo).toBe(null);
  });
});

describe("life and commander damage", () => {
  test("life delta and set", () => {
    applyAction("agent", "life", { player: "you", delta: -6 });
    expect(game.players.you.life).toBe(34);
    applyAction("you", "life", { player: "you", set: 40 });
    expect(game.players.you.life).toBe(40);
  });

  test("commander damage accumulates per commander name", () => {
    applyAction("agent", "commander_damage", { to: "you", commander: "Gonti, Night Minister", delta: 3 });
    applyAction("agent", "commander_damage", { to: "you", commander: "Gonti, Night Minister", delta: 4 });
    expect(game.players.you.commanderDamage["Gonti, Night Minister"]).toBe(7);
  });
});

describe("scry: peek and reorder", () => {
  test("peek returns top N privately", () => {
    seedLibrary("you", ["A", "B", "C"]);
    const r = applyAction("you", "peek", { n: 2 });
    expect(r.cards.map((c: any) => c.name)).toEqual(["A", "B"]);
  });

  test("reorder_top rearranges and bottoms cards", () => {
    const [a, b, c] = seedLibrary("you", ["A", "B", "C"]);
    applyAction("you", "reorder_top", { top: [b.id], toBottom: [a.id] });
    expect(game.players.you.zones.library.map((id) => game.cards[id].name)).toEqual(["B", "C", "A"]);
  });

  test("reorder_top rejects cards not in that library", () => {
    seedLibrary("you", ["A"]);
    const foreign = seedCard("X", "agent", "library");
    expect(() => applyAction("you", "reorder_top", { top: [foreign.id] })).toThrow();
  });
});

describe("combat annotations", () => {
  test("attack declaration marks and taps attackers once the opponent resolves it", () => {
    const c = seedCard("Kotis", "you", "battlefield");
    applyAction("you", "attack", { pairs: [{ attacker: c.id, target: "agent" }] });
    applyAction("agent", "stack_resolve", {});
    expect(c.attacking).toBe("agent");
    expect(c.tapped).toBe(true);
    expect(game.phase).toBe("combat");
  });

  test("resolved blocks mark blockers; clear_combat wipes both", () => {
    const att = seedCard("Attacker", "agent", "battlefield");
    const blk = seedCard("Blocker", "you", "battlefield");
    applyAction("agent", "attack", { pairs: [{ attacker: att.id, target: "you" }] });
    applyAction("you", "stack_resolve", {});
    applyAction("you", "block", { pairs: [{ blocker: blk.id, attacker: att.id }] });
    applyAction("agent", "stack_resolve", {});
    expect(blk.blocking).toBe(att.id);
    applyAction("you", "clear_combat", {});
    expect(att.attacking).toBe(null);
    expect(blk.blocking).toBe(null);
  });

  test("a resolved turn pass clears combat, tracks rounds, and hands priority over", () => {
    const c = seedCard("Guy", "you", "battlefield", { attacking: "agent" });
    const before = game.turnNumber;
    applyAction("you", "set_turn", { player: "agent" });
    applyAction("agent", "stack_resolve", {});
    expect(game.turn).toBe("agent");
    expect(game.turnNumber).toBe(before); // same round until it comes back around
    expect(game.waitingOn).toBe("agent");
    expect(c.attacking).toBe(null);
    applyAction("agent", "set_turn", { player: "you" });
    applyAction("you", "stack_resolve", {});
    expect(game.turnNumber).toBe(before + 1); // full round completed
    expect(game.waitingOn).toBe("you");
  });
});

describe("windows, chat, questions", () => {
  test("done flips waitingOn", () => {
    game.waitingOn = "you";
    applyAction("you", "done", {});
    expect(game.waitingOn).toBe("agent");
    applyAction("agent", "done", {});
    expect(game.waitingOn).toBe("you");
  });

  test("ask_user sets pendingQuestion; user chat clears it", () => {
    applyAction("agent", "ask_user", { question: "Any responses?" });
    expect(game.pendingQuestion).toBe("Any responses?");
    applyAction("you", "chat", { text: "no, resolve it" });
    expect(game.pendingQuestion).toBe(null);
  });
});

describe("view_zone", () => {
  test("viewing an opponent hand returns contents and logs it", () => {
    seedCard("Secret", "you", "hand");
    const r = applyAction("agent", "view_zone", { player: "you", zone: "hand" });
    expect(r.cards[0].name).toBe("Secret");
    expect(game.log.at(-1)!.text).toContain("looked at");
  });

  test("shuffle keeps the same multiset of cards", () => {
    seedLibrary("you", ["A", "B", "C", "D", "E"]);
    const before = [...game.players.you.zones.library].sort();
    applyAction("you", "shuffle", {});
    expect([...game.players.you.zones.library].sort()).toEqual(before);
  });
});

describe("reset", () => {
  test("resetGameState wipes everything", () => {
    seedCard("Bear", "you", "battlefield");
    applyAction("you", "life", { player: "you", delta: -10 });
    resetGameState();
    expect(game.players.you.life).toBe(40);
    expect(Object.keys(game.cards).length).toBe(0);
    expect(game.log.length).toBe(0);
  });
});

describe("chat robustness", () => {
  test("chat accepts message/text aliases and rejects empty", () => {
    applyAction("agent", "chat", { message: "aliased hello" });
    expect(game.log.at(-1)!.text).toContain("aliased hello");
    applyAction("agent", "chat", { text: "normal hello" });
    expect(game.log.at(-1)!.text).toContain("normal hello");
    expect(() => applyAction("agent", "chat", {})).toThrow();
  });

  test("ask_user accepts text alias too", () => {
    applyAction("agent", "ask_user", { text: "which card?" });
    expect(game.pendingQuestion).toBe("which card?");
  });
});

describe("agent-friendly param aliases", () => {
  test("draw accepts count alias", () => {
    seedLibrary("agent", ["A", "B"]);
    applyAction("agent", "draw", { player: "agent", count: 2 });
    expect(game.players.agent.zones.hand.length).toBe(2);
  });

  test("draw coerces string n", () => {
    seedLibrary("you", ["A", "B"]);
    applyAction("you", "draw", { n: "2" });
    expect(game.players.you.zones.hand.length).toBe(2);
  });

  test("move accepts cardId alias", () => {
    const c = seedCard("Bear", "you", "hand");
    applyAction("you", "move", { cardId: c.id, toZone: "battlefield" });
    expect(c.zone).toBe("battlefield");
  });

  test("tap accepts cardIds alias", () => {
    const c = seedCard("Bear", "you", "battlefield");
    applyAction("you", "tap", { cardIds: [c.id] });
    expect(c.tapped).toBe(true);
  });
});

describe("batch actions", () => {
  test("move accepts many cards at once and logs ONE entry", () => {
    const cards = Array.from({ length: 7 }, (_, i) => seedCard(`H${i}`, "agent", "hand"));
    const before = game.log.length;
    applyAction("agent", "move", { cards: cards.map((c) => c.id), toZone: "library", toPlayer: "agent" });
    expect(game.players.agent.zones.library.length).toBe(7);
    expect(game.players.agent.zones.hand.length).toBe(0);
    expect(game.log.length).toBe(before + 1);
  });

  test("batch move to library top preserves the given order", () => {
    seedLibrary("you", ["Old"]);
    const a = seedCard("A", "you", "hand");
    const b = seedCard("B", "you", "hand");
    applyAction("you", "move", { cards: [a.id, b.id], toZone: "library", position: "top" });
    expect(game.players.you.zones.library.map((id) => game.cards[id].name)).toEqual(["A", "B", "Old"]);
  });

  test("batch move log hides names from the opponent but shows them to the actor", () => {
    const a = seedCard("Secret A", "agent", "hand");
    const b = seedCard("Secret B", "agent", "hand");
    applyAction("agent", "move", { cards: [a.id, b.id], toZone: "library", toPlayer: "agent" });
    const entry = game.log.at(-1)!;
    expect(renderLogFor(entry, "you").text).not.toContain("Secret A");
    expect(renderLogFor(entry, "agent").text).toContain("Secret A");
  });

  test("counters accepts many cards at once", () => {
    const a = seedCard("A", "you", "battlefield");
    const b = seedCard("B", "you", "battlefield");
    applyAction("you", "counters", { cards: [a.id, b.id], kind: "+1/+1", delta: 2 });
    expect(a.counters["+1/+1"]).toBe(2);
    expect(b.counters["+1/+1"]).toBe(2);
  });

  test("batch move with a token in the batch removes the token cleanly", () => {
    applyAction("you", "create_token", { name: "Treasure", n: 1 });
    const token = game.players.you.zones.battlefield[0];
    const real = seedCard("Real", "you", "battlefield");
    applyAction("you", "move", { cards: [token, real.id], toZone: "graveyard" });
    expect(game.cards[token]).toBeUndefined();
    expect(real.zone).toBe("graveyard");
  });
});

describe("board placement (drag positions)", () => {
  test("place sets fractional positions without logging (cosmetic, no agent wake)", () => {
    const a = seedCard("A", "you", "battlefield");
    const b = seedCard("B", "you", "battlefield");
    const before = game.log.length;
    applyAction("you", "place", { positions: [{ card: a.id, x: 0.25, y: 0.8 }, { card: b.id, x: 0.5, y: 0.1 }] });
    expect(a.pos).toEqual({ x: 0.25, y: 0.8 });
    expect(b.pos).toEqual({ x: 0.5, y: 0.1 });
    expect(game.log.length).toBe(before);
  });

  test("positions clamp to 0..1 and clear when the card changes zones", () => {
    const c = seedCard("C", "you", "battlefield");
    applyAction("you", "place", { positions: [{ card: c.id, x: 7, y: -3 }] });
    expect(c.pos).toEqual({ x: 1, y: 0 });
    applyAction("you", "move", { card: c.id, toZone: "graveyard" });
    expect(c.pos).toBeNull();
  });

  test("pos survives the redacted view", () => {
    const c = seedCard("C", "you", "battlefield");
    applyAction("you", "place", { positions: [{ card: c.id, x: 0.3, y: 0.6 }] });
    const v = viewFor("agent");
    expect(v.players.you.zones.battlefield[0].pos).toEqual({ x: 0.3, y: 0.6 });
  });
});

describe("batch move with top: refs", () => {
  test("repeated top:player refs take successive cards, not the same one twice", () => {
    seedLibrary("agent", ["First", "Second", "Third"]);
    applyAction("you", "move", { cards: ["top:agent", "top:agent"], toZone: "exile", toPlayer: "agent", faceDown: true, revealTo: "you" });
    const names = game.players.agent.zones.exile.map((id) => game.cards[id].name).sort();
    expect(names).toEqual(["First", "Second"]);
    expect(game.players.agent.zones.library.length).toBe(1);
  });
});

describe("action input validation", () => {
  test("set_turn rejects invalid player ids", () => {
    expect(() => applyAction("agent", "set_turn", { player: "artem" })).toThrow();
    expect(game.turn).toBe("you");
  });

  test("life/untap_all/draw reject invalid player ids", () => {
    expect(() => applyAction("you", "life", { player: "nobody", delta: -1 })).toThrow();
    expect(() => applyAction("you", "untap_all", { player: "nobody" })).toThrow();
    expect(() => applyAction("you", "draw", { player: "nobody" })).toThrow();
  });

  test("move rejects an invalid toPlayer", () => {
    const c = seedCard("Bear", "you", "hand");
    expect(() => applyAction("you", "move", { card: c.id, toZone: "battlefield", toPlayer: "artem" })).toThrow();
  });
});

describe("two-faced cards", () => {
  test("set_face switches the displayed face and the view follows it", () => {
    const c = seedCard("Valakut Awakening // Valakut Stoneforge", "you", "battlefield", {
      typeLine: "Instant // Land",
      faces: [
        { name: "Valakut Awakening", image: "front.jpg", typeLine: "Instant", mana: "{3}{R}", oracle: "draw" },
        { name: "Valakut Stoneforge", image: "back.jpg", typeLine: "Land", oracle: "taps for R" },
      ],
    } as any);
    expect(viewFor("you").players.you.zones.battlefield[0].name).toBe("Valakut Awakening // Valakut Stoneforge");
    applyAction("you", "set_face", { card: c.id, face: 1 });
    const v = viewFor("you").players.you.zones.battlefield[0];
    expect(v.name).toBe("Valakut Stoneforge");
    expect(v.image).toBe("back.jpg");
    expect(v.typeLine).toBe("Land");
    expect(v.faceCount).toBe(2);
  });

  test("set_face rejects an out-of-range face and single-faced cards", () => {
    const c = seedCard("Bear", "you", "battlefield");
    expect(() => applyAction("you", "set_face", { card: c.id, face: 1 })).toThrow();
  });

  test("hidden cards never leak their faces", () => {
    const c = seedCard("Secret // Back", "you", "hand", {
      faces: [{ name: "Secret", image: "a.jpg" }, { name: "Back", image: "b.jpg" }],
    } as any);
    const v = viewFor("agent").players.you.zones.hand[0];
    expect(v.hidden).toBe(true);
    expect((v as any).faces).toBeUndefined();
    expect((v as any).name).toBeUndefined();
  });
});

describe("flipping cards face-down (anyone, anywhere)", () => {
  test("flip_card hides a battlefield card from the opponent and logs it", () => {
    const c = seedCard("Secret Weapon", "you", "battlefield");
    const before = game.log.length;
    applyAction("you", "flip_card", { card: c.id });
    expect(c.faceDown).toBe(true);
    expect(cardVisibleTo(c, "you")).toBe(true);      // flipper still knows it
    expect(cardVisibleTo(c, "agent")).toBe(false);   // opponent does not
    expect(viewFor("agent").players.you.zones.battlefield[0].hidden).toBe(true);
    expect(game.log.length).toBe(before + 1);
    expect(game.log.at(-1)!.text.toLowerCase()).toContain("face-down");
  });

  test("either player may flip any card, including the opponent's", () => {
    const c = seedCard("Their Guy", "agent", "battlefield");
    applyAction("you", "flip_card", { card: c.id });
    expect(c.faceDown).toBe(true);
    expect(cardVisibleTo(c, "you")).toBe(true);
  });

  test("flipping face-up reveals it to everyone", () => {
    const c = seedCard("Morph", "you", "battlefield", { faceDown: true, visibleTo: ["you"] });
    applyAction("agent", "flip_card", { card: c.id, faceDown: false });
    expect(c.faceDown).toBe(false);
    expect(cardVisibleTo(c, "agent")).toBe(true);
    expect(viewFor("agent").players.you.zones.battlefield[0].name).toBe("Morph");
  });

  test("flip_card works on many cards at once", () => {
    const a = seedCard("A", "you", "battlefield");
    const b = seedCard("B", "you", "battlefield");
    applyAction("you", "flip_card", { cards: [a.id, b.id] });
    expect(a.faceDown && b.faceDown).toBe(true);
  });
});

describe("token catalog", () => {
  test("create_token fills art and copy from the deck's token catalog", () => {
    game.tokenCatalog["elemental"] = {
      name: "Elemental", image: "https://img/elemental.jpg",
      oracle: "Haste", typeLine: "Token Creature — Elemental", power: "1", toughness: "1",
    };
    const r = applyAction("agent", "create_token", { name: "Elemental", n: 2 });
    const c = game.cards[r.ids[0]];
    expect(c.image).toBe("https://img/elemental.jpg");
    expect(c.typeLine).toBe("Token Creature — Elemental");
    expect(c.power).toBe("1");
    expect(c.oracle).toBe("Haste");
  });

  test("explicit params win over the catalog; unknown tokens keep given copy for the placeholder", () => {
    game.tokenCatalog["treasure"] = { name: "Treasure", image: "https://img/treasure.jpg", typeLine: "Token Artifact — Treasure" };
    const r1 = applyAction("you", "create_token", { name: "Treasure", image: "https://img/mine.jpg" });
    expect(game.cards[r1.ids[0]].image).toBe("https://img/mine.jpg");
    const r2 = applyAction("you", "create_token", { name: "Weird Homunculus", power: "3", toughness: "3", typeLine: "Token Creature — Homunculus", oracle: "Flying" });
    const c2 = game.cards[r2.ids[0]];
    expect(c2.image).toBeUndefined();
    expect(c2.power).toBe("3");
    expect(c2.oracle).toBe("Flying");
  });
});

describe("set_pt overrides", () => {
  test("override remembers printed P/T and shows both in the view", () => {
    const c = seedCard("Bear", "you", "battlefield", { power: "2", toughness: "2" });
    applyAction("you", "set_pt", { card: c.id, power: "4", toughness: "4" });
    expect(c.power).toBe("4");
    expect(c.basePower).toBe("2");
    // second override keeps the ORIGINAL printed values
    applyAction("you", "set_pt", { card: c.id, power: "7", toughness: "1" });
    expect(c.basePower).toBe("2");
    const view = viewFor("you").players.you.zones.battlefield[0] as any;
    expect(view.power).toBe("7");
    expect(view.basePower).toBe("2");
  });

  test("empty power resets to printed and clears the override", () => {
    const c = seedCard("Bear", "you", "battlefield", { power: "2", toughness: "3" });
    applyAction("you", "set_pt", { card: c.id, power: "0", toughness: "1" });
    applyAction("you", "set_pt", { card: c.id });
    expect(c.power).toBe("2");
    expect(c.toughness).toBe("3");
    expect(c.basePower).toBeUndefined();
    expect((viewFor("you").players.you.zones.battlefield[0] as any).basePower).toBeUndefined();
  });
});

describe("stack moves out of graveyard/exile", () => {
  test("cast from graveyard with resolveTo hand + resolveToPlayer goes via the stack", () => {
    const c = seedCard("Sepulchral Primordial", "agent", "graveyard", { typeLine: "Creature — Avatar" });
    applyAction("you", "cast", { card: c.id, resolveTo: "hand", resolveToPlayer: "agent", note: "from graveyard → owner's hand" });
    expect(c.zone).toBe("stack");
    expect(game.stack[game.stack.length - 1].resolveToPlayer).toBe("agent");
    applyAction("agent", "stack_resolve", {});
    expect(c.zone).toBe("hand");
    expect(c.controller).toBe("agent");
    expect(game.players.agent.zones.hand).toContain(c.id);
  });

  test("a land cast with resolveTo is NOT a land drop — it uses the stack", () => {
    const c = seedCard("Wasteland", "you", "graveyard", { typeLine: "Land" });
    applyAction("you", "cast", { card: c.id, resolveTo: "hand" });
    expect(c.zone).toBe("stack");
    applyAction("agent", "stack_resolve", {});
    expect(c.zone).toBe("hand");
    expect(game.players.you.zones.hand).toContain(c.id);
  });
});
