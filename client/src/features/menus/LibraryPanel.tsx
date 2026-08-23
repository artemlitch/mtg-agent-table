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
import { useState } from "react";
import { act } from "../../api";
import { Dial } from "../../components/Dial";
import { Icon } from "../../components/Icon";
import { gameView } from "../../store/game";
import { ui, type Anchor } from "../../store/ui";
import type { PlayerId } from "../../types";
import { openPeekBrowser, openSearchBrowser } from "../browsers/Browsers";

export function openLibraryPanel(p: PlayerId, at: Anchor) {
  ui().openPanel(() => <LibraryPanel p={p} />, at);
}

function LibraryPanel({ p }: { p: PlayerId }) {
  const view = gameView();
  const mine = p === "you";
  const run = (fn: () => unknown) => async () => {
    ui().closeMenu();
    await fn();
  };
  const topRef = `top:${p}`;
  const millOne = () => act("move", { card: topRef, toZone: "graveyard", toPlayer: p, note: "mill" });
  // taking cards off the agent's library is a theft effect: face-down, yours to see
  const exileOne = () =>
    mine
      ? act("move", { card: topRef, toZone: "exile", toPlayer: p, note: "exiled from library" })
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
        <LibButton cls="lp-tile" label="Exile" icon="exile" counted onRun={(n) => run(() => repeat(n, exileOne))()} />
        <LibButton cls="lp-tile" label="Surveil" icon="surveil" counted onRun={(n) => run(() => peekN(n))()} />
      </div>

      <LibButton cls="lp-wide" label="Shuffle" icon="shuffle" onRun={run(() => act("shuffle", { player: p }))} />
    </>
  );
}

/** A button with an icon, a label, and optionally an inline counter that
 *  doubles as a +/− stepper. `icon` doubles as the colour class. */
function LibButton({
  cls,
  label,
  icon,
  counted,
  onRun,
}: {
  cls: string;
  label: string;
  icon: string;
  counted?: boolean;
  onRun: (n: number) => void;
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
    </button>
  );
}
