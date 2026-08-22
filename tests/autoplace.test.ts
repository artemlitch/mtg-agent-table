import { describe, expect, it } from "vitest";
import { freeSpot, GAP, homeSpot, type Box } from "../client/src/game/autoplace";
import { typeCat } from "../client/src/game/rules";
import type { Card, PlayerId } from "../client/src/types";

const asCard = (typeLine: string, extra: Partial<Card> = {}) => ({ typeLine, ...extra }) as Card;
const home = (typeLine: string, p: PlayerId = "you") => homeSpot(p, typeCat(asCard(typeLine)));

describe("where a card heads for", () => {
  it("files a card by what it is", () => {
    expect(typeCat(asCard("Basic Land — Forest"))).toBe("land");
    expect(typeCat(asCard("Creature — Bear"))).toBe("creature");
    expect(typeCat(asCard("Instant"))).toBe("spell");
    expect(typeCat(asCard("Sorcery"))).toBe("spell");
    expect(typeCat(asCard("Artifact"))).toBe("other");
    expect(typeCat(asCard("Enchantment"))).toBe("other");
    // an artifact creature is a creature: the creature row wins
    expect(typeCat(asCard("Artifact Creature — Golem"))).toBe("creature");
  });

  it("files a double-faced card under the face it is showing", () => {
    const dfc = asCard("Creature — Werewolf", {
      faces: [{ name: "Front", typeLine: "Creature — Werewolf" }, { name: "Back", typeLine: "Land" }] as any,
      face: 1,
    });
    expect(typeCat(dfc)).toBe("land");
  });

  it("keeps the old board's convention: lands low, creatures forward, the rest to the side", () => {
    const land = home("Basic Land — Forest");
    const creature = home("Creature — Bear");
    const artifact = home("Artifact");
    const enchantment = home("Enchantment");

    // lands along your own edge, below everything else on your side, and the
    // row starts at the left edge itself — nothing sits to the left of it
    expect(land.y).toBeGreaterThan(creature.y);
    expect(land.x).toBe(0);
    // creatures forward, toward the midline (y 0.5 puts a card's CENTRE there)
    expect(creature.y).toBeGreaterThan(0.5);
    expect(creature.y).toBeLessThan(0.6);
    expect(creature.x).toBeLessThan(0.1);
    // artifacts and enchantments share the side column, off to the right
    expect(artifact).toEqual(enchantment);
    expect(artifact.x).toBeGreaterThan(0.9);
  });

  it("hovers a spell at a casting spot rather than in a permanent row", () => {
    const bolt = home("Instant");
    const bear = home("Creature — Bear");
    expect(bolt).not.toEqual(bear);
    // same row as the creatures, but centred instead of hard left
    expect(bolt.x).toBe(0.5);
    expect(bolt.x).toBeGreaterThan(bear.x);
    expect(bolt.y).toBe(bear.y);
  });

  it("mirrors the agent's half about the midline", () => {
    expect(home("Creature — Bear", "agent").y).toBeLessThan(0.5);
    expect(home("Basic Land — Island", "agent").y).toBeLessThan(home("Creature — Bear", "agent").y);
    // same column, opposite side
    expect(home("Artifact", "agent").x).toBe(home("Artifact").x);
  });

  it("hands out a copy, so a caller cannot edit the map", () => {
    const a = home("Artifact");
    a.x = 0.1;
    expect(home("Artifact").x).toBeGreaterThan(0.9);
  });
});

const W = 100;
const H = 140;
const BOARD: Box = { left: 0, top: 0, width: 1000, height: 600 };
const card = (left: number, top: number): Box => ({ left, top, width: W, height: H });
/** one card plus its air — the distance between two cards parked side by side */
const STEP = W + GAP;

describe("the two halves of the table", () => {
  // the real numbers off the board that produced the bug: your creature row
  // and the agent's both crowd the midline, leaving 4px between them
  it("does not let the row across the table displace a card", () => {
    const yourCreatureHome = { left: 150, top: 433 };
    const theirCreature = card(150, 301); // 301..429, yours starts at 433
    // the agent's cards are not in the list at all — settle.ts hands over
    // only the cards this one's controller holds
    expect(freeSpot(yourCreatureHome, [], W, H, BOARD)).toEqual(yourCreatureHome);
    // and if they were, this is what would happen: hop the midline
    expect(freeSpot(yourCreatureHome, [theirCreature], W, H, BOARD).top).toBe(301);
  });
});

