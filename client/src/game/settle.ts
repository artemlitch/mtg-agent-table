// The impure half of automatic placement: read the felt, ask autoplace.ts
// where the card should go, claim the spot and tell the server.
//
// The server puts every card that reaches the table on the default spot for
// its type and marks it posAuto — "nobody chose this". It cannot do better:
// how wide a card is on screen, and what else is already lying there, are
// facts about this browser window. So the client finishes the job for every
// such card, whichever seat played it.

import { act } from "../api";
import { useGame } from "../store/game";
import type { Card } from "../types";
import { freeSpot, type Box, type Spot } from "./autoplace";
import { dlog, pt } from "./debug";
import { stackCardsOf } from "./rules";
import { CH, CW, placeRect, posToPx, pxToPos, snapshotCards } from "./table";

/** Give every unchosen card on the table a spot of its own.
 *
 *  Returns true if anything was claimed, which the caller needs: the claim
 *  goes into a Map that no component subscribes to, so the re-render is the
 *  caller's to trigger. Runs inside a layout effect, before paint, so a card
 *  is never seen at the default spot it is about to leave. */
export function settleAutoPlaced(): boolean {
  const { view, dragging, pendingPos } = useGame.getState();
  const bounds = placeRect();
  if (!view || dragging || !bounds) return false;

  // A card claimed a moment ago still reads posAuto until the server catches
  // up — the claim is the record that this one is already dealt with. A
  // tucked card is skipped because its pile's anchor carries the position.
  const unchosen = (c: Card | undefined | null): c is Card =>
    !!c && !!c.posAuto && !!c.pos && !c.under && !pendingPos.has(c.id);
  const waiting: Card[] = [];
  for (const p of ["you", "agent"] as const) {
    waiting.push(...view.players[p].zones.battlefield.filter(unchosen));
    // an unresolved spell is on the felt as well, and the spot it settles
    // into now is the spot it will resolve at
    waiting.push(...stackCardsOf(p).map((it) => it.card).filter(unchosen));
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
    const home = posToPx(c.pos!);
    const at: Spot = freeSpot(home, occupied, w, h, bounds);
    // the rest of this batch has to see it — the DOM will not know until the
    // next paint, and four tokens must not all take the same spot
    occupied.push({ left: at.left, top: at.top, width: w, height: h });
    const pos = pxToPos(at.left, at.top);
    dlog("settle", { card: c.id, name: c.name, home: pt(pxToPos(home.left, home.top)), to: pt(pos) });
    useGame.getState().expectPos(c.id, pos);
    void act("place", { positions: [{ card: c.id, x: pos.x, y: pos.y }] });
  }
  return true;
}
