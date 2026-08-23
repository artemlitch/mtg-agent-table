// Card art that cannot silently vanish.
//
// Deck images are built by hand from the Scryfall printing uid Archidekt gave
// us (cdnImg in server/decks.ts assembles the CDN path out of it). Scryfall
// reissues a card object now and then, and when it does that uid dies and
// every url built from it 404s — leaving a blank rectangle in your hand with
// nothing on screen or in the console to say why. Come Back Wrong (DSK #86) is
// the one that caught us; server/archidekt.ts has been carrying a note about
// it, and the same answer it uses belongs here.
//
// Scryfall's by-NAME endpoint needs no uid: it 302s to whatever art the card
// currently has, so it cannot go stale the same way. It is the API rather than
// the CDN, and rate-limited, so it is wrong for every card and exactly right
// for the few that break.
import type React from "react";

export const namedArt = (name: string, back = false) =>
  `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name.split(" // ")[0])}&format=image&version=normal${
    back ? "&face=back" : ""
  }`;

/** Spread onto an <img> whose art cannot be replaced — a token's, where
 *  `cards/named` would answer with the real card of that name rather than the
 *  token. The frame around it already carries the name, type, rules text and
 *  P/T, so the honest fallback is to take the art box away and let the drawn
 *  frame stand, instead of leaving a broken-image glyph in the middle of it. */
export const hideOnError = {
  onError: (e: React.SyntheticEvent<HTMLImageElement>) => {
    e.currentTarget.style.display = "none";
  },
};

/** Spread onto any <img> showing card art: a dead printing id falls back to
 *  the card's current art, by name. Tokens use hideOnError instead. */
export function artFallback(name?: string | null, back = false) {
  if (!name) return {};
  return {
    onError: (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      // one shot. If the by-name art fails too there is nothing left to try,
      // and re-pointing src at a url that just failed spins forever.
      if (img.dataset.namedArt) return;
      img.dataset.namedArt = "1";
      img.src = namedArt(name, back);
    },
  };
}
