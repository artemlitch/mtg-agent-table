// One drag, for every card on the table.
//
// A card is picked up wherever it lives — hand, board, command zone — and
// PROMOTED onto the felt: the real element stops rendering in its zone and the
// same card draws in the drag layer at board size, in felt-local pixels. No
// clone rides the cursor. That is the whole reason there is one drag function
// here instead of the two that used to disagree with each other: a hand card
// and a board card differ only in which zone was rendering them a moment ago.
//
// Where it lands is decided by the region under the pointer, not by a chain of
// special cases in the gesture. Regions declare themselves in the DOM (see
// snapshotRegions); this file only asks "what is under the cursor" and hands
// the card to that region's rule.
import { create } from "zustand";
import { act } from "../api";
import { pileChainBelow, useGame } from "../store/game";
import { ui } from "../store/ui";
import type { Card } from "../types";
import { CH, CW, PILE_DX, PILE_DY, cardAt, pxToPos, regionAt, snapshotCards, snapshotRegions, type Region } from "./table";

/** How far the pointer travels before this is a drag and not a click. */
const THRESHOLD = 6;

interface DragStore {
  /** the card in hand, plus anything tucked beneath it, top-first */
  cards: Card[];
  /** the region that would take the drop right now */
  over: Region | null;
  /** the card that would be tucked under, if any */
  overCard: string | null;
  begin(cards: Card[]): void;
  aim(over: Region | null, overCard: string | null): void;
  end(): void;
}

export const useDrag = create<DragStore>((set) => ({
  cards: [],
  over: null,
  overCard: null,
  begin(cards) {
    // While a card is in the air the table leaves the hover system: no
    // previews, no tooltips, no hover chips. Without this, every card the
    // cursor crosses raises its own full-size preview and repositions it on
    // each mousemove, which is a card image being laid out continuously
    // underneath the drag. It is the reason a drag has to say "I am dragging"
    // globally rather than just moving an element.
    document.body.classList.add("dragging");
    set({ cards, over: null, overCard: null });
  },
  aim(over, overCard) {
    set({ over, overCard });
  },
  end() {
    document.body.classList.remove("dragging");
    set({ cards: [], over: null, overCard: null });
  },
}));

export const draggingIds = () => new Set(useDrag.getState().cards.map((c) => c.id));

// A release always fires a click, so a finished drag would also open the card
// menu. The dragged card is flagged and its next click is eaten.
let dragged: string | null = null;
export function consumeDragClick(id: string): boolean {
  if (dragged !== id) return false;
  dragged = null;
  return true;
}

/** Write the carried card's position. Imperative on purpose: this runs on
 *  every frame of the drag, and the drag layer's CONTENTS do not change while
 *  it moves — only its offset does, so there is nothing for React to do. */
function paint(layer: HTMLElement | null, left: number, top: number) {
  if (layer) layer.style.transform = `translate3d(${left}px, ${top}px, 0)`;
}

