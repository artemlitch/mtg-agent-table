// What the hover preview draws.
//
// Hovering snapshots a Card object and the preview then prefers the LIVE copy
// off the table, so a card that changes while you are looking at it redraws.
// That was right for every card you can hover on the board and wrong for the
// one window where the snapshot is the only copy with a face on it: a library
// search. Every zone is serialized into the view, libraries included, and a
// library card is always hidden — so the "live" copy the preview reached for
// had an id and nothing else, and the search window drew an empty box.
import { describe, test, expect, beforeEach } from "vitest";
import type { Card, GameView } from "../client/src/types";

const { previewCard, useGame } = await import("../client/src/store/game");

const ZONES = ["library", "hand", "battlefield", "graveyard", "exile", "command", "stack"] as const;

/** A view holding exactly these cards, each filed in its own zone. */
function tableOf(...cards: Card[]) {
  const side = () => ({
    life: 40,
    commanderDamage: {},
    commanderTax: 0,
    turnDone: {},
    counts: Object.fromEntries(ZONES.map((z) => [z, 0])),
    zones: Object.fromEntries(ZONES.map((z) => [z, [] as Card[]])),
  });
  const v = { players: { you: side(), agent: side() }, stack: [] } as unknown as GameView;
  for (const c of cards) v.players[c.owner].zones[c.zone].push(c);
  useGame.setState({ view: v, dragging: false, parked: null });
}

const card = (extra: Partial<Card> = {}): Card =>
  ({ id: "c1", owner: "you", controller: "you", zone: "battlefield", name: "Sylvan Library", ...extra }) as Card;

beforeEach(() => {
  useGame.setState({ view: null, dragging: false, parked: null });
});

describe("which copy of the card the preview draws", () => {
  test("the live one, when the table has a face for it", () => {
    // the whole point of the lookup: flip a card, add a counter, tap it, and
    // the preview under a still cursor keeps up
    tableOf(card({ name: "Sylvan Library", tapped: true }));
    expect(previewCard(card({ tapped: false })).tapped).toBe(true);
  });

  test("the snapshot, when the table's copy is a faceless stub", () => {
    // a library card as the view carries it: id, zone, owner — no name
    tableOf(card({ zone: "library", hidden: true, name: undefined }));
    const found = card({ zone: "library", name: "Sylvan Library", image: "art.jpg" });
    expect(previewCard(found).name).toBe("Sylvan Library");
    expect(previewCard(found).image).toBe("art.jpg");
  });

  test("the snapshot, for something not on the table at all", () => {
    tableOf();
    expect(previewCard(card({ name: "Sylvan Library" })).name).toBe("Sylvan Library");
  });

  test("the snapshot, before any view has arrived", () => {
    expect(previewCard(card()).name).toBe("Sylvan Library");
  });
});
