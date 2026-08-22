import { describe, test, expect, beforeEach } from "bun:test";
import {
  studio,
  deckMetadata,
  applyOption,
  metadataDiff,
  manaValue,
  actionsFor,
  setArchidektClient,
  restoreStudio,
  confirm,
  primePrintings,
  type StudioCard,
  type Proposal,
} from "../server/deckstudio";
import { ArchidektClient, parseDeck, toArchidektAction } from "../server/archidekt";
import { normalize, cardSearch, setSearchFetch, edhrecSlug } from "../server/cardsearch";

const card = (name: string, category: string, mana: string | undefined, typeLine: string, qty = 1, extra: Partial<StudioCard> = {}): StudioCard => ({
  name,
  category,
  mana,
  mv: manaValue(mana),
  typeLine,
  qty,
  image: `https://img/${name}.jpg`,
  ...extra,
});

const deck = () => [
  card("Marchesa, the Black Rose", "Commander", "{1}{U}{B}{R}", "Legendary Creature — Human Wizard", 1, { deckRelationId: 1, printingId: 11 }),
  card("Deadly Dispute", "Card Advantage", "{1}{B}", "Instant", 1, { deckRelationId: 2, printingId: 22 }),
  card("Word of Seizing", "Theft", "{3}{R}{R}", "Instant", 1, { deckRelationId: 3, printingId: 33 }),
  card("Island", "Land", undefined, "Basic Land — Island", 4, { deckRelationId: 4, printingId: 44 }),
  card("Valakut Awakening // Valakut Stoneforge", "Card Advantage", "{2}{R}", "Instant // Land", 1, { deckRelationId: 5, printingId: 55 }),
];

beforeEach(() => {
  restoreStudio({ deckId: 123, deckName: "YOINK", cards: deck(), proposals: [] });
});

describe("manaValue", () => {
  test("generic + pips, hybrid, X", () => {
    expect(manaValue("{1}{U}{B}{R}")).toBe(4);
    expect(manaValue("{2/W}{2/W}")).toBe(4);
    expect(manaValue("{X}{R}")).toBe(1);
    expect(manaValue(undefined)).toBe(0);
  });
});

describe("deckMetadata", () => {
  test("counts, lands, curve, categories, pips", () => {
    const m = deckMetadata(deck());
    expect(m.count).toBe(8);
    expect(m.lands).toBe(4);
    expect(m.nonlands).toBe(4);
    expect(m.categories).toEqual({ Commander: 1, "Card Advantage": 2, Theft: 1, Land: 4 });
    expect(m.curve).toEqual([0, 0, 1, 1, 1, 1, 0, 0]);
    expect(m.avgMv).toBe(3.5);
    expect(m.pips).toEqual({ U: 1, B: 2, R: 4 });
  });
  test("an MDFC whose front is a spell is not a land", () => {
    const m = deckMetadata([card("Valakut Awakening // Valakut Stoneforge", "CA", "{2}{R}", "Instant // Land")]);
    expect(m.lands).toBe(0);
  });
});

const cutProposal = (): Proposal => ({
  id: "p1",
  kind: "cut",
  why: "replaceable",
  card: deck()[1], // Deadly Dispute
  subjectCategory: "Card Advantage",
  options: [
    { name: "Fain, the Broker", category: "Utility", note: "", primary: true, card: card("Fain, the Broker", "Utility", "{2}{B}", "Legendary Creature") },
    { name: "Karn's Bastion", category: "Land", note: "", card: card("Karn's Bastion", "Land", undefined, "Land") },
  ],
  status: "open",
  createdAt: 0,
});

const addProposal = (): Proposal => ({
  id: "p2",
  kind: "add",
  why: "great",
  card: card("Volatile Stormdrake", "Theft", "{1}{U}", "Creature — Drake"),
  subjectCategory: "Theft",
  options: [
    { name: "Island", category: "Land", note: "", primary: true, card: deck()[3] },
    { name: "Word of Seizing", category: "Theft", note: "", card: deck()[2] },
  ],
  status: "open",
  createdAt: 0,
});

describe("applyOption", () => {
  test("cut: subject leaves, option joins in its own category", () => {
    const after = deckMetadata(applyOption(deck(), cutProposal(), "Fain, the Broker"));
    expect(after.count).toBe(8);
    expect(after.categories["Card Advantage"]).toBe(1);
    expect(after.categories.Utility).toBe(1);
    const diff = metadataDiff(deckMetadata(deck()), after);
    expect(diff.categories).toEqual({ "Card Advantage": [2, 1], Utility: [0, 1] });
  });
  test("add: cutting a basic decrements quantity", () => {
    const cards = applyOption(deck(), addProposal(), "Island");
    expect(cards.find((c) => c.name === "Island")!.qty).toBe(3);
    const m = deckMetadata(cards);
    expect(m.count).toBe(8);
    expect(m.lands).toBe(3);
    expect(m.categories.Theft).toBe(2);
  });
  test("unknown option / missing card throws", () => {
    expect(() => applyOption(deck(), cutProposal(), "Nope")).toThrow(/not on proposal/);
    const p = cutProposal();
    p.card = card("Gone", "X", "{1}", "Instant");
    expect(() => applyOption(deck(), p, "Fain, the Broker")).toThrow(/not in the deck/);
  });
});

