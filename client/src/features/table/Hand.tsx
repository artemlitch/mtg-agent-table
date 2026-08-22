// Both hands are centered fans of held cards, poking over the board — yours
// arcs up from the bottom, the agent's mirrors down from the top. The fan
// flattens as the hand grows: the end card never tilts past 10° or sinks more
// than ~24px, and wide hands tighten their overlap instead of bleeding past
// the edges.
import { useEffect, useRef, useState } from "react";
import { act } from "../../api";
import { CardEl } from "../../components/Card";
import { CH, CW, guardClicks, handZone, markDragged, noHover } from "../../game/interaction";
import { useGame } from "../../store/game";
import { ui } from "../../store/ui";
import type { Card, PlayerId } from "../../types";

const CARD_W = 76; // .handrow.fan .card.fanned

export function Hand({ p }: { p: PlayerId }) {
  const cards = useGame((s) => s.view!.players[p].zones.hand);
  const row = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const n = cards.length;
  const mid = (n - 1) / 2;
  const rotStep = mid > 0 ? Math.min(4, 10 / mid) : 0;
  const dipK = mid > 0 ? Math.min(2.4, 24 / (mid * mid)) : 0;
  // the whole arc rides up so the dipped end cards stay inside the window
  // (the bottom hand row only has ~4px of slack past its padding)
  const yShift = Math.max(0, mid * mid * dipK - 4);
  let overlap = 22;
  const avail = width - 16;
  if (n > 1 && CARD_W + (n - 1) * (CARD_W - overlap) > avail) {
    overlap = Math.min(CARD_W * 0.8, CARD_W - (avail - CARD_W) / (n - 1));
  }

  return (
    <div className="handrow fan" id={`hand-${p}`} ref={row}>
      {cards.map((c, i) => (
        <CardEl
          key={c.id}
          card={c}
          className="fanned"
          style={
            {
              "--fan-rot": `${(i - mid) * rotStep}deg`,
              "--fan-y": `${(i - mid) * (i - mid) * dipK - yShift}px`,
              marginLeft: -overlap / 2,
              marginRight: -overlap / 2,
              zIndex: i + 1,
            } as React.CSSProperties
          }
          onPointerDown={p === "you" && !c.hidden ? (e) => startHandDrag(e, c) : undefined}
        />
      ))}
    </div>
  );
}

// Hand cards sit in a flex row, so there is no left/top to move: the drag
// carries a fixed-position clone under the cursor and the original dims in
// place. Dropping on your own half plays the card there; anywhere else is a
// cancel. Lands land, spells go to the stack — same `cast` either way — and
// the drop point becomes the card's board position.
function startHandDrag(down: React.PointerEvent<HTMLDivElement>, c: Card) {
  if (down.button !== 0 || c.controller !== "you") return;
  const el = down.currentTarget;
  const pointerId = down.pointerId;
  let ghost: HTMLElement | null = null;

  const onMove = (mv: PointerEvent) => {
    if (!ghost) {
      if (Math.hypot(mv.clientX - down.clientX, mv.clientY - down.clientY) < 8) return;
      ui().hidePreview();
      useGame.getState().setDragging(true);
      ghost = el.cloneNode(true) as HTMLElement;
      ghost.className = "card handghost";
      ghost.style.width = `${CW}px`;
      ghost.style.height = `${CH}px`;
      document.body.appendChild(ghost);
      el.classList.add("beingdragged");
      el.setPointerCapture?.(pointerId);
      handZone.show(false);
    }
    ghost.style.left = `${mv.clientX - CW / 2}px`;
    ghost.style.top = `${mv.clientY - CH / 2}px`;
    const bf = document.getElementById("bf-you")!.getBoundingClientRect();
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
    const bfEl = document.getElementById("bf-you")!;
    const bf = bfEl.getBoundingClientRect();
    const inside = up.clientX >= bf.left && up.clientX <= bf.right && up.clientY >= bf.top && up.clientY <= bf.bottom;
    if (!inside) {
      useGame.getState().setDragging(false); // dropped nowhere — the fan goes back
      return;
    }
    const W = Math.max(bfEl.clientWidth, 400);
    const H = Math.max(bfEl.clientHeight, 200);
    const x = Math.max(0, Math.min(1, (up.clientX - bf.left - CW / 2) / Math.max(1, W - CW)));
    const y = (up.clientY - bf.top - CH / 2) / Math.max(1, H - CH);
    useGame.getState().expectPos(c.id, { x, y }); // so the ack can't snap it elsewhere
    useGame.getState().setDragging(false);
    await act("cast", { card: c.id });
    await act("place", { positions: [{ card: c.id, x, y }] });
  };

  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
}
