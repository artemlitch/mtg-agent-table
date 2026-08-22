// Deck loading: Archidekt is the card source (offline fixture tests of the
// mapping); Scryfall network tests (token lookups) gated behind RUN_NET=1.
import { describe, test, expect } from "vitest";
import { buildCardInfo, cdnImg, pickTokenFace } from "../server/decks";

// fixtures modeled on real archidekt.com/api/decks/<id>/ payloads
const marchesaSpec = {
  name: "Marchesa, the Black Rose",
  quantity: 1,
  isCommander: true,
  uid: "ca6cf5ba-0bad-4f7d-83b9-c092c2586131",
  imageHash: "1783935881",
  flippedDefault: false,
  oracle: {
    name: "Marchesa, the Black Rose",
    manaCost: "{1}{U}{B}{R}",
    power: "3",
    toughness: "3",
    superTypes: ["Legendary"],
    types: ["Creature"],
    subTypes: ["Human", "Wizard"],
    text: "Dethrone\nOther creatures you control have dethrone.",
    layout: "normal",
  },
};

const tergridSpec = {
  name: "Tergrid, God of Fright // Tergrid's Lantern",
  quantity: 1,
  isCommander: false,
  uid: "14dc88ee-bba9-4625-af0d-89f3762a0ead",
  imageHash: "1783928244",
  flippedDefault: false,
  oracle: {
    name: "Tergrid, God of Fright // Tergrid's Lantern",
    manaCost: "",
    text: "",
    layout: "modal_dfc",
    superTypes: ["Legendary"],
    types: ["Creature"],
    subTypes: ["God"],
    faces: [
      {
        name: "Tergrid, God of Fright",
        manaCost: "{3}{B}{B}",
        power: "4",
        toughness: "5",
        superTypes: ["Legendary"],
        types: ["Creature"],
        subTypes: ["God"],
        text: "Menace\nWhenever an opponent sacrifices...",
      },
      {
        name: "Tergrid's Lantern",
        manaCost: "{3}{B}",
        power: "",
        toughness: "",
        superTypes: ["Legendary"],
        types: ["Artifact"],
        subTypes: [],
        text: "{T}: Target player loses 3 life...",
      },
    ],
  },
};

describe("buildCardInfo (archidekt → card)", () => {
  test("normal card: chosen printing's CDN art, assembled type line, oracle", () => {
    const c = buildCardInfo(marchesaSpec as any);
    expect(c.name).toBe("Marchesa, the Black Rose");
    expect(c.image).toBe(
      "https://cards.scryfall.io/normal/front/c/a/ca6cf5ba-0bad-4f7d-83b9-c092c2586131.jpg?1783935881"
    );
    expect(c.typeLine).toBe("Legendary Creature — Human Wizard");
    expect(c.mana).toBe("{1}{U}{B}{R}");
    expect(c.power).toBe("3");
    expect(c.oracle).toContain("Dethrone");
    expect(c.faces).toBeUndefined();
  });

  test("modal DFC: both faces, back face gets back/ art, name is the front face", () => {
    const c = buildCardInfo(tergridSpec as any);
    expect(c.name).toBe("Tergrid, God of Fright");
    expect(c.faces!.length).toBe(2);
    expect(c.faces![0].image).toContain("/front/");
    expect(c.faces![1].image).toContain("/back/");
    expect(c.faces![1].name).toBe("Tergrid's Lantern");
    expect(c.faces![1].typeLine).toBe("Legendary Artifact");
    expect(c.faces![1].power).toBeUndefined(); // empty string → absent
    expect(c.typeLine).toBe("Legendary Creature — God // Legendary Artifact");
    expect(c.oracle).toContain("Tergrid's Lantern:");
  });

  test("flippedDefault starts the card on its back face", () => {
    const c = buildCardInfo({ ...tergridSpec, flippedDefault: true } as any);
    expect(c.face).toBe(1);
    expect(c.name).toBe("Tergrid's Lantern");
    expect(c.image).toContain("/back/");
  });

  test("adventure/split layouts share the front image on both faces", () => {
    const spec = {
      ...tergridSpec,
      oracle: { ...tergridSpec.oracle, layout: "adventure" },
    };
    const c = buildCardInfo(spec as any);
    expect(c.faces![1].image).toContain("/front/");
  });

  test("missing uid degrades to no image, not a crash", () => {
    const c = buildCardInfo({ ...marchesaSpec, uid: null, imageHash: null } as any);
    expect(c.image).toBeUndefined();
    expect(c.name).toBe("Marchesa, the Black Rose");
  });
});

describe("cdnImg", () => {
  test("constructs the scryfall CDN path from uid shards", () => {
    expect(cdnImg("ab12", "99", "back")).toBe("https://cards.scryfall.io/normal/back/a/b/ab12.jpg?99");
    expect(cdnImg(null, "99")).toBeUndefined();
  });
});

describe.runIf(!!process.env.RUN_NET)("token lookup (network)", () => {
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

  test("harvestTokenParts finds token references for a token-making printing", async () => {
    const { harvestTokenParts } = await import("../server/decks");
    // Grave Titan (a printing that makes Zombie tokens)
    const parts = await harvestTokenParts(["3b4faa6e-5013-4c59-80f5-662a386672eb"]);
    expect([...parts.keys()].some((n) => /zombie/i.test(n))).toBe(true);
  }, 20000);
});

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

describe("commander detection", () => {
  const spec = (name, cats, extra = {}) => ({
    name, quantity: 1, isCommander: cats.some((c) => /commander/i.test(c)),
    uid: null, imageHash: null, flippedDefault: false,
    oracle: { name, superTypes: ["Legendary"], types: ["Creature"], subTypes: [], ...extra },
  });
  test("numbered commander categories count ('1 Commander' etc.)", () => {
    expect(spec("Teysa Karlov", ["1 Commander"]).isCommander).toBe(true);
    expect(spec("Teysa Karlov", ["1 Tokens"]).isCommander).toBe(false);
  });
});

describe("custom cards (separate archidekt array)", () => {
  // modeled on the real customCards entry that carried a deck's commander
  const customTeysa = {
    name: "Teysa Karlov",
    quantity: 1,
    isCommander: true, // categories: ["Commander"]
    uid: null,
    imageHash: null,
    imageUrl: "https://storage.googleapis.com/topdekt-user/images/uploads/56/teysa.png",
    flippedDefault: false,
    oracle: {
      name: "Teysa Karlov",
      manaCost: "{2}{W}{B}",
      power: "2",
      toughness: "4",
      text: "If a creature dying causes a triggered ability...",
      superTypes: ["Legendary"],
      types: ["Creature"],
      subTypes: ["Human", "Advisor"],
    },
  };
  test("custom card builds with uploaded art and assembled type line", () => {
    const c = buildCardInfo(customTeysa as any);
    expect(c.name).toBe("Teysa Karlov");
    expect(c.image).toContain("topdekt-user");
    expect(c.typeLine).toBe("Legendary Creature — Human Advisor");
    expect(c.power).toBe("2");
    expect(c.oracle).toContain("triggered ability");
  });
});
