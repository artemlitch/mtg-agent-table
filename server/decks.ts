// Deck loading: Archidekt (public read, no auth) + Scryfall hydration.

import { game, newCardId, shuffleZone, addLog, type PlayerId, type Card } from "./game";

const SCRYFALL_HEADERS = {
  "User-Agent": "mtg-agent-table/1.0",
  Accept: "application/json",
  "Content-Type": "application/json",
};

interface DeckCardSpec {
  name: string;
  quantity: number;
  isCommander: boolean;
}

export interface LoadedDeck {
  deckId: number;
  name: string;
  cards: DeckCardSpec[];
}

export async function fetchArchidektDeck(deckId: number): Promise<LoadedDeck> {
  const res = await fetch(`https://archidekt.com/api/decks/${deckId}/`, {
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`archidekt deck ${deckId}: HTTP ${res.status}`);
  const d: any = await res.json();
  const included = new Map<string, boolean>();
  for (const c of d.categories ?? []) included.set(c.name, c.includedInDeck !== false);
  const cards: DeckCardSpec[] = [];
  for (const entry of d.cards) {
    const primary = (entry.categories ?? [])[0];
    if (primary && included.has(primary) && !included.get(primary)) continue; // maybeboard etc.
    const name = entry.card.oracleCard.name;
    cards.push({
      name,
      quantity: entry.quantity,
      isCommander: primary === "Commander",
    });
  }
  return { deckId, name: d.name, cards };
}

interface ScryCard {
  name: string;
  image?: string;
  oracle?: string;
  mana?: string;
  typeLine?: string;
  power?: string;
  toughness?: string;
}

export async function hydrateScryfall(names: string[]): Promise<Map<string, ScryCard>> {
  const out = new Map<string, ScryCard>();
  const unique = [...new Set(names)];
  for (let i = 0; i < unique.length; i += 75) {
    const batch = unique.slice(i, i + 75);
    const res = await fetch("https://api.scryfall.com/cards/collection", {
      method: "POST",
      headers: SCRYFALL_HEADERS,
      // collection matches front-face names, not "A // B" composites
      body: JSON.stringify({ identifiers: batch.map((name) => ({ name: name.split(" // ")[0] })) }),
    });
    if (!res.ok) throw new Error(`scryfall collection: HTTP ${res.status} ${await res.text()}`);
    const data: any = await res.json();
    for (const c of data.data) {
      const face = c.card_faces?.[0];
      out.set((c.name as string).toLowerCase(), {
        name: c.name,
        image: c.image_uris?.normal ?? face?.image_uris?.normal,
        oracle: c.oracle_text ?? c.card_faces?.map((f: any) => `${f.name}: ${f.oracle_text}`).join("\n// "),
        mana: c.mana_cost ?? face?.mana_cost,
        typeLine: c.type_line,
        power: c.power ?? face?.power,
        toughness: c.toughness ?? face?.toughness,
      });
    }
    for (const nf of data.not_found ?? []) console.error("scryfall not found:", nf);
  }
  return out;
}

function lookup(scry: Map<string, ScryCard>, name: string): ScryCard {
  const hit =
    scry.get(name.toLowerCase()) ??
    // archidekt gives front-face names for DFCs; scryfall returns "Front // Back"
    [...scry.values()].find((c) => c.name.toLowerCase().startsWith(name.toLowerCase() + " //"));
  return hit ?? { name };
}

export async function loadPlayerDeck(player: PlayerId, deckId: number) {
  const deck = await fetchArchidektDeck(deckId);
  const scry = await hydrateScryfall(deck.cards.map((c) => c.name));
  const ps = game.players[player];
  ps.deckName = deck.name;
  ps.deckId = deckId;

  for (const spec of deck.cards) {
    const info = lookup(scry, spec.name);
    for (let i = 0; i < spec.quantity; i++) {
      const id = newCardId();
      const card: Card = {
        id,
        name: info.name ?? spec.name,
        image: info.image,
        oracle: info.oracle,
        mana: info.mana,
        typeLine: info.typeLine,
        power: info.power,
        toughness: info.toughness,
        owner: player,
        controller: player,
        zone: spec.isCommander ? "command" : "library",
        tapped: false,
        faceDown: false,
        counters: {},
        attachedTo: null,
        isToken: false,
        isCommander: spec.isCommander,
        visibleTo: [],
        attacking: null,
        blocking: null,
      };
      game.cards[id] = card;
      ps.zones[card.zone].push(id);
    }
  }
  shuffleZone(player);
  const total = ps.zones.library.length + ps.zones.command.length;
  addLog("system", `${player === "you" ? "Artem" : "Agent"} loaded "${deck.name}" (${total} cards)`);
  return deck;
}

/** Resolve a token/card image by fuzzy name, for create_token. */
export async function scryfallNamed(name: string): Promise<ScryCard | null> {
  const res = await fetch(
    `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`,
    { headers: { "User-Agent": SCRYFALL_HEADERS["User-Agent"], Accept: "application/json" } }
  );
  if (!res.ok) return null;
  const c: any = await res.json();
  const face = c.card_faces?.[0];
  return {
    name: c.name,
    image: c.image_uris?.normal ?? face?.image_uris?.normal,
    oracle: c.oracle_text ?? face?.oracle_text,
    mana: c.mana_cost ?? face?.mana_cost,
    typeLine: c.type_line,
    power: c.power ?? face?.power,
    toughness: c.toughness ?? face?.toughness,
  };
}
