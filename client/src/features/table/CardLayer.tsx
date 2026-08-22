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
// A second, identical layer sits above the furniture and holds whatever is
// being dragged. Same geometry, so promoting a card from one to the other
// costs no conversion; different z, so the carried card passes over the hand
// and the command zone instead of under them.
import { useEffect, useLayoutEffect, useState } from "react";
import { CardEl } from "../../components/Card";
import { carriedOffset, startDrag, useDrag } from "../../game/drag";
import { battlefieldGhosts, battlefieldTriggerGhosts, pendingAttackOf, resolveZoneOf, stackCardsOf } from "../../game/rules";
import { HOME, PILE_DX, PILE_DY, measureSurface, posToPx } from "../../game/table";
import { cardById, useGame } from "../../store/game";
import { ui } from "../../store/ui";
import type { Card, PlayerId, StackItem } from "../../types";
import { StackItemButtons } from "../stack/StackItem";

const PLAYERS: PlayerId[] = ["agent", "you"];

export function CardLayer() {
  const view = useGame((s) => s.view);
  // renders twice per drag — lift and land. Per-frame drag state (position,
  // armed targets, the tuckover ring) never comes through React: a store
  // write here re-renders every card on the table.
  const carried = useDrag((s) => s.cards);
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
  const hidden = new Set(carried.map((c) => c.id));

  const lifts = new Map<string, StackItem>();
  const ghosts: { item: StackItem; spell: boolean }[] = [];
  for (const p of PLAYERS) {
    for (const { item, source } of battlefieldTriggerGhosts(p)) if (!lifts.has(source.id)) lifts.set(source.id, item);
    for (const g of battlefieldGhosts(p)) ghosts.push({ item: g, spell: false });
    for (const g of stackCardsOf(p)) if (resolveZoneOf(g) !== "battlefield") ghosts.push({ item: g, spell: true });
  }

  return (
    <>
      <div id="cardlayer">
        {PLAYERS.flatMap((p) =>
          view.players[p].zones.battlefield
            .filter((c) => !hidden.has(c.id))
            .map((c) => <Placed key={c.id} card={c} lift={lifts.get(c.id)} />)
        )}
        {ghosts.map(({ item, spell }) => (
          <Ghost key={item.card!.id} item={item} spell={spell} />
        ))}
      </div>

      <div id="draglayer" className={carried.length ? "" : "empty"}>
        {carried.map((c, depth) => (
          <CardEl key={c.id} card={c} className={`placed carried${depth ? " tucked" : ""}`} style={carriedOffset(depth)} />
        ))}
      </div>
    </>
  );
}

/** One battlefield card at its place on the surface. A tucked card has no
 *  place of its own — it hangs off the card above it, one step per rung, so a
 *  pile stays a pile however its top card moves. */
function Placed({ card: c, lift }: { card: Card; lift?: StackItem }) {
  const { left, top, depth } = anchorOf(c);
  const mine = c.controller === "you";
  // "tuckover" is not in this list on purpose: the drag paints it straight
  // onto the element, so lighting a target costs zero renders
  const classes = ["placed", mine && "grabbable", depth > 0 && "tucked", lift && "lifted", pendingAttackOf(c.id) && "declaring"]
    .filter(Boolean)
    .join(" ");
  return (
    <CardEl
      card={c}
      className={classes}
      style={{ left, top, zIndex: depth > 0 ? Math.max(1, 20 - depth) : 21 }}
      onPointerDown={mine ? (e) => startDrag(e, c) : undefined}
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
    </CardEl>
  );
}

/** Walk up the pile to the card that actually owns a position, and count the
 *  rungs on the way so the cascade knows how far down this card hangs. */
function anchorOf(c: Card): { left: number; top: number; depth: number } {
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
  const at = posToPx(claimed ?? top.pos ?? HOME[top.controller]);
  return { left: at.left + depth * PILE_DX, top: at.top + depth * PILE_DY, depth };
}

/** THE card in its on-the-stack presentation — the same element as any board
 *  card, with "ghost" as a state class and the stack buttons riding below in a
 *  panel that does not affect its box. Not draggable: a card on the stack has
 *  no position yet (the server only gives one to cards that have landed), so
 *  it hovers in its caster's corner until it resolves. */
function Ghost({ item, spell }: { item: StackItem; spell: boolean }) {
  const c = item.card!;
  const { left, top } = anchorOf(c);
  return (
    <CardEl
      card={c}
      className={["placed", "ghost", item.countered && "countered", spell && "spell"].filter(Boolean).join(" ")}
      style={{ left, top, zIndex: 22 }}
      onClick={() => {
        ui().hidePreview();
        ui().setTab("stack");
      }}
    >
      <div className="liftpanel">
        <StackItemButtons item={item} />
      </div>
    </CardEl>
  );
}
