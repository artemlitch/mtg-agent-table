// Authed Archidekt client for the deck studio: list my decks, read a deck with
// the ids needed to edit it, resolve printings, and PATCH card changes.
// Endpoints reverse-engineered in ~/.claude/skills/archidekt/SKILL.md.
//
// Credentials: ARCHIDEKT_USER / ARCHIDEKT_PASS env vars, else parsed from that
// SKILL.md so no secret has to live in this repo.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const BASE = "https://archidekt.com/api";
const UA = "mtg-agent-table/1.0";

/** One printing, as Archidekt describes it — enough to render and reason about. */
export interface ArchidektPrinting {
  printingId: number;
  name: string; // oracle name; "A // B" for double-faced cards
  image?: string; // Scryfall CDN url for THIS printing (built from uid + hash)
  mv: number;
  mana?: string;
  typeLine?: string;
  oracle?: string;
  colorIdentity: string[];
  commanderLegal: boolean;
  gameChanger: boolean;
  edhrecRank?: number;
}

export interface ArchidektCard extends ArchidektPrinting {
  deckRelationId: number;
  quantity: number;
  category: string; // primary category ("" if none)
  categories: string[];
  inDeck: boolean; // false for maybeboard/sideboard categories
}

export interface ArchidektDeck {
  id: number;
  name: string;
  categories: { name: string; includedInDeck: boolean }[];
  cards: ArchidektCard[];
}

export interface DeckSummary {
  id: number;
  name: string;
}

export type CardAction =
  | { action: "add"; printingId: number; category: string; quantity?: number }
  | { action: "modify"; printingId: number; deckRelationId: number; category: string; quantity: number }
  | { action: "remove"; printingId: number; deckRelationId: number; category: string };

export function credentialsFromSkill(path = `${homedir()}/.claude/skills/archidekt/SKILL.md`) {
  const user = process.env.ARCHIDEKT_USER;
  const pass = process.env.ARCHIDEKT_PASS;
  if (user && pass) return { user, pass };
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error("no Archidekt credentials: set ARCHIDEKT_USER/ARCHIDEKT_PASS or install the archidekt skill");
  }
  const u = text.match(/^- username: `([^`]+)`/m)?.[1];
  const p = text.match(/^- password: `([^`]+)`/m)?.[1];
  if (!u || !p) throw new Error("could not parse credentials from archidekt SKILL.md");
  return { user: u, pass: p };
}

export class ArchidektClient {
  private token: string | null = null;
  private tokenAt = 0;
  private decks: DeckSummary[] = [];
  // injectable for tests
  constructor(private fetchFn: typeof fetch = fetch, private creds: () => { user: string; pass: string } = credentialsFromSkill) {}

  private async login() {
    const { user, pass } = this.creds();
    const res = await this.fetchFn(`${BASE}/rest-auth/login/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
      body: JSON.stringify({ username: user, password: pass }),
    });
    if (!res.ok) throw new Error(`archidekt login: HTTP ${res.status} ${await res.text()}`);
    const d: any = await res.json();
    this.token = d.access_token;
    this.tokenAt = Date.now();
    this.decks = (d.user?.decks ?? []).map((x: any) => ({ id: x.id, name: x.name }));
  }

  private async authed(): Promise<string> {
    // JWT lives 1h; refresh endpoint is broken, so re-login at 50 min
    if (!this.token || Date.now() - this.tokenAt > 50 * 60_000) await this.login();
    return this.token!;
  }

  async listMyDecks(): Promise<DeckSummary[]> {
    await this.authed();
    if (!this.decks.length) await this.login();
    return [...this.decks].sort((a, b) => a.name.localeCompare(b.name));
  }

  async getDeck(id: number): Promise<ArchidektDeck> {
    const res = await this.fetchFn(`${BASE}/decks/${id}/`, {
      headers: { Accept: "application/json", "User-Agent": UA },
    });
    if (!res.ok) throw new Error(`archidekt deck ${id}: HTTP ${res.status}`);
    return parseDeck(await res.json());
  }

  /** A commander-legal, non-Alchemy printing for an exact name (front face
   * accepted for DFCs). Deterministic: oldest release. Null if none. */
  async findPrinting(name: string): Promise<ArchidektPrinting | null> {
    const front = name.split(" // ")[0].toLowerCase();
    const res = await this.fetchFn(`${BASE}/cards/v2/?name=${encodeURIComponent(front)}`, {
      headers: { Accept: "application/json", "User-Agent": UA },
    });
    if (!res.ok) throw new Error(`archidekt card search "${name}": HTTP ${res.status}`);
    const d: any = await res.json();
    const hits = (d.results ?? []).filter((c: any) => {
      const n = String(c.oracleCard?.name ?? "").toLowerCase();
      return (
        (n === front || n.startsWith(front + " //")) &&
        !String(c.collectorNumber ?? "").startsWith("A-") &&
        c.oracleCard?.legalities?.commander === "legal" &&
        c.uid
      );
    });
    if (!hits.length) return null;
    hits.sort((a: any, b: any) => String(a.releasedAt ?? a.edition?.releaseDate ?? "").localeCompare(String(b.releasedAt ?? b.edition?.releaseDate ?? "")));
    return parsePrinting(hits[0]);
  }

  async findPrintingId(name: string): Promise<number> {
    const p = await this.findPrinting(name);
    if (!p) throw new Error(`no commander-legal Archidekt printing for "${name}"`);
    return p.printingId;
  }

  async modifyCards(deckId: number, actions: CardAction[]): Promise<any> {
    const token = await this.authed();
    const body = { cards: actions.map(toArchidektAction) };
    const res = await this.fetchFn(`${BASE}/decks/${deckId}/modifyCards/v2/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA, Authorization: `JWT ${token}` },
      body: JSON.stringify(body),
    });
    if (res.status === 401) {
      this.token = null;
      throw new Error("archidekt: token rejected (401) — retry");
    }
    if (!res.ok) throw new Error(`archidekt modifyCards: HTTP ${res.status} ${await res.text()}`);
    return await res.json();
  }
}

