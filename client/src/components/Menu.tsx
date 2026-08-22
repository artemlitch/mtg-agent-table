import { useEffect, useLayoutEffect, useRef } from "react";
import { menuLook, stripGlyph } from "../icons";
import { CURSOR_GAP, useUI } from "../store/ui";
import { Icon } from "./Icon";
import { KeyCaps } from "./KeyCaps";

// THE menu. Right-clicking a card, clicking a card in a browser, opening a
// dropdown and right-clicking a library all land here — one plate, one look,
// one set of rules for Esc and click-away. The library panel is this same
// container laid out as a grid (kind: "panel").

export function MenuLayer() {
  const menu = useUI((s) => s.menu);
  const closeMenu = useUI((s) => s.closeMenu);
  const box = useRef<HTMLDivElement>(null);

  // clicking anywhere else dismisses. Every opener calls stopPropagation, so
  // the click that opened a menu never reaches this listener.
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => {
      if (box.current?.contains(e.target as Node)) return;
      closeMenu();
    };
    document.addEventListener("click", away);
    return () => document.removeEventListener("click", away);
  }, [menu, closeMenu]);

  // clamped once it has a height — a menu opened near the bottom edge grows
  // upward rather than off-screen
  useLayoutEffect(() => {
    if (!menu || !box.current) return;
    const wide = menu.kind === "panel" ? 250 : 200;
    const x = Math.min(menu.x + CURSOR_GAP.x, window.innerWidth - wide);
    const y = Math.min(menu.y + CURSOR_GAP.y, window.innerHeight - box.current.offsetHeight - 10);
    box.current.style.left = `${x}px`;
    box.current.style.top = `${Math.max(4, y)}px`;
  }, [menu]);

  if (!menu) return null;
  if (menu.kind === "panel")
    return (
      <div id="menu" className="libpanel" ref={box}>
        {menu.render()}
      </div>
    );

  let firstAction = true;
  return (
    <div id="menu" ref={box}>
      {menu.items.map((it, i) => {
        if (it.title)
          return (
            <div className="mi title" key={i}>
              {stripGlyph(it.label)}
            </div>
          );
        const look = menuLook(it.label);
        // the first action is the one you almost always came for — give it
        // size. A dropdown's list is a list of equals, so it opts out.
        const primary = firstAction && !menu.plain;
        firstAction = false;
        return (
          <button
            key={i}
            className={`mi a-${look.tone}${it.sep ? " sep" : ""}${primary ? " primary" : ""}${it.on ? " on" : ""}`}
            onClick={() => {
              closeMenu();
              it.fn?.();
            }}
          >
            <Icon name={it.icon ?? look.icon} />
            <span className="mi-label">{stripGlyph(it.label)}</span>
            {it.keys && <KeyCaps keys={it.keys} className="mi-keys" />}
          </button>
        );
      })}
    </div>
  );
}
