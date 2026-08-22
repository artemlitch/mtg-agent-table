// Core game logic tests: zones, moves, redaction, combat annotations, log privacy.
// Run: bun test

import { describe, test, expect, beforeEach } from "bun:test";
import {
  game,
  resetGameState,
  applyAction,
  viewFor,
  newCardId,
  makeCard,
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
  const card = makeCard({
    id: newCardId(),
    name,
    owner,
    controller: owner,
    zone,
    typeLine: "Creature — Test",
    ...extra,
  });
  game.cards[card.id] = card;
  game.players[extra.controller ?? owner].zones[zone].push(card.id);
  // seeded cards skip the API, so count them as read — the read-before-cast
  // suite clears agentSeen explicitly to test the gate itself
  if ((extra.controller ?? owner) === "agent") game.agentSeen[card.id] = true;
  return card;
}

function seedLibrary(owner: PlayerId, names: string[]): Card[] {
  // first name = top of library
  return names.map((n) => seedCard(n, owner, "library"));
}

beforeEach(() => {
  resetGameState();
});

describe("trigger hints", () => {
  test("casting a card with trigger text returns the trigger lines", () => {
    const c = seedCard("Bastion", "you", "hand", {
      typeLine: "Enchantment",
      oracle: "When Bastion enters the battlefield, create a 1/1 token.\nFlying",
    });
    const r = applyAction("you", "cast", { card: c.id });
    expect(r.TRIGGERS_ON_THIS_CARD).toEqual(["When Bastion enters the battlefield, create a 1/1 token."]);
  });

  test("ability words, bare keywords, sagas, another-phrasings, and as-enters are all caught", () => {
    const mk = (oracle: string) => seedCard("T", "you", "hand", { oracle });
    const lines = (o: string) => {
      const card = mk(o);
      const { triggerLines } = require("../server/game");
      return triggerLines(card);
    };
    expect(lines("Landfall — Whenever a land you control enters, draw a card.").length).toBe(1);
    expect(lines("Prowess").length).toBe(1);
    expect(lines("Annihilator 2").length).toBe(1);
    expect(lines("I — Draw a card.\nII, III — Discard a card.").length).toBe(2);
    expect(lines("Whenever another creature you control dies, gain 1 life.").length).toBe(1);
    expect(lines("As this creature enters, choose a color.").length).toBe(1);
    expect(lines("This creature enters with two +1/+1 counters on it.").length).toBe(1);
    expect(lines("Flying, haste").length).toBe(0);
    expect(lines("Other creatures you control get +1/+1.").length).toBe(0);
  });

  test("a plain card returns no trigger hint", () => {
    const c = seedCard("Vanilla", "you", "hand", { oracle: "Flying" });
    const r = applyAction("you", "cast", { card: c.id });
    expect(r.TRIGGERS_ON_THIS_CARD).toBeUndefined();
  });

  test("a land drop with trigger text carries the hint despite being stackless", () => {
    const c = seedCard("Bojuka Bog", "you", "hand", {
      typeLine: "Land",
      oracle: "Bojuka Bog enters tapped.\nWhen Bojuka Bog enters, exile target player's graveyard.",
    });
    const r = applyAction("you", "cast", { card: c.id });
    expect(r.landPlay).toBe(true);
    expect(r.TRIGGERS_ON_THIS_CARD?.length).toBe(1);
  });

  test("a death lists battlefield cards whose text mentions dying", () => {
    seedCard("Midnight Reaper", "agent", "battlefield", {
      oracle: "Whenever a nontoken creature you control dies, you draw a card and lose 1 life.",
    });
    seedCard("Blood Artist", "you", "battlefield", {
      oracle: "Whenever this or another creature dies, target player loses 1 life and you gain 1 life.",
    });
    const victim = seedCard("Bear", "you", "battlefield");
    const r = applyAction("you", "move", { card: victim.id, toZone: "graveyard" });
    expect(r.DEATH_TRIGGER_CANDIDATES!.sort()).toEqual(["Agent's Midnight Reaper", "Player's Blood Artist"]);
  });

  test("a discard (hand → graveyard) raises no death hint", () => {
    seedCard("Blood Artist", "you", "battlefield", { oracle: "Whenever a creature dies, drain 1." });
    const c = seedCard("Bear", "you", "hand");
    const r = applyAction("you", "move", { card: c.id, toZone: "graveyard", note: "discard" });
    expect(r.DEATH_TRIGGER_CANDIDATES).toBeUndefined();
  });
});

