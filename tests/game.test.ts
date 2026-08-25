// Core game logic tests: zones, moves, redaction, combat annotations, log privacy.
// Run: bun test

import { describe, test, expect, beforeEach } from "vitest";
import {
  game,
  resetGameState,
  applyAction,
  viewFor,
  newCardId,
  makeCard,
  cardVisibleTo,
  renderLogFor,
  triggerLines,
  leanCard,
  transcript,
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

describe("commander damage keys", () => {
  test("a card id is accepted but damage is stored under the commander's name", () => {
    const cmdr = seedCard("Marchesa, the Black Rose", "you", "battlefield", { isCommander: true });
    const r = applyAction("you", "commander_damage", { to: "agent", commander: cmdr.id, delta: 4 });
    expect(r.commander).toBe("Marchesa, the Black Rose");
    expect(game.players.agent.commanderDamage).toEqual({ "Marchesa, the Black Rose": 4 });
  });

  test("stale id-keyed entries are healed on the next call", () => {
    const cmdr = seedCard("Teysa Karlov", "agent", "battlefield", { isCommander: true });
    game.players.you.commanderDamage[cmdr.id] = 2;
    applyAction("agent", "commander_damage", { to: "you", commander: "Teysa Karlov", delta: 3 });
    expect(game.players.you.commanderDamage).toEqual({ "Teysa Karlov": 5 });
  });

  test("unknown commanders and missing delta fail loudly", () => {
    seedCard("Teysa Karlov", "agent", "battlefield", { isCommander: true });
    expect(() => applyAction("agent", "commander_damage", { to: "you", commander: "c999", delta: 2 })).toThrow(/unknown commander/);
    expect(() => applyAction("agent", "commander_damage", { to: "you", commander: "Teysa Karlov" })).toThrow(/numeric delta/);
  });

  test("damage dropping to zero removes the scoreboard entry", () => {
    const cmdr = seedCard("Teysa Karlov", "agent", "battlefield", { isCommander: true });
    applyAction("agent", "commander_damage", { to: "you", commander: cmdr.id, delta: 3 });
    applyAction("agent", "commander_damage", { to: "you", commander: cmdr.id, delta: -3 });
    expect(game.players.you.commanderDamage).toEqual({});
  });
});

describe("owner zones (CR 404.1)", () => {
  test("a stolen creature dying goes to its OWNER's graveyard, not the thief's", () => {
    const c = seedCard("Stormdrake", "you", "battlefield", { controller: "agent" });
    const r = applyAction("agent", "move", { card: c.id, toZone: "graveyard" });
    expect(r.ok).toBe(true);
    expect(game.players.you.zones.graveyard).toContain(c.id);
    expect(game.players.agent.zones.graveyard).not.toContain(c.id);
  });

  test("an explicit wrong toPlayer is coerced to the owner for graveyard/exile/library/command", () => {
    for (const zone of ["graveyard", "exile", "library", "command"] as const) {
      const c = seedCard("Bear-" + zone, "you", "battlefield");
      applyAction("agent", "move", { card: c.id, toZone: zone, toPlayer: "agent" });
      expect(game.players.you.zones[zone]).toContain(c.id);
    }
  });

  test("exile resolving off the stack is the owner's exile too", () => {
    const c = seedCard("Their Relic", "agent", "graveyard");
    applyAction("you", "cast", { card: c.id, resolveTo: "exile", resolveToPlayer: "you" });
    const item = game.stack[game.stack.length - 1];
    applyAction("agent", "stack_resolve", { item: item.id }); // the opponent resolves your item
    expect(game.players.agent.zones.exile).toContain(c.id);
    expect(game.players.you.zones.exile).not.toContain(c.id);
  });

  test("hand is the deliberate exception: it defaults to the owner but honours an explicit thief", () => {
    // theft effects at this table take a card INTO the thief's hand
    const stolen = seedCard("Stolen Plan", "agent", "library");
    applyAction("you", "move", { card: stolen.id, toZone: "hand", toPlayer: "you" });
    expect(game.players.you.zones.hand).toContain(stolen.id);
    // with no toPlayer it still goes home to its owner
    const bounced = seedCard("Their Bear", "agent", "battlefield", { controller: "you" });
    applyAction("you", "move", { card: bounced.id, toZone: "hand" });
    expect(game.players.agent.zones.hand).toContain(bounced.id);
  });

  test("battlefield keeps controller semantics (steals still work)", () => {
    const c = seedCard("Bear", "agent", "battlefield");
    applyAction("you", "move", { card: c.id, toZone: "battlefield", toPlayer: "you", note: "control effect" });
    expect(game.players.you.zones.battlefield).toContain(c.id);
  });
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

  test("entering the battlefield lists watchers, including the card's own ETB", () => {
    seedCard("Soul Warden", "agent", "battlefield", {
      oracle: "Whenever another creature enters the battlefield, you gain 1 life.",
    });
    const back = seedCard("Gravedigger", "you", "graveyard", {
      oracle: "When Gravedigger enters the battlefield, return target creature card from your graveyard to your hand.",
    });
    const r = applyAction("you", "move", { card: back.id, toZone: "battlefield", note: "reanimate" });
    expect(r.ENTER_TRIGGER_CANDIDATES!.sort()).toEqual(["Agent's Soul Warden", "Player's Gravedigger"]);
  });

  test("leaving the battlefield (bounce) lists leaves-watchers, not death-watchers", () => {
    seedCard("Watcher", "agent", "battlefield", {
      oracle: "Whenever a creature leaves the battlefield, draw a card.",
    });
    const c = seedCard("Bear", "you", "battlefield");
    const r = applyAction("you", "move", { card: c.id, toZone: "hand" });
    expect(r.LEAVE_TRIGGER_CANDIDATES).toEqual(["Agent's Watcher"]);
    expect(r.DEATH_TRIGGER_CANDIDATES).toBeUndefined();
  });

  test("tokens entering trigger the enter-watchers hint", () => {
    seedCard("Soul Warden", "you", "battlefield", {
      oracle: "Whenever another creature enters the battlefield, you gain 1 life.",
    });
    const r = applyAction("you", "create_token", { name: "Treasure", n: 1 });
    expect(r.ENTER_TRIGGER_CANDIDATES).toEqual(["Player's Soul Warden"]);
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

  test("moving to the untap step untaps the player whose turn it is", () => {
    // it used to be the client's job, so it happened for Player and never for
    // the agent — which moved the marker to "untap" and left its lands tapped
    const mine = seedCard("Mine", "agent", "battlefield", { tapped: true });
    const theirs = seedCard("Theirs", "you", "battlefield", { tapped: true });
    game.turn = "agent";
    applyAction("agent", "set_phase", { phase: "untap" });
    expect(mine.tapped).toBe(false);
    expect(theirs.tapped).toBe(true); // an untap step is one seat's, not both
  });

  test("every other phase leaves the board exactly as it was", () => {
    const c = seedCard("Tapped", "you", "battlefield", { tapped: true });
    game.turn = "you";
    applyAction("you", "set_phase", { phase: "main 1" });
    expect(c.tapped).toBe(true);
  });

  test("an untap step with nothing to untap says nothing about it", () => {
    seedCard("Ready", "you", "battlefield");
    game.turn = "you";
    applyAction("you", "set_phase", { phase: "untap/upkeep" });
    expect(transcript().at(-1)!.text).toBe("Player moves to untap/upkeep");
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
    seedCard("Gonti, Night Minister", "agent", "command", { isCommander: true });
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
    const [a, b] = seedLibrary("you", ["A", "B", "C"]);
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
    game.turn = "agent";
    applyAction("agent", "attack", { pairs: [{ attacker: att.id, target: "you" }] });
    applyAction("you", "stack_resolve", {});
    applyAction("you", "block", { pairs: [{ blocker: blk.id, attacker: att.id }] });
    applyAction("agent", "stack_resolve", {});
    expect(blk.blocking).toBe(att.id);
    applyAction("you", "clear_combat", {});
    expect(att.attacking).toBe(null);
    expect(blk.blocking).toBe(null);
  });

  test("a declaration carries its pairs in the view, so the client can mark the creature before it locks in", () => {
    const att = seedCard("Attacker", "agent", "battlefield");
    const blk = seedCard("Blocker", "you", "battlefield");
    game.turn = "agent";
    applyAction("agent", "attack", { pairs: [{ attacker: att.id, target: "you" }] });
    expect(viewFor("you").stack[0].attackPairs).toEqual([{ attacker: att.id, target: "you" }]);
    applyAction("you", "stack_resolve", {});
    applyAction("you", "block", { pairs: [{ blocker: blk.id, attacker: att.id }] });
    expect(viewFor("you").stack[0].blockPairs).toEqual([{ blocker: blk.id, attacker: att.id }]);
    // and the card itself stays unmarked until the other seat locks it in
    expect(blk.blocking).toBe(null);
  });

  // Tapping four creatures with E is four attack calls, and the UI calls the
  // whole thing one action ("Finish declaring attackers"). Four stack items
  // meant undo peeled one creature off instead of taking the declaration.
  test("declaring attackers one at a time builds ONE stack item", () => {
    const a = seedCard("Carrion Feeder", "you", "battlefield");
    const b = seedCard("Tergrid", "you", "battlefield");
    applyAction("you", "attack", { pairs: [{ attacker: a.id, target: "agent" }] });
    applyAction("you", "attack", { pairs: [{ attacker: b.id, target: "agent" }] });
    expect(game.stack).toHaveLength(1);
    expect(game.stack[0].apply).toEqual({ type: "attack", pairs: [
      { attacker: a.id, target: "agent" },
      { attacker: b.id, target: "agent" },
    ] });
    // the item and the log line both name the whole declaration
    expect(game.stack[0].text).toContain("Carrion Feeder");
    expect(game.stack[0].text).toContain("Tergrid");
    expect(game.log.at(-1)!.text).toContain("Tergrid");
    // and locking it in taps every attacker, not just the last one declared
    applyAction("agent", "stack_resolve", {});
    expect(a.attacking).toBe("agent");
    expect(b.attacking).toBe("agent");
  });

  test("re-declaring a creature retargets it instead of listing it twice", () => {
    const a = seedCard("Carrion Feeder", "you", "battlefield");
    const pw = seedCard("Planeswalker", "agent", "battlefield");
    applyAction("you", "attack", { pairs: [{ attacker: a.id, target: "agent" }] });
    applyAction("you", "attack", { pairs: [{ attacker: a.id, target: pw.id }] });
    expect(game.stack).toHaveLength(1);
    expect((game.stack[0].apply as any).pairs).toEqual([{ attacker: a.id, target: pw.id }]);
  });

  // Closing the declaration used to be a bare done, which is a pass: not a
  // play, so not undoable, and it told the defender nothing about what it was
  // being handed.
  test("finishing a declaration names the attackers and hands the window over", () => {
    const a = seedCard("Carrion Feeder", "you", "battlefield");
    applyAction("you", "attack", { pairs: [{ attacker: a.id, target: "agent" }] });
    applyAction("you", "finish_attacks", {});
    expect(game.waitingOn).toBe("agent");
    expect(game.log.at(-1)!.text).toContain("finishes declaring attackers: Carrion Feeder");
    // the declaration is still the defender's to lock in — finishing is not resolving
    expect(game.stack).toHaveLength(1);
    expect(a.attacking).toBe(null);
  });

  test("there is nothing to finish without a declaration", () => {
    expect(() => applyAction("you", "finish_attacks", {})).toThrow(/declare attackers first/);
  });

  test("the defender cannot declare attackers — that is a blocks declaration", () => {
    const mine = seedCard("Blocker", "you", "battlefield");
    game.turn = "agent";
    expect(() => applyAction("you", "attack", { pairs: [{ attacker: mine.id, target: "agent" }] })).toThrow(/declares attackers/);
    expect(game.stack).toHaveLength(0);
  });

  test("damage announces on the stack and changes nothing until it resolves", () => {
    const src = seedCard("Gonti", "you", "battlefield", { isCommander: true });
    applyAction("agent", "damage", { hits: [{ source: src.id, target: "agent", amount: 3 }] });
    expect(game.stack).toHaveLength(1);
    expect(game.stack[0].text).toBe("COMBAT DAMAGE");
    expect(game.stack[0].lines?.[0]).toContain("Gonti → Agent: 3 (commander damage)");
    expect(game.players.agent.life).toBe(40);
    applyAction("you", "stack_resolve", {});
    expect(game.players.agent.life).toBe(37);
  });

  test("a commander's hit books life and commander damage off one call", () => {
    const src = seedCard("Gonti", "you", "battlefield", { isCommander: true });
    applyAction("agent", "damage", { hits: [{ source: src.id, target: "agent", amount: 3 }] });
    applyAction("you", "stack_resolve", {});
    applyAction("agent", "damage", { hits: [{ source: src.id, target: "agent", amount: 4 }] });
    applyAction("you", "stack_resolve", {});
    expect(game.players.agent.life).toBe(33);
    expect(game.players.agent.commanderDamage).toEqual({ Gonti: 7 });
  });

  test("a non-commander source moves life only", () => {
    const src = seedCard("Bear", "you", "battlefield");
    applyAction("you", "damage", { hits: [{ source: src.id, target: "agent", amount: 2 }] });
    applyAction("agent", "stack_resolve", {});
    expect(game.players.agent.life).toBe(38);
    expect(game.players.agent.commanderDamage).toEqual({});
  });

  test("declared deaths go to the owner's graveyard on resolve, creature hits do not", () => {
    const att = seedCard("Attacker", "you", "battlefield");
    const blk = seedCard("Blocker", "agent", "battlefield");
    applyAction("agent", "damage", {
      hits: [
        { source: att.id, target: blk.id, amount: 3 },
        { source: blk.id, target: att.id, amount: 1 },
      ],
      dies: [blk.id],
    });
    expect(blk.zone).toBe("battlefield");
    applyAction("you", "stack_resolve", {});
    expect(blk.zone).toBe("graveyard");
    expect(att.zone).toBe("battlefield"); // took 1, was not declared dead
    expect(game.players.you.life).toBe(40);
    expect(game.players.agent.life).toBe(40);
  });

  test("damage rejects a bad id or an empty announcement before anything reaches the stack", () => {
    const src = seedCard("Bear", "you", "battlefield");
    expect(() => applyAction("you", "damage", { hits: [] })).toThrow(/at least one hit/);
    expect(() => applyAction("you", "damage", { hits: [{ source: "nope", target: "agent", amount: 1 }] })).toThrow(/no card/);
    expect(() => applyAction("you", "damage", { hits: [{ source: src.id, target: "agent" }] })).toThrow(/must be a number/);
    expect(game.stack).toHaveLength(0);
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

// Round 6 of the live game, seq 447-469. The agent made three Rats, swung with
// all three, and the table let the whole combat happen in the wrong order.
//
// What the log shows, step by step:
//
//   455  Attacks locked in: Rat, Rat, Rat (attackers tapped)
//   456  Agent announces damage: Rat → Player: 1 — unblocked  (×3)   ← WRONG
//   457  Agent passes — Player's window
//   458  Player declares blockers: Carrion Feeder → Rat              ← on top of it
//   459  Player declares blockers: Tergrid, God of Fright → Rat      ← a 2nd item
//   460  Player declares blockers: Marchesa, the Black Rose → Rat    ← a 3rd
//   461  Blocks locked in: Marchesa, the Black Rose → Rat            ← LIFO:
//   462  Blocks locked in: Tergrid, God of Fright → Rat                 reverse
//   463  Blocks locked in: Carrion Feeder → Rat                         order
//   464  Agent removed from the stack: COMBAT DAMAGE                 ← it unwound
//   465  Agent announces damage: … lethal to Rat …                      its own mess
//
// Nothing in the table objected to any of it. The agent noticed and cleaned up
// after itself, which is not the same thing as the rules holding.
describe("combat happens in order", () => {
  /** The Rat combat up to the moment attackers lock in: three attackers, three
   *  creatures that could block, the defender yet to say anything. */
  function ratsAttack() {
    const rats = [1, 2, 3].map(() => seedCard("Rat", "agent", "battlefield"));
    const blockers = [
      seedCard("Carrion Feeder", "you", "battlefield"),
      seedCard("Tergrid, God of Fright", "you", "battlefield"),
      seedCard("Marchesa, the Black Rose", "you", "battlefield"),
    ];
    game.turn = "agent";
    applyAction("agent", "attack", { pairs: rats.map((r) => ({ attacker: r.id, target: "you" })) });
    applyAction("you", "stack_resolve", {}); // seq 455
    return { rats, blockers };
  }

  const unblocked = (rats: Card[]) => ({
    hits: rats.map((r) => ({ source: r.id, target: "you", amount: 1, note: "unblocked" })),
  });

  // seq 456. The declare-blockers step never happened: the agent asserted
  // "unblocked" about three creatures before the defender had been given the
  // chance to make that false.
  test("damage cannot be announced while the defender still owes blockers", () => {
    const { rats } = ratsAttack();
    expect(rats[0].attacking).toBe("you");
    expect(() => applyAction("agent", "damage", unblocked(rats))).toThrow(/block/i);
    expect(game.stack).toHaveLength(0);
  });

  // seq 458-460 sat a block declaration ON TOP of a damage item that had
  // already called those same creatures unblocked. Declaring is not enough —
  // blocks are only real once the attacker locks them in (that is what marks
  // the blockers), so damage has to wait for the resolve, not the declaration.
  test("a block declaration still on the stack does not open the damage step", () => {
    const { rats, blockers } = ratsAttack();
    applyAction("you", "block", { pairs: [{ blocker: blockers[0].id, attacker: rats[0].id }] });
    expect(blockers[0].blocking).toBe(null); // not locked in yet
    expect(() => applyAction("agent", "damage", unblocked(rats))).toThrow(/block/i);
  });

  // The legal path out of the same position, and the reason the rule above is
  // about the DECLARATION rather than about blockers existing: declining to
  // block is a declaration too, and a table that would not let you swing at an
  // empty board would be worse than the bug.
  test("declaring no blocks is the declaration that opens the damage step", () => {
    const { rats } = ratsAttack();
    applyAction("you", "block", { pairs: [] });
    applyAction("agent", "stack_resolve", {});
    applyAction("agent", "damage", unblocked(rats));
    expect(game.stack).toHaveLength(1);
    expect(game.stack[0].text).toBe("COMBAT DAMAGE");
  });

  // The boundary. A ping, a burn spell, a drain — nothing is attacking, so
  // there is no blocks step to be owed and nothing to wait for.
  test("damage with nothing attacking is not a combat step and owes no blocks", () => {
    const bolt = seedCard("Agate Instigator", "agent", "battlefield");
    applyAction("agent", "damage", { hits: [{ source: bolt.id, target: "you", amount: 1 }] });
    expect(game.stack).toHaveLength(1);
  });

  // seq 458-463: three blockers, three stack items, three lock-ins in the
  // reverse order they were declared. That is BY DESIGN — one declaration per
  // creature is an event apiece, same as the client's attack model — so what
  // this pins is not the count but that every one of them still lands.
  test("blockers declared one at a time all lock in, however many items that takes", () => {
    const { rats, blockers } = ratsAttack();
    applyAction("you", "block", { pairs: [{ blocker: blockers[0].id, attacker: rats[0].id }] });
    applyAction("you", "block", { pairs: [{ blocker: blockers[1].id, attacker: rats[1].id }] });
    applyAction("you", "block", { pairs: [{ blocker: blockers[2].id, attacker: rats[2].id }] });
    while (game.stack.length) applyAction("agent", "stack_resolve", {});
    expect(blockers.map((b) => b.blocking)).toEqual(rats.map((r) => r.id));
  });
});

// The four facts the next-action prompt reconstructs by running regexes over
// the log — enteredCombatAt, lockedAt, finishedAt, damageAt (see steps.ts) —
// are the combat STEPS, and the server does not model them: `phase` is a free
// string in which "combat" covers declaring attackers, declaring blockers and
// dealing damage all at once.
//
// That single missing model is behind both halves of this. The server cannot
// refuse damage announced before blockers because there is no step to be out
// of; the client cannot ask where combat is, so it reads prose. Scraping has
// already cost three bugs, each one documented in the comments at the scrape
// site: an undo notice quoting the line it undid, a pattern that matched the
// request for damage rather than damage landing, and a lock-in that is the
// DEFENDER's answer and so never comes from an agent that does not give one.
describe("the view says where combat is", () => {
  function combatOf(p: PlayerId = "you") {
    return (viewFor(p) as unknown as { combat: string | null }).combat;
  }

  test("combat reports its step, so nothing has to read the log for it", () => {
    const rat = seedCard("Rat", "agent", "battlefield");
    const blk = seedCard("Carrion Feeder", "you", "battlefield");
    game.turn = "agent";
    expect(combatOf()).toBe(null); // not in combat at all

    applyAction("agent", "set_phase", { phase: "combat" });
    expect(combatOf()).toBe("attackers");

    applyAction("agent", "attack", { pairs: [{ attacker: rat.id, target: "you" }] });
    expect(combatOf()).toBe("attackers"); // declared is not locked in

    applyAction("you", "stack_resolve", {}); // seq 455
    expect(combatOf()).toBe("blockers"); // ← the step the agent skipped at 456

    applyAction("you", "block", { pairs: [{ blocker: blk.id, attacker: rat.id }] });
    applyAction("agent", "stack_resolve", {});
    expect(combatOf()).toBe("damage");

    applyAction("agent", "damage", { hits: [{ source: rat.id, target: blk.id, amount: 1 }] });
    applyAction("you", "stack_resolve", {});
    expect(combatOf()).toBe("done");
  });

  // Why the scrape used log POSITIONS rather than "has it happened yet": a
  // turn can hold two combats, because undoing back past combat and swinging
  // again is the ordinary way in. A step on the state needs no such trick — it
  // is wherever combat currently is, not a search back through what was said.
  test("a second combat in the same turn starts at attackers again", () => {
    const rat = seedCard("Rat", "agent", "battlefield");
    game.turn = "agent";
    applyAction("agent", "set_phase", { phase: "combat" });
    applyAction("agent", "attack", { pairs: [{ attacker: rat.id, target: "you" }] });
    applyAction("you", "stack_resolve", {});
    expect(combatOf()).toBe("blockers");
    applyAction("agent", "set_phase", { phase: "main 2" });
    expect(combatOf()).toBe(null);
    applyAction("agent", "set_phase", { phase: "combat" });
    expect(combatOf()).toBe("attackers");
  });

  // Both seats are being asked different questions in the same step, and both
  // have to be able to see which one is theirs.
  test("both seats see the same step", () => {
    const rat = seedCard("Rat", "agent", "battlefield");
    game.turn = "agent";
    applyAction("agent", "set_phase", { phase: "combat" });
    applyAction("agent", "attack", { pairs: [{ attacker: rat.id, target: "you" }] });
    applyAction("you", "stack_resolve", {});
    expect(combatOf("you")).toBe("blockers");
    expect(combatOf("agent")).toBe("blockers");
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

  test("a mulligan puts the table back where the deal left it", () => {
    resetGameState();
    seedLibrary("you", Array.from({ length: 20 }, (_, i) => `Card ${i}`));
    applyAction("you", "draw", { n: 7 });
    const opening = [...game.players.you.zones.hand];
    game.log.length = 0;

    applyAction("you", "mulligan", {});

    expect(game.players.you.zones.hand).toHaveLength(7);
    // a fresh seven, not the same seven handed back
    expect(game.players.you.zones.hand).not.toEqual(opening);
    for (const id of opening) expect(game.cards[id].zone).not.toBe("stack");
    // ONE line, so the log does not read as a turn's worth of play
    expect(game.log).toHaveLength(1);
    expect(game.log[0].text).toMatch(/mulligan/i);
    // and the turn structure is untouched
    expect(game.turnNumber).toBe(1);
    expect(game.phase).toBe("untap/upkeep");
    expect(game.stack).toHaveLength(0);
  });

  test("a mulligan can go down to fewer cards", () => {
    resetGameState();
    seedLibrary("you", Array.from({ length: 20 }, (_, i) => `Card ${i}`));
    applyAction("you", "draw", { n: 7 });
    applyAction("you", "mulligan", { n: 5 });
    expect(game.players.you.zones.hand).toHaveLength(5);
  });

  test("the log line a mulligan leaves is not one the prompt reads as a play", () => {
    // game-start in features/nextaction/steps.ts stands the prompt down until
    // the player has actually done something; a mulligan must not count
    resetGameState();
    seedLibrary("you", Array.from({ length: 20 }, (_, i) => `Card ${i}`));
    applyAction("you", "draw", { n: 7 });
    game.log.length = 0;
    applyAction("you", "mulligan", {});
    const STARTED = /^Player (played|cast|tapped|untapped|moved|created|declares|put on the stack|moves to)/;
    for (const e of game.log) expect(e.text).not.toMatch(STARTED);
  });

  test("the turn cannot be handed to whoever already has it", () => {
    resetGameState();
    game.turn = "agent";
    // seen in play: the agent aimed set_turn at "agent" on its own turn, took a
    // second turn, and the round counter did not move because it only bumps
    // when the turn comes back round to the player
    expect(() => applyAction("agent", "set_turn", { player: "agent" })).toThrow(/already/i);
    expect(game.stack.length).toBe(0);
  });

  test("...unless it is deliberately an extra turn", () => {
    resetGameState();
    game.turn = "agent";
    applyAction("agent", "set_turn", { player: "agent", extra: true });
    expect(game.stack.length).toBe(1);
    expect(game.stack[0].text).toMatch(/extra turn/i);
  });

  test("a new game opens where every other turn opens", () => {
    resetGameState();
    // turn 1 used to start at "main 1" and skip the step the turn pass gives
    // every later turn, so the prompt led with "main phase → combat" on a fresh board
    expect(game.phase).toBe("untap/upkeep");
    expect(game.turnNumber).toBe(1);
  });
});

describe("chat robustness", () => {
  test("chat accepts message/text aliases and rejects empty", () => {
    applyAction("agent", "chat", { message: "aliased hello" });
    expect(transcript().at(-1)!.text).toContain("aliased hello");
    applyAction("agent", "chat", { text: "normal hello" });
    expect(transcript().at(-1)!.text).toContain("normal hello");
    expect(() => applyAction("agent", "chat", {})).toThrow();
    // said, not played: it is not in the game's own log at all
    expect(game.log.some((e) => e.text.includes("hello"))).toBe(false);
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

describe("the table surface", () => {
  test("a card reaching the battlefield arrives unplaced", () => {
    // where it should go is a question about the felt, and nothing here can
    // see the felt — the client answers it (client/src/game/settle.ts)
    const c = seedCard("Forest", "you", "hand", { typeLine: "Basic Land — Forest" });
    applyAction("you", "cast", { card: c.id });
    expect(c.zone).toBe("battlefield");
    expect(c.pos).toBe(null);
  });

  test("a token arrives unplaced too", () => {
    const r = applyAction("you", "create_token", { name: "Treasure", typeLine: "Artifact — Treasure", n: 2 });
    const [first, second] = (r.ids as string[]).map((id) => game.cards[id]);
    expect(first.pos ?? null).toBe(null);
    // the second is tucked under the first: the pile's anchor owns the spot
    expect(second.under).toBe(first.id);
  });

  test("a placed card stays placed while it stays on the table", () => {
    const c = seedCard("Bear", "you", "battlefield");
    applyAction("you", "place", { positions: [{ card: c.id, x: 0.3, y: 0.7 }] });
    applyAction("you", "tap", { cards: [c.id] });
    applyAction("you", "untap", { cards: [c.id] });
    expect(c.pos).toEqual({ x: 0.3, y: 0.7 });
  });

  test("a spot chosen on the stack survives the resolution", () => {
    const c = seedCard("Bear", "you", "hand", { typeLine: "Creature — Bear" });
    applyAction("you", "cast", { card: c.id });
    expect(c.zone).toBe("stack");
    expect(c.pos).toBe(null);
    applyAction("you", "place", { positions: [{ card: c.id, x: 0.3, y: 0.7 }] });
    applyAction("agent", "stack_resolve", {});
    expect(c.zone).toBe("battlefield");
    expect(c.pos).toEqual({ x: 0.3, y: 0.7 });
  });

  test("a card leaving the table loses its spot, and comes back unplaced", () => {
    const c = seedCard("Bear", "you", "battlefield");
    applyAction("you", "place", { positions: [{ card: c.id, x: 0.3, y: 0.7 }] });
    applyAction("you", "move", { card: c.id, toZone: "graveyard" });
    expect(c.pos).toBe(null);
    applyAction("you", "move", { card: c.id, toZone: "battlefield" });
    expect(c.pos).toBe(null);
  });

  test("the view carries a null spot as null, not as a made-up one", () => {
    const c = seedCard("Bear", "you", "battlefield");
    const seen = viewFor("you").players.you.zones.battlefield.find((x: any) => x.id === c.id);
    expect(seen.pos).toBe(null);
  });

  test("place moves cards without logging — it is not a game action", () => {
    const a = seedCard("A", "you", "battlefield");
    const b = seedCard("B", "you", "battlefield");
    const before = game.log.length;
    const r = applyAction("you", "place", {
      positions: [
        { card: a.id, x: 0.25, y: 0.8 },
        { card: b.id, x: 0.5, y: 0.55 },
      ],
    });
    expect(a.pos).toEqual({ x: 0.25, y: 0.8 });
    expect(b.pos).toEqual({ x: 0.5, y: 0.55 });
    expect(r.placed).toBe(2);
    expect(game.log.length).toBe(before);
  });

  test("putting a card down puts it on top of the ones it overlaps", () => {
    const a = seedCard("A", "you", "battlefield");
    const b = seedCard("B", "you", "battlefield");
    applyAction("you", "place", { positions: [{ card: a.id, x: 0.3, y: 0.6 }] });
    applyAction("you", "place", { positions: [{ card: b.id, x: 0.32, y: 0.6 }] });
    expect(b.z).toBeGreaterThan(a.z!);
    // touch A again and it comes back to the top
    applyAction("you", "place", { positions: [{ card: a.id, x: 0.3, y: 0.6 }] });
    expect(a.z).toBeGreaterThan(b.z!);
  });

  test("a batch of placements keeps its own order", () => {
    const a = seedCard("A", "you", "battlefield");
    const b = seedCard("B", "you", "battlefield");
    applyAction("you", "place", {
      positions: [
        { card: a.id, x: 0.3, y: 0.6 },
        { card: b.id, x: 0.4, y: 0.6 },
      ],
    });
    expect(b.z).toBeGreaterThan(a.z!);
  });

  test("paint order runs across both seats — the table is one surface", () => {
    const mine = seedCard("Mine", "you", "battlefield");
    const theirs = seedCard("Theirs", "agent", "battlefield");
    applyAction("you", "place", { positions: [{ card: mine.id, x: 0.3, y: 0.6 }] });
    applyAction("agent", "place", { positions: [{ card: theirs.id, x: 0.3, y: 0.45 }] });
    expect(theirs.z).toBeGreaterThan(mine.z!);
  });

  test("a game saved before paint order existed starts counting from 1", () => {
    const c = seedCard("C", "you", "battlefield");
    expect(c.z).toBeUndefined();
    applyAction("you", "place", { positions: [{ card: c.id, x: 0.3, y: 0.6 }] });
    expect(c.z).toBe(1);
  });

  test("either seat may place any card — the table is shared", () => {
    const mine = seedCard("Mine", "you", "battlefield");
    applyAction("agent", "place", { positions: [{ card: mine.id, x: 0.4, y: 0.9 }] });
    expect(mine.pos).toEqual({ x: 0.4, y: 0.9 });
  });

  test("coordinates are fractions: out of range clamps, garbage lands at the origin", () => {
    const c = seedCard("C", "you", "battlefield");
    applyAction("you", "place", { positions: [{ card: c.id, x: 7, y: -3 }] });
    expect(c.pos).toEqual({ x: 1, y: 0 });
    applyAction("you", "place", { positions: [{ card: c.id, x: NaN, y: 0.5 }] });
    expect(c.pos).toEqual({ x: 0, y: 0.5 });
  });

  test("only cards on the table have a position", () => {
    const c = seedCard("C", "you", "hand");
    expect(() => applyAction("you", "place", { positions: [{ card: c.id, x: 0.5, y: 0.5 }] })).toThrow(/only cards on the table/);
  });

  test("an unresolved card can be pre-placed, and resolves into that spot", () => {
    const c = seedCard("Bear", "you", "hand", { typeLine: "Creature — Bear" });
    applyAction("you", "cast", { card: c.id });
    expect(c.zone).toBe("stack");
    expect(c.pos).toBe(null);
    applyAction("you", "place", { positions: [{ card: c.id, x: 0.4, y: 0.7 }] });
    applyAction("agent", "stack_resolve", {});
    expect(c.zone).toBe("battlefield");
    expect(c.pos).toEqual({ x: 0.4, y: 0.7 });
  });

  test("a card resolving carries whatever spot it had on the stack, including none", () => {
    const c = seedCard("Bear", "you", "hand", { typeLine: "Creature — Bear" });
    applyAction("you", "cast", { card: c.id });
    applyAction("agent", "stack_resolve", {});
    expect(c.zone).toBe("battlefield");
    expect(c.pos).toBe(null);
  });

  test("a spell carries no position into the graveyard", () => {
    const bolt = seedCard("Lightning Bolt", "you", "hand", { typeLine: "Instant" });
    applyAction("you", "cast", { card: bolt.id });
    applyAction("you", "place", { positions: [{ card: bolt.id, x: 0.5, y: 0.55 }] });
    applyAction("agent", "stack_resolve", { item: game.stack[0].id });
    expect(bolt.zone).toBe("graveyard");
    expect(bolt.pos).toBeNull();
  });

  test("leaving the battlefield drops the position; coming back arrives unplaced", () => {
    const c = seedCard("C", "you", "battlefield");
    applyAction("you", "place", { positions: [{ card: c.id, x: 0.6, y: 0.7 }] });
    applyAction("you", "move", { card: c.id, toZone: "graveyard" });
    expect(c.pos).toBeNull();
    applyAction("you", "move", { card: c.id, toZone: "battlefield" });
    expect(c.pos).toBeNull();
  });

  test("changing controller unplaces the card, so it is re-placed on its new side", () => {
    const c = seedCard("Stolen", "agent", "battlefield");
    applyAction("agent", "place", { positions: [{ card: c.id, x: 0.5, y: 0.2 }] });
    applyAction("you", "move", { card: c.id, toZone: "battlefield", toPlayer: "you" });
    expect(c.controller).toBe("you");
    expect(c.pos).toBeNull();
  });

  test("the agent sees positions — it shares the surface and places its own cards", () => {
    const c = seedCard("C", "agent", "battlefield");
    applyAction("agent", "place", { positions: [{ card: c.id, x: 0.3, y: 0.15 }] });
    const v = viewFor("agent");
    const seen = v.players.agent.zones.battlefield[0];
    expect(seen.pos).toEqual({ x: 0.3, y: 0.15 });
    // and it survives the lean trim that strips art urls
    expect(leanCard(seen).pos).toEqual({ x: 0.3, y: 0.15 });
  });

  test("lean drops the fields a card at rest has nothing to say about", () => {
    // a library listing repeats these ~90 times, and every one of them is the
    // default: nothing in a library is tapped, attacking, or anywhere
    const idle = leanCard({
      id: "c1", name: "Sheltered Thicket", typeLine: "Land", oracle: "…", zone: "library",
      tapped: false, faceDown: false, attacking: null, blocking: null, under: null,
      pos: null, z: 0, counters: {}, isToken: false, isCommander: false,
      faceCount: 1, face: 0, revealedTo: [],
    });
    expect(idle).toEqual({ id: "c1", name: "Sheltered Thicket", typeLine: "Land", oracle: "…", zone: "library" });
  });

  test("a card with a back to turn to still says so", () => {
    // faceCount only ever appears when it means something, so its absence is
    // what says "one-faced" — and a DFC on its back has to keep both
    const dfc = leanCard({ id: "c3", name: "Back", zone: "battlefield", faceCount: 2, face: 1, revealedTo: ["agent"] });
    expect(dfc).toEqual({ id: "c3", name: "Back", zone: "battlefield", faceCount: 2, face: 1, revealedTo: ["agent"] });
    // showing its front: the face index is the default, the count is not
    expect(leanCard({ id: "c4", faceCount: 2, face: 0 })).toEqual({ id: "c4", faceCount: 2 });
  });

  test("board coordinates are rounded to something a screen can tell apart", () => {
    // they arrive from a mouse as full float noise and ride on every
    // battlefield card in every snapshot; three decimals is a pixel
    expect(leanCard({ id: "c5", pos: { x: 0, y: 0.8748319276372082 } }).pos).toEqual({ x: 0, y: 0.875 });
  });

  test("a creature carrying counters is told what it currently is", () => {
    // the sum used to be the reader's job: a 0/0 Thromok under 36 +1/+1
    // counters was served as power 0, toughness 0 and a counters map, and the
    // agent read it as something 13 damage could kill
    expect(leanCard({ id: "c6", name: "Thromok", power: "0", toughness: "0", counters: { "+1/+1": 36 } }).pt).toBe("36/36");
    expect(leanCard({ id: "c7", name: "Shrunk", power: "4", toughness: "4", counters: { "-1/-1": 3 } }).pt).toBe("1/1");
  });

  test("…and nothing is added where the counters do not move it", () => {
    // a plain 2/3 already says 2/3 twice over; and a card with no P/T at all
    // (a land, an artifact) has nothing to sum
    expect(leanCard({ id: "c8", name: "Bear", power: "2", toughness: "2" }).pt).toBeUndefined();
    expect(leanCard({ id: "c9", name: "Bear", power: "2", toughness: "2", counters: { charge: 4 } }).pt).toBeUndefined();
    expect(leanCard({ id: "c10", name: "Forest" }).pt).toBeUndefined();
  });

  test("a printed star survives the sum instead of becoming NaN", () => {
    expect(leanCard({ id: "c11", name: "Tarmogoyf", power: "*", toughness: "1+*", counters: { "+1/+1": 2 } }).pt).toBe("*+2/1+*+2");
  });

  test("…but keeps every one of them that is actually saying something", () => {
    const busy = leanCard({
      id: "c2", name: "Bear", tapped: true, faceDown: true, attacking: "you", blocking: "c9",
      under: "c8", pos: { x: 0.3, y: 0.15 }, z: 4, counters: { "+1/+1": 2 }, isToken: true, isCommander: true,
    });
    expect(busy).toEqual({
      id: "c2", name: "Bear", tapped: true, faceDown: true, attacking: "you", blocking: "c9",
      under: "c8", pos: { x: 0.3, y: 0.15 }, z: 4, counters: { "+1/+1": 2 }, isToken: true, isCommander: true,
    });
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
    expect(() => applyAction("agent", "set_turn", { player: "nobody" })).toThrow();
    expect(game.turn).toBe("you");
  });

  test("life/untap_all/draw reject invalid player ids", () => {
    expect(() => applyAction("you", "life", { player: "nobody", delta: -1 })).toThrow();
    expect(() => applyAction("you", "untap_all", { player: "nobody" })).toThrow();
    expect(() => applyAction("you", "draw", { player: "nobody" })).toThrow();
  });

  test("move rejects an invalid toPlayer", () => {
    const c = seedCard("Bear", "you", "hand");
    expect(() => applyAction("you", "move", { card: c.id, toZone: "battlefield", toPlayer: "nobody" })).toThrow();
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
    seedCard("Secret // Back", "you", "hand", {
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

  test("the spell face resolves to the graveyard, not onto the battlefield as its land", () => {
    const c = mdfc();
    applyAction("you", "cast", { card: c.id });
    expect(c.zone).toBe("stack");
    applyAction("agent", "stack_resolve", {});
    expect(c.zone).toBe("graveyard");
  });

  test("the log calls a spell-face cast a cast, not a land drop", () => {
    const c = mdfc();
    applyAction("you", "cast", { card: c.id });
    expect(game.log.at(-1)!.text).toContain("cast Agadeem's Awakening");
  });

  test("a permanent front face still resolves onto the battlefield", () => {
    const c = seedCard("Beast // Cave", "you", "hand", {
      typeLine: "Creature // Land",
      faces: [{ name: "Beast", typeLine: "Creature — Beast" }, { name: "Cave", typeLine: "Land" }],
    } as any);
    applyAction("you", "cast", { card: c.id });
    applyAction("agent", "stack_resolve", {});
    expect(c.zone).toBe("battlefield");
    expect(c.face ?? 0).toBe(0); // still the creature, not flipped to its land
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

describe("create_token", () => {
  test("a batch of tokens enters as one pile, newest at the bottom", () => {
    const r = applyAction("you", "create_token", { name: "Treasure", n: 3 });
    const [a, b, c] = r.ids as string[];
    // the first is the pile's top and sits on nothing
    expect(game.cards[a].under).toBeNull();
    expect(game.cards[b].under).toBe(a);
    expect(game.cards[c].under).toBe(b);
    expect(game.players.you.zones.battlefield.length).toBe(3);
  });

  test("a single token is not a pile", () => {
    const r = applyAction("you", "create_token", { name: "Clue", n: 1 });
    expect(game.cards[(r.ids as string[])[0]].under).toBeNull();
  });

  test("a second batch is its own pile, not stacked on the first", () => {
    const first = applyAction("you", "create_token", { name: "Treasure", n: 2 }).ids as string[];
    const second = applyAction("you", "create_token", { name: "Soldier", n: 2 }).ids as string[];
    expect(game.cards[second[0]].under).toBeNull();
    expect(game.cards[second[1]].under).toBe(second[0]);
    // and the first pile is untouched
    expect(game.cards[first[1]].under).toBe(first[0]);
  });

  test("the pile can be taken apart with tuck, like any other", () => {
    const ids = applyAction("you", "create_token", { name: "Treasure", n: 3 }).ids as string[];
    applyAction("you", "tuck", { card: ids[1], under: "" });
    expect(game.cards[ids[1]].under).toBeNull();
    // pulling the middle out re-links the one below it to the top
    expect(game.cards[ids[2]].under).toBe(ids[0]);
  });
});

// What a log line IS, said by the code that knows. The client used to work it
// out by running regexes over the sentence, which made every string in here a
// frozen one — see tests/sounds.test.ts for the other half of the joint.
describe("log lines name their event", () => {
  const lastEvent = () => game.log.at(-1)!.event;

  test("a cast and its resolution are different events, and the destination decides which", () => {
    const bear = seedCard("Bear", "you", "hand");
    applyAction("you", "cast", { card: bear.id });
    expect(lastEvent()).toBe("cast");
    applyAction("agent", "stack_resolve", {});
    expect(lastEvent()).toBe("permanent_resolved");

    const bolt = seedCard("Bolt", "you", "hand", { typeLine: "Instant" });
    applyAction("you", "cast", { card: bolt.id });
    applyAction("agent", "stack_resolve", {});
    // same line, same words either way — only where it landed differs
    expect(lastEvent()).toBe("spell_resolved");
  });

  test("a land drop is played, not cast — it never touches the stack", () => {
    const swamp = seedCard("Swamp", "you", "hand", { typeLine: "Basic Land — Swamp" });
    applyAction("you", "cast", { card: swamp.id });
    expect(lastEvent()).toBe("land_played");
  });

  test("a permanent reaching a graveyard dies; going anywhere else does not", () => {
    const a = seedCard("Doomed", "you", "battlefield");
    applyAction("you", "move", { card: a.id, toZone: "graveyard" });
    expect(lastEvent()).toBe("permanent_died");

    const b = seedCard("Bounced", "you", "battlefield");
    applyAction("you", "move", { card: b.id, toZone: "hand" });
    expect(lastEvent()).toBeUndefined();
  });

  test("tapping is an event and untapping is not", () => {
    const c = seedCard("Mox", "you", "battlefield");
    applyAction("you", "tap", { cards: [c.id] });
    expect(lastEvent()).toBe("tapped");
    // bookkeeping at the top of every turn. It was silent before only because
    // " tapped " happens not to appear inside the word "untapped".
    applyAction("you", "untap", { cards: [c.id] });
    expect(lastEvent()).toBeUndefined();
  });

  test("finishing a declaration is its own event, and so is the answer to it", () => {
    game.turn = "you";
    const c = seedCard("Swinger", "you", "battlefield");
    applyAction("you", "attack", { pairs: [{ attacker: c.id, target: "agent" }] });
    expect(lastEvent()).toBe("attackers_declared");
    applyAction("you", "finish_attacks", {});
    expect(lastEvent()).toBe("attacks_finished");
    applyAction("agent", "stack_resolve", {});
    expect(lastEvent()).toBe("attacks_locked");
  });

  test("the event rides out to the client, and the prose is untouched", () => {
    const swamp = seedCard("Swamp", "you", "hand", { typeLine: "Basic Land — Swamp" });
    applyAction("you", "cast", { card: swamp.id });
    const entry = viewFor("you").log.at(-1)!;
    expect(entry.event).toBe("land_played");
    // the agent reads the sentence like a person; the tag is for the client
    expect(renderLogFor(game.log.at(-1)!, "agent").text).toContain("land drop");
  });
});

describe("phase labels are a vocabulary, not free text", () => {
  test("aliases fold into the five canonical phases", () => {
    for (const [raw, canon] of [
      ["untap", "untap/upkeep"],
      ["upkeep", "untap/upkeep"],
      ["draw", "untap/upkeep"],
      ["Main 1", "main 1"],
      ["combat", "combat"],
      ["second main", "main 2"],
      ["cleanup", "end"],
      ["end step", "end"],
    ] as const) {
      applyAction("you", "set_phase", { phase: raw });
      expect(game.phase).toBe(canon);
    }
  });

  test("bare main resolves to main 1 before combat has resolved", () => {
    // the agent's most common label — "Agent moves to main" — is ambiguous,
    // and before this turn's combat is done it means the first main phase
    applyAction("agent", "set_phase", { phase: "main" });
    expect(game.phase).toBe("main 1");
  });

  test("garbage is refused, naming the vocabulary", () => {
    expect(() => applyAction("you", "set_phase", { phase: "combatt" })).toThrow(/untap\/upkeep.*main 1.*combat.*main 2.*end/);
    expect(game.phase).toBe("untap/upkeep"); // unchanged
  });

  test("the auto-untap still fires on an alias of the untap step", () => {
    const c = seedCard("Guy", "you", "battlefield", { tapped: true });
    applyAction("you", "set_phase", { phase: "untap" });
    expect(c.tapped).toBe(false);
    expect(game.phase).toBe("untap/upkeep");
  });
});