describe("actionsFor", () => {
  const fakeClient = { findPrintingId: async (name: string) => (name === "Fain, the Broker" ? 999 : 0) } as unknown as ArchidektClient;
  beforeEach(() => setArchidektClient(fakeClient));

  test("cut a singleton → remove + add new printing", async () => {
    const acts = await actionsFor(cutProposal(), "Fain, the Broker");
    expect(acts).toEqual([
      { action: "remove", printingId: 22, deckRelationId: 2, category: "Card Advantage" },
      { action: "add", printingId: 999, category: "Utility", quantity: 1 },
    ]);
  });
  test("add by cutting a basic → modify qty-1", async () => {
    setArchidektClient({ findPrintingId: async () => 777 } as any);
    const acts = await actionsFor(addProposal(), "Island");
    expect(acts[0]).toEqual({ action: "modify", printingId: 44, deckRelationId: 4, category: "Land", quantity: 3 });
    expect(acts[1]).toEqual({ action: "add", printingId: 777, category: "Theft", quantity: 1 });
  });
});

describe("archidekt", () => {
  test("action objects carry deckRelationId only for modify/remove", () => {
    const add = toArchidektAction({ action: "add", printingId: 1, category: "Theft", quantity: 1 }) as any;
    expect(add.deckRelationId).toBeUndefined();
    expect(add.categories).toEqual(["Theft"]);
    expect(add.modifications.quantity).toBe(1);
    const rm = toArchidektAction({ action: "remove", printingId: 1, deckRelationId: 5, category: "Theft" }) as any;
    expect(rm.deckRelationId).toBe(5);
    const mod = toArchidektAction({ action: "modify", printingId: 1, deckRelationId: 5, category: "Land", quantity: 3 }) as any;
    expect(mod.modifications.quantity).toBe(3);
  });
  test("parseDeck excludes maybeboard categories and keeps edit ids", () => {
    const d = parseDeck({
      id: 1,
      name: "T",
      categories: [{ name: "Maybeboard", includedInDeck: false }, { name: "Theft" }],
      cards: [
        { id: 10, quantity: 1, categories: ["Theft"], card: { id: 100, oracleCard: { name: "A", cmc: 2, manaCost: "{1}{R}", types: ["Instant"], colorIdentity: ["R"] } } },
        { id: 11, quantity: 1, categories: ["Maybeboard"], card: { id: 101, oracleCard: { name: "B", cmc: 1 } } },
      ],
    });
    expect(d.cards.map((c) => [c.name, c.inDeck, c.deckRelationId, c.printingId])).toEqual([
      ["A", true, 10, 100],
      ["B", false, 11, 101],
    ]);
  });
  test("findPrintingId skips Alchemy and non-legal printings", async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          results: [
            { id: 1, uid: "u1", collectorNumber: "A-12", oracleCard: { name: "Fain, the Broker", legalities: { commander: "legal" } }, edition: { releaseDate: "2020" } },
            { id: 2, uid: "u2", collectorNumber: "12", oracleCard: { name: "Fain, the Broker", legalities: { commander: "legal" } }, edition: { releaseDate: "2022" } },
            { id: 3, uid: "u3", collectorNumber: "13", oracleCard: { name: "Fain, the Broker", legalities: { commander: "legal" } }, edition: { releaseDate: "2021" } },
          ],
        })
      )) as unknown as typeof fetch;
    const c = new ArchidektClient(fetchFn, () => ({ user: "u", pass: "p" }));
    expect(await c.findPrintingId("Fain, the Broker")).toBe(3);
  });
});

describe("cardsearch", () => {
  test("normalize flags inDeck/offColor against the studio deck", () => {
    const n = normalize({ name: "Deadly Dispute", cmc: 2, mana_cost: "{1}{B}", color_identity: ["B"], legalities: { commander: "legal" }, game_changer: false });
    expect(n.inDeck).toBe(true);
    expect(n.offColor).toBe(false);
    const g = normalize({ name: "Sol Ring", cmc: 1, color_identity: ["G"], legalities: { commander: "legal" } });
    expect(g.offColor).toBe(true);
    expect(g.inDeck).toBe(false);
  });
  test("cardSearch scopes to commander legality + deck colors", async () => {
    let url = "";
    setSearchFetch((async (u: any) => {
      url = String(u);
      return new Response(JSON.stringify({ total_cards: 0, data: [] }));
    }) as any);
    const r = await cardSearch({ q: "otag:theft" });
    expect(r.query).toBe("otag:theft legal:commander ci<=UBR game:paper");
    expect(decodeURIComponent(url)).toContain("ci<=UBR");
    const raw = await cardSearch({ q: "otag:theft", deckFilter: false });
    expect(raw.query).toBe("otag:theft");
  });
  test("edhrec slug", () => {
    expect(edhrecSlug("Marchesa, the Black Rose")).toBe("marchesa-the-black-rose");
    expect(edhrecSlug("Kotis, the Fangkeeper")).toBe("kotis-the-fangkeeper");
  });
});

