import { useRef, useState } from "react";

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
//   editable   — the middle is a text field you can type into, so the arrows
//                give it room and take only the outer quarters. The signs show
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
  const [armed, setArmed] = useState<"up" | "down" | null>(null);
  const clamp = (n: number) => Math.max(min, Math.min(max, n));

  // Takes a number, never the event: a synthetic event is only valid inside
  // its own handler, so anything deferred must not be holding one.
  const zoneAt = (clientY: number): "up" | "down" | null => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return null;
    const edge = editable ? 0.25 : 0.5;
    const y = (clientY - r.top) / r.height;
    if (y < edge) return "up";
    if (y > 1 - edge) return "down";
    return null;
  };

  return (
    <span
      ref={box}
      className={`dial${editable ? " editable" : ""}${armed ? ` step-${armed}` : ""}`}
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
          className="dial-count"
          inputMode="numeric"
          autoFocus={autoFocus}
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
