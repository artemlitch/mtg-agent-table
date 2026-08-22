import { useLayoutEffect, useRef, useState } from "react";

// The struck-coin counter. It started life inside the library panel's tiles
// and is now its own component, because the shape is general: a number you
// nudge without leaving the thing you are pointing at.
//
// The dial IS the stepper. Hovering its top arms a + above, its bottom a −
// below, and clicking there changes the number instead of firing whatever the
// dial is sitting on.
//
// Two variants:
//   plain      — the whole dial steps, split down the middle. Small target, so
//                it wants the biggest zones it can get.
//   editable   — the middle is a text field you can type into, so the step
//                zones are everything ABOVE and BELOW that field. They are
//                measured off the field itself rather than set to a fraction:
//                what you aim at is "not on the number", and the eye judges
//                that against the number, not against the coin. The signs show
//                at rest here: on a dial you are meant to type into, the fact
//                that it also steps has to be visible.

export interface DialProps {
  value: number;
  onChange: (n: number) => void;
  /** the middle becomes a text field; the step zones shrink to the quarters */
  editable?: boolean;
  step?: number;
  min?: number;
  max?: number;
  autoFocus?: boolean;
}

export function Dial({ value, onChange, editable, step = 1, min = 0, max = 999, autoFocus }: DialProps) {
  const box = useRef<HTMLSpanElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [armed, setArmed] = useState<"up" | "down" | null>(null);
  // how deep the step zone runs from each end — the gap between the coin's
  // edge and the field's. The shading reads it so the lit area is exactly the
  // area that acts.
  const [edge, setEdge] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!editable) return;
    const b = box.current?.getBoundingClientRect();
    const f = field.current?.getBoundingClientRect();
    if (b && f) setEdge(Math.round(f.top - b.top));
    // Focused here rather than through React's autoFocus attribute: that only
    // fires on the very first mount, and this dial arrives inside a modal that
    // may be swapping its body rather than mounting fresh. Selecting too, so
    // the first digit replaces the default instead of appending to it.
    if (autoFocus && field.current) {
      field.current.focus();
      field.current.select();
    }
  }, [editable, autoFocus]);
  const clamp = (n: number) => Math.max(min, Math.min(max, n));

  // Takes a number, never the event: a synthetic event is only valid inside
  // its own handler, so anything deferred must not be holding one.
  const zoneAt = (clientY: number): "up" | "down" | null => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return null;
    if (editable) {
      // anything off the field, either way, is a step
      const f = field.current?.getBoundingClientRect();
      if (!f) return null;
      return clientY < f.top ? "up" : clientY > f.bottom ? "down" : null;
    }
    return clientY < r.top + r.height / 2 ? "up" : "down";
  };

  return (
    <span
      ref={box}
      className={`dial${editable ? " editable" : ""}${armed ? ` step-${armed}` : ""}`}
      style={edge === null ? undefined : ({ "--dial-edge": `${edge}px` } as React.CSSProperties)}
      onMouseMove={(e) => setArmed(zoneAt(e.clientY))}
      onMouseLeave={() => setArmed(null)}
      onClick={(e) => {
        const zone = zoneAt(e.clientY);
        if (!zone) return; // the middle belongs to the field, or to nothing
        e.stopPropagation(); // adjust, never fire what the dial sits on
        onChange(clamp(value + (zone === "up" ? step : -step)));
      }}
    >
      <span className={`dial-step up${armed === "up" ? " armed" : ""}`}>+</span>
      {editable ? (
        <input
          ref={field}
          className="dial-count"
          inputMode="numeric"
          value={String(value)}
          onClick={(e) => e.stopPropagation()}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            const n = parseInt(e.target.value.replace(/[^\d-]/g, ""), 10);
            onChange(Number.isNaN(n) ? min : clamp(n));
          }}
          onKeyDown={(e) => {
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            e.preventDefault();
            onChange(clamp(value + (e.key === "ArrowUp" ? step : -step)));
          }}
        />
      ) : (
        <span className="dial-count">{value}</span>
      )}
      <span className={`dial-step down${armed === "down" ? " armed" : ""}`}>−</span>
    </span>
  );
}
