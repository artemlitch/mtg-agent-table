// Free-placement board. Cards without an explicit pos auto-arrange by
// convention: your lands bottom, creatures mid-field (near the midline),
// artifacts/enchantments in a right-side column. The agent's half mirrors
// that. A card's first spot is then SAVED, so nothing ever reflows again.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { act } from "../../api";
import { CardEl } from "../../components/Card";
import { CH, CW, capturePointer, clearOverlays, commandZone, guardClicks, handZone, markDragged, noHover, swallowClick } from "../../game/interaction";
import { battlefieldGhosts, battlefieldTriggerGhosts, pendingAttackOf, resolveZoneOf, stackCardsOf, typeCat } from "../../game/rules";
import { cardBeneathOf, pileChainBelow, useGame } from "../../store/game";
import { ui } from "../../store/ui";
import type { Card, PlayerId, StackItem } from "../../types";
import { StackItemButtons } from "../stack/StackItem";

const GAP = 14;
// your lands hug the bottom edge, clearing the hand fan that pokes up over the
// board (~32px); further rows stack UPWARD so they can never slide under it
const HAND_CLEAR = 36;
const PILE_DX = 15;
const PILE_DY = 26;

type Slot = { left: number; top: number; under?: boolean; depth?: number };

/** Cards whose first battlefield spot has already been persisted this game.
 *  Card ids restart across games, so the board being empty clears it. */
const autoPlaced = new Set<string>();

export function Battlefield({ p }: { p: PlayerId }) {
  const view = useGame((s) => s.view!);
  const bf = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ W: number; H: number } | null>(null);

  useLayoutEffect(() => {
    const el = bf.current;
    if (!el) return;
    const measure = () => setSize({ W: Math.max(el.clientWidth, 400), H: Math.max(el.clientHeight, 200) });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cards = view.players[p].zones.battlefield;
  const ghosts = battlefieldGhosts(p);
  const layout = size ? layoutBoard(p, cards, ghosts, size.W, size.H, bf.current) : null;

  // a card's first spot is SAVED (cosmetic place, no log/wake): from then on it
  // owns its position exactly like a dragged card
  useEffect(() => {
    if (!layout || !view.started) return;
    if (!view.players.you.zones.battlefield.length && !view.players.agent.zones.battlefield.length) autoPlaced.clear();
    const toSave = layout.newlyPlaced.filter((s) => !autoPlaced.has(s.card));
    if (!toSave.length) return;
    for (const s of toSave) autoPlaced.add(s.card);
    void act("place", { positions: toSave });
  }, [layout, view.started, view.players]);

  // a trigger on the stack LIFTS its real source card — a state on the card,
  // not a copy (the card stays draggable, one element per card)
  const lifts = new Map<string, StackItem>();
  for (const { item, source } of battlefieldTriggerGhosts(p)) if (!lifts.has(source.id)) lifts.set(source.id, item);

  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));

  return (
    <div className="battlefield freeboard" id={`bf-${p}`} ref={bf}>
      {layout &&
        cards.map((c) => {
          const pos = layout.posMap[c.id];
          if (!pos) return null;
          // explicitly dragged positions may cross the midline into the other
          // half — only auto-laid cards are clamped to their own field
          const left = c.pos ? pos.left : clamp(pos.left, size!.W - CW);
          const top = c.pos ? pos.top : clamp(pos.top, size!.H - CH);
          const lift = lifts.get(c.id);
          // pile stacking order: top card highest, each rung one step lower
          const z = pos.under ? Math.max(1, 24 - (pos.depth ?? 0)) : cardBeneathOf(c.id) ? 25 : undefined;
          return (
            <CardEl
              key={c.id}
              card={c}
              className={["placed", pos.under && "tucked", lift && "lifted", pendingAttackOf(c.id) && "declaring"]
                .filter(Boolean)
                .join(" ")}
              style={{ left: `${left.toFixed(0)}px`, top: `${top.toFixed(0)}px`, ...(z ? { zIndex: z } : {}) }}
              onPointerDown={c.controller === "you" ? (e) => startDrag(e, c, p) : undefined}
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
        })}

      {/* ghosts: translucent card bobbing in its would-be slot, stack buttons
          under it. Dragging one (your own) pre-places where the card will land
          — pos set on the stack card survives resolution onto the board. */}
      {layout &&
        ghosts.map((g) => {
          const c = g.card!;
          const pos = layout.posMap[c.id];
          if (!pos) return null;
          const left = c.pos ? pos.left : clamp(pos.left, size!.W - CW);
          const top = c.pos ? pos.top : clamp(pos.top, size!.H - CH);
          return <Ghost key={c.id} item={g} left={left} top={top} p={p} />;
        })}

      {/* spells that DON'T resolve to the battlefield (sorceries, instants,
          graveyard-to-hand returns) hover at a casting spot: centre of the
          caster's half, hugging the midline, fanning out if several are up */}
      {size &&
        (() => {
          const spells = stackCardsOf(p).filter((it) => resolveZoneOf(it) !== "battlefield");
          return spells.map((g, i) => {
            const c = g.card!;
            let left = size.W / 2 - CW / 2 + (i - (spells.length - 1) / 2) * (CW * 0.65);
            let top = p === "you" ? 10 : size.H - CH - 16;
            if (c.pos) {
              left = c.pos.x * (size.W - CW);
              top = c.pos.y * (size.H - CH);
            } else {
              left = clamp(left, size.W - CW);
              top = Math.max(0, top);
            }
            return <Ghost key={c.id} item={g} left={left} top={top} p={p} extraClass="spell" />;
          });
        })()}
    </div>
  );
}