describe("freeSpot", () => {
  it("leaves the home spot alone when nothing is there", () => {
    expect(freeSpot({ left: 20, top: 200 }, [], W, H, BOARD)).toEqual({ left: 20, top: 200 });
  });

  it("ignores cards that are nowhere near the home spot", () => {
    const spot = freeSpot({ left: 20, top: 200 }, [card(600, 200), card(20, 400)], W, H, BOARD);
    expect(spot).toEqual({ left: 20, top: 200 });
  });

  it("parks flush against the card in the way, one gap over", () => {
    const spot = freeSpot({ left: 20, top: 200 }, [card(20, 200)], W, H, BOARD);
    expect(spot).toEqual({ left: 20 + W + GAP, top: 200 });
  });

  it("takes the y of the neighbour it ends up beside, not the y it started at", () => {
    // the row has drifted 12px up since it was laid down; the new card joins
    // the row where it actually is
    const spot = freeSpot({ left: 20, top: 200 }, [card(20, 188)], W, H, BOARD);
    expect(spot).toEqual({ left: 20 + W + GAP, top: 188 });
  });

  it("counts a card that is only inside the gap as being in the way", () => {
    // no pixel of these two overlaps, but they would sit 2px too close to
    // read as two cards, so the newcomer shuffles over to a clean gap — the
    // nearest one, which here is 2px the other way
    const neighbour = card(20 + W + GAP - 2, 200);
    const spot = freeSpot({ left: 20, top: 200 }, [neighbour], W, H, BOARD);
    expect(spot).toEqual({ left: neighbour.left - W - GAP, top: 200 });
  });

  it("walks past a whole row of cards", () => {
    const row = [card(20, 200), card(20 + STEP, 200), card(20 + 2 * STEP, 200)];
    expect(freeSpot({ left: 20, top: 200 }, row, W, H, BOARD)).toEqual({ left: 20 + 3 * STEP, top: 200 });
  });

  it("walks past the row whatever order the cards come in", () => {
    const row = [card(20 + 2 * STEP, 200), card(20, 200), card(20 + STEP, 200)];
    expect(freeSpot({ left: 20, top: 200 }, row, W, H, BOARD)).toEqual({ left: 20 + 3 * STEP, top: 200 });
  });

  it("goes left when the nearest room is left", () => {
    // right of home is two cards deep, left of home is open
    const spot = freeSpot({ left: 400, top: 200 }, [card(400, 200), card(400 + STEP, 200)], W, H, BOARD);
    expect(spot).toEqual({ left: 400 - STEP, top: 200 });
  });

  it("goes right when the nearest room is right", () => {
    const spot = freeSpot({ left: 400, top: 200 }, [card(400, 200), card(400 - STEP, 200)], W, H, BOARD);
    expect(spot).toEqual({ left: 400 + STEP, top: 200 });
  });

  it("does not treat a card in another row as room", () => {
    // something sits exactly where the hop would land, one row down: the walk
    // has to carry on past it rather than stopping on top of it
    const spot = freeSpot({ left: 20, top: 200 }, [card(20, 200), card(20 + STEP, 220)], W, H, BOARD);
    expect(spot.left).toBeGreaterThanOrEqual(20 + 2 * STEP);
  });

  it("falls back to the home spot when the board is full both ways", () => {
    const narrow: Box = { left: 0, top: 0, width: 300, height: 600 };
    const spot = freeSpot({ left: 100, top: 200 }, [card(100, 200)], W, H, narrow);
    expect(spot).toEqual({ left: 100, top: 200 });
  });

  it("stays inside the board when it runs to the right edge", () => {
    const occupied = [card(BOARD.width - W, 200), card(BOARD.width - W - STEP, 200)];
    const spot = freeSpot({ left: BOARD.width - W, top: 200 }, occupied, W, H, BOARD);
    expect(spot.left + W).toBeLessThanOrEqual(BOARD.width);
    expect(spot).toEqual({ left: BOARD.width - W - 2 * STEP, top: 200 });
  });

  it("answers for a home spot pinned to the left edge by going right only", () => {
    const spot = freeSpot({ left: 0, top: 200 }, [card(0, 200)], W, H, BOARD);
    expect(spot).toEqual({ left: W + GAP, top: 200 });
  });

  it("answers for a home spot pinned to the right edge by going left only", () => {
    const home = { left: BOARD.width - W, top: 200 };
    const spot = freeSpot(home, [card(home.left, 200)], W, H, BOARD);
    expect(spot).toEqual({ left: home.left - W - GAP, top: 200 });
  });

  it("terminates on a board packed solid", () => {
    const packed: Box[] = [];
    for (let x = 0; x + W <= 1000; x += 54) packed.push(card(x, 200));
    expect(freeSpot({ left: 500, top: 200 }, packed, W, H, BOARD)).toEqual({ left: 500, top: 200 });
  });
});
