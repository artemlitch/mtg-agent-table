// One drag, for every card on the table — no clones, no React, no layers.
// A card is a card: the element you press is the element that moves.
//
// A card already positioned on the felt (battlefield or unresolved on the
// stack) moves by style.left/top — the numbers written during the drag are
// the same felt-local pixels the layout renders, so pickup and drop are
// seamless. A card in the hand or the command zone has no left/top of its
// own, so the SAME element is lifted out of flow (position: fixed, board
// size) for the length of the gesture: its fan slot closes behind it, the
// way a card leaves a real hand. If the drop cancels, its styles are
// restored and the fan takes it back.
//
// React is touched zero times between pointerdown and drop. The armed
// drop-target glow and the tuckover ring are classList toggles on the two
// elements whose answer changed; incoming server views park until the
// pointer comes up. Routing any of this through a store re-renders the
// whole table per boundary-crossing, which is what made the drag trail the
// cursor.
//
// Where the card lands is decided by the region under the pointer, not by a
// chain of special cases in the gesture: zones declare themselves with
// data-drop (see snapshotRegions) and each kind owns its drop rule below.
import { act } from "../api";
import { pileChainBelow, useGame } from "../store/game";
import { ui } from "../store/ui";
import type { Card } from "../types";
import { box, dlog, fr, pt, px, tag } from "./debug";
import { CH, CW, cardAt, posToPx, pxToPos, regionAt, snapshotCards, snapshotRegions, type CardBox, type Region } from "./table";

/** How far the pointer travels before this is a drag and not a click. */
const THRESHOLD = 6;

/** Would releasing THIS card here actually send it somewhere?
 *
 *  Drives the lighting, and it has to be the same question the drop asks or
 *  the two drift apart — a zone that glows and then declines the card is
 *  worse than one that never glowed. The drop guards below read the same
 *  way, region kind by region kind. */
function offers(region: Region, card: Card): boolean {
  if (region.kind === "hand") return region.player === card.controller && card.zone !== "hand";
  // a commander only ever goes home to its OWNER's socket, so only that one
  // is a place this card could go
  if (region.kind === "command") return !!card.isCommander && region.player === card.owner;
  return region.kind === "pile";
}

// A release always fires a click, so a finished drag would also open the card
// menu. The dragged card is flagged and its next click is eaten.
let dragged: string | null = null;
export function consumeDragClick(id: string): boolean {
  if (dragged !== id) return false;
  dragged = null;
  return true;
}

