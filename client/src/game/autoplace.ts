// Where a card goes when nobody said where.
//
// The old board kept a count — third land, third slot — and any card you
// dragged by hand made that count a lie. Nothing is counted here. The board
// is read as it stands at the moment of the placement and the answer comes
// out of that, so rearranging the table by hand cannot desynchronise
// anything: the next card simply looks again.
//
// Everything in this file is a pure function of its arguments. It knows
// nothing about the DOM, the store or the server — see settle.ts for the
// part that does. The type imports are erased, so this stays loadable
// anywhere.
import type { PlayerId } from "../types";
import type { TypeCat } from "./rules";

/** Where a card of each kind heads for when it reaches the table. Only ever a
 *  starting point: the search below moves off it if it is taken, and once a
 *  card has a spot nothing consults this again.
 *
 *  The convention is the one the old board laid out by hand — lands in a row
 *  along your own edge, creatures forward toward the midline, artifacts and
 *  enchantments off to one side — in table coordinates.
 *
 *  A note on y: it is a fraction of the PLACEABLE span (board height minus a
 *  card), which puts a card's CENTRE at the midline when y is 0.5. So "just
 *  inside my half" is a little over 0.5, not a little under 1. y of 0 and 1
 *  mean flush against the far edges; a card is held clear of the hands that
 *  overlap those edges, so a land at y=1 rests on top of your hand rather
 *  than behind it. */
const HOME: Record<PlayerId, Record<TypeCat, { x: number; y: number }>> = {
  you: {
    creature: { x: 0.02, y: 0.59 }, // top left of your half
    spell: { x: 0.5, y: 0.59 }, //    top centre, up against the midline
    other: { x: 0.97, y: 0.73 }, //   the right-hand column
    land: { x: 0, y: 1 }, //          the land row, flush above your hand
  },
  // the agent's half mirrors yours about the midline: same x, y flipped, so
  // its creatures also come forward and its lands also sit on its own edge
  agent: {
    creature: { x: 0.02, y: 0.41 },
    spell: { x: 0.5, y: 0.41 },
    other: { x: 0.97, y: 0.27 },
    land: { x: 0, y: 0 },
  },
};

export const homeSpot = (player: PlayerId, cat: TypeCat) => ({ ...HOME[player][cat] });

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Spot {
  left: number;
  top: number;
}

/** Air kept clear around every card on the felt — just enough that two cards
 *  side by side read as two cards rather than a pile. */
export const GAP = 2;

const right = (b: Box) => b.left + b.width;
const bottom = (b: Box) => b.top + b.height;

/** Is a card of this size, at this spot, clear of `b`? The gap is charged to
 *  the card already on the table, so a spot flush against an occupant's
 *  inflated edge counts as free — which is exactly where a hop lands. */
function clashes(at: Spot, w: number, h: number, b: Box): boolean {
  return (
    at.left < right(b) + GAP &&
    at.left + w > b.left - GAP &&
    at.top < bottom(b) + GAP &&
    at.top + h > b.top - GAP
  );
}

function blockerAt(at: Spot, w: number, h: number, occupied: Box[]): Box | null {
  for (const b of occupied) if (clashes(at, w, h, b)) return b;
  return null;
}

/** How close, side to side, two cards must be before one is put down as the
 *  other's neighbour. Roughly half a card. */
export const ALIGN_REACH = 40;
/** How far out of line a drop may be and still read as meant for the row. */
export const ALIGN_TOL = 20;

/** Tidy the y of a card just dropped by hand.
 *
 *  Land beside a card — within half a card's reach of it, and near enough to
 *  its line that you were plainly aiming for the row — and the drop takes
 *  that card's y exactly. It closes the gap between what a hand can do with
 *  a mouse and what the eye wants, which is a straight row. x is left where
 *  you put it: spacing along a row is a choice, height in it is not.
 *
 *  Out of reach, or clearly on a line of its own, and the drop stands. */
export function alignY(spot: Spot, neighbours: Box[], w: number): Spot {
  let best: Box | null = null;
  let bestGap = Infinity;
  for (const n of neighbours) {
    const dy = Math.abs(n.top - spot.top);
    if (dy > ALIGN_TOL) continue;
    // edge to edge, so a card you dropped overlapping one counts as touching
    const gap = Math.max(0, n.left - (spot.left + w), spot.left - right(n));
    if (gap > ALIGN_REACH) continue;
    if (gap < bestGap || (gap === bestGap && best && dy < Math.abs(best.top - spot.top))) {
      best = n;
      bestGap = gap;
    }
  }
  return best ? { left: spot.left, top: best.top } : spot;
}

/** The spot a card should take, given where its type says it belongs.
 *
 *  If the home spot is clear, that is the answer. If it is not, two probes
 *  leave home — one going left, one going right — and the one currently
 *  nearer home always moves next, so whichever finds a clear spot first has
 *  found the nearest clear spot there is.
 *
 *  A probe never inches: it hops straight past the card that blocked it and
 *  takes that card's y on the way. So a card comes to rest tight against a
 *  neighbour and level with it, and a row that somebody has nudged out of
 *  true stays the row it has become rather than snapping back to a lattice.
 *
 *  Run out of board and the home spot is the answer after all. A visible
 *  pile beats a card shoved off the edge, and you can always drag it. */
export function freeSpot(home: Spot, occupied: Box[], w: number, h: number, bounds: Box): Spot {
  if (!blockerAt(home, w, h, occupied)) return home;

  const onBoard = (at: Spot) => at.left >= bounds.left && at.left + w <= right(bounds);
  let ahead: Spot | null = home; // walking right
  let behind: Spot | null = home; // walking left
  // every hop moves a probe strictly outward, so each can hop at most once
  // per occupant before it leaves the board; the cap is only a backstop
  let hops = occupied.length * 2 + 8;

  while ((ahead || behind) && hops-- > 0) {
    const takeAhead = ahead !== null && (behind === null || ahead.left - home.left <= home.left - behind.left);
    const at = (takeAhead ? ahead : behind)!;
    const blocker = blockerAt(at, w, h, occupied);
    if (!blocker) return at;
    const hop: Spot = takeAhead
      ? { left: right(blocker) + GAP, top: blocker.top }
      : { left: blocker.left - w - GAP, top: blocker.top };
    const next = onBoard(hop) ? hop : null;
    if (takeAhead) ahead = next;
    else behind = next;
  }
  return home;
}
