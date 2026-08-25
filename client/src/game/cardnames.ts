// Finding the cards a line of game text is talking about.
//
// The names come from the cards in the GAME, not from a card database. Every
// name the server writes it looked up first — publicDesc(getCard(id)) — so the
// live view is a superset of what can turn up in a log line, and the same pass
// catches names the agent typed into chat for free.
//
// This half knows nothing about React: it turns a string into a list of plain
// stretches and named cards, and components/CardLink.tsx draws the result.
import { gameView } from "../store/game";
import type { Card, PlayerId } from "../types";

/** Which copy to point at when several cards share a name — the one the
 *  sentence is most likely about. Combat, triggers and targets are all talking
 *  about the table. */
const RANK: Record<string, number> = { battlefield: 0, stack: 1, graveyard: 2, exile: 3, command: 4, hand: 5, library: 6 };

const ESC = /[.*+?^${}()|[\]\\]/g;
/** Written as `[[Card Name]]` — how the agent names a card that is not in the
 *  game at all (still in a library, in a decklist, one it is speculating
 *  about). The only part of this the agent has to know. */
const EXPLICIT = String.raw`\[\[[^\]\n]{1,80}\]\]`;

/** Every way a card gets named in practice, most specific first.
 *
 *  Nobody writes "Marchesa, the Black Rose" three times in a sentence — they
 *  write Marchesa. Shorthand is how people actually talk, so short forms are
 *  indexed too and long ones are matched first, which means writing a name out
 *  in full still wins wherever it appears.
 *
 *  Deliberately loose at the edges: pointing at the wrong card still shows you
 *  a card, and showing nothing shows you nothing. */
export function aliases(card: Card): string[] {
  const out: string[] = [];
  const push = (s?: string) => {
    const n = s?.trim();
    if (n && n.length >= 3 && !out.includes(n)) out.push(n);
  };
  push(card.name);
  for (const f of card.faces ?? []) push(f.name);
  for (const n of [...out]) {
    // "Tergrid, God of Fright" → Tergrid: the legendary comma is the one
    // abbreviation Magic players make without thinking about it
    if (n.includes(",")) push(n.slice(0, n.indexOf(",")));
    // "Carrion Feeder" → Carrion
    const first = n.split(/\s+/)[0];
    if (n.includes(" ") && first.length >= 4) push(first);
  }
  return out;
}

let cache: { seq: number; re: RegExp | null; by: Map<string, Card> } | null = null;

/** name → the card to show for it, and one regex that finds any of them.
 *
 *  Rebuilt when the table changes. Not for the sake of the search — a game
 *  holds a couple of hundred cards and scanning those is nothing. It is that
 *  <Text> runs on every log line, stack item and message on screen, hundreds
 *  of times over, and compiling a regex of every card name that often is the
 *  only part of this that would cost anything. */
function index() {
  const v = gameView();
  if (!v) return { seq: -1, re: null as RegExp | null, by: new Map<string, Card>() };
  if (cache?.seq === v.seq) return cache;

  const by = new Map<string, Card>();
  const rank = (c: Card) => RANK[c.zone] ?? 9;
  for (const p of ["you", "agent"] as PlayerId[])
    for (const zone of Object.values(v.players[p].zones))
      for (const c of zone) {
        // a card you are not allowed to know about must not become a link
        // that shows it to you
        if (c.hidden) continue;
        for (const n of aliases(c)) {
          const cur = by.get(n);
          if (!cur || rank(c) < rank(cur)) by.set(n, c);
        }
      }

  // longest first, so "Marchesa, the Black Rose" is matched whole rather than
  // as the shorthand that is a prefix of it
  const names = [...by.keys()].sort((a, b) => b.length - a.length).map((n) => n.replace(ESC, "\\$&"));
  // the guards keep a name from matching inside a longer word. Matching is
  // case-exact, which is what keeps "the plains" scenery and "Plains" a land.
  const re = new RegExp(names.length ? `${EXPLICIT}|(?<![\\w'])(?:${names.join("|")})(?![\\w])` : EXPLICIT, "g");
  cache = { seq: v.seq, re, by };
  return cache;
}

/** A card named in text that is not in the game. Art is fetched by name (see
 *  namedArt), so it previews like anything else; CardPreviewLayer looks the
 *  live card up by id and falls back to this snapshot, and no real card has
 *  an id shaped like this. */
function ghost(name: string, image: string): Card {
  return {
    id: `link:${name}`, zone: "library", owner: "agent", controller: "agent",
    tapped: false, faceDown: false, counters: {}, under: null,
    isToken: false, isCommander: false, attacking: null, blocking: null,
    name, image,
  };
}

/** One stretch of a line: either plain text, or a card the text named. */
export type Segment = string | { name: string; card: Card };

/** Split a line into plain stretches and the cards it names. Returns null when
 *  it named none, so the caller can keep the string it already had. */
export function cardSegments(text: string, art: (name: string) => string): Segment[] | null {
  const { re, by } = index();
  if (!text || !re) return null;
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const explicit = m[0].startsWith("[[");
    const name = explicit ? m[0].slice(2, -2).trim() : m[0];
    const card = by.get(name) ?? (explicit ? ghost(name, art(name)) : null);
    if (!card) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ name, card });
    last = m.index + m[0].length;
  }
  if (!out.length) return null;
  if (last < text.length) out.push(text.slice(last));
  return out;
}