export function startDrag(down: React.PointerEvent<HTMLElement>, card: Card) {
  if (down.button !== 0) return;
  const el = down.currentTarget as HTMLElement;
  // pinned now: a synthetic event is only valid inside its own handler
  const startX = down.clientX;
  const startY = down.clientY;

  // where on the card you grabbed it, as a fraction — a hand card grows to
  // board size when lifted, and a fraction survives that where a pixel
  // offset would not
  const src = el.getBoundingClientRect();
  const fx = src.width ? (startX - src.left) / src.width : 0.5;
  const fy = src.height ? (startY - src.top) / src.height : 0.5;

  // on the felt already (battlefield, or unresolved on the stack): the card
  // has a left/top and moves by it. Otherwise (hand, command zone) it must
  // be lifted out of flow first.
  const onFelt = card.zone === "battlefield" || card.zone === "stack";
  // Everything the gesture needs is read ONCE when it goes live. Nothing on
  // the table moves while you hold a card, so a pointermove is arithmetic
  // plus one or two style writes — no reads, no queries, no renders.
  let origin = { x: 0, y: 0 };
  let regions: Region[] = [];
  let others: CardBox[] = [];
  let live = false;
  let startLeft = 0;
  let startTop = 0;
  /** the lifted card's styles before we touched them, for a cancelled drop */
  let savedCss = "";
  // pile riders: the cards hanging beneath a carried pile top, moved by the
  // same delta each frame
  let kids: { el: HTMLElement; left: number; top: number }[] = [];
  // felt-local top-left corner of the carried card, kept current every move —
  // this is what the drop converts to a stored position
  let at = { left: 0, top: 0 };
  let last = { x: startX, y: startY };

  // the elements currently lit as the drop target — armed and un-armed by
  // toggling a class, never through React
  let aimedAt: Region | null = null;
  let aimedCard: CardBox | null = null;
  let frame = 0;

  // the live translate, sampled rather than streamed: one line per frame is
  // still 60 a second, and the interesting thing is the trend plus every
  // boundary crossing (those log unthrottled, below)
  let loggedAt = 0;
  const traceMove = () => {
    const now = performance.now();
    if (now - loggedAt < 120) return;
    loggedAt = now;
    dlog(`move   ${card.name ?? "?"}`, {
      pointerVp: `${px(last.x)}, ${px(last.y)}`,
      pointerFelt: `${px(last.x - origin.x)}, ${px(last.y - origin.y)}`,
      translate: `${px(last.x - startX)}, ${px(last.y - startY)}`,
      cardPx: box(at),
      wouldStore: pt(pxToPos(at.left, at.top)),
    });
  };

  const retarget = () => {
    frame = 0;
    traceMove();
    const region = regionAt(regions, at);
    // tucking is a board-to-board gesture: playing a card out of your hand
    // (or pre-placing an unresolved one) should never silently attach it to
    // whatever is under the drop
    const target = !region && card.zone === "battlefield" ? cardAt(others, at.left + CW() / 2, at.top + CH() / 2) : null;
    if (region !== aimedAt) {
      aimedAt?.el.classList.remove("armed");
      region?.el.classList.add("armed");
      aimedAt = region;
      dlog("target", { zone: region ? `${region.kind}:${region.player}${region.zone ? ":" + region.zone : ""}` : "open table" });
    }
    if (target !== aimedCard) {
      aimedCard?.el.classList.remove("tuckover");
      target?.el.classList.add("tuckover");
      aimedCard = target;
      dlog("target", { tuckUnder: target ? target.id : "none" });
    }
  };

  const onMove = (mv: PointerEvent) => {
    if (!live) {
      if (Math.hypot(mv.clientX - startX, mv.clientY - startY) < THRESHOLD) return;
      live = true;
      ui().hidePreview();
      ui().closeMenu();
      // the table leaves the hover system (no previews, no tooltips, no hover
      // chips waking under the cursor) and incoming views wait for the drop
      document.body.classList.add("dragging");
      useGame.getState().setDragging(true);
      const carriedIds = new Set([
        card.id,
        ...(card.zone === "battlefield" && !card.under ? pileChainBelow(card.id).map((c) => c.id) : []),
      ]);
      regions = snapshotRegions();
      others = snapshotCards(carriedIds);
      // light every place this card could go, for as long as it is in the
      // air. You should be able to see where a card can land the moment you
      // pick it up, not discover it by dragging over things.
      for (const r of regions) if (offers(r, card)) r.el.classList.add("offered");
      const felt = document.getElementById("felt")?.getBoundingClientRect();
      origin = { x: felt?.left ?? 0, y: felt?.top ?? 0 };
      if (onFelt) {
        // the card moves itself — .dragging kills its glide transition so it
        // is under the cursor, not 180ms behind it
        el.classList.add("dragging");
        startLeft = parseFloat(el.style.left) || 0;
        startTop = parseFloat(el.style.top) || 0;
        for (const id of carriedIds) {
          if (id === card.id) continue;
          const kel = document.querySelector<HTMLElement>(`#cardlayer .card[data-card-id="${id}"]`);
          if (kel) {
            kel.style.transition = "none";
            kids.push({ el: kel, left: parseFloat(kel.style.left) || 0, top: parseFloat(kel.style.top) || 0 });
          }
        }
      } else {
        // the SAME element leaves the fan: fixed-position, board size. Its
        // slot closes behind it — the card is in your grip, not in your hand.
        savedCss = el.style.cssText;
        el.classList.add("draglift");
        el.style.width = `${CW()}px`;
        el.style.height = `${CH()}px`;
      }
      dlog(`PICK UP ${tag(card)}`, {
        mode: onFelt ? "moves itself (left/top)" : "lifted out of flow (fixed)",
        grabbedAt: `${fr(fx)}, ${fr(fy)} of the card`,
        startPx: onFelt ? box({ left: startLeft, top: startTop }) : "n/a (no layout box)",
        startPos: card.pos ? pt(card.pos) : "none",
        feltOrigin: `${px(origin.x)}, ${px(origin.y)}`,
        carrying: carriedIds.size,
        regions: regions.map((r) => `${r.kind}:${r.player}${r.zone ? ":" + r.zone : ""}`).join(" "),
      });
    }
    last = { x: mv.clientX, y: mv.clientY };
    if (onFelt) {
      const dx = mv.clientX - startX;
      const dy = mv.clientY - startY;
      at = { left: startLeft + dx, top: startTop + dy };
      el.style.left = `${at.left}px`;
      el.style.top = `${at.top}px`;
      for (const k of kids) {
        k.el.style.left = `${k.left + dx}px`;
        k.el.style.top = `${k.top + dy}px`;
      }
    } else {
      // a lifted card is fixed-position, so it lives in viewport pixels; `at`
      // tracks the same corner in felt pixels for the drop
      const left = mv.clientX - fx * CW();
      const top = mv.clientY - fy * CH();
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      at = { left: left - origin.x, top: top - origin.y };
    }
    // which zone is lit only changes on a boundary, so it waits for the frame
    if (!frame) frame = requestAnimationFrame(retarget);
  };

  const onUp = async (up: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (!live) return;
    dragged = card.id;
    // a click that never comes must not eat a real one later: a card dropped
    // into another zone unmounts before its click can fire
    window.setTimeout(() => {
      if (dragged === card.id) dragged = null;
    }, 400);
    // resolve the target from where the pointer ACTUALLY came up, not from
    // whatever the last painted frame decided
    const over = regionAt(regions, at);
    const overCard = !over && card.zone === "battlefield" ? cardAt(others, at.left + CW() / 2, at.top + CH() / 2) : null;
    aimedAt?.el.classList.remove("armed");
    aimedCard?.el.classList.remove("tuckover");
    for (const r of regions) r.el.classList.remove("offered");
    ui().hidePreview();
    // a felt card released beyond the placeable rect settles onto its clamped
    // spot NOW — the exact pixel the store will render it at — so the server
    // ack cannot move it
    const stored = pxToPos(at.left, at.top);
    const roundTrip = posToPx(stored);
    dlog(`DROP   ${tag(card)}`, {
      releasedVp: `${px(up.clientX)}, ${px(up.clientY)}`,
      cardPx: box(at),
      "-> stores": pt(stored),
      "-> renders": box(roundTrip),
      snap: `${px(roundTrip.left - at.left)}, ${px(roundTrip.top - at.top)}`,
      onto: over ? `${over.kind}:${over.player}${over.zone ? ":" + over.zone : ""}` : overCard ? `tuck under ${overCard.id}` : "open table",
    });
    if (onFelt && !over && !overCard) {
      el.style.left = `${roundTrip.left}px`;
      el.style.top = `${roundTrip.top}px`;
    }
    // the card stays where you let go until the server has been told —
    // release it earlier and it flicks back for the round trip
    let moved = false;
    try {
      moved = await drop(card, over, overCard?.id ?? null, at);
      dlog(`settled ${card.name ?? "?"}`, { moved });
    } finally {
      if (onFelt) {
        el.classList.remove("dragging");
        for (const k of kids) k.el.style.transition = "";
        kids = [];
      } else if (!moved) {
        // the drop came to nothing: the fan takes the card back exactly as
        // it was. (A card that DID move stays lifted where you dropped it
        // until the server's view unmounts it from the hand — restoring it
        // early would snap it back into the fan for a frame.)
        el.classList.remove("draglift");
        el.style.cssText = savedCss;
      }
      document.body.classList.remove("dragging");
      useGame.getState().setDragging(false);
    }
  };

  // on the window, not on the card: a poll can re-render the source element
  // away mid-gesture, and listeners on it would die with it
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

/** What a region does with a card released onto it. The gesture above knows
 *  none of this; it only knows which region won. Returns whether the card
 *  actually went somewhere. */
async function drop(card: Card, over: Region | null, overCard: string | null, at: { left: number; top: number }): Promise<boolean> {
  if (over?.kind === "hand") {
    // your hand takes your cards; the agent's takes its own
    if (over.player !== card.controller) return false;
    if (card.zone === "hand") return false; // already there — nothing to change
    const res = await act("move", { card: card.id, toZone: "hand", toPlayer: over.player });
    return res.ok;
  }
  if (over?.kind === "command") {
    // a commander always goes home to its OWNER's zone, so a borrowed one
    // comes back to the right side of the table
    if (!card.isCommander) return false;
    const res = await act("move", { card: card.id, toZone: "command", toPlayer: card.owner });
    return res.ok;
  }
  if (over?.kind === "pile") {
    const res = await act("move", { card: card.id, toZone: over.zone!, toPlayer: over.player });
    return res.ok;
  }

  // the open table: everything that is not one of the zones above
  const pos = pxToPos(at.left, at.top);
  // released on top of another card: attach to it (equip, auras, tidying a
  // pile) rather than resting on the felt
  if (overCard) {
    const res = await act("tuck", { card: card.id, under: overCard });
    return res.ok;
  }
  if (card.zone === "hand" || card.zone === "command") {
    // dropping a held card on the table plays it — lands land, spells go to
    // the stack in their unresolved state — and either way the card takes
    // the spot you chose: a land immediately, an unresolved card as the
    // pre-chosen place it will resolve into.
    const res = await act("cast", { card: card.id, ...(card.zone === "command" ? { note: "from command zone" } : {}) });
    if (!res.ok) return false;
    useGame.getState().expectPos(card.id, pos);
    await act("place", { positions: [{ card: card.id, x: pos.x, y: pos.y }] });
    return true;
  }
  if (!["battlefield", "stack"].includes(card.zone)) return false;
  if (card.under) await act("tuck", { card: card.id, under: "" });
  useGame.getState().expectPos(card.id, pos);
  await act("place", { positions: [{ card: card.id, x: pos.x, y: pos.y }] });
  return true;
}
