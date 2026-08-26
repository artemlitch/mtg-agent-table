// Sending a commander home.
//
// Command-zone replacement is a choice its owner makes as the card leaves,
// and nothing at this table is in a position to ask: a commander that dies,
// is exiled, is discarded or gets shuffled away just lands there like any
// other card. So the row is offered afterwards, from wherever it ended up —
// and it has to be offered on every surface that can show one of those zones,
// because the card menu is not the only way you meet a card.
import { describe, test, expect, beforeEach } from "vitest";
import { game, resetGameState, applyAction, makeCard, newCardId, type Zone } from "../server/game";
import type { Card } from "../client/src/types";

globalThis.localStorage ??= { getItem: () => null, setItem: () => {} } as unknown as Storage;

/** Every action the row sent, in order. */
const sent: { type: string; params: any }[] = [];
globalThis.fetch = (async (_url: string, init: any) => {
  sent.push(JSON.parse(init.body));
  return { json: async () => ({ ok: true }) };
}) as unknown as typeof fetch;

const { canSendHome, destItem } = await import("../client/src/game/dest");

const clientCard = (zone: Zone, extra: Partial<Card> = {}): Card =>
  ({ id: "c1", name: "Marchesa, the Black Rose", owner: "you", controller: "you", zone, isCommander: true, ...extra }) as Card;

describe("which zones a commander can be sent home from", () => {
  test("the four it can be stranded in", () => {
    for (const zone of ["hand", "graveyard", "exile", "library"] as Zone[]) {
      expect(canSendHome(clientCard(zone))).toBe(true);
    }
  });

  test("not the command zone — it is already there", () => {
    expect(canSendHome(clientCard("command"))).toBe(false);
  });

  test("not the battlefield — that menu has its own Command zone row", () => {
    // offering it twice in one list is the bug this exclusion prevents; the
    // battlefield row sits among the other places a permanent can be sent
    expect(canSendHome(clientCard("battlefield"))).toBe(false);
  });

  test("not the stack — a commander waiting there has not gone anywhere", () => {
    expect(canSendHome(clientCard("stack"))).toBe(false);
  });

  test("and never on a card whose face you cannot see", () => {
    // isCommander rides along on a hidden card, so the row would have pointed
    // at the one card in a hand you are not allowed to identify
    expect(canSendHome(clientCard("hand", { hidden: true }))).toBe(false);
  });

  test("and never for a card that is not the commander", () => {
    for (const zone of ["hand", "graveyard", "exile", "library"] as Zone[]) {
      expect(canSendHome(clientCard(zone, { isCommander: false }))).toBe(false);
    }
  });
});

describe("what the row does", () => {
  beforeEach(() => {
    sent.length = 0;
  });

  test("it is a plain move, not a cast", () => {
    // the command zone is not a battlefield, so runDest must not route this
    // through playCard — going home is filing a card, not playing one
    destItem("command", clientCard("graveyard")).fn!();
    expect(sent.length).toBe(1);
    expect(sent[0].type).toBe("move");
    expect(sent[0].params).toMatchObject({ card: "c1", toZone: "command", toPlayer: "you" });
  });

  test("it aims at the card's OWNER, never at whoever is looking", () => {
    // a commander of the agent's, sitting in a pile you are browsing
    destItem("command", clientCard("exile", { owner: "agent", controller: "you" })).fn!();
    expect(sent[0].params.toPlayer).toBe("agent");
  });
});

describe("the table takes it home", () => {
  beforeEach(() => {
    resetGameState();
  });

  const strandedIn = (zone: Zone) => {
    const c = makeCard({
      id: newCardId(),
      name: "Marchesa, the Black Rose",
      owner: "you",
      controller: "you",
      zone,
      typeLine: "Legendary Creature — Human Wizard",
      isCommander: true,
    });
    game.cards[c.id] = c;
    game.players.you.zones[zone].push(c.id);
    return c;
  };

  for (const zone of ["hand", "graveyard", "exile", "library"] as Zone[]) {
    test(`from the ${zone}`, () => {
      const c = strandedIn(zone);
      applyAction("you", "move", { card: c.id, toZone: "command", toPlayer: "you" });
      expect(game.cards[c.id].zone).toBe("command");
      expect(game.players.you.zones.command).toContain(c.id);
      expect(game.players.you.zones[zone]).not.toContain(c.id);
    });
  }

  test("a commander of the agent's goes to the AGENT's command zone", () => {
    // the server coerces owner-zones (CR 404.1), so the row cannot misfile one
    const c = makeCard({
      id: newCardId(),
      name: "Kess, Dissident Mage",
      owner: "agent",
      controller: "you",
      zone: "exile",
      isCommander: true,
    });
    game.cards[c.id] = c;
    game.players.you.zones.exile.push(c.id);
    applyAction("you", "move", { card: c.id, toZone: "command", toPlayer: "you" });
    expect(game.players.agent.zones.command).toContain(c.id);
    expect(game.players.you.zones.command).not.toContain(c.id);
  });
});
