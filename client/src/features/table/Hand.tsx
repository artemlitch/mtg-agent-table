// Both hands are centered fans of held cards, poking over the board — yours
// arcs up from the bottom, the agent's mirrors down from the top. The fan
// flattens as the hand grows: the end card never tilts past 10° or sinks more
// than ~24px, and wide hands tighten their overlap instead of bleeding past
// the edges.
import { useEffect, useRef, useState } from "react";
import { CardEl } from "../../components/Card";
import { HAND_W } from "../../game/interaction";
import { useGame } from "../../store/game";
import type { PlayerId } from "../../types";

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
  if (n > 1 && HAND_W + (n - 1) * (HAND_W - overlap) > avail) {
    overlap = Math.min(HAND_W * 0.8, HAND_W - (avail - HAND_W) / (n - 1));
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
        />
      ))}
    </div>
  );
}
