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
  // upward rather than off-screen. The open animation then scales out of the
  // point that was actually clicked: with the origin pinned there, a menu
  // that sits below the cursor grows downward, one pushed up by the bottom
  // edge grows upward, and one shoved sideways by the right edge grows out of
  // its own middle — all from the same rule, no cases.
  useLayoutEffect(() => {
    if (!menu || !box.current) return;
    const el = box.current;
    const wide = menu.kind === "panel" ? 250 : 200;
    const left = Math.min(menu.x + CURSOR_GAP.x, window.innerWidth - wide);
    const top = Math.max(4, Math.min(menu.y + CURSOR_GAP.y, window.innerHeight - el.offsetHeight - 10));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.transformOrigin = `${menu.x - left}px ${menu.y - top}px`;
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
        // matched on the label as DISPLAYED. Several MENU_LOOK rules are
        // anchored (/^show /), so a leading glyph on the label silently sank
        // them to the fallback bullet while the row rendered without it —
        // "⟳ Show <other face>" drew no icon at all for exactly that reason.
        const look = menuLook(stripGlyph(it.label));
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
