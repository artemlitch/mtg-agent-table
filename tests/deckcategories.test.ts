import { describe, test, expect } from "vitest";
import { categoryInDeck, isHoldingPen } from "../server/deckcategories";
import { parseDeck } from "../server/archidekt";

const included = (pairs: [string, boolean][]) => new Map(pairs);

describe("which Archidekt categories are part of a deck", () => {
  test("an uncategorised card is in the deck", () => {
    expect(categoryInDeck(undefined, included([]))).toBe(true);
    expect(categoryInDeck("", included([]))).toBe(true);
  });

  test("a category toggled off is out", () => {
    expect(categoryInDeck("Maybeboard", included([["Maybeboard", false]]))).toBe(false);
    expect(categoryInDeck("Theft", included([["Theft", false]]))).toBe(false);
  });

  test("a normal category is in", () => {
    expect(categoryInDeck("Ramp", included([["Ramp", true]]))).toBe(true);
    expect(categoryInDeck("Ramp", included([]))).toBe(true); // unknown category: in
  });

  test("sideboard and maybeboard are out even when the owner marked them included", () => {
    expect(categoryInDeck("Sideboard", included([["Sideboard", true]]))).toBe(false);
    expect(categoryInDeck("Maybeboard", included([["Maybeboard", true]]))).toBe(false);
    // however they are spelled
    expect(categoryInDeck("sideboard", included([["sideboard", true]]))).toBe(false);
    expect(categoryInDeck("  Maybeboard  ", included([]))).toBe(false);
    expect(isHoldingPen("SIDEBOARD")).toBe(true);
    expect(isHoldingPen("Sideboard tech")).toBe(false); // only the exact name
  });
});

describe("parseDeck (the studio's reader)", () => {
  // the shape that started this: archidekt deck 20926601 counts a 24-card
  // sideboard as part of a 124-card deck
  const deck = {
    id: 20926601,
    name: "She Mulled on my Drotha till I Gravetide",
    categories: [
      { name: "Land", includedInDeck: true },
      { name: "Sideboard", includedInDeck: true },
      { name: "Maybeboard", includedInDeck: false },
    ],
    cards: [
      { id: 1, quantity: 1, categories: ["Land"], card: { id: 10, oracleCard: { name: "Swamp", cmc: 0 } } },
      { id: 2, quantity: 1, categories: ["Sideboard"], card: { id: 11, oracleCard: { name: "Duress", cmc: 1 } } },
      { id: 3, quantity: 1, categories: ["Maybeboard"], card: { id: 12, oracleCard: { name: "Doom Blade", cmc: 2 } } },
      { id: 4, quantity: 1, categories: [], card: { id: 13, oracleCard: { name: "Sol Ring", cmc: 1 } } },
    ],
  };

  test("keeps the deck, drops both holding pens", () => {
    const parsed = parseDeck(deck);
    const inDeck = parsed.cards.filter((c) => c.inDeck).map((c) => c.name);
    expect(inDeck).toEqual(["Swamp", "Sol Ring"]);
    const out = parsed.cards.filter((c) => !c.inDeck).map((c) => c.name);
    expect(out).toEqual(["Duress", "Doom Blade"]);
  });
});
