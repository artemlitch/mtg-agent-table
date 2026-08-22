import { describe, expect, it } from "vitest";
import { freeSpot, GAP, type Box } from "../client/src/game/autoplace";

const W = 100;
const H = 140;
const BOARD: Box = { left: 0, top: 0, width: 1000, height: 600 };
const card = (left: number, top: number): Box => ({ left, top, width: W, height: H });

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
    const row = [card(20, 200), card(128, 200), card(236, 200)];
    expect(freeSpot({ left: 20, top: 200 }, row, W, H, BOARD)).toEqual({ left: 344, top: 200 });
  });

  it("walks past the row whatever order the cards come in", () => {
    const row = [card(236, 200), card(20, 200), card(128, 200)];
    expect(freeSpot({ left: 20, top: 200 }, row, W, H, BOARD)).toEqual({ left: 344, top: 200 });
  });

  it("goes left when the nearest room is left", () => {
    // right of home is two cards deep, left of home is open
    const spot = freeSpot({ left: 400, top: 200 }, [card(400, 200), card(508, 200)], W, H, BOARD);
    expect(spot).toEqual({ left: 400 - W - GAP, top: 200 });
  });

  it("goes right when the nearest room is right", () => {
    const spot = freeSpot({ left: 400, top: 200 }, [card(400, 200), card(292, 200)], W, H, BOARD);
    expect(spot).toEqual({ left: 508, top: 200 });
  });

  it("does not treat a card in another row as room", () => {
    // something sits exactly where the hop would land, one row down: the walk
    // has to carry on past it rather than stopping on top of it
    const spot = freeSpot({ left: 20, top: 200 }, [card(20, 200), card(128, 200 + 20)], W, H, BOARD);
    expect(spot.left).toBeGreaterThanOrEqual(236);
  });

  it("falls back to the home spot when the board is full both ways", () => {
    const narrow: Box = { left: 0, top: 0, width: 300, height: 600 };
    const spot = freeSpot({ left: 100, top: 200 }, [card(100, 200)], W, H, narrow);
    expect(spot).toEqual({ left: 100, top: 200 });
  });

  it("stays inside the board when it runs to the right edge", () => {
    const occupied = [card(700, 200), card(808, 200)];
    const spot = freeSpot({ left: 700, top: 200 }, occupied, W, H, BOARD);
    expect(spot.left + W).toBeLessThanOrEqual(BOARD.width);
    expect(spot).toEqual({ left: 592, top: 200 });
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
