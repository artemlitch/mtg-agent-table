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

interface Rect {
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

/** Mirrors HOME_POS on the server: where a card sits before anybody has moved
 *  it. Only reached by cards the server has no position for — a stack ghost
 *  hovering before it resolves. */
export const HOME: Record<"you" | "agent", { x: number; y: number }> = {
  agent: { x: 0, y: 0 },
  you: { x: 0, y: 1 },
};

interface Surface {
  /** the felt itself, at 0,0 — the origin every other number here shares */
  felt: Rect;
  /** where cards may come to rest: board area minus the furniture over it */
  place: Rect;
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

  // inset past whatever is drawn over the board. Each piece is on a known
  // edge, so this is four maxima rather than real region subtraction.
  let l = board.left;
  let t = board.top;
  let r = right(board);
  let b = bottom(board);
  const inset = (sel: string, edge: "top" | "bottom" | "left" | "right") => {
    const el = document.querySelector(sel);
    if (!el) return;
    const q = rectOf(el, origin);
    if (edge === "top") t = Math.max(t, bottom(q));
    else if (edge === "bottom") b = Math.min(b, q.top);
    else if (edge === "left") l = Math.max(l, right(q));
    else r = Math.min(r, q.left);
  };
  inset("#hand-agent", "top");
  inset("#hand-you", "bottom");
  // both command zones hug the left edge of their own half (the agent's is
  // mirrored to its top corner), so one left inset clears both
  inset("#cmdzone-you", "left");
  inset("#cmdzone-agent", "left");
  inset("#btn-token", "right");

  const place: Rect = { left: l, top: t, width: Math.max(1, r - l), height: Math.max(1, b - t) };
  surface = { felt: { left: 0, top: 0, width: origin.width, height: origin.height }, place };
  return surface;
}

const span = (s: Surface) => ({ w: Math.max(1, s.place.width - CW()), h: Math.max(1, s.place.height - CH()) });

/** A stored position as felt-local pixels — the card's top-left corner. */
export function posToPx(pos: { x: number; y: number }): { left: number; top: number } {
  const s = surface;
  if (!s) return { left: 0, top: 0 };
  const { w, h } = span(s);
  return { left: s.place.left + pos.x * w, top: s.place.top + pos.y * h };
}

/** Felt-local pixels back to a stored position, clamped onto the table. */
export function pxToPos(left: number, top: number): { x: number; y: number } {
  const s = surface;
  if (!s) return { x: 0, y: 0 };
  const { w, h } = span(s);
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  return { x: clamp01((left - s.place.left) / w), y: clamp01((top - s.place.top) / h) };
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
      // smallest first, so the specific target wins where regions overlap: the
      // command zone sits ON TOP of the hand strip, and in document order the
      // hand would swallow every drop meant for the socket
      .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)
  );
}

/** The region under a felt-local point, or null for the open table. */
export function regionAt(regions: Region[], x: number, y: number): Region | null {
  return regions.find((r) => inside(r.rect, x, y)) ?? null;
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
