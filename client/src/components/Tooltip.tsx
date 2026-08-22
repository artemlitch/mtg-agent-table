import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { KeyCaps } from "./KeyCaps";

// ONE floating layer, fixed to the viewport, above everything else in the app.
// Never a sibling of the thing it describes: as a sibling it gets clipped by
// any ancestor that scrolls (the rails, the topbar) and painted over by later
// siblings (the deck pile), which reads as "the hover is broken".
//
// Anything can have one, no wiring required:
//     data-tip="Undo"          — text; \n starts a new line
//     data-tip-keys="⌘,Z"      — keycaps under it

export function TooltipLayer() {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const over = (e: MouseEvent) => {
      // a card in the air is not a hover: the cursor is crossing the table on
      // its way somewhere, not asking about what it passes over
      if (document.body.classList.contains("dragging")) return;
      const t = e.target as HTMLElement | null;
      setEl(t?.closest?.<HTMLElement>("[data-tip]") ?? null);
    };
    const hide = () => setEl(null);
    document.addEventListener("mouseover", over);
    document.addEventListener("mousedown", hide);
    document.addEventListener("mouseleave", hide);
    return () => {
      document.removeEventListener("mouseover", over);
      document.removeEventListener("mousedown", hide);
      document.removeEventListener("mouseleave", hide);
    };
  }, []);

  // placed once it is measurable: above when there is room, below when there
  // isn't, and never off the side
  useLayoutEffect(() => {
    if (!el || !box.current) return;
    const r = el.getBoundingClientRect();
    const t = box.current.getBoundingClientRect();
    const top = r.top - t.height - 6 < 4 ? r.bottom + 6 : r.top - t.height - 6;
    const left = Math.max(4, Math.min(r.left + (r.width - t.width) / 2, window.innerWidth - t.width - 4));
    box.current.style.top = `${top}px`;
    box.current.style.left = `${left}px`;
  });

  if (!el) return null;
  const lines = (el.dataset.tip ?? "").split("\n");
  const keys = el.dataset.tipKeys?.split(",");
  return createPortal(
    <div id="tooltip" ref={box}>
      {lines.map((line, i) => (
        <div className="tt-row" key={i}>
          {line}
        </div>
      ))}
      {keys && <KeyCaps keys={keys} />}
    </div>,
    document.body
  );
}
