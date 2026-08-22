// One drag, for every card on the table — and NO React anywhere in it.
//
// A board card is moved the way it always was: the element itself, by
// style.left/top. It already lives in #cardlayer in felt-local pixels, so the
// numbers written during the drag are the same numbers the layout uses — no
// promotion, no remount, no render. A hand or command-zone card has no
// left/top of its own to move (one is a flex row, the other a fixed socket),
// so a fixed-position clone rides the cursor while the original dims in
// place, exactly like the old castDrag.
//
// React is touched exactly zero times between pointerdown and drop. The
// armed drop-target glow and the tuckover ring are classList toggles on the
// two elements whose answer changed; incoming server views park until the
// pointer comes up. Routing any of this through a store re-renders the whole
// table per boundary-crossing, which is what made the drag trail the cursor.
//
// Where the card lands is decided by the region under the pointer, not by a
// chain of special cases in the gesture: zones declare themselves with
// data-drop (see snapshotRegions) and each kind owns its drop rule below.
import { act } from "../api";
import { pileChainBelow, useGame } from "../store/game";
import { ui } from "../store/ui";
import type { Card } from "../types";
import { CH, CW, cardAt, posToPx, pxToPos, regionAt, snapshotCards, snapshotRegions, type CardBox, type Region } from "./table";

/** How far the pointer travels before this is a drag and not a click. */
const THRESHOLD = 6;

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

  // where on the card you grabbed it, as a fraction — a hand card is smaller
  // than its board-size ghost, so a fraction survives where a pixel offset
  // would not
  const src = el.getBoundingClientRect();
  const fx = src.width ? (startX - src.left) / src.width : 0.5;
  const fy = src.height ? (startY - src.top) / src.height : 0.5;

  const fromBoard = card.zone === "battlefield";
  // Everything the gesture needs is read ONCE when it goes live. Nothing on
  // the table moves while you hold a card, so a pointermove is arithmetic
  // plus one or two style writes — no reads, no queries, no renders.
  let origin = { x: 0, y: 0 };
  let regions: Region[] = [];
  let others: CardBox[] = [];
  let live = false;
  // the element under the cursor: the card itself (board) or the ghost
  let ghost: HTMLElement | null = null;
  let startLeft = 0;
  let startTop = 0;
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

  const retarget = () => {
    frame = 0;
    const region = regionAt(regions, last.x - origin.x, last.y - origin.y);
    // tucking is a board-to-board gesture: playing a card out of your hand
    // should never silently attach it to whatever is under the drop
    const target = !region && fromBoard ? cardAt(others, at.left + CW() / 2, at.top + CH() / 2) : null;
    if (region !== aimedAt) {
      aimedAt?.el.classList.remove("armed");
      region?.el.classList.add("armed");
      aimedAt = region;
    }
    if (target !== aimedCard) {
      aimedCard?.el.classList.remove("tuckover");
      target?.el.classList.add("tuckover");
      aimedCard = target;
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
      const carriedIds = new Set([card.id, ...(fromBoard && !card.under ? pileChainBelow(card.id).map((c) => c.id) : [])]);
      regions = snapshotRegions();
      others = snapshotCards(carriedIds);
      const felt = document.getElementById("felt")?.getBoundingClientRect();
      origin = { x: felt?.left ?? 0, y: felt?.top ?? 0 };
      if (fromBoard) {
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
        // no layout box to move: a board-size clone rides the cursor
        ghost = el.cloneNode(true) as HTMLElement;
        ghost.className = "card dragghost";
        ghost.style.width = `${CW()}px`;
        ghost.style.height = `${CH()}px`;
        document.body.appendChild(ghost);
        el.classList.add("beingdragged");
      }
    }
    last = { x: mv.clientX, y: mv.clientY };
    if (fromBoard) {
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
      // the ghost is fixed-position, so it lives in viewport pixels; `at`
      // tracks the same corner in felt pixels for the drop
      const left = mv.clientX - fx * CW();
      const top = mv.clientY - fy * CH();
      ghost!.style.left = `${left}px`;
      ghost!.style.top = `${top}px`;
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
    const f = { x: up.clientX - origin.x, y: up.clientY - origin.y };
    const over = regionAt(regions, f.x, f.y);
    const overCard = !over && fromBoard ? cardAt(others, at.left + CW() / 2, at.top + CH() / 2) : null;
    aimedAt?.el.classList.remove("armed");
    aimedCard?.el.classList.remove("tuckover");
    ui().hidePreview();
    // a board card released beyond the placeable rect settles onto its
    // clamped spot NOW — the exact pixel the store will render it at — so
    // the server ack cannot move it
    if (fromBoard && !over && !overCard) {
      const px = posToPx(pxToPos(at.left, at.top));
      el.style.left = `${px.left}px`;
      el.style.top = `${px.top}px`;
    }
    // the carried element stays where you let go until the server has been
    // told — release it earlier and it flicks back for the round trip
    try {
      await drop(card, over, overCard?.id ?? null, at);
    } finally {
      if (fromBoard) {
        el.classList.remove("dragging");
        for (const k of kids) k.el.style.transition = "";
        kids = [];
      } else {
        ghost?.remove();
        el.classList.remove("beingdragged");
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
