import { type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode, type Ref } from "react";
import { act } from "../api";
import { cardMenu } from "../features/menus/cardMenu";
import { consumeDragClick } from "../game/drag";
import { trackHover } from "../game/interaction";
import { cardById } from "../store/game";
import { menuOpen, ui, useUI } from "../store/ui";
import type { Card } from "../types";
import { previewProps } from "./CardPreview";
import { TokenFace, drawnHere } from "./TokenFace";

export interface CardElProps {
  card: Card;
  className?: string;
  style?: CSSProperties;
  /** rail-sized: fills its column instead of the fixed board size */
  small?: boolean;
  elRef?: Ref<HTMLDivElement>;
  onPointerDown?: (e: RPointerEvent<HTMLDivElement>) => void;
  /** unresolved cards open the Stack tab rather than the card menu */
  onClick?: (e: React.MouseEvent) => void;
  /** the stack panel that rides below a lifted card */
  children?: ReactNode;
}

/** THE card. One element, every state as a class: tapped, attacking,
 *  unresolved, lifted, tucked, face-down. Used in hands, on the board, in the
 *  rail and on the stack — the geometry never changes, only the classes. */
export function CardEl({ card: c, className = "", style, small, elRef, onPointerDown, onClick, children }: CardElProps) {
  const pendingTuck = useUI((s) => s.pendingTuck);
  const classes = ["card", c.tapped && "tapped", c.attacking && "attacking", c.blocking && "blocking", pendingTuck === c.id && "tuck-source", className]
    .filter(Boolean)
    .join(" ");

  const smallStyle: CSSProperties | undefined = small ? { width: "100%", height: "auto", aspectRatio: "0.72" } : undefined;
  // hover does two things at once: raise the preview, and remember the card for
  // the E keybind
  const preview = c.hidden ? null : previewProps(c);
  const track = trackHover(c);
  const hover = {
    onMouseEnter: (e: React.MouseEvent) => {
      preview?.onMouseEnter(e);
      track.onMouseEnter();
    },
    onMouseMove: preview?.onMouseMove,
    onMouseLeave: () => {
      preview?.onMouseLeave();
      track.onMouseLeave();
    },
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // a drag's release fires a click — eat it, so putting a card down never
    // also opens its menu
    if (consumeDragClick(c.id)) return;
    if (onClick) return onClick(e);
    // a menu is up: this click dismisses it rather than acting on the card
    if (menuOpen()) return ui().closeMenu();
    ui().hidePreview();
    const tuck = ui().pendingTuck;
    if (tuck && tuck !== c.id) {
      void act("tuck", { card: tuck, under: c.id });
      ui().setPendingTuck(null);
      return;
    }
    // either button shows the menu — tapping by accident was too easy, so the
    // keyboard (E / shift+E) owns the quick gestures instead
    cardMenu(c, e);
  };

  return (
    <div
      ref={elRef}
      className={classes}
      style={{ ...smallStyle, ...style }}
      data-card-id={c.id}
      onPointerDown={onPointerDown}
      onClick={handleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        ui().hidePreview();
        cardMenu(c, e);
      }}
      {...hover}
    >
      {/* The card's face sits in its own box so the float animations have
          something to move that is not the card. A transform on .card would
          shift its hit area and its rect, and every rect the table reads —
          what you are hovering, what a dropped card lands on — would be
          reading an animation frame instead of where the card is. */}
      <div className="cardface">
        {c.hidden ? <img className="cardback" src="/card-back.jpg" alt="face-down card" draggable={false} /> : <CardFace c={c} />}
      </div>
      {children}
    </div>
  );
}

function CardFace({ c }: { c: Card }) {
  const art = drawnHere(c) ? (
    <TokenFace c={c} />
  ) : c.image ? (
    <img src={c.image} alt={c.name} draggable={false} />
  ) : (
    <div className="textcard">
      <b>{c.name}</b>
      <br />
      {c.mana || ""}
      <br />
      {c.typeLine || ""}
      <br />
      {(c.oracle || "").slice(0, 120)}
      {c.power !== undefined && c.power !== null && (
        <div className="textpt">
          {c.power}/{c.toughness}
        </div>
      )}
    </div>
  );

  const ctrTotal = (c.counters?.["+1/+1"] || 0) - (c.counters?.["-1/-1"] || 0);
  const other = Object.entries(c.counters || {}).filter(([k, v]) => k !== "+1/+1" && k !== "-1/-1" && v);
  const tucked = c.under ? cardById(c.under) : null;
  const badges: ReactNode[] = [];
  if (c.attacking)
    badges.push(
      <span className="badge att" key="att">
        ⚔ {c.attacking === "you" ? "You" : c.attacking === "agent" ? "Agent" : "→"}
      </span>
    );
  if (c.blocking)
    badges.push(
      <span className="badge blk" key="blk">
        🛡
      </span>
    );
  if (c.under)
    badges.push(
      <span className="badge eq" key="eq">
        ↳ {tucked && !tucked.hidden ? (tucked.name || "?").split(",")[0] : "?"}
      </span>
    );
  if (c.isCommander)
    badges.push(
      <span className="badge" key="cmdr">
        CMDR
      </span>
    );

  const bump = (kind: string, delta: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void act("counters", { card: c.id, kind, delta });
  };

  return (
    <>
      {c.faceDown ? <div className="facedown-known">{art}</div> : art}
      {(other.length > 0 || badges.length > 0) && (
        <div className="badges">
          {/* P/T counters have their own on-card chip; other kinds are live
              badges — click adds one, right-click removes one */}
          {other.map(([k, v]) => (
            <span
              key={k}
              className="badge ctr"
              title={`${k} counters — click +1, right-click −1`}
              onClick={bump(k, 1)}
              onContextMenu={bump(k, -1)}
            >
              {v} {k}
            </span>
          ))}
          {badges}
        </div>
      )}
      {c.isToken && <span className="tokentag">token</span>}
      {c.zone === "battlefield" && (
        <button
          className={`ctrbtn${ctrTotal > 0 ? " has" : ctrTotal < 0 ? " has neg" : ""}`}
          title="+1/+1 counters — click to add, right-click to remove"
          onClick={bump("+1/+1", 1)}
          onContextMenu={bump("+1/+1", -1)}
        >
          {ctrTotal > 0 ? `+${ctrTotal}/+${ctrTotal}` : ctrTotal < 0 ? `${ctrTotal}/${ctrTotal}` : "0/0"}
        </button>
      )}
      {c.basePower !== undefined && c.zone === "battlefield" && (
        <div className="ptbadge" title={`printed ${c.basePower}/${c.baseToughness}`}>
          {c.power}/{c.toughness}
        </div>
      )}
      {(c.faceCount ?? 1) > 1 && c.faces && (
        <button
          className="flipbtn"
          title={`Flip to ${c.faces[((c.face ?? 0) + 1) % c.faceCount!].name}`}
          onClick={(e) => {
            e.stopPropagation();
            ui().hidePreview();
            void act("set_face", { card: c.id, face: ((c.face ?? 0) + 1) % c.faceCount! });
          }}
        >
          ⟳
        </button>
      )}
    </>
  );
}