/** THE card, in its on-the-stack presentation — the SAME .card.placed element
 *  as any board card (same size, same drag geometry); "ghost" is a state
 *  class, and the stack buttons ride below as a child panel that doesn't
 *  affect the card's bounding box. */
function Ghost({ item, left, top, p, extraClass = "" }: { item: StackItem; left: number; top: number; p: PlayerId; extraClass?: string }) {
  const c = item.card!;
  return (
    <CardEl
      card={c}
      className={["placed", "ghost", item.countered && "countered", extraClass].filter(Boolean).join(" ")}
      style={{ left: `${left.toFixed(0)}px`, top: `${top.toFixed(0)}px` }}
      onClick={() => {
        if (swallowClick(c.id)) return;
        ui().hidePreview();
        ui().setTab("stack");
      }}
      onPointerDown={item.player === "you" ? (e) => startDrag(e, c, p, { tuck: false }) : undefined}
    >
      <div className="liftpanel">
        <StackItemButtons item={item} />
      </div>
    </CardEl>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function layoutBoard(p: PlayerId, cards: Card[], ghosts: StackItem[], W: number, H: number, bfEl: HTMLElement | null) {
  const buried = cards.filter((c) => c.under);
  const free = cards.filter((c) => !c.under);
  // every free card claims a slot in its category — dragged cards keep theirs
  // as a HOLE, so moving one card never reflows its neighbors
  const autos: Record<string, Card[]> = { creature: [], land: [], other: [] };
  for (const c of free) autos[typeCat(c)].push(c);
  // stack cards headed for this battlefield claim the NEXT auto-layout slot in
  // their row — that's where the ghost hovers
  const ghostCards = ghosts.map((g) => g.card!);
  for (const g of ghostCards) autos[typeCat(g)].push(g);

  const regions = p === "you" ? { creature: 0.12, land: 0.72, other: 0.05 } : { creature: 0.6, land: 0.02, other: 0.05 };
  const perRow = Math.max(1, Math.floor((W * 0.8) / (CW + GAP)));
  const yourLandTop = H - CH - HAND_CLEAR;

  const posMap: Record<string, Slot> = {};
  const slotFor = (cat: string, i: number): Slot => {
    if (cat === "other") {
      const col = Math.floor(i / 3);
      return { left: W - CW - 10 - col * (CW + 10), top: regions.other * (H - CH) + (i % 3) * (CH * 0.45) };
    }
    const left = 8 + (i % perRow) * (CW + GAP);
    const row = Math.floor(i / perRow);
    if (cat === "land" && p === "you") return { left, top: Math.max(0, yourLandTop - row * (CH * 0.55)) };
    return { left, top: (regions as any)[cat] * (H - CH) + row * (CH * 0.55) };
  };
  const collides = (s: Slot) =>
    Object.values(posMap).some((o) => Math.abs(o.left - s.left) < CW * 0.55 && Math.abs(o.top - s.top) < CH * 0.55);

  // saved positions first — they own their spots
  const unplaced: Card[] = [];
  for (const c of [...free, ...ghostCards]) {
    if (c.pos) posMap[c.id] = { left: c.pos.x * (W - CW), top: c.pos.y * (H - CH) };
    else unplaced.push(c);
  }
  // newcomers take the first FREE slot in their category's region
  for (const c of unplaced) {
    const cat = typeCat(c);
    let i = autos[cat].indexOf(c);
    let s = slotFor(cat, i);
    let guard = 0;
    while (collides(s) && guard++ < 80) s = slotFor(cat, ++i);
    posMap[c.id] = s;
  }

  const newlyPlaced = free
    .filter((c) => !c.pos)
    .map((c) => {
      const s = posMap[c.id];
      return {
        card: c.id,
        x: Math.max(0, Math.min(1, s.left / Math.max(1, W - CW))),
        y: s.top / Math.max(1, H - CH),
      };
    });

  // buried pile members cascade beneath their pile's top card, one visible
  // strip per rung — the strip is the grab handle for pulling a card out
  for (const c of buried) {
    let top: Card = c;
    let depth = 0;
    let guard = 0;
    while (top.under && guard++ < 50) {
      const t = findCard(top.under);
      if (!t) break;
      top = t;
      depth++;
    }
    let base = posMap[top.id] as Slot | undefined;
    // pile top on the other battlefield: anchor via its pos + container offset
    if (!base && top.controller !== p && top.pos && bfEl) {
      const myRect = bfEl.getBoundingClientRect();
      const otherBf = document.getElementById(`bf-${top.controller}`);
      if (otherBf) {
        const oRect = otherBf.getBoundingClientRect();
        const oW = Math.max(otherBf.clientWidth, 400);
        const oH = Math.max(otherBf.clientHeight, 200);
        base = {
          left: top.pos.x * (oW - CW) + (oRect.left - myRect.left),
          top: top.pos.y * (oH - CH) + (oRect.top - myRect.top),
        };
      }
    }
    posMap[c.id] = base
      ? { left: base.left + PILE_DX * depth, top: base.top + PILE_DY * depth, under: true, depth }
      : { left: W / 2, top: H / 2, under: true, depth };
  }

  return { posMap, newlyPlaced };
}

function findCard(id: string): Card | null {
  const v = useGame.getState().view;
  if (!v) return null;
  for (const p of ["you", "agent"] as PlayerId[]) for (const c of v.players[p].zones.battlefield) if (c.id === id) return c;
  return null;
}

// ---------------------------------------------------------------------------
// Dragging a card around the board
// ---------------------------------------------------------------------------

function startDrag(down: React.PointerEvent<HTMLDivElement>, c: Card, p: PlayerId, opts: { tuck?: boolean } = {}) {
  if (down.button !== 0) return;
  const el = down.currentTarget;
  const bf = document.getElementById(`bf-${p}`)!;
  const pointerId = down.pointerId;
  // pinned now: a synthetic event is only guaranteed valid inside its handler
  const startX = down.clientX;
  const startY = down.clientY;

  // ONE coordinate system: battlefield-local layout px, the numbers that live
  // in style.left/top. The dragged element's own bounding rect is never read —
  // it's the post-transform box, and a tapped (rotated) or bobbing card's rect
  // disagrees with its layout box, which snaps.
  const bfRect = bf.getBoundingClientRect();
  // the table is one continuous surface: drag bounds span BOTH battlefields
  const otherRect = document.getElementById(p === "you" ? "bf-agent" : "bf-you")!.getBoundingClientRect();
  const minY = Math.min(bfRect.top, otherRect.top) - bfRect.top;
  const maxY = Math.max(bfRect.bottom, otherRect.bottom) - bfRect.top - CH;
  const maxX = bfRect.width - CW;
  const startLeft = parseFloat(el.style.left) || 0;
  const startTop = parseFloat(el.style.top) || 0;
  let left = startLeft;
  let top = startTop;

  // dragging a pile's TOP card carries the whole pile (same delta, live);
  // dragging a buried card pulls just that card out — no riders
  const kids: { el: HTMLElement; left: number; top: number }[] = [];
  if (opts.tuck !== false && !c.under) {
    for (const k of pileChainBelow(c.id)) {
      const kel = document.querySelector<HTMLElement>(`.card.placed[data-card-id="${k.id}"]`);
      if (kel) kids.push({ el: kel, left: parseFloat(kel.style.left) || 0, top: parseFloat(kel.style.top) || 0 });
    }
  }
  const kidEls = new Set(kids.map((k) => k.el));
  let moved = false;

  const onMove = (mv: PointerEvent) => {
    if (!moved && Math.hypot(mv.clientX - startX, mv.clientY - startY) < 6) return;
    if (!moved) {
      moved = true;
      useGame.getState().setDragging(true);
      el.classList.add("dragging");
      // riders track per-frame: the placed-card left/top glide transition would
      // make them trail the handle by 180ms
      for (const k of kids) k.el.style.transition = "none";
      capturePointer(el, pointerId);
      // your own cards can go back to hand — offer the strip while dragging
      if (c.controller === "you") handZone.show(false);
    }
    if (c.controller === "you") handZone.show(handZone.over(mv.clientX, mv.clientY));
    // a commander has a second way off the board: back into its own socket
    if (c.isCommander) commandZone.arm(commandZone.over(mv.clientX, mv.clientY));
    // pure delta on the layout box: start position + pointer travel. No
    // transform can offset this — tapped cards drag identically.
    left = Math.max(0, Math.min(maxX, startLeft + (mv.clientX - startX)));
    top = Math.max(minY, Math.min(maxY, startTop + (mv.clientY - startY)));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    const dx = left - startLeft;
    const dy = top - startTop;
    for (const k of kids) {
      k.el.style.left = `${k.left + dx}px`;
      k.el.style.top = `${k.top + dy}px`;
    }
  };

  const onUp = async (up: PointerEvent) => {
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    if (!moved) return;
    el.classList.remove("dragging");
    for (const k of kids) k.el.style.transition = "";
    markDragged(c.id);
    guardClicks();
    noHover.id = c.id;
    handZone.hide();
    commandZone.arm(false);
    clearOverlays();

    // dropped in the command zone → the commander goes home. Always its
    // OWNER's zone, so a borrowed commander returns to the right side.
    if (c.isCommander && commandZone.over(up.clientX, up.clientY)) {
      useGame.getState().setDragging(false);
      await act("move", { card: c.id, toZone: "command", toPlayer: c.owner });
      return;
    }
    // dropped on the strip over your hand → the card goes back to hand
    if (c.controller === "you" && handZone.over(up.clientX, up.clientY)) {
      useGame.getState().setDragging(false);
      await act("move", { card: c.id, toZone: "hand", toPlayer: "you" });
      return;
    }
    // drop onto another card = tuck into its pile (equip, auras, board tidying
    // — one gesture). Centre from the layout box (rotation about the centre
    // can't move it); target rects are only hit-tested, never written back.
    const centre = { x: bfRect.left + left + CW / 2, y: bfRect.top + top + CH / 2 };
    const targetEl =
      opts.tuck === false
        ? null
        : [...document.querySelectorAll<HTMLElement>(".battlefield .card.placed")].find((o) => {
            // never tuck a pile under its own members (cycle)
            if (o === el || kidEls.has(o) || !o.dataset.cardId) return false;
            const r = o.getBoundingClientRect();
            return centre.x >= r.left && centre.x <= r.right && centre.y >= r.top && centre.y <= r.bottom;
          });

    const game = useGame.getState();
    if (targetEl) {
      // the server re-anchors to the pile's top; claim it locally meanwhile
      game.expectUnder(c.id, targetEl.dataset.cardId!);
      const beneath = cardBeneathOf(c.id);
      if (beneath) game.expectUnder(beneath.id, c.under ?? null);
      game.setDragging(false);
      await act("tuck", { card: c.id, under: targetEl.dataset.cardId });
      return;
    }
    if (c.under) {
      const beneath = cardBeneathOf(c.id);
      if (beneath) game.expectUnder(beneath.id, c.under);
      game.expectUnder(c.id, null);
      await act("tuck", { card: c.id, under: "" });
    }
    // normalize with the exact W/H/CW/CH formula the layout uses, so the round
    // trip pos -> px -> pos is bit-exact and the server ack can't snap
    const W = Math.max(bf.clientWidth, 400);
    const H = Math.max(bf.clientHeight, 200);
    const x = Math.max(0, Math.min(1, left / Math.max(1, W - CW)));
    // y stays relative to the own field but may cross the midline
    const y = top / Math.max(1, H - CH);
    game.expectPos(c.id, { x, y });
    game.setDragging(false);
    await act("place", { positions: [{ card: c.id, x, y }] });
  };

  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
}
