// The command zone as a place on the table rather than a row in the rail: a
// small lit socket in the corner of your own half, with the commander sitting
// in it at half a hand card's size.
//
// The socket stays drawn when it is empty — an empty command zone is
// information too.
import { act } from "../../api";
import { CardEl } from "../../components/Card";
import { startDrag } from "../../game/drag";
import { useGame } from "../../store/game";
import type { PlayerId } from "../../types";

export function CommandZone({ p }: { p: PlayerId }) {
  const cards = useGame((s) => s.view!.players[p].zones.command);
  const tax = useGame((s) => s.view!.players[p].commanderTax) ?? 0;
  const mine = p === "you";
  // dragging never renders this component: the drag dims the picked card and
  // lights the socket by toggling classes on the elements directly
  return (
    <div className={`cmdzone${mine ? "" : " theirs"}`} id={`cmdzone-${p}`} data-drop={`command:${p}`} data-tip="Command zone">
      {/* the nebula: four blobs drifting on their own clocks — see table.css */}
      <div className="cmdcloud" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="cmdslot">
        {cards.map((c) => (
          <CardEl key={c.id} card={c} className="cmdcard" onPointerDown={mine ? (e) => startDrag(e, c) : undefined} />
        ))}
      </div>
      {/* the {2}-per-previous-cast surcharge. Both seats keep it by hand — the
          agent has the same counter through the commander_tax tool — so it is
          a plain stepper, not a derived number. */}
      <button
        className={`cmdtax${tax > 0 ? " owed" : ""}`}
        data-tip={`Commander tax\nclick +2, right-click −2`}
        onClick={(e) => {
          e.stopPropagation();
          void act("commander_tax", { player: p, delta: 2 });
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void act("commander_tax", { player: p, delta: -2 });
        }}
      >
        {tax}
      </button>
    </div>
  );
}
