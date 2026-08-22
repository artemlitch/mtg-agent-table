// Dragging a card ONTO your battlefield to play it. Shared by the hand and the
// command zone: neither has a left/top of its own to move (one is a flex row,
// the other a fixed socket), so the drag carries a fixed-position clone under
// the cursor while the original dims in place. Dropping on your own half plays
// the card there; anywhere else is a cancel. Lands land, spells go to the
// stack — same `cast` either way — and the drop point becomes the card's board
// position.
import { act } from "../api";
import { useGame } from "../store/game";
import { ui } from "../store/ui";
import type { Card } from "../types";
import { CH, CW, capturePointer, guardClicks, handZone, markDragged, noHover } from "./interaction";

export function startCastDrag(down: React.PointerEvent<HTMLDivElement>, c: Card, opts: { note?: string } = {}) {
  if (down.button !== 0 || c.controller !== "you") return;
  const el = down.currentTarget;
  const pointerId = down.pointerId;
  let ghost: HTMLElement | null = null;

  const board = () => document.getElementById("bf-you")!;

  const onMove = (mv: PointerEvent) => {
    if (!ghost) {
      if (Math.hypot(mv.clientX - down.clientX, mv.clientY - down.clientY) < 8) return;
      ui().hidePreview();
      useGame.getState().setDragging(true);
      ghost = el.cloneNode(true) as HTMLElement;
      ghost.className = "card handghost";
      // the socket art is half-size; the thing you are carrying is a real card
      ghost.style.width = `${CW}px`;
      ghost.style.height = `${CH}px`;
      document.body.appendChild(ghost);
      el.classList.add("beingdragged");
      capturePointer(el, pointerId);
      handZone.show(false);
    }
    ghost.style.left = `${mv.clientX - CW / 2}px`;
    ghost.style.top = `${mv.clientY - CH / 2}px`;
    const bf = board().getBoundingClientRect();
    const over = mv.clientX >= bf.left && mv.clientX <= bf.right && mv.clientY >= bf.top && mv.clientY <= bf.bottom;
    ghost.classList.toggle("overboard", over);
  };

  const onUp = async (up: PointerEvent) => {
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    if (!ghost) return;
    ghost.remove();
    el.classList.remove("beingdragged");
    markDragged(c.id);
    guardClicks();
    noHover.id = c.id;
    handZone.hide();
    const bfEl = board();
    const bf = bfEl.getBoundingClientRect();
    const inside = up.clientX >= bf.left && up.clientX <= bf.right && up.clientY >= bf.top && up.clientY <= bf.bottom;
    if (!inside) {
      useGame.getState().setDragging(false); // dropped nowhere — put it back
      return;
    }
    const W = Math.max(bfEl.clientWidth, 400);
    const H = Math.max(bfEl.clientHeight, 200);
    const x = Math.max(0, Math.min(1, (up.clientX - bf.left - CW / 2) / Math.max(1, W - CW)));
    const y = (up.clientY - bf.top - CH / 2) / Math.max(1, H - CH);
    useGame.getState().expectPos(c.id, { x, y }); // so the ack can't snap it elsewhere
    useGame.getState().setDragging(false);
    await act("cast", { card: c.id, ...(opts.note ? { note: opts.note } : {}) });
    await act("place", { positions: [{ card: c.id, x, y }] });
  };

  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
}
