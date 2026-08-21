// Deck loading: Archidekt is the source of truth for CARDS — oracle text,
// faces, types, and the CHOSEN printing's art (uid + scryfallImageHash give
// the Scryfall CDN file directly, no API call). Scryfall's API is used only
// for what Archidekt cannot supply: token cards (all_parts) and ad-hoc
// create_token lookups.

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
  uid: string | null; // scryfall printing uuid — the printing chosen on Archidekt
  imageHash: string | null;
  imageUrl?: string | null; // custom cards: uploaded art, used verbatim
  oracle: any; // archidekt oracleCard (or one synthesized from a custom card)
  flippedDefault: boolean;
}

export interface LoadedDeck {
  deckId: number;
  name: string;
  cards: DeckCardSpec[];
}

/** The chosen printing's image straight off the Scryfall CDN — no API. */
export function cdnImg(uid: string | null, hash: string | null, side: "front" | "back" = "front"): string | undefined {
  if (!uid) return undefined;
  return `https://cards.scryfall.io/normal/${side}/${uid[0]}/${uid[1]}/${uid}.jpg${hash ? `?${hash}` : ""}`;
}

/** "Legendary Creature — God" from Archidekt's type arrays. */
function typeLineOf(o: any): string | undefined {
  const main = [...(o?.superTypes ?? []), ...(o?.types ?? [])].join(" ");
  const sub = (o?.subTypes ?? []).join(" ");
  const line = sub ? `${main} — ${sub}` : main;
  return line || undefined;
}

// layouts whose second face has its own art on the CDN's back/ path
const BACK_IMAGE_LAYOUTS = /^(modal_dfc|transform|double_faced_token|reversible_card|meld)$/;

