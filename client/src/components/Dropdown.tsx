import { useRef } from "react";
import { CURSOR_GAP, menuOpen, ui } from "../store/ui";
import { Icon } from "./Icon";

export interface Option {
  value: string;
  label: string;
  /** options that carry their own glyph keep it; the rest borrow the icon
   *  column to mark which one is current */
  icon?: string;
}

/** A native <select> can't wear the plate-and-rim look, so ours is a plate
 *  that drops THE card menu underneath it — same rows, same hover, same
 *  dismissal. */
export function Dropdown({
  options,
  value,
  onPick,
  className = "",
}: {
  options: Option[];
  value: string;
  onPick: (v: string) => void;
  className?: string;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const label = options.find((o) => o.value === value)?.label ?? "";
  return (
    <button
      ref={btn}
      className={`dropdown${className ? " " + className : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        if (menuOpen()) return ui().closeMenu();
        const r = btn.current!.getBoundingClientRect();
        ui().openMenu(
          options.map((o) => ({
            label: o.label,
            icon: o.icon ?? (o.value === value ? "resolve" : "blank"),
            on: o.value === value,
            fn: () => onPick(o.value),
          })),
          { clientX: r.left - CURSOR_GAP.x, clientY: r.bottom - CURSOR_GAP.y + 3 },
          { plain: true }
        );
      }}
    >
      <span className="dd-label">{label}</span>
      <Icon name="caret" />
    </button>
  );
}