let patchSeq = 0;
export function toArchidektAction(a: CardAction) {
  const base = {
    action: a.action,
    cardid: a.printingId,
    customCardId: null,
    categories: [a.category],
    patchId: `p${Date.now()}-${++patchSeq}`,
    modifications: {
      quantity: a.action === "remove" ? 1 : a.quantity ?? 1,
      modifier: "Normal",
      customCmc: null,
      companion: false,
      flippedDefault: false,
      label: "",
    },
  };
  return a.action === "add" ? base : { ...base, deckRelationId: a.deckRelationId };
}

/** Card art via Scryfall's name-keyed redirect. Archidekt's stored Scryfall
 * uids go stale when Scryfall reissues a card object (Come Back Wrong, DSK #86
 * 404s), so a uid-built CDN url can silently break; the exact-name endpoint
 * 302s to the current image and can't. Front face for DFCs. */
export const imageUrl = (name: string) =>
  `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name.split(" // ")[0])}&format=image&version=normal`;

const typeLineOf = (oc: any) =>
  [oc.superTypes, oc.types].flat().filter(Boolean).join(" ") + (oc.subTypes?.length ? ` — ${oc.subTypes.join(" ")}` : "");

/** Raw printing object (deck entry's `card`, or a /cards/v2 result) → ArchidektPrinting. */
export function parsePrinting(c: any): ArchidektPrinting {
  const oc = c?.oracleCard ?? {};
  const faces: any[] = oc.faces ?? [];
  return {
    printingId: c.id,
    name: oc.name,
    image: oc.name ? imageUrl(oc.name) : undefined,
    mv: Number(oc.cmc ?? 0),
    mana: oc.manaCost || faces[0]?.manaCost || undefined,
    typeLine: faces.length ? faces.map((f) => typeLineOf(f)).filter(Boolean).join(" // ") || typeLineOf(oc) : typeLineOf(oc),
    oracle: oc.text || (faces.length ? faces.map((f) => `${f.name}: ${f.text ?? ""}`).join("\n// ") : undefined),
    colorIdentity: oc.colorIdentity ?? oc.colors ?? [],
    commanderLegal: oc.legalities?.commander === "legal",
    gameChanger: !!oc.gameChanger,
    edhrecRank: oc.edhrecRank ?? undefined,
  };
}

export function parseDeck(d: any): ArchidektDeck {
  const categories = (d.categories ?? []).map((c: any) => ({ name: c.name, includedInDeck: c.includedInDeck !== false }));
  const included = new Map(categories.map((c: any) => [c.name, c.includedInDeck]));
  const cards: ArchidektCard[] = (d.cards ?? []).map((e: any) => {
    const cats: string[] = e.categories ?? [];
    const primary = cats[0] ?? "";
    return {
      ...parsePrinting(e.card ?? {}),
      deckRelationId: e.id,
      quantity: e.quantity ?? 1,
      category: primary,
      categories: cats,
      inDeck: primary ? included.get(primary) !== false : true,
    };
  });
  return { id: d.id, name: d.name, categories, cards };
}
