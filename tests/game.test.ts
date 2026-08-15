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
  test("attack marks and taps attackers", () => {
    const c = seedCard("Kotis", "you", "battlefield");
    applyAction("you", "attack", { pairs: [{ attacker: c.id, target: "agent" }] });
    expect(c.attacking).toBe("agent");
    expect(c.tapped).toBe(true);
    expect(game.phase).toBe("combat");
  });

  test("block marks blockers; clear_combat wipes both", () => {
    const att = seedCard("Attacker", "agent", "battlefield");
    const blk = seedCard("Blocker", "you", "battlefield");
    applyAction("agent", "attack", { pairs: [{ attacker: att.id, target: "you" }] });
    applyAction("you", "block", { pairs: [{ blocker: blk.id, attacker: att.id }] });
    expect(blk.blocking).toBe(att.id);
    applyAction("you", "clear_combat", {});
    expect(att.attacking).toBe(null);
    expect(blk.blocking).toBe(null);
  });

  test("set_turn clears combat and bumps turn number", () => {
    const c = seedCard("Guy", "you", "battlefield", { attacking: "agent" });
    const before = game.turnNumber;
    applyAction("you", "set_turn", { player: "agent" });
    expect(game.turn).toBe("agent");
    expect(game.turnNumber).toBe(before + 1);
    expect(c.attacking).toBe(null);
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