describe("confirm", () => {
  const raw = (id: number, cardId: number, name: string, cat: string, qty = 1, cmc = 2) => ({ id, quantity: qty, categories: [cat], card: { id: cardId, uid: "44c1a862-00fc-4e79-a83a-289fef81503a", scryfallImageHash: "123", oracleCard: { name, cmc, types: ["Instant"] } } });
  const baseDeck = () => ({
    id: 123, name: "YOINK", categories: [],
    cards: [raw(1, 11, "Marchesa, the Black Rose", "Commander"), raw(2, 22, "Deadly Dispute", "Card Advantage"), raw(3, 33, "Word of Seizing", "Theft"), raw(4, 44, "Island", "Land", 4), raw(5, 55, "Valakut Awakening // Valakut Stoneforge", "Card Advantage")],
  });
  beforeEach(() => {
    primePrintings(["Fain, the Broker", "Karn's Bastion"].map((n, i) => ({ printingId: 900 + i, name: n, image: `https://img/${n}`, mv: 1, colorIdentity: [], commanderLegal: true, gameChanger: false })));
  });

  test("re-reads Archidekt, writes remove+add, marks applied", async () => {
    const writes: any[] = [];
    let current = baseDeck();
    setArchidektClient({
      getDeck: async () => parseDeck(current),
      findPrintingId: async () => 999,
      modifyCards: async (_id: number, actions: any[]) => {
        writes.push(actions);
        current = { ...current, cards: [...current.cards.filter((c) => c.id !== 2), raw(6, 999, "Fain, the Broker", "Utility")] };
        return { add: [] };
      },
    } as any);
    studio.proposals.push(cutProposal());
    const p = await confirm("p1");
    expect(p.status).toBe("applied");
    expect(p.chosen).toBe("Fain, the Broker");
    expect(writes[0].map((a: any) => a.action)).toEqual(["remove", "add"]);
    expect(studio.cards.some((c) => c.name === "Fain, the Broker")).toBe(true);
    expect(studio.cards.some((c) => c.name === "Deadly Dispute")).toBe(false);
  });

  test("refuses when the card already left the deck on Archidekt — nothing written", async () => {
    const writes: any[] = [];
    const gone = baseDeck();
    gone.cards = gone.cards.filter((c) => c.id !== 2); // Deadly Dispute removed on the site
    setArchidektClient({ getDeck: async () => parseDeck(gone), findPrintingId: async () => 999, modifyCards: async (_: any, a: any) => writes.push(a) } as any);
    studio.proposals.push(cutProposal());
    await expect(confirm("p1")).rejects.toThrow(/deck changed on Archidekt/);
    expect(writes.length).toBe(0);
    expect(studio.proposals[0].status).toBe("dismissed");
  });

  test("post-write count mismatch surfaces as an error", async () => {
    let current = baseDeck();
    setArchidektClient({
      getDeck: async () => parseDeck(current),
      findPrintingId: async () => 999,
      modifyCards: async () => {
        current = { ...current, cards: current.cards.filter((c) => c.id !== 2) }; // removed but add never landed
        return {};
      },
    } as any);
    studio.proposals.push(cutProposal());
    await expect(confirm("p1")).rejects.toThrow(/expected 8/);
    expect(studio.proposals[0].status).toBe("open");
  });
});

describe("parsePrinting", () => {
  test("builds the Scryfall CDN url from uid + hash and reads DFC faces", () => {
    const { parsePrinting } = require("../server/archidekt");
    const p = parsePrinting({
      id: 7, uid: "44c1a862-00fc-4e79-a83a-289fef81503a", scryfallImageHash: "1783935360",
      oracleCard: { name: "Valakut Awakening // Valakut Stoneforge", cmc: 3, manaCost: "", layout: "modal_dfc", colorIdentity: ["R"], legalities: { commander: "legal" }, gameChanger: false,
        faces: [{ name: "Valakut Awakening", manaCost: "{2}{R}", types: ["Instant"], text: "Put any number" }, { name: "Valakut Stoneforge", manaCost: "", types: ["Land"], text: "T: add R" }] },
    });
    expect(p.image).toBe("https://cards.scryfall.io/normal/front/4/4/44c1a862-00fc-4e79-a83a-289fef81503a.jpg?1783935360");
    expect(p.mana).toBe("{2}{R}");
    expect(p.typeLine).toBe("Instant // Land");
    expect(p.oracle).toContain("Valakut Stoneforge: T: add R");
    expect(p.mv).toBe(3);
  });
});
