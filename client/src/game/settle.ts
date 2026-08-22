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
  // Only the top of a pile counts as occupying its space: the cards tucked
  // under it are the same object on the table, not separate obstacles.
  const mine = new Set(waiting.map((c) => c.id));
  const occupied: Box[] = snapshotCards(mine)
    .filter((c) => !c.el.classList.contains("tucked"))
    .map((c) => c.rect);

  for (const c of waiting) {
    const cat = typeCat(c);
    const home = posToPx(homeSpot(c.controller, cat));
    const at: Spot = freeSpot(home, occupied, w, h, bounds);
    // the rest of this batch has to see it — the DOM will not know until the
    // next paint, and four tokens must not all take the same spot
    occupied.push({ left: at.left, top: at.top, width: w, height: h });
    const pos = pxToPos(at.left, at.top);
    dlog(`settle ${c.name}(${c.id})`, {
      as: cat,
      home: `${Math.round(home.left)},${Math.round(home.top)}`,
      spot: `${Math.round(at.left)},${Math.round(at.top)}`,
      moved: at.left !== home.left || at.top !== home.top ? `${Math.round(at.left - home.left)},${Math.round(at.top - home.top)}` : "no",
      pos: pt(pos),
      past: occupied.length - 1,
    });
    useGame.getState().expectPos(c.id, pos);
    void act("place", { positions: [{ card: c.id, x: pos.x, y: pos.y }] });
  }
  return true;
}
