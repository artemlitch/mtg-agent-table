// Card names in game text, drawn as links that preview on hover — the same
// idea as withMana, in the same place (<Text>) and for the same reason: a
// transform you have to remember to call is one that gets forgotten. Putting
// it here means the log line the server wrote, the stack item, the agent's
// chat message and the Brain tab all get it without anybody asking for it.
//
// Which cards a line names is game/cardnames.ts; this is only the drawing.
import { Fragment, type ReactNode } from "react";
import { cardSegments } from "../game/cardnames";
import { useUI } from "../store/ui";
import type { Card } from "../types";
import { namedArt } from "./cardArt";

function CardName({ card, children }: { card: Card; children: string }) {
  return (
    <span
      className="cardlink"
      // the same three handlers previewProps spreads, minus the import that
      // would make this module and CardPreview each other's dependency
      onMouseEnter={(e) => useUI.getState().showPreview(card, e, e.currentTarget)}
      onMouseMove={(e) => useUI.getState().movePreview(e)}
      onMouseLeave={() => useUI.getState().hidePreview()}
    >
      {children}
    </span>
  );
}

/** The text with every card name it mentions turned into a hoverable link.
 *
 *  `plain` renders the stretches BETWEEN the links — <Text> passes withMana, so
 *  the two transforms compose without either having to know about the other.
 *  Names are matched first because a card name cannot contain a mana symbol,
 *  while running mana first would bury the names inside elements. */
export function withCardLinks(text: string, plain: (s: string) => ReactNode = (s) => s): ReactNode {
  const segs = cardSegments(text, namedArt);
  if (!segs) return plain(text);
  return segs.map((s, i) =>
    typeof s === "string" ? (
      <Fragment key={i}>{plain(s)}</Fragment>
    ) : (
      <CardName key={i} card={s.card}>
        {s.name}
      </CardName>
    )
  );
}
