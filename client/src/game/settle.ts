// Placing the cards nobody has placed yet.
//
// A card reaching the table arrives with pos null: the server does not
// invent positions, because where a card should go is a question about the
// felt — how wide a card is in this window, what is already lying there,
// which way a row grows — and it can see none of that. So a null pos on the
// table means one thing only, and it means it to everybody: this card is
// waiting to be placed. It gets placed here, once, before the next paint,
// and from then on it has a position like any other card and nothing moves
// it again.

import { act } from "../api";
import { useGame } from "../store/game";
import type { Card } from "../types";
import { freeSpot, homeSpot, type Box, type Spot } from "./autoplace";
import { dlog, pt } from "./debug";
import { stackCardsOf, typeCat } from "./rules";
import type { GameView, PlayerId } from "../types";
import { CH, CW, placeRect, posToPx, pxToPos, snapshotCards } from "./table";

/** Place every card on the table that has no position yet.
 *
 *  Returns true if anything was placed, which the caller needs: the claim
 *  goes into a Map that no component subscribes to, so the re-render is the
 *  caller's to trigger. */
export function settleUnplaced(): boolean {
  const { view, dragging, pendingPos } = useGame.getState();
  const bounds = placeRect();
  if (!view || dragging || !bounds) return false;

  // A card placed a moment ago has a claim but no server answer yet, so it
  // still reads null — the claim is the record that it is already dealt
  // with. A tucked card is skipped because its pile's anchor owns the spot.
  const unplaced = (c: Card | undefined | null): c is Card =>
    !!c && !c.pos && !c.under && !pendingPos.has(c.id);
  const waiting: Card[] = [];
  for (const p of ["you", "agent"] as const) {
    waiting.push(...view.players[p].zones.battlefield.filter(unplaced));
    // an unresolved spell is on the felt as well, and the spot it settles
    // into now is the spot it will resolve at
    waiting.push(...stackCardsOf(p).map((it) => it.card).filter(unplaced));
  }
  if (!waiting.length) return false;

  const w = CW();
  const h = CH();
  // A card makes room for its controller's cards and nobody else's. The two
  // creature rows both crowd the midline, so at most window heights they sit
  // a few pixels apart — near enough that the agent's row would read as
  // blocking yours and push your creature onto their side of the table. You
  // arrange your half, they arrange theirs.
  //
  // Only the top of a pile counts as occupying its space: the cards tucked
  // under it are the same object on the table, not separate obstacles.
  const waitingIds = new Set(waiting.map((c) => c.id));
  const held = controllers(view);
  const occupied = snapshotCards(waitingIds)
    .filter((c) => !c.el.classList.contains("tucked"))
    .map((c) => ({ by: held.get(c.id), ...c.rect }));

  for (const c of waiting) {
    const cat = typeCat(c);
    const home = posToPx(homeSpot(c.controller, cat));
    const rivals: Box[] = occupied.filter((b) => b.by === c.controller);
    const at: Spot = freeSpot(home, rivals, w, h, bounds);
    // the rest of this batch has to see it — the DOM will not know until the
    // next paint, and four tokens must not all take the same spot
    occupied.push({ by: c.controller, left: at.left, top: at.top, width: w, height: h });
    const pos = pxToPos(at.left, at.top);
    dlog(`settle ${c.name}(${c.id})`, {
      as: cat,
      home: `${Math.round(home.left)},${Math.round(home.top)}`,
      spot: `${Math.round(at.left)},${Math.round(at.top)}`,
      moved: at.left !== home.left || at.top !== home.top ? `${Math.round(at.left - home.left)},${Math.round(at.top - home.top)}` : "no",
      pos: pt(pos),
      past: rivals.length,
    });
    useGame.getState().expectPos(c.id, pos);
    void act("place", { positions: [{ card: c.id, x: pos.x, y: pos.y }] });
  }
  return true;
}

/** Who controls each card drawn on the felt. The rects come from the DOM,
 *  which knows nothing about seats. */
function controllers(view: GameView): Map<string, PlayerId> {
  const by = new Map<string, PlayerId>();
  for (const p of ["you", "agent"] as const) {
    for (const c of view.players[p].zones.battlefield) by.set(c.id, c.controller ?? p);
    for (const it of stackCardsOf(p)) if (it.card) by.set(it.card.id, p);
  }
  return by;
}