export function startDrag(down: React.PointerEvent<HTMLElement>, card: Card) {
  if (down.button !== 0) return;
  const el = down.currentTarget as HTMLElement;
  // pinned now: a synthetic event is only valid inside its own handler
  const startX = down.clientX;
  const startY = down.clientY;

  // grab the card where you actually grabbed it, as a fraction of the element.
  // A hand card is smaller than a board card, so the fraction survives the
  // promotion where a pixel offset would not.
  const src = el.getBoundingClientRect();
  const fx = src.width ? (startX - src.left) / src.width : 0.5;
  const fy = src.height ? (startY - src.top) / src.height : 0.5;

  const fromBoard = card.zone === "battlefield";
  // Everything the gesture needs is read ONCE, here. Nothing on the table
  // moves while you hold a card, so a pointermove is pure arithmetic plus one
  // style write — no getBoundingClientRect, no getComputedStyle, no query.
  let origin = { x: 0, y: 0 };
  let regions: Region[] = [];
  let others: ReturnType<typeof snapshotCards> = [];
  let layer: HTMLElement | null = null;
  let carried: Card[] = [];
  let live = false;
  let at = { left: 0, top: 0 };
  // the last target we told the store about; the store is only touched when
  // the answer actually changes, not on every frame
  let aimedAt: Region | null = null;
  let aimedCard: string | null = null;

  let frame = 0;
  let last = { x: startX, y: startY };

  const place = (clientX: number, clientY: number) => {
    const f = { x: clientX - origin.x, y: clientY - origin.y };
    at = { left: f.x - fx * CW(), top: f.y - fy * CH() };
    paint(layer, at.left, at.top);
    return f;
  };

  // the target under the cursor only changes when you cross a boundary, so it
  // is resolved once a frame and the store is written only when the answer
  // differs. The card's own position is NOT deferred — see onMove.
  const retarget = () => {
    frame = 0;
    const region = regionAt(regions, last.x - origin.x, last.y - origin.y);
    // tucking is a board-to-board gesture: playing a card out of your hand
    // should never silently attach it to whatever is under the drop
    const target = !region && fromBoard ? cardAt(others, at.left + CW() / 2, at.top + CH() / 2) : null;
    if (region !== aimedAt || target !== aimedCard) {
      aimedAt = region;
      aimedCard = target;
      useDrag.getState().aim(region, target);
    }
  };

  const onMove = (mv: PointerEvent) => {
    if (!live) {
      if (Math.hypot(mv.clientX - startX, mv.clientY - startY) < THRESHOLD) return;
      live = true;
      ui().hidePreview();
      ui().closeMenu();
      // a pile travels with the card it hangs from; pulling a buried card out
      // takes only that card
      carried = [card, ...(fromBoard && !card.under ? pileChainBelow(card.id) : [])];
      const ids = new Set(carried.map((c) => c.id));
      regions = snapshotRegions();
      others = snapshotCards(ids);
      layer = document.getElementById("draglayer");
      const felt = document.getElementById("felt")?.getBoundingClientRect();
      origin = { x: felt?.left ?? 0, y: felt?.top ?? 0 };
      useDrag.getState().begin(carried);
    }
    last = { x: mv.clientX, y: mv.clientY };
    // the card moves NOW, in the handler, the way it did before any of this:
    // a transform write with no reads around it is cheap, and deferring it to
    // the next animation frame is a frame of lag you can feel. Only the
    // target hit-test waits for the frame.
    place(mv.clientX, mv.clientY);
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
    // whatever the last painted frame decided — a frame may have been dropped
    const f = place(up.clientX, up.clientY);
    const over = regionAt(regions, f.x, f.y);
    const overCard = !over && fromBoard ? cardAt(others, at.left + CW() / 2, at.top + CH() / 2) : null;
    ui().hidePreview();
    // the card stays in the drag layer, at the point you let go, until the
    // server has been told where it went — release it any earlier and it
    // flicks back to its old spot for the length of the round trip
    try {
      await drop(card, over, overCard, at);
    } finally {
      useDrag.getState().end();
    }
  };

  // on the window, not on the card: a poll can re-render the hand mid-gesture,
  // and listeners on an element that unmounts would strand the card in the
  // drag layer with no pointerup ever arriving
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

/** What a region does with a card released onto it. The gesture above knows
 *  none of this; it only knows which region won. */
async function drop(card: Card, over: Region | null, overCard: string | null, at: { left: number; top: number }) {
  if (over?.kind === "hand") {
    // your hand takes your cards; the agent's takes its own
    if (over.player !== card.controller) return;
    if (card.zone === "hand") return; // already there — no ordering to change
    await act("move", { card: card.id, toZone: "hand", toPlayer: over.player });
    return;
  }
  if (over?.kind === "command") {
    // a commander always goes home to its OWNER's zone, so a borrowed one
    // comes back to the right side of the table
    if (!card.isCommander) return;
    await act("move", { card: card.id, toZone: "command", toPlayer: card.owner });
    return;
  }
  if (over?.kind === "pile") {
    await act("move", { card: card.id, toZone: over.zone!, toPlayer: over.player });
    return;
  }

  // the board: everything that is not one of the zones above
  const pos = pxToPos(at.left, at.top);
  // released on top of another card: attach to it (equip, auras, tidying a
  // pile) rather than resting on the felt
  if (overCard) {
    await act("tuck", { card: card.id, under: overCard });
    return;
  }
  if (card.zone === "hand" || card.zone === "command") {
    // dropping a held card on the table plays it. A land arrives on the
    // battlefield immediately and keeps the spot you chose; a spell goes on
    // the stack instead, where it has no position at all — it hovers in its
    // caster's corner until it resolves, and only then does it get one.
    const res = await act("cast", { card: card.id, ...(card.zone === "command" ? { note: "from command zone" } : {}) });
    if (!res.ok || !res.landPlay) return;
    useGame.getState().expectPos(card.id, pos);
    await act("place", { positions: [{ card: card.id, x: pos.x, y: pos.y }] });
    return;
  }
  if (card.zone !== "battlefield") return;
  if (card.under) await act("tuck", { card: card.id, under: "" });
  useGame.getState().expectPos(card.id, pos);
  await act("place", { positions: [{ card: card.id, x: pos.x, y: pos.y }] });
}

/** Where a carried card draws, relative to the drag layer's own offset. The
 *  layer is moved as one block, so the head sits at 0,0 and its pile cascades
 *  beneath it exactly as it would on the board. */
export const carriedOffset = (depth: number) => ({ left: depth * PILE_DX, top: depth * PILE_DY });
