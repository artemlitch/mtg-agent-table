import type { Card } from "../types";
import { hideOnError } from "./cardArt";
import { Text } from "./Text";

/** A token we drew ourselves rather than one with a printed card: the frame,
 *  the name, the type line, the rules text and the P/T in their card
 *  positions, with the chosen icon in the art box. The same anatomy as the
 *  maker in the token modal — a custom token looks on the battlefield exactly
 *  like the card you built. A data: image is the tell: Scryfall art is a whole
 *  printed card and covers the frame instead. */
export function TokenFace({ c }: { c: Card }) {
  const pt = c.power !== undefined && c.power !== null;
  return (
    <div className="tokenface">
      <Text as="div" className="tc-title">{c.name}</Text>
      <div className="tc-art">{c.image && <img src={c.image} alt="" draggable={false} {...hideOnError} />}</div>
      <div className="tc-body">
        <Text as="div" className="tc-type">{c.typeLine || "Token"}</Text>
        {c.oracle && <Text as="div" className="tc-text">{c.oracle}</Text>}
      </div>
      {pt && (
        <div className="tc-pt">
          {c.power}/{c.toughness}
        </div>
      )}
    </div>
  );
}

/** Did we draw this token's art, rather than it carrying a printed card?
 *  A data: image is the tell — Scryfall art is a whole card and covers the
 *  frame instead of sitting in the art box. */
export const drawnHere = (c: Card) => c.isToken && (!c.image || c.image.startsWith("data:"));
