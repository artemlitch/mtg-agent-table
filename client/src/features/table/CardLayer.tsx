// Every card on the table, in one layer.
//
// Both battlefields draw here, not in their own containers, because the table
// is one surface: a card at y 0.4 is near the agent's side of the midline and
// a card at y 0.6 is near yours, and which half a card is in is a fact about
// its position rather than about which array it came from. The seats still lay
// out the felt — the hands, the rails, the command zones, and an empty
// battlefield div that reserves the space — but nothing positions a card
// except this file.
//
// Dragging never re-renders this layer: the drag moves the card's own element
// by style.left/top (see game/drag.ts), and the numbers it writes are the
// same felt-local pixels rendered here, so pickup and drop are seamless.
import { useEffect, useLayoutEffect, useState } from "react";
import { CardEl } from "../../components/Card";
import { traceDraw } from "../../game/debug";
import { startDrag } from "../../game/drag";
import { liftedTriggers, pendingAttackOf, resolveZoneOf, stackCardsOf } from "../../game/rules";
import { settleUnplaced } from "../../game/settle";
import { PILE_DX, PILE_DY, measureSurface, posToPx } from "../../game/table";
import { cardById, useGame } from "../../store/game";
import { ui } from "../../store/ui";
import type { Card, PlayerId, StackItem } from "../../types";
import { StackItemButtons } from "../stack/StackItem";

const PLAYERS: PlayerId[] = ["agent", "you"];

export function CardLayer() {
  const view = useGame((s) => s.view);
  const [measured, setMeasured] = useState(false);
  const [, bump] = useState(0);

  // the surface is measured, never assumed: the placeable rect depends on how
  // tall the hands are and how wide the command zones are, and all of that
  // moves with the window
  useLayoutEffect(() => {
    const remeasure = () => {
      measureSurface();
      setMeasured(true);
      bump((n) => n + 1);
    };
    remeasure();
    const ro = new ResizeObserver(remeasure);
    const felt = document.getElementById("felt");
    if (felt) ro.observe(felt);
    window.addEventListener("resize", remeasure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", remeasure);
    };
  }, []);

  // Anything that reached the table without a spot gets one here, after the
  // cards already out are in the DOM — their rects are what the search reads
  // — and before the browser paints, so a new card's first frame is the one
  // that has it in the right place.
  useLayoutEffect(() => {
    if (measured && settleUnplaced()) bump((n) => n + 1);
  });

  // the fonts and art land after first paint and can change the hand's height,
  // so take one more measurement once everything has settled
  useEffect(() => {
    const t = window.setTimeout(() => {
      measureSurface();
      bump((n) => n + 1);
    }, 250);
    return () => window.clearTimeout(t);
  }, []);

  // nothing draws before the surface is measured: a card rendered at 0,0 and
  // then corrected would glide across the felt on its own transition
  if (!view || !measured) return null;

  const lifts = new Map<string, StackItem>();
  const unresolved: StackItem[] = [];
  for (const p of PLAYERS) {
    for (const { item, source } of liftedTriggers(p)) if (!lifts.has(source.id)) lifts.set(source.id, item);
    unresolved.push(...stackCardsOf(p));
  }

  return (
    <div id="cardlayer">
      {PLAYERS.flatMap((p) =>
        view.players[p].zones.battlefield.map((c) => <Placed key={c.id} card={c} lift={lifts.get(c.id)} />)
      )}
      {unresolved.map((item) => (
        <Placed key={item.card!.id} card={item.card!} item={item} />
      ))}
    </div>
  );
}

/** THE card, at its place on the surface — there is no other way a card gets
 *  drawn on the table. Everything else is a state on it: `unresolved` while
 *  it waits on the stack (translucent, bobbing, the stack buttons riding
 *  below), `tucked` while it hangs in a pile, `lifted` while one of its
 *  triggers waits. An unresolved card drags like any other — the spot you
 *  put it in is where it resolves — it just cannot be tapped, because
 *  tapping is not an action it has yet. */
function Placed({ card: c, lift, item }: { card: Card; lift?: StackItem; item?: StackItem }) {
  const anchor = anchorOf(c);
  // not placed yet: it gets a spot in this same commit, before the frame is
  // painted, so it appears where it belongs rather than sliding there
  if (!anchor) return null;
  const { left, top, depth } = anchor;
  const mine = item ? item.player === "you" : c.controller === "you";
  const spell = item && resolveZoneOf(item) !== "battlefield";
  // "tuckover" is not in this list on purpose: the drag paints it straight
  // onto the element, so lighting a target costs zero renders
  const classes = [
    "placed",
    mine && "grabbable",
    item && "unresolved",
    item?.countered && "countered",
    spell && "spell",
    depth > 0 && "tucked",
    lift && "lifted",
    !item && pendingAttackOf(c.id) && "declaring",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <CardEl
      card={c}
      className={classes}
      style={{ left, top, zIndex: item ? 22 : depth > 0 ? Math.max(1, 20 - depth) : 21 }}
      onPointerDown={mine ? (e) => startDrag(e, c) : undefined}
      onClick={
        item
          ? () => {
              ui().hidePreview();
              ui().setTab("stack");
            }
          : undefined
      }
    >
      {lift && (
        <div className="liftpanel">
          <div
            className="trigchip"
            title={lift.text}
            onClick={(e) => {
              e.stopPropagation();
              ui().setTab("stack");
            }}
          >
            {lift.text.length > 110 ? lift.text.slice(0, 110) + "…" : lift.text}
          </div>
          <StackItemButtons item={lift} />
        </div>
      )}
      {item && (
        <div className="liftpanel">
          <StackItemButtons item={item} />
        </div>
      )}
    </CardEl>
  );
}

/** Walk up the pile to the card that actually owns a position, and count the
 *  rungs on the way so the cascade knows how far down this card hangs.
 *  Null means the card has not been placed yet — settleUnplaced() is about
 *  to give it a spot, and until it does there is nowhere honest to draw it. */
function anchorOf(c: Card): { left: number; top: number; depth: number } | null {
  let top: Card = c;
  let depth = 0;
  let guard = 0;
  while (top.under && guard++ < 50) {
    const next = cardById(top.under);
    if (!next) break;
    top = next;
    depth++;
  }
  // a position you just dropped the card at outranks the one in the view: the
  // server has not answered yet, and the card must not flick back meanwhile
  const claimed = useGame.getState().pendingPos.get(top.id);
  const pos = claimed ?? top.pos;
  if (!pos) return null;
  const at = posToPx(pos);
  const out = { left: at.left + depth * PILE_DX, top: at.top + depth * PILE_DY, depth };
  traceDraw(c.id, c.name, out, pos, claimed ? "claim" : top.pos ? "server" : "MISSING", depth);
  return out;
}
