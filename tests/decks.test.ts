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

describe.if(!!process.env.RUN_NET)("two-faced cards (network)", () => {
  test("MDFC hydration stores BOTH faces with their own art and text", async () => {
    const map = await hydrateScryfall(["Valakut Awakening // Valakut Stoneforge"]);
    const c = map.get("valakut awakening // valakut stoneforge")!;
    expect(c.faces).toBeDefined();
    expect(c.faces!.length).toBe(2);
    expect(c.faces![0].name).toBe("Valakut Awakening");
    expect(c.faces![1].name).toBe("Valakut Stoneforge");
    expect(c.faces![0].image).toContain("scryfall");
    expect(c.faces![1].image).toContain("scryfall");
    expect(c.faces![1].typeLine).toContain("Land");
  }, 20000);

  test("transforming DFCs also store both faces", async () => {
    const map = await hydrateScryfall(["Delver of Secrets // Insectile Aberration"]);
    const c = [...map.values()][0];
    expect(c.faces!.length).toBe(2);
    expect(c.faces![1].power).toBe("3");
  }, 20000);
});

import { pickTokenFace } from "../server/decks";

describe("pickTokenFace", () => {
  const dfcToken = {
    name: "City's Vengeance // Elemental",
    type_line: "Card // Token Creature — Elemental",
    card_faces: [
      { name: "City's Vengeance", type_line: "Card", image_uris: { normal: "https://img/front.jpg" } },
      { name: "Elemental", type_line: "Token Creature — Elemental", image_uris: { normal: "https://img/elemental.jpg" }, oracle_text: "Haste", power: "1", toughness: "1" },
    ],
  };
  test("double-faced token: picks the face matching the requested name", () => {
    const f = pickTokenFace(dfcToken as any, "Elemental");
    expect(f.image).toBe("https://img/elemental.jpg");
    expect(f.typeLine).toBe("Token Creature — Elemental");
    expect(f.power).toBe("1");
  });
  test("single-faced token passes through", () => {
    const single = { name: "Treasure", type_line: "Token Artifact — Treasure", image_uris: { normal: "https://img/t.jpg" }, oracle_text: "Sac: mana" };
    const f = pickTokenFace(single as any, "Treasure");
    expect(f.image).toBe("https://img/t.jpg");
    expect(f.name).toBe("Treasure");
  });
});
