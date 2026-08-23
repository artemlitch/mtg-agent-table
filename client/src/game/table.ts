// The table surface: ONE coordinate system for the whole felt.
//
// Everything you can touch mid-gesture — both battlefields, both hands, both
// command zones, the rail piles — lives in felt-local pixels. There is no
// per-seat space, no viewport space, no conversion inside a drag. A card being
// carried from your hand to the agent's half never changes number line.
//
// Storage is the one place fractions appear. A card's saved pos is a fraction
// of the PLACEABLE rect: the board area inset past the furniture that sits on
// top of it (the hands along the top and bottom edges, the command zones on
// the left, the token button on the right). That inset is why the server can
// say "home is {0,0}" and mean the corner of usable board rather than the
// corner of the window, at any window size.
//
// Normalization divides by (size - card size), so x=1 is a card flush with the
// right edge rather than a card hanging off it. That also makes the round trip
// pos -> px -> pos exact, which is what keeps a server ack from nudging a card
// you just dropped.

import { box, dlog, fr, px } from "./debug";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const rectOf = (el: Element, origin: DOMRect): Rect => {
  const r = el.getBoundingClientRect();
  return { left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height };
};

const right = (r: Rect) => r.left + r.width;
const bottom = (r: Rect) => r.top + r.height;

/** Card size on the board — the LAYOUT box, from the stylesheet. Never a
 *  bounding rect: a tapped card is rotated, and its rect is not its box.
 *
 *  Cached, and refreshed by measureSurface. Reading a custom property means
 *  getComputedStyle, which flushes style; this is called once per card per
 *  render and several times per pointermove, and at that rate it is the
 *  difference between a card that tracks the cursor and one that trails it. */
let cw = 92;
let ch = 128;
export const CW = () => cw;
export const CH = () => ch;

/** A tucked card peeks out from under the one it hangs from by this much, one
 *  step per rung, so every card in a pile has a strip you can grab. */
export const PILE_DX = 15;
export const PILE_DY = 26;


interface Surface {
  /** the felt itself, at 0,0 — the origin every other number here shares */
  felt: Rect;
  /** the coordinate space: the whole board, so x=0 is its real left edge */
  place: Rect;
  /** the vertical band a card may come to REST in — the board between the two
   *  hands. Not a smaller coordinate space (that is what made the left edge
   *  unreachable), just a clamp on where a dropped card settles, so a card
   *  can never be laid down behind a hand. */
  restTop: number;
  restBottom: number;
}

let surface: Surface | null = null;

/** Re-measure the felt. Called on mount and on every resize, never per frame:
 *  the rects cannot change mid-gesture, so a drag reads them once. */
export function measureSurface(): Surface | null {
  const felt = document.getElementById("felt");
  const boards = ["agent", "you"].map((p) => document.getElementById(`boardwrap-${p}`));
  if (!felt || !boards[0] || !boards[1]) return null;
  const origin = felt.getBoundingClientRect();
  // the one place the card size is read: everything downstream uses the cache
  const root = getComputedStyle(document.documentElement);
  cw = parseFloat(root.getPropertyValue("--card-w")) || 92;
  ch = parseFloat(root.getPropertyValue("--card-h")) || 128;

  const top = rectOf(boards[0]!, origin);
  const bot = rectOf(boards[1]!, origin);
  // the two boardwraps are stacked and the same width, so their union is the
  // board area: one rect spanning both halves, the rail excluded by
  // construction (it is a sibling of the boardwrap, not inside it)
  const board: Rect = {
    left: Math.min(top.left, bot.left),
    top: top.top,
    width: Math.max(right(top), right(bot)) - Math.min(top.left, bot.left),
    height: bottom(bot) - top.top,
  };

  // The placeable rect IS the board. It is tempting to inset it past the
  // furniture drawn on top (the hands, the command zones, the token button)
  // so that x=0 lands somewhere clear — but every one of those is a drop
  // REGION, so a release over them never reaches placement in the first
  // place. Insetting only makes x=0 mean "84px inside the left edge", which
  // clamps anything dropped further left and snaps it sideways on release.
  const place: Rect = board;
  // the hands bound the resting band top and bottom. They are the only
  // furniture that does: each is a full-width strip along an edge, so
  // "cards stop here" is the whole shape. The command zone and the token
  // button are small things sitting ON the table, and a card may overlap
  // them the way one card overlaps another.
  const strip = (id: string) => {
    const el = document.getElementById(id);
    return el ? rectOf(el, origin) : null;
  };
  const topHand = strip("hand-agent");
  const botHand = strip("hand-you");
  const restTop = topHand ? Math.max(place.top, bottom(topHand)) : place.top;
  const restBottom = botHand ? Math.min(bottom(place), botHand.top) : bottom(place);

  surface = { felt: { left: 0, top: 0, width: origin.width, height: origin.height }, place, restTop, restBottom };
  dlog("surface", {
    felt: `${px(origin.width)} x ${px(origin.height)} @vp ${px(origin.left)}, ${px(origin.top)}`,
    placeable: `${px(place.width)} x ${px(place.height)} @felt ${box(place)}`,
    restBand: `${px(restTop)} .. ${px(restBottom)} (y ${fr(yLimits().min)} .. ${fr(yLimits().max)})`,
    card: `${cw} x ${ch}`,
    span: `${px(Math.max(1, place.width - cw))} x ${px(Math.max(1, place.height - ch))}`,
  });
  return surface;
}

