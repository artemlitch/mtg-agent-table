// The Magic stack: cast → stack zone, LIFO resolution, countering, triggers.
import { describe, test, expect, beforeEach } from "vitest";
import { game, resetGameState, applyAction, viewFor, cardVisibleTo, newCardId, makeCard, type Card, type PlayerId, type Zone } from "../server/game";

function seedCard(name: string, owner: PlayerId, zone: Zone, extra: Partial<Card> = {}): Card {
  const card = makeCard({ id: newCardId(), name, owner, controller: owner, zone, typeLine: "Creature — Test", ...extra });
  game.cards[card.id] = card;
  game.players[extra.controller ?? owner].zones[zone].push(card.id);
  // seeded cards skip the API — count them as read (see read-before-cast suite)
  if ((extra.controller ?? owner) === "agent") game.agentSeen[card.id] = true;
  return card;
}

beforeEach(() => resetGameState());

describe("casting onto the stack", () => {
  test("declared targets render on the stack item and in the log", () => {
    const spell = seedCard("Path to Exile", "you", "hand", { typeLine: "Instant" });
    const victim = seedCard("Sephiroth", "agent", "battlefield");
    applyAction("you", "cast", { card: spell.id, targets: [victim.id] });
    expect(game.stack[0].text).toContain("⟶ Sephiroth");
    expect(game.log.at(-1)!.text).toContain("⟶ Sephiroth");
    // player targets render too
    const bolt = seedCard("Lava Spike", "you", "hand", { typeLine: "Sorcery" });
    applyAction("you", "cast", { card: bolt.id, targets: ["agent"] });
    expect(game.stack[1].text).toContain("⟶ Agent");
  });

  test("a bad target ref fails before the card moves anywhere", () => {
    const spell = seedCard("Doom Blade", "you", "hand", { typeLine: "Instant" });
    expect(() => applyAction("you", "cast", { card: spell.id, targets: ["c999"] })).toThrow();
    expect(spell.zone).toBe("hand");
    expect(game.stack.length).toBe(0);
  });

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
    applyAction("agent", "stack_resolve", {});
    expect(cr.zone).toBe("battlefield");
    expect(game.players.you.zones.battlefield).toContain(cr.id);

    const sorc = seedCard("Damnation", "you", "hand", { typeLine: "Sorcery" });
    applyAction("you", "cast", { card: sorc.id });
    applyAction("agent", "stack_resolve", {});
    expect(sorc.zone).toBe("graveyard");
  });

  test("explicit destination overrides inference", () => {
    const c = seedCard("Beast Within", "you", "hand", { typeLine: "Instant" });
    applyAction("you", "cast", { card: c.id });
    applyAction("agent", "stack_resolve", { to: "exile" });
    expect(c.zone).toBe("exile");
  });

  test("countering MARKS the item; resolving a countered item fizzles it", () => {
    const spell = seedCard("Threat", "you", "hand", { typeLine: "Sorcery" });
    applyAction("you", "cast", { card: spell.id });
    applyAction("agent", "stack_counter", {});
    // still on the stack, marked — responses can reference it
    expect(game.stack.length).toBe(1);
    expect(game.stack[0].countered).toBe(true);
    expect(spell.zone).toBe("stack");
    // counter again = un-mark
    applyAction("agent", "stack_counter", {});
    expect(game.stack[0].countered).toBe(false);
    applyAction("agent", "stack_counter", {});
    // resolving the countered item fizzles: card → owner's graveyard, no effect
    applyAction("agent", "stack_resolve", {});
    expect(spell.zone).toBe("graveyard");
    expect(game.players.you.zones.graveyard).toContain(spell.id);
    expect(game.stack.length).toBe(0);
  });

  test("resolve can target the opponent's items mid-stack by id", () => {
    const a = seedCard("Bottom Spell", "agent", "hand", { typeLine: "Creature — Bear" });
    const b = seedCard("Top Spell", "agent", "hand", { typeLine: "Instant" });
    applyAction("agent", "cast", { card: a.id });
    applyAction("agent", "cast", { card: b.id });
    // mid-stack resolve of the agent's BOTTOM item — no top-only rule
    applyAction("you", "stack_resolve", { item: game.stack[0].id });
    expect(a.zone).toBe("battlefield");
    expect(game.stack.length).toBe(1);
    expect(game.stack[0].cardId).toBe(b.id);
  });

  test("text-only items (triggers/abilities) push and resolve", () => {
    applyAction("agent", "stack_push", { text: "Gonti trigger — exile top of Player's library" });
    expect(game.stack.length).toBe(1);
    expect(game.stack[0].cardId).toBeNull();
    applyAction("you", "stack_resolve", {});
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
    // a stack item's card is nullable (text-only items have none) and hidden
    // cards serialize without a name — this one is neither, and says so
    expect((v.stack[0].card as { name: string }).name).toBe("Bribery");
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
  test("land plays are special actions: straight to the battlefield, no stack (CR 115.2a)", () => {
    const land = seedCard("Swamp", "you", "hand", { typeLine: "Basic Land — Swamp" });
    applyAction("you", "cast", { card: land.id });
    expect(land.zone).toBe("battlefield");
    expect(game.stack.length).toBe(0);
    expect(game.log.at(-1)!.text).toContain("played Swamp");
  });

  test("an MDFC played by its land face is also a special action", () => {
    const c = seedCard("Valakut Awakening // Valakut Stoneforge", "you", "hand", {
      typeLine: "Instant // Land",
      faces: [
        { name: "Valakut Awakening", typeLine: "Instant", mana: "{3}{R}" },
        { name: "Valakut Stoneforge", typeLine: "Land" },
      ],
    } as any);
    applyAction("you", "cast", { card: c.id, face: 1 });
    expect(c.zone).toBe("battlefield");
    expect(c.face).toBe(1);
    expect(game.stack.length).toBe(0);
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

describe("MDFC face display", () => {
  const FACES = [
    { name: "Valakut Awakening", image: "front.jpg", typeLine: "Instant", mana: "{3}{R}" },
    { name: "Valakut Stoneforge", image: "back.jpg", typeLine: "Land" },
  ];

  test("cast can declare which face is being played (spell faces go on the stack)", () => {
    const c = seedCard("Valakut Awakening // Valakut Stoneforge", "you", "hand", { typeLine: "Instant // Land", faces: FACES } as any);
    applyAction("you", "cast", { card: c.id, face: 0 });
    expect(game.cards[c.id].face).toBe(0);
    // the stack shows the face being cast, never the composite name
    expect(viewFor("you").players.you.zones.stack[0].name).toBe("Valakut Awakening");
    expect(game.stack[0].text).toBe("Valakut Awakening");
  });

  test("an MDFC resolving to the battlefield auto-shows its permanent face", () => {
    const c = seedCard("Valakut Awakening // Valakut Stoneforge", "you", "hand", { typeLine: "Instant // Land", faces: FACES } as any);
    applyAction("you", "cast", { card: c.id, resolveTo: "battlefield" }); // an effect putting it onto the battlefield
    applyAction("agent", "stack_resolve", {});
    expect(game.cards[c.id].zone).toBe("battlefield");
    expect(game.cards[c.id].face).toBe(1);                // shows the land side
    expect(viewFor("agent").players.you.zones.battlefield[0].name).toBe("Valakut Stoneforge");
  });

  // The land side of an MDFC is a land DROP — stackless, never a resolution.
  // So anything that reached the stack with no face declared is the spell,
  // and the composite "Instant // Land" must not talk the resolver into
  // reading it as a permanent. It did, and a Sundering Eruption aimed at a
  // land resolved as Volcanic Fissure onto its caster's battlefield instead.
  test("an MDFC cast with no face declared resolves as its SPELL face", () => {
    const c = seedCard("Valakut Awakening // Valakut Stoneforge", "you", "hand", { typeLine: "Instant // Land", faces: FACES } as any);
    applyAction("you", "cast", { card: c.id });
    applyAction("agent", "stack_resolve", {});
    expect(game.cards[c.id].zone).toBe("graveyard");
  });

  test("a normal transforming DFC is NOT auto-flipped when it resolves", () => {
    const c = seedCard("Delver of Secrets // Insectile Aberration", "you", "hand", {
      typeLine: "Creature — Human Wizard // Creature — Human Insect",
      faces: [{ name: "Delver of Secrets", typeLine: "Creature — Human Wizard" }, { name: "Insectile Aberration", typeLine: "Creature — Human Insect" }],
    } as any);
    applyAction("you", "cast", { card: c.id });
    applyAction("agent", "stack_resolve", {});
    expect(game.cards[c.id].face ?? 0).toBe(0);
  });
});

describe("turn hygiene", () => {
  test("declaring no blocks says so instead of trailing off", () => {
    // seen three times in one game: the agent had nothing to block with and
    // the stack item read "BLOCKS: " with nothing after the colon
    applyAction("agent", "block", { pairs: [] });
    expect(game.stack.at(-1)!.text).toMatch(/no blocks/i);
  });

  test("a gang block is one row per attacker, not one per blocker", () => {
    const marchesa = seedCard("Marchesa, the Black Rose", "you", "battlefield");
    const tergrid = seedCard("Tergrid, God of Fright", "you", "battlefield");
    const chrysalis = seedCard("Writhing Chrysalis", "agent", "battlefield");
    const instigator = seedCard("Agate Instigator", "agent", "battlefield");
    const elves = seedCard("Llanowar Elves", "agent", "battlefield");
    const plant = seedCard("Plant", "agent", "battlefield");
    applyAction("agent", "block", {
      pairs: [
        { blocker: chrysalis.id, attacker: marchesa.id },
        { blocker: instigator.id, attacker: marchesa.id },
        { blocker: elves.id, attacker: marchesa.id },
        { blocker: plant.id, attacker: tergrid.id },
      ],
    });
    const item = game.stack.at(-1)!;
    expect(item.text).toBe("BLOCKS: 4 blockers on 2 attackers");
    expect(item.lines).toEqual([
      "Writhing Chrysalis, Agate Instigator, Llanowar Elves → Marchesa, the Black Rose",
      "Plant → Tergrid, God of Fright",
    ]);
    // one attacker blocked says the whole thing in the headline — a summary
    // over a single row is longer than the row. Declared fresh, because a
    // second block call now amends the declaration already open rather than
    // starting a rival one (see block() in server/game.ts).
    applyAction("you", "stack_resolve", {});
    applyAction("agent", "block", { pairs: [{ blocker: elves.id, attacker: marchesa.id }] });
    expect(game.stack.at(-1)!.text).toBe("BLOCKS: Llanowar Elves → Marchesa, the Black Rose");
    expect(game.stack.at(-1)!.lines).toBeUndefined();
  });

  test("set_turn is rejected while the stack is non-empty", () => {
    const c = seedCard("Pending Spell", "agent", "hand", { typeLine: "Sorcery" });
    applyAction("agent", "cast", { card: c.id });
    // it is the player's turn here, so the pass under test is the one that
    // hands it over — passing it to the seat that already has it is its own
    // error now, and would mask this one
    expect(() => applyAction("you", "set_turn", { player: "agent" })).toThrow(/stack/i);
    expect(game.turn).toBe("you");
    applyAction("you", "stack_resolve", {});
    applyAction("you", "set_turn", { player: "agent" }); // fine once empty
  });
});

describe("turn passes go through the stack", () => {
  test("set_turn declares on the stack; the turn changes only when the opponent resolves", () => {
    game.started = true;
    applyAction("you", "set_turn", { player: "agent" });
    expect(game.turn).toBe("you");            // not yet
    expect(game.stack.length).toBe(1);
    applyAction("agent", "stack_resolve", {});
    expect(game.turn).toBe("agent");
    expect(game.waitingOn).toBe("agent");
    expect(game.stack.length).toBe(0);
  });

  test("cannot declare a turn pass while other items are pending", () => {
    const c = seedCard("Spell", "you", "hand", { typeLine: "Instant" });
    applyAction("you", "cast", { card: c.id });
    expect(() => applyAction("you", "set_turn", { player: "agent" })).toThrow(/stack/i);
  });

  test("the opponent can respond before the turn ends (flash at end of turn)", () => {
    applyAction("you", "set_turn", { player: "agent" });
    const flash = seedCard("Ambusher", "agent", "hand", { typeLine: "Creature — Ninja" });
    applyAction("agent", "cast", { card: flash.id, note: "flash, in your end step" });
    applyAction("you", "stack_resolve", {});    // creature resolves first
    expect(flash.zone).toBe("battlefield");
    expect(game.turn).toBe("you");              // still my turn
    applyAction("agent", "stack_resolve", {});  // then the turn passes
    expect(game.turn).toBe("agent");
  });

  test("round counting still works through stacked turn passes", () => {
    const before = game.turnNumber;
    applyAction("you", "set_turn", { player: "agent" });
    applyAction("agent", "stack_resolve", {});
    applyAction("agent", "set_turn", { player: "you" });
    applyAction("you", "stack_resolve", {});
    expect(game.turnNumber).toBe(before + 1);
  });
});

describe("phase steps apply immediately — only the turn pass stacks", () => {
  test("set_phase changes the phase with no stack item", () => {
    applyAction("you", "set_phase", { phase: "combat" });
    expect(game.phase).toBe("combat");
    expect(game.stack.length).toBe(0);
  });

  test("end-of-turn responses happen against the TURN PASS declaration", () => {
    applyAction("you", "set_turn", { player: "agent" });
    const flash = seedCard("End-step Trick", "agent", "hand", { typeLine: "Instant" });
    applyAction("agent", "cast", { card: flash.id, note: "in response to the turn pass" });
    applyAction("you", "stack_resolve", {});    // trick first
    expect(flash.zone).toBe("graveyard");
    applyAction("agent", "stack_resolve", {});  // then the turn pass
    expect(game.turn).toBe("agent");
  });
});

describe("batched stack groups (proposed shortcuts)", () => {
  test("stack_batch pushes items in order sharing one groupId; cards move to the stack zone", () => {
    const spell = seedCard("Fresh Meat", "agent", "hand", { typeLine: "Instant" });
    const r = applyAction("agent", "stack_batch", { items: [
      { card: spell.id },
      { text: "Devour trigger — nine +1/+1 counters" },
      { text: "PLANNED: cast Springbloom Druid after this resolves", retractable: true },
    ]});
    expect(game.stack.length).toBe(3);
    expect(spell.zone).toBe("stack");
    const gid = game.stack[0].groupId;
    expect(gid).toBeTruthy();
    expect(game.stack.every((i) => i.groupId === gid)).toBe(true);
    expect(game.stack[2].retractable).toBe(true);
    expect(game.stack[0].retractable).toBeFalsy();
    expect(r.groupId).toBe(gid);
  });

  test("a land inside a batch is still a special action: straight to battlefield, not grouped", () => {
    const land = seedCard("Bojuka Bog", "you", "hand", { typeLine: "Land" });
    applyAction("you", "stack_batch", { items: [
      { card: land.id },
      { text: "Bojuka Bog ETB trigger — exile target graveyard" },
    ]});
    expect(land.zone).toBe("battlefield");
    expect(game.stack.length).toBe(1);
    expect(game.stack[0].groupId).toBeTruthy();
  });

  test("stack_resolve_all resolves opponent items LIFO and stops at your own", () => {
    const mine = seedCard("My Instant", "you", "hand", { typeLine: "Instant" });
    applyAction("you", "cast", { card: mine.id });
    const spell = seedCard("Bear", "agent", "hand", { typeLine: "Creature — Bear" });
    applyAction("agent", "stack_batch", { items: [
      { card: spell.id },
      { text: "ETB trigger — fight something" },
    ]});
    applyAction("you", "stack_resolve_all", {});
    expect(spell.zone).toBe("battlefield");
    expect(game.stack.length).toBe(1);       // my own item survives
    expect(game.stack[0].cardId).toBe(mine.id);
  });

  test("stack_resolve_all refuses when the top item is yours", () => {
    const mine = seedCard("My Instant", "you", "hand", { typeLine: "Instant" });
    applyAction("you", "cast", { card: mine.id });
    expect(() => applyAction("you", "stack_resolve_all", {})).toThrow();
  });

  test("respondAt retracts the proposer's retractable tail, keeps mandatory triggers, then pushes the response", () => {
    const a = seedCard("Spell A", "agent", "hand", { typeLine: "Sorcery" });
    const planned = seedCard("Planned B", "agent", "hand", { typeLine: "Creature — Ooze" });
    applyAction("agent", "stack_batch", { items: [
      { card: a.id },
      { text: "A's cast trigger" },                       // mandatory, above A
      { card: planned.id, retractable: true },            // planned follow-up
      { text: "PLANNED: pass turn", retractable: true },
    ]});
    const targetId = game.stack[0].id;                    // respond while A is on the stack
    const counter = seedCard("Counterspell", "you", "hand", { typeLine: "Instant" });
    applyAction("you", "cast", { card: counter.id, respondAt: targetId });
    // planned items above A are retracted (card back to agent's hand); trigger stays
    expect(planned.zone).toBe("hand");
    expect(game.stack.map((i) => i.text)).toEqual(["Spell A", "A's cast trigger", "Counterspell"]);
    expect(game.stack.at(-1)!.player).toBe("you");
  });

  test("respondAt on stack_push works the same", () => {
    const a = seedCard("Spell A", "agent", "hand", { typeLine: "Sorcery" });
    applyAction("agent", "stack_batch", { items: [
      { card: a.id },
      { text: "PLANNED: something else", retractable: true },
    ]});
    applyAction("you", "stack_push", { text: "Soultrader ability in response", respondAt: game.stack[0].id });
    expect(game.stack.map((i) => i.text)).toEqual(["Spell A", "Soultrader ability in response"]);
  });

  test("stack_counter can mark a specific mid-stack item by id", () => {
    const a = seedCard("Spell A", "agent", "hand", { typeLine: "Sorcery" });
    const b = seedCard("Trigger card", "agent", "hand", { typeLine: "Instant" });
    applyAction("agent", "cast", { card: a.id });
    applyAction("agent", "cast", { card: b.id });
    applyAction("you", "stack_counter", { item: game.stack[0].id });
    // both still on the stack; only the bottom one is marked
    expect(game.stack.length).toBe(2);
    expect(game.stack[0].countered).toBe(true);
    expect(game.stack[1].countered).toBeUndefined();
    expect(a.zone).toBe("stack");
    // resolve_all fizzles the countered one and resolves the other
    applyAction("you", "stack_resolve_all", {});
    expect(a.zone).toBe("graveyard");
    expect(b.zone).toBe("graveyard"); // instant resolves to graveyard normally
    expect(game.stack.length).toBe(0);
  });
});

describe("accepted proposals execute in proposal order", () => {
  test("resolve_all on a group runs bottom-up: the fetch happens before the planned cast", () => {
    const bear = seedCard("Bear", "agent", "hand", { typeLine: "Creature — Bear" });
    applyAction("agent", "stack_batch", { items: [
      { text: "Fetch: sac tarn, find a Forest" },
      { card: bear.id, retractable: true },
    ]});
    applyAction("you", "stack_resolve_all", {});
    expect(bear.zone).toBe("battlefield");
    const texts = game.log.slice(-3).map((e) => e.text);
    const fetchIdx = texts.findIndex((t) => t.includes("Fetch"));
    const bearIdx = texts.findIndex((t) => t.includes("Bear resolved"));
    expect(fetchIdx).toBeGreaterThanOrEqual(0);
    expect(bearIdx).toBeGreaterThan(fetchIdx);
  });

  test("ungrouped opponent items still resolve LIFO", () => {
    const a = seedCard("First Spell", "agent", "hand", { typeLine: "Instant" });
    const b = seedCard("Response To Own", "agent", "hand", { typeLine: "Instant" });
    applyAction("agent", "cast", { card: a.id });
    applyAction("agent", "cast", { card: b.id });
    applyAction("you", "stack_resolve_all", {});
    const texts = game.log.slice(-3).map((e) => e.text);
    expect(texts.findIndex((t) => t.includes("Response To Own resolved"))).toBeLessThan(texts.findIndex((t) => t.includes("First Spell resolved")));
  });
});

describe("only the opponent resolves your items", () => {
  test("stack_resolve refuses your own item (any position); opponent resolves it", () => {
    const c = seedCard("My Spell", "you", "hand", { typeLine: "Sorcery" });
    applyAction("you", "cast", { card: c.id });
    expect(() => applyAction("you", "stack_resolve", {})).toThrow(/opponent/);
    expect(() => applyAction("you", "stack_resolve", { item: game.stack[0].id })).toThrow(/opponent/);
    expect(game.stack.length).toBe(1); // refused resolves leave the stack intact
    applyAction("agent", "stack_resolve", {});
    expect(c.zone).toBe("graveyard");
  });
});

describe("multi-part announcements", () => {
  test("stack_push lines are stored, exposed in the view, and logged numbered", () => {
    applyAction("agent", "stack_push", {
      text: "COMBAT DAMAGE",
      lines: ["Marchesa 7/7 → Warrior token: token dies", "Imperial Recruiter unblocked → 2 to Agent"],
    });
    expect(game.stack[0].lines!.length).toBe(2);
    expect((viewFor("you") as any).stack[0].lines[1]).toContain("Imperial Recruiter");
    expect(game.log.at(-1)!.text).toContain("1. Marchesa");
  });
});

describe("stack_push source", () => {
  test("stores a validated source id and exposes it in the view", () => {
    const keep = seedCard("Kher Keep", "agent", "battlefield", { typeLine: "Legendary Land" });
    applyAction("agent", "stack_push", { text: "Kher Keep: create a Kobold", source: keep.id });
    expect(game.stack[0].sourceId).toBe(keep.id);
    expect((viewFor("you") as any).stack[0].source).toBe(keep.id);
    expect(() => applyAction("agent", "stack_push", { text: "x", source: "nope" })).toThrow();
  });
});
