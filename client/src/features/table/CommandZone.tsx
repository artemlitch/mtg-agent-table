// The command zone as a place on the table rather than a row in the rail: a
// small lit socket in the corner of your own half, with the commander sitting
// in it at half a hand card's size. Drag the card out onto the board to cast
// it; drag a commander off the board back in here to send it home.
//
// The socket stays drawn when it is empty — it has to be a visible drop target
// for the way back, and an empty command zone is information too.
import { CardEl } from "../../components/Card";
import { startCastDrag } from "../../game/castDrag";
import { useGame } from "../../store/game";
import type { PlayerId } from "../../types";

export function CommandZone({ p }: { p: PlayerId }) {
  const cards = useGame((s) => s.view!.players[p].zones.command);
  const mine = p === "you";
  return (
    <div className={`cmdzone${mine ? "" : " theirs"}`} id={`cmdzone-${p}`} data-tip="Command zone">
      {/* the nebula: four blobs drifting on their own clocks — see table.css */}
      <div className="cmdcloud" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="cmdslot">
        {cards.map((c) => (
          <CardEl
            key={c.id}
            card={c}
            className="cmdcard"
            onPointerDown={mine ? (e) => startCastDrag(e, c, { note: "from command zone" }) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