/** The rect a card may be laid down in, in felt-local pixels. */
export function placeRect(): Rect | null {
  return surface?.place ?? null;
}

/** The stored-y range that keeps a card's whole box inside the resting band. */
function yLimits(): { min: number; max: number } {
  const s = surface;
  if (!s) return { min: 0, max: 1 };
  const h = Math.max(1, s.place.height - ch);
  return {
    min: Math.max(0, Math.min(1, (s.restTop - s.place.top) / h)),
    max: Math.max(0, Math.min(1, (s.restBottom - ch - s.place.top) / h)),
  };
}

const span = (s: Surface) => ({ w: Math.max(1, s.place.width - CW()), h: Math.max(1, s.place.height - CH()) });

/** A stored position as felt-local pixels — the card's top-left corner.
 *
 *  y is held inside the resting band on the way out, the same as on the way
 *  in. That is what lets a default position say "y = 1" and mean "flush with
 *  where my hand starts" at any window size, instead of carrying a fraction
 *  someone measured once. It also means a card can never be DRAWN behind a
 *  hand, however its position got there — dropped, defaulted, or placed by
 *  the agent. */
export function posToPx(pos: { x: number; y: number }): { left: number; top: number } {
  const s = surface;
  if (!s) return { left: 0, top: 0 };
  const { w, h } = span(s);
  const lim = yLimits();
  const y = Math.max(lim.min, Math.min(lim.max, pos.y));
  return { left: s.place.left + pos.x * w, top: s.place.top + y * h };
}

/** Felt-local pixels back to a stored position. x is clamped to the board's
 *  own edges; y additionally to the resting band, so a card released over a
 *  hand settles above it instead of behind it. */
export function pxToPos(left: number, top: number): { x: number; y: number } {
  const s = surface;
  if (!s) return { x: 0, y: 0 };
  const { w, h } = span(s);
  const lim = yLimits();
  return {
    x: Math.max(0, Math.min(1, (left - s.place.left) / w)),
    y: Math.max(lim.min, Math.min(lim.max, (top - s.place.top) / h)),
  };
}

// ── drop regions ───────────────────────────────────────────────────────────
// Every zone a card can be released onto, as a rect in the same felt-local
// space. Snapshotted once when a drag starts: they cannot move while the
// pointer is down, and re-reading them per frame is how the old code ended up
// calling getBoundingClientRect on the far battlefield sixty times a second.

export type RegionKind = "hand" | "command" | "pile";

export interface Region {
  kind: RegionKind;
  player: "you" | "agent";
  /** graveyard / exile / library, for pile regions */
  zone?: string;
  el: HTMLElement;
  rect: Rect;
}

const inside = (r: Rect, x: number, y: number) => x >= r.left && x <= right(r) && y >= r.top && y <= bottom(r);

/** Snapshot every registered drop region. Zones declare themselves with
 *  data-drop="<kind>:<player>[:<zone>]", so adding a target is an attribute
 *  rather than another branch in the drag. */
export function snapshotRegions(): Region[] {
  const felt = document.getElementById("felt");
  if (!felt) return [];
  const origin = felt.getBoundingClientRect();
  return (
    [...document.querySelectorAll<HTMLElement>("[data-drop]")]
      .map((el) => {
        const [kind, player, zone] = el.dataset.drop!.split(":");
        return { kind: kind as RegionKind, player: player as "you" | "agent", zone, el, rect: rectOf(el, origin) };
      })
      // smallest first, so the specific target wins wherever regions overlap
      // and document order would let the larger one swallow the drop
      .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)
  );
}

/** The region a card released here would go to, or null for the open table.
 *
 *  Tested against the CARD's centre, not the pointer. The pointer is where
 *  your fingers are; the card is the thing being put down, and the two are
 *  a grab-offset apart. Testing the pointer meant a card grabbed near its
 *  top edge could be laid down behind the hand while the pointer stayed
 *  clear of it — and, in reverse, a card grabbed near its bottom edge
 *  jumped into the hand while its body was nowhere near. One object
 *  decides both the target and the resting place. */
export function regionAt(regions: Region[], card: { left: number; top: number }): Region | null {
  const cx = card.left + cw / 2;
  const cy = card.top + ch / 2;
  return regions.find((r) => inside(r.rect, cx, cy)) ?? null;
}

/** Every board card's box, in the same felt-local space. Snapshotted when a
 *  drag starts, for the same reason the regions are: measuring each card on
 *  each pointermove is a forced layout per card per frame, and that is what a
 *  card lagging behind the cursor looks like.
 *
 *  Cards do not move while you hold one. A poll landing mid-drag could in
 *  principle add one, and it will not be a tuck target until you let go. */
export interface CardBox {
  id: string;
  el: HTMLElement;
  rect: Rect;
}

export function snapshotCards(exclude: Set<string>): CardBox[] {
  const felt = document.getElementById("felt");
  if (!felt) return [];
  const origin = felt.getBoundingClientRect();
  return [...document.querySelectorAll<HTMLElement>("#cardlayer .card[data-card-id]")]
    .filter((el) => !exclude.has(el.dataset.cardId!))
    .map((el) => ({ id: el.dataset.cardId!, el, rect: rectOf(el, origin) }));
}

/** The topmost card under a point — last in document order wins, which is the
 *  one drawn on top. */
export function cardAt(cards: CardBox[], x: number, y: number): CardBox | null {
  for (let i = cards.length - 1; i >= 0; i--) if (inside(cards[i].rect, x, y)) return cards[i];
  return null;
}
