// Deck hydration edge cases. Network tests gated behind RUN_NET=1.
import { describe, test, expect } from "bun:test";
import { hydrateScryfall } from "../server/decks";

describe.if(!!process.env.RUN_NET)("scryfall hydration (network)", () => {
  test("adventure cards hydrate with image, mana, and type line", async () => {
    const map = await hydrateScryfall(["Murderous Rider // Swift End"]);
    const c = map.get("murderous rider // swift end");
    expect(c).toBeDefined();
    expect(c!.image).toContain("scryfall");
    expect(c!.mana).toContain("{1}{B}{B}");
    expect(c!.typeLine).toContain("Adventure");
    expect(c!.oracle).toContain("Swift End");
  }, 20000);

  test("front-face-only names hydrate too (how Archidekt sometimes sends them)", async () => {
    const map = await hydrateScryfall(["Murderous Rider"]);
    const c = [...map.values()].find((x) => x.name.startsWith("Murderous Rider"));
    expect(c).toBeDefined();
    expect(c!.image).toContain("scryfall");
  }, 20000);
});

describe.if(!!process.env.RUN_NET)("token lookup (network)", () => {
  test("Treasure resolves to an actual Treasure token, not a fuzzy mismatch", async () => {
    const { scryfallToken } = await import("../server/decks");
    const t = await scryfallToken("Treasure");
    expect(t).toBeDefined();
    expect(t!.typeLine).toContain("Treasure");
    expect(t!.image).toContain("scryfall");
  }, 20000);

  test("unknown token names return null instead of a wrong card", async () => {
    const { scryfallToken } = await import("../server/decks");
    const t = await scryfallToken("Definitely Not A Real Token Name XYZ");
    expect(t).toBeNull();
  }, 20000);
});