describe("counters param strictness", () => {
  test("missing kind fails loudly instead of silently becoming +1/+1", () => {
    const c = seedCard("Sephiroth", "you", "battlefield");
    expect(() => applyAction("you", "counters", { card: c.id, delta: 1 })).toThrow(/requires kind/);
    expect(c.counters["+1/+1"]).toBeUndefined();
  });

  test("type is accepted as an alias for kind", () => {
    const c = seedCard("Sephiroth", "you", "battlefield");
    applyAction("you", "counters", { card: c.id, type: "charge", delta: 2 });
    expect(c.counters.charge).toBe(2);
    expect(c.counters["+1/+1"]).toBeUndefined();
  });
});

describe("read-before-cast enforcement (agent only)", () => {
  test("the agent cannot cast a card it was never shown; a state view unlocks it", () => {
    const c = seedCard("Mystery Bear", "agent", "hand");
    game.agentSeen = {};
    expect(() => applyAction("agent", "cast", { card: c.id })).toThrow(/READ FIRST/);
    viewFor("agent");
    const r = applyAction("agent", "cast", { card: c.id });
    expect(r.ok).toBe(true);
  });

  test("the agent's own draw counts as reading the drawn cards", () => {
    seedLibrary("agent", ["Drawn Bear"]);
    const r = applyAction("agent", "draw", { n: 1 });
    const id = game.players.agent.zones.hand[0];
    expect(r.cards[0].name).toBe("Drawn Bear");
    expect(applyAction("agent", "cast", { card: id }).ok).toBe(true);
  });

  test("read_card unlocks a single card", () => {
    const c = seedCard("Fine Print", "agent", "hand");
    game.agentSeen = {};
    applyAction("agent", "read_card", { card: c.id });
    expect(applyAction("agent", "cast", { card: c.id }).ok).toBe(true);
  });

  test("stack_batch card items are enforced too", () => {
    const c = seedCard("Batched Bear", "agent", "hand");
    game.agentSeen = {};
    expect(() => applyAction("agent", "stack_batch", { items: [{ card: c.id }] })).toThrow(/READ FIRST/);
  });

  test("the human player is never gated", () => {
    const c = seedCard("Your Bear", "you", "hand");
    expect(applyAction("you", "cast", { card: c.id }).ok).toBe(true);
  });
});

