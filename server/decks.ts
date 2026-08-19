// Deck loading: Archidekt (public read, no auth) + Scryfall hydration.

import { game, newCardId, makeCard, shuffleZone, addLog, type PlayerId } from "./game";

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

interface ScryFace {
  name: string;
  image?: string;
  oracle?: string;
  mana?: string;
  typeLine?: string;
  power?: string;
  toughness?: string;
}

interface ScryCard extends ScryFace {
  faces?: ScryFace[];
}

/**
 * From a RAW Scryfall card object, pick the face that IS the requested token.
 * Double-faced token printings (art card // token, or token // token) would
 * otherwise render their front face — the "City's Vengeance as an Elemental" bug.
 */
export function pickTokenFace(c: any, name: string): ScryFace {
  const want = name.toLowerCase();
  const faces: any[] = c.card_faces ?? [];
  const match =
    faces.find((f) => f.name?.toLowerCase() === want) ??
    faces.find((f) => /\btoken\b/i.test(f.type_line ?? "")) ??
    null;
  const src = match ?? c;
  return {
    name: src.name ?? c.name,
    image: src.image_uris?.normal ?? c.image_uris?.normal,
    oracle: src.oracle_text ?? c.oracle_text,
    mana: src.mana_cost ?? c.mana_cost,
    typeLine: src.type_line ?? c.type_line,
    power: src.power ?? c.power,
    toughness: src.toughness ?? c.toughness,
  };
}

/** Fetch full token cards for all_parts references and key them by lowercase token name. */
export async function buildTokenCatalog(parts: Map<string, string>): Promise<Record<string, ScryFace>> {
  const out: Record<string, ScryFace> = {};
  for (const [name, uri] of parts) {
    try {
      const res = await fetch(uri, {
        headers: { "User-Agent": SCRYFALL_HEADERS["User-Agent"], Accept: "application/json" },
      });
      if (!res.ok) continue;
      const face = pickTokenFace(await res.json(), name);
      out[name.toLowerCase()] = { ...face, name };
    } catch {}
  }
  return out;
}

export async function hydrateScryfall(
  names: string[],
  tokenParts?: Map<string, string>
): Promise<Map<string, ScryCard>> {
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
      if (tokenParts) {
        for (const part of c.all_parts ?? []) {
          if (part.component === "token" && !tokenParts.has(part.name)) {
            tokenParts.set(part.name, part.uri);
          }
        }
      }
      const face = c.card_faces?.[0];
      // two-faced cards: keep every face with its own art and text
      const faces: ScryFace[] | undefined = c.card_faces?.length
        ? c.card_faces.map((f: any) => ({
            name: f.name,
            // transforming DFCs have per-face art; split/adventure cards share one image
            image: f.image_uris?.normal ?? c.image_uris?.normal,
            oracle: f.oracle_text,
            mana: f.mana_cost,
            typeLine: f.type_line,
            power: f.power,
            toughness: f.toughness,
          }))
        : undefined;
      out.set((c.name as string).toLowerCase(), {
        name: c.name,
        image: c.image_uris?.normal ?? face?.image_uris?.normal,
        oracle: c.oracle_text ?? c.card_faces?.map((f: any) => `${f.name}: ${f.oracle_text}`).join("\n// "),
        mana: c.mana_cost ?? face?.mana_cost,
        typeLine: c.type_line,
        power: c.power ?? face?.power,
        toughness: c.toughness ?? face?.toughness,
        ...(faces ? { faces } : {}),
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
  const tokenParts = new Map<string, string>();
  const scry = await hydrateScryfall(deck.cards.map((c) => c.name), tokenParts);
  // the deck's own token printings become this game's token art/copy
  Object.assign(game.tokenCatalog, await buildTokenCatalog(tokenParts));
  const ps = game.players[player];
  ps.deckName = deck.name;
  ps.deckId = deckId;

  for (const spec of deck.cards) {
    const info = lookup(scry, spec.name);
    for (let i = 0; i < spec.quantity; i++) {
      const id = newCardId();
      const card = makeCard({
        id,
        // a DFC's name is its ACTIVE face's name (front at load) — never the
        // composite "A // B"; the composite survives only inside faces[]
        name: info.faces?.[0]?.name ?? info.name ?? spec.name,
        image: info.image,
        oracle: info.oracle,
        mana: info.mana,
        typeLine: info.typeLine,
        power: info.power,
        toughness: info.toughness,
        ...(info.faces ? { faces: info.faces, face: 0 } : {}),
        owner: player,
        controller: player,
        zone: spec.isCommander ? "command" : "library",
        isCommander: spec.isCommander,
      });
      game.cards[id] = card;
      ps.zones[card.zone].push(id);
    }
  }
  shuffleZone(player);
  const total = ps.zones.library.length + ps.zones.command.length;
  addLog("system", `${player === "you" ? "Artem" : "Agent"} loaded "${deck.name}" (${total} cards)`);
  return deck;
}

/** Exact-name token lookup (Treasure, Clue, Food, …). Returns null when no token matches. */
export async function scryfallToken(name: string): Promise<ScryCard | null> {
  const q = encodeURIComponent(`!"${name}" t:token`);
  const res = await fetch(`https://api.scryfall.com/cards/search?q=${q}&unique=cards`, {
    headers: { "User-Agent": SCRYFALL_HEADERS["User-Agent"], Accept: "application/json" },
  });
  if (!res.ok) return null;
  const data: any = await res.json();
  const results: any[] = data.data ?? [];
  if (!results.length) return null;
  // prefer a single-faced printing named exactly right; else face-match a DFC
  const single = results.find(
    (c) => !c.card_faces?.length && c.name?.toLowerCase() === name.toLowerCase()
  );
  const face = pickTokenFace(single ?? results[0], name);
  return { ...face, name };
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
