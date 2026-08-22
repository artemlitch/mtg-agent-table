import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useUI } from "../store/ui";

// The card-size slider picks a row density, not a pixel width: the cards then
// divide the browser evenly, so a row never ends in a ragged half-gap.
export const PER_ROW = [10, 9, 8, 7, 6, 5, 4, 3];
const GRID_GAP = 8; // must match .modalcards gap
const GRID_PAD = 4; // and its padding, which the row width has to give back

/** The veil and the box. What goes inside is one component — see ModalFrame,
 *  which every modal in the app uses for its heading and scroll area. */
export function ModalLayer() {
  const modal = useUI((s) => s.modal);
  const closeModal = useUI((s) => s.closeModal);
  if (!modal) return null;
  return (
    <div id="modal" onClick={(e) => e.target === e.currentTarget && closeModal()}>
      <div id="modal-box" className={modal.compact ? "compact" : ""}>
        <button className="modalx" title="Close (Esc)" onClick={closeModal}>
          ✕
        </button>
        {modal.body}
      </div>
      {modal.side}
    </div>
  );
}

/** Title and any filter bar stay put; only what you pass as children scrolls.
 *  Also the thing that sizes the cards: `--cardsize` divides the scroll area
 *  by the chosen row density. */
export function ModalFrame({ title, header, children }: { title: ReactNode; header?: ReactNode; children: ReactNode }) {
  const perRow = useUI((s) => s.cardsPerRow);
  const scroll = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const size = () => {
      const w = el.clientWidth - 2 * GRID_PAD;
      if (w > 0) el.style.setProperty("--cardsize", `${Math.floor((w - GRID_GAP * (perRow - 1)) / perRow) - 1}px`);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);
    return () => ro.disconnect();
  }, [perRow]);

  return (
    <>
      <div className="modalhead">
        <h3>{title}</h3>
        {header}
      </div>
      <div className="modalscroll" ref={scroll}>
        {children}
      </div>
    </>
  );
}