/** The ONE mapping from an Archidekt deck entry to our card fields. Pure. */
export function buildCardInfo(spec: DeckCardSpec) {
  const o = spec.oracle ?? {};
  const faces =
    o.faces?.length
      ? o.faces.map((f: any, i: number) => ({
          name: f.name,
          image: f.imageUrl ?? cdnImg(spec.uid, spec.imageHash, i > 0 && BACK_IMAGE_LAYOUTS.test(o.layout ?? "") ? "back" : "front"),
          oracle: f.text || undefined,
          mana: f.manaCost || undefined,
          typeLine: typeLineOf(f),
          power: f.power || undefined,
          toughness: f.toughness || undefined,
        }))
      : undefined;
  const face = spec.flippedDefault && faces ? 1 : 0;
  return {
    // a DFC's name is its ACTIVE face's name — never the composite "A // B"
    name: faces?.[face]?.name ?? o.name ?? spec.name,
    image: faces?.[face]?.image ?? spec.imageUrl ?? cdnImg(spec.uid, spec.imageHash),
    oracle: o.text || faces?.map((f: any) => `${f.name}: ${f.oracle ?? ""}`).join("\n// ") || undefined,
    mana: o.manaCost || faces?.[0]?.mana || undefined,
    typeLine: faces ? faces.map((f: any) => f.typeLine).join(" // ") : typeLineOf(o),
    power: o.power || undefined,
    toughness: o.toughness || undefined,
    ...(faces ? { faces, face } : {}),
  };
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
    cards.push({
      name: entry.card.oracleCard.name,
      quantity: entry.quantity,
      // any category containing "commander" counts ("Commander", "1 Commander"…)
      isCommander: (entry.categories ?? []).some((cat: string) => /commander/i.test(cat)),
      uid: entry.card.uid ?? null,
      imageHash: entry.card.scryfallImageHash ?? null,
      oracle: entry.card.oracleCard,
      flippedDefault: !!entry.flippedDefault,
    });
  }
  // CUSTOM cards ride in a separate top-level array with their own field
  // shape (front*/back*, types as space-separated strings, uploaded art).
  // A deck's commander can live here — this one bit us.
  const words = (s: any) => String(s ?? "").split(" ").filter(Boolean);
  const customSide = (c: any, side: "front" | "back") => ({
    name: c[`${side}Name`],
    manaCost: c[`${side}ManaCost`],
    power: c[`${side}Power`],
    toughness: c[`${side}Toughness`],
    text: c[`${side}Text`],
    superTypes: words(c[`${side}SuperTypes`]),
    types: words(c[`${side}Types`]),
    subTypes: words(c[`${side}SubTypes`]),
    imageUrl: c[`${side}ImageUrl`],
  });
  for (const entry of d.customCards ?? []) {
    const primary = (entry.categories ?? [])[0];
    if (primary && included.has(primary) && !included.get(primary)) continue;
    const c = entry.card ?? {};
    const front = customSide(c, "front");
    const faces = c.hasBack ? [front, customSide(c, "back")] : undefined;
    cards.push({
      name: front.name ?? "Custom Card",
      quantity: entry.quantity ?? 1,
      isCommander: (entry.categories ?? []).some((cat: string) => /commander/i.test(cat)),
      uid: null,
      imageHash: null,
      imageUrl: c.frontImageUrl ?? null,
      oracle: { ...front, ...(faces ? { faces, layout: "transform" } : {}) },
      flippedDefault: !!entry.flippedDefault,
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

/** The ONE mapping from a raw Scryfall object to our card fields. `fb` is a
 * second raw object supplying whatever the first leaves out — a face borrowing
 * the printing's art, a card borrowing its front face's mana cost. */
function scryFace(src: any, fb: any = {}): ScryFace {
  return {
    name: src.name ?? fb.name,
    image: src.image_uris?.normal ?? fb.image_uris?.normal,
    oracle: src.oracle_text ?? fb.oracle_text,
    mana: src.mana_cost ?? fb.mana_cost,
    typeLine: src.type_line ?? fb.type_line,
    power: src.power ?? fb.power,
    toughness: src.toughness ?? fb.toughness,
  };
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
  return scryFace(match ?? c, c);
}

/** One Scryfall collection sweep over the deck's printings, solely to harvest
 * all_parts token references — the one thing Archidekt cannot supply. */
export async function harvestTokenParts(uids: string[]): Promise<Map<string, string>> {
  const parts = new Map<string, string>();
  const unique = [...new Set(uids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 75) {
    const res = await fetch("https://api.scryfall.com/cards/collection", {
      method: "POST",
      headers: SCRYFALL_HEADERS,
      body: JSON.stringify({ identifiers: unique.slice(i, i + 75).map((id) => ({ id })) }),
    });
    if (!res.ok) break;
    const data: any = await res.json();
    for (const c of data.data ?? []) {
      for (const part of c.all_parts ?? []) {
        if (part.component === "token" && !parts.has(part.name)) parts.set(part.name, part.uri);
      }
    }
  }
  return parts;
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

export async function loadPlayerDeck(player: PlayerId, deckId: number) {
  const deck = await fetchArchidektDeck(deckId);
  // token art/copy for this game's decks — the only Scryfall API involvement
  try {
    const tokenParts = await harvestTokenParts(deck.cards.map((c) => c.uid!));
    Object.assign(game.tokenCatalog, await buildTokenCatalog(tokenParts));
  } catch (e: any) {
    console.error("token catalog failed (game continues):", e.message);
  }
  const ps = game.players[player];
  ps.deckName = deck.name;
  ps.deckId = deckId;

  for (const spec of deck.cards) {
    const info = buildCardInfo(spec);
    for (let i = 0; i < spec.quantity; i++) {
      const id = newCardId();
      const card = makeCard({
        id,
        ...info,
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
  // load-time invariant, no guessing: a deck with nothing commander-categorized
  // on Archidekt gets a LOUD warning instead of a silently empty command zone
  if (ps.zones.command.length === 0) {
    addLog(
      "system",
      `⚠ "${deck.name}" has no card categorized as Commander on Archidekt — the command zone is empty. Move the commander there manually (card menu → To command zone).`
    );
  }
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
  // a DFC keeps its composite type line; everything else may fall back to the front face
  return { ...scryFace(c, c.card_faces?.[0]), typeLine: c.type_line };
}
