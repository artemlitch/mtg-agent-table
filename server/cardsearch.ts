// Card research for deck-building agents: Scryfall search / batch lookup and
// EDHREC commander pages, normalized to the handful of fields an agent
// actually reasons about, and annotated against the studio's selected deck
// (already in it? off-color? game changer?). No image urls — those are for
// the board, which hydrates separately.

import { studio } from "./deckstudio";

const UA = "mtg-agent-table/1.0";
const H = { "User-Agent": UA, Accept: "application/json" };

export interface CardInfo {
  name: string;
  mana?: string;
  mv: number;
  typeLine?: string;
  oracle?: string;
  power?: string;
  toughness?: string;
  colorIdentity: string;
  commanderLegal: boolean;
  gameChanger: boolean;
  edhrecRank?: number;
  priceUsd?: number;
  inDeck: boolean;
  offColor: boolean;
}

let fetchFn: typeof fetch = fetch;
export const setSearchFetch = (f: typeof fetch) => (fetchFn = f);

/** Color identity of the selected deck, from its Commander-category cards' pips (fallback: all deck pips). */
export function deckColorIdentity(): string | null {
  if (!studio.deckId) return null;
  const cmdrs = studio.cards.filter((c) => c.category.toLowerCase() === "commander");
  const pool = cmdrs.length ? cmdrs : studio.cards;
  const set = new Set<string>();
  for (const c of pool) {
    for (const sym of (c.mana ?? "").match(/\{([^}]+)\}/g) ?? []) {
      for (const col of sym.slice(1, -1).split("/")) if (col.length === 1 && "WUBRG".includes(col)) set.add(col);
    }
    // color indicators / oracle pips are not in the mana cost; a lookup later
    // refines this via Scryfall color_identity when the commander is searched
    for (const col of c.colorIdentity ?? []) set.add(col);
  }
  return "WUBRG".split("").filter((c) => set.has(c)).join("");
}

const inDeck = (name: string) => studio.cards.some((c) => c.name.toLowerCase() === name.toLowerCase() || c.name.toLowerCase().startsWith(name.toLowerCase() + " //"));

export function normalize(c: any): CardInfo {
  const face = c.card_faces?.[0];
  const ci = (c.color_identity ?? []).join("");
  const deckCi = deckColorIdentity();
  return {
    name: c.name,
    mana: c.mana_cost ?? face?.mana_cost,
    mv: c.cmc ?? 0,
    typeLine: c.type_line,
    oracle: c.oracle_text ?? c.card_faces?.map((f: any) => `${f.name}: ${f.oracle_text}`).join(" // "),
    power: c.power ?? face?.power,
    toughness: c.toughness ?? face?.toughness,
    colorIdentity: ci || "C",
    commanderLegal: c.legalities?.commander === "legal",
    gameChanger: !!c.game_changer,
    edhrecRank: c.edhrec_rank,
    priceUsd: c.prices?.usd ? Number(c.prices.usd) : undefined,
    inDeck: inDeck(c.name),
    offColor: deckCi !== null && [...ci].some((col) => !deckCi.includes(col)),
  };
}

export interface SearchOpts {
  q: string;
  limit?: number;
  order?: string;
  /** default true: append legal:commander and the deck's color identity */
  deckFilter?: boolean;
}

export async function cardSearch(opts: SearchOpts): Promise<{ query: string; total: number; cards: CardInfo[] }> {
  let q = opts.q.trim();
  if (opts.deckFilter !== false) {
    if (!/\blegal:/.test(q)) q += " legal:commander";
    const ci = deckColorIdentity();
    if (ci && !/\b(ci|id|identity)[:<=>]/.test(q)) q += ` ci<=${ci}`;
    if (!/\bgame:/.test(q)) q += " game:paper";
  }
  const order = opts.order ?? "edhrec";
  const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&order=${order}&unique=cards`;
  const res = await fetchFn(url, { headers: H });
  if (res.status === 404) return { query: q, total: 0, cards: [] };
  if (!res.ok) throw new Error(`scryfall search: HTTP ${res.status} ${await res.text()}`);
  const d: any = await res.json();
  const limit = Math.min(opts.limit ?? 30, 175);
  return { query: q, total: d.total_cards ?? d.data.length, cards: d.data.slice(0, limit).map(normalize) };
}

export async function cardLookup(names: string[]): Promise<{ cards: CardInfo[]; notFound: string[] }> {
  const cards: CardInfo[] = [];
  const notFound: string[] = [];
  for (let i = 0; i < names.length; i += 75) {
    const batch = names.slice(i, i + 75);
    const res = await fetchFn("https://api.scryfall.com/cards/collection", {
      method: "POST",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: batch.map((n) => ({ name: n.split(" // ")[0] })) }),
    });
    if (!res.ok) throw new Error(`scryfall collection: HTTP ${res.status} ${await res.text()}`);
    const d: any = await res.json();
    cards.push(...d.data.map(normalize));
    notFound.push(...(d.not_found ?? []).map((x: any) => x.name));
  }
  return { cards, notFound };
}

export interface EdhrecCard {
  name: string;
  inclusion: number; // fraction of decks running it
  numDecks: number;
  synergy: number;
  tag: string; // edhrec cardlist header: "High Synergy Cards", "Top Cards", "Creatures", …
  inDeck: boolean;
}

export const edhrecSlug = (name: string) =>
  name
    .split(" // ")[0]
    .toLowerCase()
    .replace(/[',.!?"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export async function edhrecCommander(commander?: string, limit = 60): Promise<{ commander: string; cards: EdhrecCard[] }> {
  const name = commander ?? studio.cards.find((c) => c.category.toLowerCase() === "commander")?.name;
  if (!name) throw new Error("no commander: pass one, or select a deck with a Commander category");
  const res = await fetchFn(`https://json.edhrec.com/pages/commanders/${edhrecSlug(name)}.json`, { headers: H });
  if (!res.ok) throw new Error(`edhrec ${edhrecSlug(name)}: HTTP ${res.status}`);
  const d: any = await res.json();
  const lists: any[] = d.container?.json_dict?.cardlists ?? [];
  const seen = new Map<string, EdhrecCard>();
  for (const list of lists) {
    for (const cv of list.cardviews ?? []) {
      if (seen.has(cv.name)) continue;
      seen.set(cv.name, {
        name: cv.name,
        inclusion: cv.potential_decks ? Math.round((cv.num_decks / cv.potential_decks) * 1000) / 10 : 0,
        numDecks: cv.num_decks ?? 0,
        synergy: Math.round((cv.synergy ?? 0) * 1000) / 10,
        tag: list.header,
        inDeck: inDeck(cv.name),
      });
    }
  }
  const cards = [...seen.values()].sort((a, b) => b.synergy - a.synergy || b.inclusion - a.inclusion).slice(0, limit);
  return { commander: name, cards };
}
