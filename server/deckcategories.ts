// Which Archidekt categories are actually part of a deck.
//
// Two rules, and the second one is the surprise:
//
//   1. A category can be flagged `includedInDeck: false` — Archidekt's own
//      "don't count this" toggle. Those cards are out.
//   2. Sideboard and Maybeboard are out no matter what that flag says. They are
//      holding pens for cards you are thinking about, and Commander has no
//      sideboard to play with. The toggle is per-deck and owners do flip it:
//      deck 20926601 ships a 24-card Sideboard marked as included, so Archidekt
//      counts it as a 124-card deck and the table dealt those cards into the
//      opponent's library.
//
// Rule 2 costs a deck that deliberately names a real category "Sideboard" —
// which no Commander deck does, since the word means the opposite there.
const NEVER_IN_DECK = new Set(["sideboard", "maybeboard"]);

export function isHoldingPen(category: string | undefined | null): boolean {
  return !!category && NEVER_IN_DECK.has(category.trim().toLowerCase());
}

/** True when cards whose primary category is `category` belong in the deck.
 * `included` maps a category name to its Archidekt includedInDeck flag. */
export function categoryInDeck(category: string | undefined | null, included: Map<string, boolean>): boolean {
  if (!category) return true; // uncategorised cards are in the deck
  if (isHoldingPen(category)) return false;
  return included.get(category) !== false;
}
