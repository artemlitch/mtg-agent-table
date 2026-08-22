// Where a card goes when nobody said where.
//
// The old board kept a count — third land, third slot — and any card you
// dragged by hand made that count a lie. Nothing is counted here. The board
// is read as it stands at the moment of the placement and the answer comes
// out of that, so rearranging the table by hand cannot desynchronise
// anything: the next card simply looks again.
//
// Everything in this file is a pure function of the numbers passed in. It
// knows nothing about cards, the DOM, the store or the server — see
// settle.ts for the part that does.

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

/** Air kept clear around every card on the felt. Two cards butted edge to
 *  edge read as a pile; this is enough to read as two cards. */
export const GAP = 8;

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
