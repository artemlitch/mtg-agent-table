// Right-clicking a library opens a laid-out panel, not a text menu:
//
//   [ mulligan ]          yours, turn 1 only
//   [ search   ]
//   [ draw n  ][reveal n] counter tiles
//   [scry n][mill n]
//   [exile n][surveil n]
//   [ shuffle ]
//
// The tile body runs the action with the number shown. The number is also the
// stepper: hovering its top half arms a + above, the bottom half a − below,
// and clicking there changes the count instead of firing.
import { useState, type ReactNode } from "react";
import { act } from "../../api";
import { Dial } from "../../components/Dial";
import { Icon } from "../../components/Icon";
import { gameView } from "../../store/game";
import { ui, useUI, type Anchor } from "../../store/ui";
import type { PlayerId } from "../../types";
import { openPeekBrowser, openSearchBrowser } from "../browsers/Browsers";

export function openLibraryPanel(p: PlayerId, at: Anchor) {
  ui().openPanel(() => <LibraryPanel p={p} />, at);
}

function LibraryPanel({ p }: { p: PlayerId }) {
  const view = gameView();
  const mine = p === "you";
  // subscribed, not read once: the switch below flips it while the panel is open
  const exileDown = useUI((s) => s.exileFaceDown);
  const run = (fn: () => unknown) => async () => {
    ui().closeMenu();
    await fn();
  };
  const topRef = `top:${p}`;
  const millOne = () => act("move", { card: topRef, toZone: "graveyard", toPlayer: p, note: "mill" });
  // taking cards off the agent's library is a theft effect: face-down, yours to see
  // ...and the exile-face-down preference (see exileToggle) reaches the top
  // of your own library too: a chapter that exiles face-down does it from here
  const exileOne = () =>
    mine
      ? act("move", {
          card: topRef,
          toZone: "exile",
          toPlayer: p,
          ...(ui().exileFaceDown ? { faceDown: true, revealTo: "you" } : {}),
          note: "exiled from library",
        })
      : act("move", { card: topRef, toZone: "exile", toPlayer: "agent", faceDown: true, revealTo: "you", note: "theft effect" });
  const peekN = async (n: number) => {
    const r = await act("peek", { player: p, n });
    if (r.ok) openPeekBrowser(p, r.cards);
  };
  const repeat = async (n: number, once: () => unknown) => {
    for (let i = 0; i < n; i++) await once();
  };

  return (
    <>
      <div className="lp-title">{mine ? "Your library" : "Agent's library"}</div>

      {mine && view?.turnNumber === 1 && (
        <LibButton
          cls="lp-wide"
          label="Mulligan"
          icon="mulligan"
          // one action, so there is nothing to undo and the next-action prompt
          // still reads the table as freshly dealt — see mulligan() in
          // server/game.ts
          onRun={run(async () => {
            await act("mulligan", {});
          })}
        />
      )}

      <LibButton
        cls="lp-wide"
        label="Search"
        icon="search"
        onRun={run(async () => {
          const r = await act("view_zone", { player: p, zone: "library" });
          if (r.ok) openSearchBrowser(p, r.cards);
        })}
      />

      {/* the standing self-reveal (Top, Elsha, Future Sight): the pile wears
          the top card's face — for your eyes only — until turned off */}
      {mine && (
        <LibButton
          cls="lp-wide"
          label={view?.players.you.topRevealed ? "Hide top card" : "Reveal top to you"}
          icon={view?.players.you.topRevealed ? "facedown" : "faceup"}
          onRun={run(() => act("reveal_top", {}))}
        />
      )}

      {/* draw leads the tiles, paired with reveal — counters and all */}
      <div className="lp-grid">
        {mine && <LibButton cls="lp-tile" label="Draw" icon="draw" counted onRun={(n) => run(() => act("draw", { n }))()} />}
        <LibButton
          cls="lp-tile"
          label="Reveal"
          icon="reveal"
          counted
          onRun={(n) =>
            run(async () => {
              const r = await act("peek", { player: p, n });
              if (r.ok && r.cards.length) await act("reveal", { cards: r.cards.map((c: { id: string }) => c.id), to: "all" });
            })()
          }
        />
      </div>

      <div className="lp-grid">
        <LibButton cls="lp-tile" label="Scry" icon="scry" counted onRun={(n) => run(() => peekN(n))()} />
        <LibButton cls="lp-tile" label="Mill" icon="mill" counted onRun={(n) => run(() => repeat(n, millOne))()} />
        <LibButton
          cls="lp-tile"
          label="Exile"
          icon="exile"
          counted
          onRun={(n) => run(() => repeat(n, exileOne))()}
          // the same switch the card menu carries (see exileToggle), tucked
          // into the tile's corner so the dial keeps the middle: lit while
          // on, and every exile — this tile, the menus, the browsers — goes
          // face-down for your eyes until it is clicked off
          aside={
            mine ? (
              <span
                role="button"
                aria-pressed={exileDown}
                title="Exile face down"
                className={`lp-aside${exileDown ? " on" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  ui().setExileFaceDown(!exileDown);
                }}
              >
                <Icon name="facedown" />
              </span>
            ) : undefined
          }
        />
        <LibButton cls="lp-tile" label="Surveil" icon="surveil" counted onRun={(n) => run(() => peekN(n))()} />
      </div>

      <LibButton cls="lp-wide" label="Shuffle" icon="shuffle" onRun={run(() => act("shuffle", { player: p }))} />
    </>
  );
}

/** A button with an icon, a label, and optionally an inline counter that
 *  doubles as a +/− stepper. `icon` doubles as the colour class. `aside` is
 *  a small control pinned to the tile's corner, outside the flow, so the dial
 *  stays centred whether or not the tile has one. */
function LibButton({
  cls,
  label,
  icon,
  counted,
  onRun,
  aside,
}: {
  cls: string;
  label: string;
  icon: string;
  counted?: boolean;
  onRun: (n: number) => void;
  aside?: ReactNode;
}) {
  const [n, setN] = useState(1);
  const [onDial, setOnDial] = useState(false);

  return (
    <button className={`${cls} a-${icon}${onDial ? " on-dial" : ""}`} onClick={() => onRun(n)}>
      {/* icon and label always share a line; the dial sits beside them on wide
          buttons and beneath them on tiles */}
      <span className="lp-head">
        <Icon name={icon} />
        <span className="lp-label">{label}</span>
      </span>
      {counted && (
        // the pointer being on the dial means the click adjusts rather than
        // fires, so the button stops pretending it is hovered
        <span onMouseEnter={() => setOnDial(true)} onMouseLeave={() => setOnDial(false)} style={{ display: "contents" }}>
          <Dial value={n} onChange={setN} min={1} />
        </span>
      )}
      {aside}
    </button>
  );
}
