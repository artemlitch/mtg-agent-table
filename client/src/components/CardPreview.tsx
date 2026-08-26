import { useEffect } from "react";
import { previewCard, previewable, useGame } from "../store/game";
import { previewLost, useUI } from "../store/ui";
import type { Card } from "../types";
import { artFallback } from "./cardArt";
import { Text } from "./Text";
import { TokenFace, drawnHere } from "./TokenFace";

// The full-size card that follows the cursor. One layer, above the board and
// the modal, below the tooltip.

// wide enough for a full-size face plus the 90%-height other one tucked in
// behind it (55% + 49.5% - 4.5% overlap = the whole width; see overlays.css),
// so the face in play measures the same NARROW as any other card
const WIDE = 470;
const NARROW = 260;

export function CardPreviewLayer() {
  const preview = useUI((s) => s.preview);
  // The table can move out from under a still cursor — E plays the card you
  // are hovering, the agent exiles it, a pile swallows it — and no mouseleave
  // fires for a card that simply stopped being there. So after every change to
  // the table, once the DOM has caught up, check whether the thing being
  // previewed is still the thing under the cursor.
  const seq = useGame((s) => s.view?.seq);
  useEffect(() => {
    if (previewLost()) useUI.getState().hidePreview();
  }, [seq]);
  if (!preview) return null;
  const { x, y } = preview;
  // the card AS IT IS, not as it was when the pointer arrived — except where
  // the snapshot is the only copy with a face on it. See previewCard.
  const c = previewCard(preview.card);
  // nothing to draw beats an empty box: a face-down card of the agent's, a
  // card that went face-down or left for a library while the cursor sat on it
  if (!previewable(c)) return null;
  const faces = (c.faceCount ?? 1) > 1 ? c.faces : undefined;
  const width = faces ? WIDE : NARROW;
  // Beside the cursor, and it FLIPS to the left rather than sliding along the
  // edge. What it has to clear is not the window but the SIDE PANEL: a card
  // named in the chat sits a couple of hundred pixels from the right edge, so
  // there is room in the viewport and the card lands square on the sentence
  // you are reading it in. Hovering a card on the table is unchanged — the
  // panel is off to the right of all of it.
  const gap = 18;
  const wall = document.getElementById("side")?.getBoundingClientRect().left ?? window.innerWidth;
  // flipped, the card hangs off the cursor OR off the panel's edge, whichever
  // is further left — a cursor inside the panel is itself past the wall, and
  // measuring from it would leave the card lying over the last inch of chat
  const left = x + gap + width <= wall - 12 ? x + gap : Math.max(6, Math.min(x - gap, wall - 12) - width);
  const top = Math.max(6, Math.min(y + 12, window.innerHeight - 380));
  return (
    <div id="cardpreview" style={{ left, top, width }}>
      {faces ? <Faces card={c} faces={faces} /> : <Single card={c} />}
    </div>
  );
}

function Single({ card }: { card: Card }) {
  // a token we drew has art but no printed card, so blowing up the image alone
  // gives an icon floating on nothing — the preview draws the same face the
  // board does, just bigger
  if (drawnHere(card))
    return (
      <div className="pv-token">
        <TokenFace c={card} />
      </div>
    );
  if (card.image) return <img src={card.image} alt="" {...artFallback(card.name)} />;
  return (
    <div className="pv-text">
      <Text as="b">{card.name}</Text> <Text>{card.mana}</Text>
      {"\n"}
      <Text>{card.typeLine}</Text>
      {"\n\n"}
      <Text>{card.oracle}</Text>
    </div>
  );
}

/** Active face first, which is the one the CSS draws full size and in front;
 *  every face fully opaque. */
function Faces({ card, faces }: { card: Card; faces: NonNullable<Card["faces"]> }) {
  const active = card.face ?? 0;
  const order = faces.map((_, i) => i).sort((a, b) => (a === active ? -1 : b === active ? 1 : a - b));
  return (
    <div className="pv-faces">
      {order.map((i) => {
        const f = faces[i];
        const cls = i === active ? "pv-active" : "";
        return f.image ? (
          <img key={i} className={cls} src={f.image} alt="" {...artFallback(f.name, i !== 0)} />
        ) : (
          <div key={i} className={`pv-text ${cls}`}>
            <Text as="b">{f.name}</Text>
            {"\n"}
            <Text>{f.typeLine}</Text>
            {"\n\n"}
            <Text>{f.oracle}</Text>
          </div>
        );
      })}
    </div>
  );
}