describe("drawing", () => {
  test("draw moves top cards to hand in order", () => {
    seedLibrary("you", ["A", "B", "C"]);
    const r = applyAction("you", "draw", { n: 2 });
    expect(r.drawn).toEqual(["A", "B"]);
    expect(game.players.you.zones.hand.length).toBe(2);
    expect(game.players.you.zones.library.length).toBe(1);
  });

  test("your own draw returns the full cards, like a state view", () => {
    seedLibrary("you", ["A", "B"]);
    const r = applyAction("you", "draw", { n: 2 });
    expect(r.cards.map((c: any) => c.name)).toEqual(["A", "B"]);
    expect(r.cards[0].typeLine).toBe("Creature — Test");
    // drawing for the opponent leaks no card data
    seedLibrary("agent", ["X"]);
    const r2 = applyAction("you", "draw", { player: "agent", n: 1 });
    expect(r2.cards).toBeUndefined();
    expect(r2.drawn).toBe(1);
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

  test("moving off the battlefield resets tap/pile/combat state", () => {
    const c = seedCard("Sword", "you", "battlefield", { tapped: true });
    const t = seedCard("Bearer", "you", "battlefield");
    c.under = t.id;
    t.attacking = "agent";
    applyAction("you", "move", { card: c.id, toZone: "graveyard" });
    expect(c.tapped).toBe(false);
    expect(c.under).toBe(null);
  });

  test("a pile closes the gap when a middle card leaves the battlefield", () => {
    const top = seedCard("Top", "you", "battlefield");
    const mid = seedCard("Mid", "you", "battlefield", { under: top.id });
    const bot = seedCard("Bot", "you", "battlefield", { under: mid.id });
    applyAction("you", "move", { card: mid.id, toZone: "graveyard" });
    expect(bot.under).toBe(top.id);
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

describe("tap, counters, piles", () => {
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

  test("tuck and pull out", () => {
    const eq = seedCard("Fireshrieker", "you", "battlefield");
    const cr = seedCard("Kotis", "you", "battlefield");
    applyAction("you", "tuck", { card: eq.id, under: cr.id });
    expect(eq.under).toBe(cr.id);
    applyAction("you", "tuck", { card: eq.id, under: "" });
    expect(eq.under).toBe(null);
  });

  test("tucking onto a buried card slots in directly under the pile's top", () => {
    const top = seedCard("Top", "you", "battlefield");
    const old = seedCard("Old", "you", "battlefield", { under: top.id });
    const nu = seedCard("New", "you", "battlefield");
    // drop point is the buried card, but the pile is one thing: join under top
    applyAction("you", "tuck", { card: nu.id, under: old.id });
    expect(nu.under).toBe(top.id);
    expect(old.under).toBe(nu.id); // displaced rung closes beneath the newcomer
  });

  test("a pile top tucked onto another pile brings its whole chain", () => {
    const t1 = seedCard("Top1", "you", "battlefield");
    const c1 = seedCard("Carried", "you", "battlefield", { under: t1.id });
    const t2 = seedCard("Top2", "you", "battlefield");
    const o2 = seedCard("Old2", "you", "battlefield", { under: t2.id });
    applyAction("you", "tuck", { card: t1.id, under: t2.id });
    // t2 on top, then t1's chain, then t2's old chain below it
    expect(t1.under).toBe(t2.id);
    expect(c1.under).toBe(t1.id);
    expect(o2.under).toBe(c1.id);
  });

  test("a buried card tucked elsewhere leaves its pile alone", () => {
    const top = seedCard("Top", "you", "battlefield");
    const mid = seedCard("Mid", "you", "battlefield", { under: top.id });
    const bot = seedCard("Bot", "you", "battlefield", { under: mid.id });
    const other = seedCard("Other", "you", "battlefield");
    applyAction("you", "tuck", { card: mid.id, under: other.id });
    expect(mid.under).toBe(other.id);
    expect(bot.under).toBe(top.id); // old pile closed the gap
  });

  test("tucking under your own pile or yourself throws", () => {
    const top = seedCard("Top", "you", "battlefield");
    const mid = seedCard("Mid", "you", "battlefield", { under: top.id });
    expect(() => applyAction("you", "tuck", { card: top.id, under: mid.id })).toThrow();
    expect(() => applyAction("you", "tuck", { card: top.id, under: top.id })).toThrow();
  });

  test("piles only exist on the battlefield", () => {
    const h = seedCard("Handcard", "you", "hand");
    const b = seedCard("Boardcard", "you", "battlefield");
    expect(() => applyAction("you", "tuck", { card: h.id, under: b.id })).toThrow();
    expect(() => applyAction("you", "tuck", { card: b.id, under: h.id })).toThrow();
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

  test("x clamps to 0..1; y may cross the midline within the table bounds", () => {
    const c = seedCard("C", "you", "battlefield");
    applyAction("you", "place", { positions: [{ card: c.id, x: 7, y: -3 }] });
    expect(c.pos).toEqual({ x: 1, y: -1.25 });
    applyAction("you", "place", { positions: [{ card: c.id, x: 0.5, y: -0.6 }] });
    expect(c.pos).toEqual({ x: 0.5, y: -0.6 });
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
    // a DFC always presents as its active face — never the composite name
    expect(viewFor("you").players.you.zones.battlefield[0].name).toBe("Valakut Awakening");
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

describe("set_phase never stacks", () => {
  test("every phase applies directly — the turn pass is the only turn-structure stack item", () => {
    for (const phase of ["untap/upkeep", "main 1", "combat", "main 2", "end"]) {
      applyAction("you", "set_phase", { phase });
      expect(game.stack.length).toBe(0);
      expect(game.phase).toBe(phase);
    }
    applyAction("you", "set_turn", { player: "agent" });
    expect(game.stack.length).toBe(1);
  });
});

describe("create_token validation", () => {
  test("missing/blank name throws with the expected shape in the message", () => {
    expect(() => applyAction("agent", "create_token", { token: "Saproling", count: 1 })).toThrow(/requires a non-empty "name"/);
    expect(() => applyAction("you", "create_token", { name: "   " })).toThrow(/requires a non-empty "name"/);
    expect(game.players.agent.zones.battlefield.length).toBe(0);
  });
});


describe("MDFC active face and hidden flips", () => {
  const mdfc = () =>
    seedCard("Agadeem's Awakening // Agadeem, the Undercrypt", "you", "hand", {
      typeLine: "Sorcery // Land",
      faces: [
        { name: "Agadeem's Awakening", typeLine: "Sorcery" },
        { name: "Agadeem, the Undercrypt", typeLine: "Land" },
      ],
    } as any);

  test("a card pre-flipped to its land face plays as a land drop, no face param needed", () => {
    const c = mdfc();
    applyAction("you", "set_face", { card: c.id, face: 1 });
    applyAction("you", "cast", { card: c.id });
    expect(c.zone).toBe("battlefield");
    expect(game.stack.length).toBe(0);
  });

  test("explicit face 0 still casts the spell side onto the stack", () => {
    const c = mdfc();
    applyAction("you", "cast", { card: c.id, face: 0 });
    expect(c.zone).toBe("stack");
  });

  test("flipping a hidden hand card does not leak its name to the opponent", () => {
    const c = mdfc();
    applyAction("you", "set_face", { card: c.id, face: 1 });
    const entry = game.log.at(-1)!;
    expect(renderLogFor(entry, "agent").text).not.toContain("Agadeem");
    expect(renderLogFor(entry, "you").text).toContain("Agadeem, the Undercrypt");
  });
});

describe("zone browsing card shape", () => {
  test("view_zone and peek include power/toughness (the client filters need them)", () => {
    seedCard("Agent of Treachery", "you", "library", { typeLine: "Creature — Human Rogue", power: "2", toughness: "3" });
    const v: any = applyAction("you", "view_zone", { player: "you", zone: "library" });
    expect(v.cards[0].power).toBe("2");
    expect(v.cards[0].toughness).toBe("3");
    const pk: any = applyAction("you", "peek", { player: "you", n: 1 });
    expect(pk.cards[0].power).toBe("2");
  });
});

describe("read_card and peek misuse", () => {
  test("read_card returns full details for visible cards, refuses hidden ones", () => {
    const pub = seedCard("Thalakos Deceiver", "you", "battlefield", { oracle: "Shadow. Sacrifice: gain control...", power: "1", toughness: "1" });
    const hid = seedCard("Secret", "you", "hand");
    const r: any = applyAction("agent", "read_card", { card: pub.id });
    expect(r.card.oracle).toContain("Shadow");
    expect(() => applyAction("agent", "read_card", { card: hid.id })).toThrow(/hidden/);
    expect(game.log.length).toBe(0); // unlogged
  });

  test("peek with a card param fails loudly and points at read_card", () => {
    seedLibrary("agent", ["Top"]);
    expect(() => applyAction("agent", "peek", { card: "c1" })).toThrow(/read_card/);
  });
});

describe("P/T counters are one net quantity (+1/+1 and -1/-1 annihilate)", () => {
  test("going below zero stores -1/-1 counters, never a negative +1/+1", () => {
    const c = seedCard("Ophiomancer", "you", "battlefield");
    applyAction("you", "counters", { card: c.id, kind: "+1/+1", delta: -2 });
    expect(c.counters["-1/-1"]).toBe(2);
    expect(c.counters["+1/+1"]).toBeUndefined();
    expect(game.log.at(-1)!.text).toContain("2 -1/-1");
  });

  test("adding -1/-1 counters annihilates existing +1/+1 (CR 704.5r)", () => {
    const c = seedCard("Bear", "you", "battlefield");
    applyAction("you", "counters", { card: c.id, kind: "+1/+1", delta: 2 });
    applyAction("you", "counters", { card: c.id, kind: "-1/-1", delta: 3 });
    expect(c.counters["+1/+1"]).toBeUndefined();
    expect(c.counters["-1/-1"]).toBe(1);
    applyAction("you", "counters", { card: c.id, kind: "+1/+1", delta: 1 });
    expect(c.counters["-1/-1"]).toBeUndefined(); // back to net zero
    expect(c.counters["+1/+1"]).toBeUndefined();
  });

  test("other counter kinds are untouched by the net rule", () => {
    const c = seedCard("Walker", "you", "battlefield");
    applyAction("you", "counters", { card: c.id, kind: "charge", set: 0 });
    expect(c.counters["charge"]).toBeUndefined();
    applyAction("you", "counters", { card: c.id, kind: "loyalty", delta: 3 });
    expect(c.counters["loyalty"]).toBe(3);
  });
});
