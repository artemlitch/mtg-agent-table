import { useUI } from "../store/ui";
import type { Card } from "../types";
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
  if (!preview) return null;
  const { card: c, x, y } = preview;
  const faces = (c.faceCount ?? 1) > 1 ? c.faces : undefined;
  const width = faces ? WIDE : NARROW;
  const left = Math.min(x + 18, window.innerWidth - (width + 20));
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
  if (card.image) return <img src={card.image} alt="" />;
  return (
    <div className="pv-text">
      <b>{card.name}</b> {card.mana || ""}
      {"\n"}
      {card.typeLine || ""}
      {"\n\n"}
      {card.oracle || ""}
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
          <img key={i} className={cls} src={f.image} alt="" />
        ) : (
          <div key={i} className={`pv-text ${cls}`}>
            <b>{f.name}</b>
            {"\n"}
            {f.typeLine || ""}
            {"\n\n"}
            {f.oracle || ""}
          </div>
        );
      })}
    </div>
  );
}

/** Hover handlers every previewable thing spreads onto itself. */
export function previewProps(card: Card) {
  return {
    onMouseEnter: (e: React.MouseEvent) => useUI.getState().showPreview(card, e),
    onMouseMove: (e: React.MouseEvent) => useUI.getState().movePreview(e),
    onMouseLeave: () => useUI.getState().hidePreview(),
  };
}
