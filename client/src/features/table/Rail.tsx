// The rail beside each half of the table: life, the library pile, the
// graveyard, exile, and the commander. Both rails share one element order —
// the agent's is mirrored with column-reverse — so each thing sits the same
// distance from the midline on both sides.
import { useEffect, useRef, useState } from "react";
import { act } from "../../api";
import { previewProps } from "../../components/CardPreview";
import { useGame } from "../../store/game";
import { menuOpen, ui, type Anchor } from "../../store/ui";
import type { Card, PlayerId } from "../../types";
import { openZoneBrowser } from "../browsers/Browsers";
import { openLibraryPanel } from "../menus/LibraryPanel";

export function Rail({ p }: { p: PlayerId }) {
  const ps = useGame((s) => s.view!.players[p]);
  return (
    <div className="rail" id={`rail-${p}`}>
      <LifeBox p={p} />
      <DeckPile p={p} />
      <Pile
        label="Graveyard"
        count={ps.counts.graveyard}
        cards={ps.zones.graveyard}
        onClick={() => openZoneBrowser(p, "graveyard")}
        onMenu={(e) => graveyardMenu(p, e)}
      />
      <Pile label="Exile" count={ps.counts.exile} cards={ps.zones.exile} onClick={() => openZoneBrowser(p, "exile")} />
      {/* the command zone is a place on the board now — see CommandZone */}
    </div>
  );
}

/** Right-clicking a graveyard: whole-pile actions, one undo step each. */
function graveyardMenu(p: PlayerId, e: Anchor) {
  const ids = (useGame.getState().view?.players[p].zones.graveyard ?? []).map((c) => c.id);
  ui().openMenu(
    [
      { label: `${p === "you" ? "Your" : "Agent's"} graveyard`, title: true },
      { label: "Browse", fn: () => openZoneBrowser(p, "graveyard") },
      {
        label: `Exile all (${ids.length})`,
        fn: () => void (ids.length && act("move", { cards: ids, toZone: "exile", note: "exiled the graveyard" })),
      },
    ],
    e
  );
}

// Life box: yours at the top of your rail, the agent's pinned to the bottom of
// its rail — both hugging the midline. Rapid −/+ clicks accumulate into a
// running delta shown on the box (−5, −6, −7…); it resets after 2s untouched.
function LifeBox({ p }: { p: PlayerId }) {
  const ps = useGame((s) => s.view!.players[p]);
  const [delta, setDelta] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const bump = (d: number) => {
    setDelta((v) => v + d);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDelta(0), 2000);
    void act("life", { player: p, delta: d });
  };

  // commander damage is reference, not headline: it rides in a hover tooltip,
  // on the number itself — the name and the ± buttons are not it. The tooltip
  // is always there, saying "none yet" when the tally is empty: a number that
  // sometimes answers a hover and sometimes ignores it reads as broken.
  const tally = Object.entries(ps.commanderDamage || {});
  const cmdmg = tally.length ? tally.map(([c, n]) => `${n} from ${c}`).join("\n") : "none yet";

  return (
    <div className="lifebox">
      {delta !== 0 && (
        <div className={`lifedelta ${delta < 0 ? "neg" : "pos"}`}>
          {delta > 0 ? "+" : ""}
          {delta}
        </div>
      )}
      <div className="lname" title={ps.deckName || ""}>
        {p === "you" ? "You" : "Agent"}
      </div>
      <div className="liferow">
        <button onClick={(e) => (e.stopPropagation(), bump(-1))}>−</button>
        <div className="life" data-tip={`Commander damage\n${cmdmg}`}>
          {ps.life}
        </div>
        <button onClick={(e) => (e.stopPropagation(), bump(1))}>+</button>
      </div>
    </div>
  );
}

/** The library as a physical face-down pile, count on top; your deck carries a
 *  Draw 1 button on its bottom edge. Either mouse button opens the panel. */
function DeckPile({ p }: { p: PlayerId }) {
  const count = useGame((s) => s.view!.players[p].counts.library);
  const open = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (menuOpen()) return ui().closeMenu();
    openLibraryPanel(p, e);
  };
  return (
    <div className="deckpile" data-tip="Library" onClick={open} onContextMenu={open}>
      <div className="deckstack">
        <img className="cardback" src="/card-back.jpg" alt="library" />
        <div className="deckcount">{count}</div>
        {p === "you" && (
          <button
            /* the same gold plate as End turn — the two buttons you actually
               press every turn should look like each other */
            className="drawbtn accent"
            onClick={(e) => {
              e.stopPropagation();
              void act("draw", { n: 1 });
            }}
          >
            🂠 Draw 1
          </button>
        )}
      </div>
    </div>
  );
}

/** A graveyard or exile pile: a count and the last few cards fanned tiny and
 *  face up, newest on top. The strip is always here, empty or not, so the rail
 *  doesn't jump when the first card lands. */
function Pile({
  label,
  count,
  cards,
  onClick,
  onMenu,
}: {
  label: string;
  count: number;
  cards: Card[];
  onClick: (e: React.MouseEvent) => void;
  onMenu?: (e: React.MouseEvent) => void;
}) {
  const recent = cards.slice(-5).reverse();
  return (
    <div
      className="pile"
      onClick={(e) => {
        e.stopPropagation();
        ui().hidePreview();
        onClick(e);
      }}
      onContextMenu={
        onMenu
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              ui().hidePreview();
              onMenu(e);
            }
          : undefined
      }
    >
      <div className="phead">
        <span className="pname">{label}</span>
        <span className="pcount">{count}</span>
      </div>
      <div className="pstrip">
        {recent.map((c, i) => {
          const style = { zIndex: recent.length - i };
          const hover = c.hidden ? {} : previewProps(c);
          if (c.hidden || c.faceDown) return <img key={c.id} className="mini" src="/card-back.jpg" style={style} alt="" {...hover} />;
          if (c.image) return <img key={c.id} className="mini" src={c.image} style={style} alt="" {...hover} />;
          return (
            <div key={c.id} className="mini minitext" style={style} {...hover}>
              {c.name?.[0] ?? "?"}
            </div>
          );
        })}
      </div>
    </div>
  );
}
