// Game state, actions, and per-viewer redaction. No rules engine — this is a
// shared tabletop with enforced information hiding.

export type PlayerId = "you" | "agent";
export type Zone = "library" | "hand" | "battlefield" | "graveyard" | "exile" | "command" | "stack";

export const PLAYERS: PlayerId[] = ["you", "agent"];
export const ZONES: Zone[] = ["library", "hand", "battlefield", "graveyard", "exile", "command", "stack"];

export interface CardFace {
  name: string;
  image?: string;
  oracle?: string;
  mana?: string;
  typeLine?: string;
  power?: string;
  toughness?: string;
}

export interface Card {
  id: string;
  name: string;
  image?: string;
  oracle?: string;
  mana?: string;
  typeLine?: string;
  power?: string;
  toughness?: string;
  // printed P/T remembered while an explicit set_pt override is active
  basePower?: string;
  baseToughness?: string;
  // modal/transforming double-faced cards: both faces, and which one is showing
  faces?: CardFace[];
  face?: number;
  owner: PlayerId;
  controller: PlayerId;
  zone: Zone;
  tapped: boolean;
  faceDown: boolean;
  counters: Record<string, number>;
  // board piles (replaces "attach"): id of the card this one is tucked
  // directly under. Chains are linear — one card per rung, any depth.
  under: string | null;
  isToken: boolean;
  isCommander: boolean;
  // Extra visibility grants beyond what the zone implies (revealed hand cards,
  // face-down exile the thief may look at, etc.)
  visibleTo: PlayerId[];
  attacking: string | null; // defender description ("you", "agent", or a card id)
  blocking: string | null;  // attacker card id
  // Where the card sits on the table surface, as a fraction of the placeable
  // area: x 0 = left edge, 1 = right edge; y 0 = the agent's back edge, 1 =
  // yours, so the midline is ~0.5. ONE space for both halves — which half a
  // card is in is read off y, not off who controls it. Battlefield only;
  // null everywhere else.
  // Null until somebody places the card. Nothing here invents one: where a
  // card should go is a question about the felt — how wide a card is in that
  // window, what is already lying there, which way a row grows — and none of
  // that is knowable from here. A card on the table with a null pos is a card
  // waiting for the client to place it, which it does before the next paint.
  pos?: { x: number; y: number } | null;
  // Paint order among the cards lying on the table, low to high. Bumped every
  // time the card is put down, so the last card you touched is the one on
  // top — the same as sliding a real card over the one beside it. Not a
  // z-index: the bands (a pile under its anchor, an unresolved card over
  // everything) are the client's, and this only breaks ties inside them.
  z?: number;
}

/** The next paint order. Read off the table rather than counted, so it needs
 *  no state of its own and a game saved before this existed starts from 1. */
const nextZ = () => 1 + Math.max(0, ...Object.values(game.cards).map((c) => c.z ?? 0));

/** Table coordinates are fractions; anything else is off the table. NaN lands
 *  at 0 rather than poisoning the card's position. */
const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

export interface PlayerState {
  life: number;
  commanderDamage: Record<string, number>; // key: commander card name
  // the {2}-per-previous-cast surcharge on casting a commander out of the
  // command zone. Bookkeeping, not enforcement: nothing checks it, both seats
  // read it, and either may correct it.
  commanderTax: number;
  zones: Record<Zone, string[]>; // ordered card ids; library[0] = TOP
  deckName?: string;
  deckId?: number;
  // what this seat has already done THIS turn — the facts the client used to
  // reconstruct by grepping the log ("did I untap", "did I draw", "has
  // anything been played"). lands is bookkeeping like commanderTax: both
  // seats read it, either corrects it.
  turnDone: { untap: boolean; draw: boolean; lands: number; acted: boolean };
}

/** What HAPPENED, named. The table knows this for certain at the moment it
 *  writes the log line, and used to throw it away: the client recovered it by
 *  running fourteen regexes over the English. Rule order was load-bearing,
 *  anchors mattered because an undo notice QUOTES the line it took back, and
 *  rewording a sentence in here silently changed what the table sounded like.
 *
 *  These are events, not sounds. The server has no business knowing the table
 *  has audio; which sound an event earns is the client's to decide, and lives
 *  in one map in client/src/game/sounds.ts.
 *
 *  Only lines the client acts on are named. An untagged line is not an
 *  oversight, it is "nothing out here reacts to this" — so the vocabulary
 *  stays the size of its use, and the client's map can be total. */
export const GAME_EVENTS = [
  "round_start",
  "phase_change",
  "turn_pass_declared",
  "cast",
  "land_played",
  "ability_stacked",
  "sequence_proposed",
  "spell_resolved",
  "permanent_resolved",
  "countered",
  "permanent_died",
  "attackers_declared",
  "attacks_finished",
  "attacks_locked",
  "blockers_declared",
  "drew",
  "tapped",
] as const;

export type GameEvent = (typeof GAME_EVENTS)[number];

export interface LogEntry {
  seq: number;
  ts: number;
  actor: PlayerId | "system";
  text: string; // public rendering
  private?: Partial<Record<PlayerId, string>>; // richer rendering for viewers allowed to know
  /** what this line IS, for anything downstream that needs to know without
   *  reading the sentence. Rides out to the client; never shown to the agent,
   *  which reads the prose like a person (see renderLogFor). */
  event?: GameEvent;
  /** The cards this entry is ABOUT, as ids — set by reveal, so the client can
   *  put the actual cards in front of you instead of a list of names in the
   *  log. Filtered per viewer on the way out; see renderLogFor. */
  cards?: string[];
  /** Conversation rather than a play: chat, a question, passing priority.
   *  Something one player SAID, not something that happened to the game — so
   *  undo never deletes it and redo never brings it back (see history.ts). */
  talk?: true;
}

/** One arrow of damage: a source dealing an amount to a player or a creature.
 *  Declared, never computed — the table has no rules engine and does not know
 *  what a creature's damage output is, only what the announcer says it is. */
export interface DamageHit {
  source: string;
  target: PlayerId | string;
  amount: number;
  note?: string;
}

export interface StackItem {
  id: string;
  player: PlayerId;
  cardId: string | null;
  text: string;
  // structured combat declarations apply their effects when resolved
  apply?:
    | { type: "attack" | "block"; pairs: any[] }
    | { type: "turn"; player: PlayerId }
    | { type: "phase"; phase: string }
    | { type: "damage"; hits: DamageHit[]; dies: string[]; combatDamage?: boolean };
  // destination declared at cast time (MDFC faces, exile-on-resolve effects)
  resolveTo?: Zone;
  // whose zone it resolves into (reanimation targets, returns to owner's hand)
  resolveToPlayer?: PlayerId;
  // for text-only trigger/ability items: the permanent the ability comes from
  sourceId?: string;
  // batched proposal (MTR-style shortcut): items pushed together share a groupId.
  // retractable marks PLANNED follow-ups that unwind if the opponent responds
  // below them; mandatory triggers are never retractable.
  groupId?: string;
  retractable?: boolean;
  // an attack declaration the attacker has handed over (finish_attacks) but
  // the defender has not yet resolved — the "you said you were done" fact the
  // client used to scrape out of the log with an anchored regex
  finished?: boolean;
  // countered is a MARK, not a removal: the item stays on the stack so
  // responses can reference it; resolving a countered item fizzles it.
  countered?: boolean;
  // multi-part announcements (combat damage per pairing): one line per part,
  // rendered as a table by the client. text stays the headline.
  lines?: string[];
}

/** The five phases this table tracks. Not the CR's eleven steps — the table
 *  runs at the granularity the two seats actually play at. */
export const PHASES = ["untap/upkeep", "main 1", "combat", "main 2", "end"] as const;
export type Phase = (typeof PHASES)[number];

const PHASE_ALIASES: Record<string, Phase> = {
  "untap/upkeep": "untap/upkeep", untap: "untap/upkeep", upkeep: "untap/upkeep", draw: "untap/upkeep", beginning: "untap/upkeep",
  "main 1": "main 1", main1: "main 1", "first main": "main 1", "precombat main": "main 1", "pre-combat main": "main 1",
  combat: "combat", attack: "combat", attackers: "combat", "declare attackers": "combat", "declare blockers": "combat", blockers: "combat", "combat damage": "combat",
  "main 2": "main 2", main2: "main 2", "second main": "main 2", "postcombat main": "main 2", "post-combat main": "main 2",
  end: "end", "end step": "end", "end of turn": "end", cleanup: "end",
};

/** Any phase label a seat might write, folded to the canonical five — or a
 *  loud error naming them. A typo used to become the phase: set_phase stored
 *  whatever string arrived, and every phase comparison downstream went
 *  quietly false. */
export function normalizePhase(raw: unknown): Phase {
  const key = String(raw ?? "").trim().toLowerCase();
  // own-property only: a plain object inherits "constructor", "toString" and
  // friends, and a bare lookup would hand one of those back as the phase
  const hit = Object.hasOwn(PHASE_ALIASES, key) ? PHASE_ALIASES[key] : undefined;
  if (hit) return hit;
  // "main" alone is the agent's most common label and is genuinely ambiguous;
  // this turn's combat settles it — once damage is done, a bare "main" is the
  // second one
  if (key === "main") return game.combat === "done" ? "main 2" : "main 1";
  throw new Error(`unknown phase "${String(raw)}" — use one of: ${PHASES.join(", ")}`);
}

/** Where this combat is. The word "combat" in `phase` covers three different
 *  questions — who attacks, who blocks, what lands — and the table needs to
 *  know which one is open: damage() refuses to run while blocks are owed,
 *  and the client prompt asks whichever question is current. null = not in
 *  combat; "done" = damage resolved, combat not yet left. */
export type CombatStep = "attackers" | "blockers" | "damage" | "done";

export interface GameState {
  started: boolean;
  turn: PlayerId;
  turnNumber: number;
  phase: Phase;
  combat: CombatStep | null;
  players: Record<PlayerId, PlayerState>;
  cards: Record<string, Card>;
  stack: StackItem[];
  log: LogEntry[];
  seq: number;
  waitingOn: PlayerId; // whose window it is
  pendingQuestion: string | null; // agent question awaiting user answer
  // token art/copy for this game's decks, keyed by lowercase token name —
  // built from Scryfall all_parts when the decks load
  tokenCatalog: Record<string, { name: string; image?: string; oracle?: string; typeLine?: string; power?: string; toughness?: string }>;
  // card ids whose oracle text has actually been DELIVERED to the agent (state
  // views, draw results, peeks, read_card) — cast refuses anything else, so
  // "read the card before playing it" is enforced, not just prompted
  agentSeen: Record<string, true>;
}

let nextCardId = 1;
export function newCardId() {
  return "c" + nextCardId++;
}

/** A card is a card ANYWHERE: the ONE constructor for a card object. The
 * caller supplies identity and printed values; every gameplay field starts at
 * its default here, so a new field is defaulted in exactly one place. */
export function makeCard(init: Pick<Card, "id" | "name" | "owner" | "controller" | "zone"> & Partial<Card>): Card {
  return {
    tapped: false,
    faceDown: false,
    counters: {},
    under: null,
    isToken: false,
    isCommander: false,
    visibleTo: [],
    attacking: null,
    blocking: null,
    ...init,
  };
}

export function emptyPlayer(): PlayerState {
  return {
    life: 40,
    commanderDamage: {},
    commanderTax: 0,
    zones: { library: [], hand: [], battlefield: [], graveyard: [], exile: [], command: [], stack: [] },
    turnDone: { untap: false, draw: false, lands: 0, acted: false },
  };
}

export function newGameState(): GameState {
  return {
    started: false,
    turn: "you",
    turnNumber: 1,
    // where the turn pass puts every later turn, so turn 1 is not a special
    // case that opens on "Go to combat" with an untouched board
    phase: "untap/upkeep",
    combat: null,
    players: { you: emptyPlayer(), agent: emptyPlayer() },
    cards: {},
    stack: [],
    log: [],
    seq: 0,
    waitingOn: "you",
    pendingQuestion: null,
    tokenCatalog: {},
    agentSeen: {},
  };
}

/** Record that these cards' full text reached the agent's context. */
export function markSeenByAgent(ids: (string | undefined)[]) {
  const seen = (game.agentSeen ??= {});
  for (const id of ids) if (id) seen[id] = true;
}

// Trigger HINTS: triggered abilities are lexically rigid — every one starts
// with When/Whenever/At — so the server can flag them at the moments they get
// missed, with zero rules knowledge. Hints ride tool results and are never
// rulings; false positives are fine.
function activeOracle(c: Card): string {
  const face = c.face !== undefined && c.faces ? c.faces[c.face] : undefined;
  return String(face?.oracle ?? c.oracle ?? "");
}

// Written-out triggers (CR 603) use When/Whenever/At — matched anywhere in
// the line, since ability words prefix them ("Landfall — Whenever…"). Bare
// keywords that IMPLY a trigger with no trigger word, and Saga chapter lines,
// get their own nets.
const TRIGGER_WORD = /\b(when|whenever|at the beginning of|at end of combat|as .{0,40}enters|enters (?:the battlefield )?with)\b/i;
const TRIGGER_KEYWORD =
  /\b(prowess|exalted|extort|cascade|storm|gravestorm|ripple|persist|undying|evolve|fabricate|mentor|melee|myriad|annihilator|afflict|bushido|rampage|soulbond|haunt|dethrone|exploit|enrage|renown|training|battle cry|ingest|decayed|flanking|gift of|living weapon|casualty)\b/i;
const SAGA_CHAPTER = /^[IVX]+(?:, ?[IVX]+)* ?—/;

export function triggerLines(c: Card): string[] {
  return activeOracle(c)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => TRIGGER_WORD.test(l) || SAGA_CHAPTER.test(l) || TRIGGER_KEYWORD.test(l));
}

/** Battlefield permanents (both sides) whose TRIGGER text watches the given
 * zone-change event. Scanned after the change, so an entering card's own ETB
 * lines list it too. */
export function zoneChangeWatchers(kind: "enters" | "leaves" | "dies"): string[] {
  const re =
    kind === "enters"
      ? /\benters?\b/i
      : kind === "dies"
        ? /\b(dies|die|put into a graveyard|leaves the battlefield)\b/i
        : /\bleaves the battlefield\b/i;
  const out: string[] = [];
  for (const p of PLAYERS) {
    for (const id of game.players[p].zones.battlefield) {
      const c = game.cards[id];
      if (c && triggerLines(c).some((l) => re.test(l))) out.push(`${who(p)}'s ${c.name}`);
    }
  }
  return out;
}

export const game: GameState = newGameState();

export function resetGameState() {
  const fresh = newGameState();
  Object.assign(game, fresh);
  said = [];
  nextCardId = 1;
}

export function getNextCardId() {
  return nextCardId;
}

export function setNextCardId(n: number) {
  nextCardId = n;
}

// ── the two streams ────────────────────────────────────────────────────────
//
//   game.log   what happened TO the game. This is game state: it lives on
//              `game`, so it is inside every undo snapshot, and rewinding a
//              play takes its log line back with it. That is correct — the
//              line is a record of the thing that no longer happened.
//
//   said       what a player SAID: chat, a question, passing priority. It
//              lives OUT HERE, not on `game`, so no snapshot can contain it
//              and neither undo nor redo can reach it. You cannot take back
//              having said something, and a redo cannot make you say it
//              twice. Passing is a response, not a play.
//
// Nothing merges the two but the readers. transcript() interleaves them by
// seq, which is monotonic across restores, so the order is always right.
let said: LogEntry[] = [];

/** The event comes BEFORE the private rendering: naming what happened is the
 *  common case and the private text is the rare one, and a fourth positional
 *  argument would have every tagged line carrying an `undefined` past it. */
export function addLog(
  actor: LogEntry["actor"],
  text: string,
  event?: GameEvent,
  priv?: LogEntry["private"]
): LogEntry {
  const entry: LogEntry = {
    seq: ++game.seq,
    ts: Date.now(),
    actor,
    text,
    ...(event ? { event } : {}),
    ...(priv ? { private: priv } : {}),
  };
  game.log.push(entry);
  return entry;
}

/** Say something. Never an event, never undoable, never redoable. */
export function addTalk(actor: LogEntry["actor"], text: string): LogEntry {
  const entry: LogEntry = { seq: ++game.seq, ts: Date.now(), actor, text, talk: true };
  said.push(entry);
  return entry;
}

/** Everything that has passed at the table, in order — plays and talk. Every
 *  reader wants both; only the undo machinery wants them apart. */
export const transcript = (): LogEntry[] => [...game.log, ...said].sort((a, b) => a.seq - b.seq);

export const getSaid = () => said;
export const setSaid = (s: LogEntry[] | undefined) => {
  said = Array.isArray(s) ? s : [];
};

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

export function cardVisibleTo(card: Card, viewer: PlayerId): boolean {
  if (card.visibleTo.includes(viewer)) return true;
  switch (card.zone) {
    case "battlefield":
    case "graveyard":
    case "command":
    case "stack":
      return !card.faceDown;
    case "exile":
      return !card.faceDown;
    case "hand":
      return card.controller === viewer;
    case "library":
      return false;
  }
}

/**
 * A card is a card ANYWHERE: the ONE card serialization, used by every place
 * that hands a card to a client (state views, view_zone, peek).
 *
 * PUBLIC fields — where it is, who owns and controls it, tapped, counters,
 * attachments, combat, board position — are always present: an opponent sees
 * all of that even on a card whose face is hidden. SECRET fields — name, art,
 * oracle text, mana, type line, P/T, faces — are added only when the viewer is
 * allowed to know them, and on a hidden card they are ABSENT (not null), so a
 * client can never read a name it was not given.
 *
 * opts.reveal is the granted peek: view_zone and peek are effects that have
 * already earned the look, so they skip the visibility test.
 */
export function serializeCard(card: Card, viewer: PlayerId, opts: { reveal?: boolean } = {}) {
  const base = {
    id: card.id,
    zone: card.zone,
    owner: card.owner,
    controller: card.controller,
    tapped: card.tapped,
    faceDown: card.faceDown,
    counters: card.counters,
    under: card.under,
    isToken: card.isToken,
    isCommander: card.isCommander,
    attacking: card.attacking,
    blocking: card.blocking,
    pos: card.pos ?? null,
    z: card.z ?? 0,
  };
  if (!opts.reveal && !cardVisibleTo(card, viewer)) return { ...base, hidden: true as const };
  // a DFC always presents as its ACTIVE face — the composite name never shows
  const idx = card.face ?? 0;
  const f = card.faces?.[idx];
  return {
    ...base,
    name: f?.name ?? card.name,
    image: f?.image ?? card.image,
    oracle: f?.oracle ?? card.oracle,
    mana: f?.mana ?? card.mana,
    typeLine: f?.typeLine ?? card.typeLine,
    power: f?.power ?? card.power,
    toughness: f?.toughness ?? card.toughness,
    basePower: card.basePower,
    baseToughness: card.baseToughness,
    faceCount: card.faces?.length ?? 1,
    face: idx,
    faces: card.faces,
    hidden: false as const,
    revealedTo: card.visibleTo,
  };
}

/** The agent-facing trim of an already-serialized card: the same card, minus
 * the fields that exist for human eyes only — the art urls, on the card and on
 * each face. Board position is NOT trimmed: the agent shares the table surface
 * and places its own cards on it. Not a second card shape: a transport trim,
 * applied by the lean state view and by the granted peeks. */
/** What a card at rest has nothing to say about. A library listing repeats
 *  these for every card in the deck and every one of them is the default —
 *  nothing in a library is tapped, attacking, or anywhere on the table. Three
 *  library searches were 45% of the agent's whole conversation, and most of
 *  each card was this. Omitted when they are at their default and kept the
 *  moment they mean something. */
const AT_REST: Record<string, unknown> = {
  tapped: false,
  faceDown: false,
  hidden: false,
  attacking: null,
  blocking: null,
  under: null,
  pos: null,
  z: 0,
  isToken: false,
  isCommander: false,
  // a one-faced card showing its only face. The pair says nothing and it rides
  // on every card in every zone; absent, faceCount only ever appears when
  // there is a back to turn to.
  faceCount: 1,
  face: 0,
};

/** Board coordinates are fractions of the table, and they arrive from a mouse
 *  as full float noise — 0.8748319276372082. The agent reads them to see the
 *  layout and writes them back to tidy, and three decimals is a pixel on any
 *  real screen. Left at full precision it is the third-largest field on a
 *  battlefield card. */
const round3 = (n: unknown) => (typeof n === "number" ? Math.round(n * 1000) / 1000 : n);

/** Untap one seat's battlefield. Returns how many actually turned over, so a
 *  caller can say so — and say nothing when there was nothing to do. */
function untapPermanents(player: PlayerId): number {
  game.players[player].turnDone.untap = true;
  let n = 0;
  for (const id of game.players[player].zones.battlefield) {
    const c = game.cards[id];
    if (c?.tapped) {
      c.tapped = false;
      n++;
    }
  }
  return n;
}

/** Power and toughness as the board actually shows them: printed, plus the
 *  +1/+1 and -1/-1 counters.
 *
 *  The printed pair and the counters map were served separately and the sum
 *  left to the reader. A person reads it off the card once and remembers; the
 *  agent re-derives it on every call, and a 0/0 Thromok carrying 36 counters is
 *  exactly the shape it gets wrong — it worked out 36/36 correctly and then
 *  ruled that 13 damage killed it, in the same sentence. */
export function effectivePT(c: { power?: string; toughness?: string; counters?: Record<string, number> }): string | null {
  if (c.power === undefined || c.toughness === undefined) return null;
  const n = (c.counters?.["+1/+1"] ?? 0) - (c.counters?.["-1/-1"] ?? 0);
  // "*" and "1+*" are printed values that no amount of counting resolves —
  // keep them readable rather than turning them into NaN
  const add = (v: string) => {
    const base = Number(v);
    if (Number.isFinite(base)) return String(base + n);
    return n ? `${v}${n > 0 ? "+" : ""}${n}` : v;
  };
  return `${add(c.power)}/${add(c.toughness)}`;
}

export function leanCard({ image, faces, ...rest }: any) {
  const out: any = {};
  for (const [k, v] of Object.entries(rest)) {
    if (k in AT_REST && v === AT_REST[k]) continue;
    // an empty collection is the same nothing as a missing one — counters {}
    // on a card with no counters, revealedTo [] on a card nobody has peeked at
    if (v && typeof v === "object" && !Object.keys(v).length) continue;
    out[k] = k === "pos" && v && typeof v === "object" ? { x: round3((v as any).x), y: round3((v as any).y) } : v;
  }
  // the sum the reader would otherwise have to do — printed P/T plus counters,
  // only where the counters actually move it
  const pt = effectivePT(rest);
  if (pt && pt !== `${rest.power}/${rest.toughness}`) out.pt = pt;
  return { ...out, ...(faces ? { faces: faces.map(({ image: _i, ...f }: any) => f) } : {}) };
}

/** Full table snapshot as one viewer is allowed to see it. */
export function viewFor(viewer: PlayerId, logTail = 40) {
  // a state view delivers full oracle text for the agent's castable zones
  if (viewer === "agent") {
    markSeenByAgent([...game.players.agent.zones.hand, ...game.players.agent.zones.command]);
  }
  const players: any = {};
  for (const p of PLAYERS) {
    const ps = game.players[p];
    players[p] = {
      life: ps.life,
      commanderDamage: ps.commanderDamage,
      commanderTax: ps.commanderTax ?? 0,
      deckName: ps.deckName,
      turnDone: ps.turnDone,
      counts: Object.fromEntries(ZONES.map((z) => [z, ps.zones[z].length])),
      zones: Object.fromEntries(
        ZONES.map((z) => [z, ps.zones[z].map((id) => serializeCard(game.cards[id], viewer))])
      ),
    };
  }
  return {
    started: game.started,
    viewer,
    turn: game.turn,
    turnNumber: game.turnNumber,
    phase: game.phase,
    combat: game.combat,
    waitingOn: game.waitingOn,
    pendingQuestion: game.pendingQuestion,
    // the same fact mulligan() itself enforces, so the offer on the table and
    // the rule behind it cannot drift apart
    canMulligan:
      game.started &&
      game.turnNumber === 1 &&
      game.turn === viewer &&
      game.players[viewer].zones.hand.length > 0 &&
      !game.players[viewer].turnDone.acted,
    players,
    stack: game.stack.map((item) => ({
      id: item.id,
      player: item.player,
      text: item.text,
      groupId: item.groupId,
      retractable: item.retractable,
      finished: item.finished,
      resolveTo: item.resolveTo,
      source: item.sourceId,
      countered: item.countered,
      lines: item.lines,
      // structured combat declarations — the client marks a creature the
      // moment it is DECLARED, not when the opponent gets round to locking it
      // in. Waiting for the resolve left a declared blocker looking exactly
      // like a creature standing around doing nothing.
      attackPairs: item.apply?.type === "attack" ? item.apply.pairs : undefined,
      blockPairs: item.apply?.type === "block" ? item.apply.pairs : undefined,
      // turn pass: the client floats a one-click "take your turn" prompt
      turnPassTo: item.apply?.type === "turn" ? item.apply.player : undefined,
      card: item.cardId ? serializeCard(game.cards[item.cardId], viewer) : null,
    })),
    log: transcript().slice(-logTail).map((e) => renderLogFor(e, viewer)),
    seq: game.seq,
  };
}

export function renderLogFor(e: LogEntry, viewer: PlayerId) {
  // the ids ride out only to viewers who may actually see those cards, which
  // is the same grant reveal just made — so a reveal aimed at one seat never
  // hands the other seat a way to look the cards up. A card that has since
  // changed zones has had its grant wiped, and drops out here with it.
  const cards = e.cards?.filter((id) => game.cards[id] && cardVisibleTo(game.cards[id], viewer));
  return {
    seq: e.seq,
    ts: e.ts,
    actor: e.actor,
    text: (e.private && e.private[viewer]) || e.text,
    ...(e.event ? { event: e.event } : {}),
    ...(cards?.length ? { cards } : {}),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function who(p: PlayerId) {
  return p === "you" ? "Player" : "Agent";
}

/** Take every attacking/blocking mark off the table. */
function clearCombatMarks() {
  for (const c of Object.values(game.cards)) {
    c.attacking = null;
    c.blocking = null;
  }
}

/** A fresh turn has seen nothing yet — for BOTH seats. The turn pass is the
 *  one moment the slate is wiped; everything else only ever sets a flag. */
function resetTurnDone() {
  for (const ps of Object.values(game.players)) ps.turnDone = { untap: false, draw: false, lands: 0, acted: false };
}

/** Player ids are exactly "you" | "agent" — reject anything else loudly. */
function asPlayer(v: any, field = "player"): PlayerId {
  if (v !== "you" && v !== "agent") {
    throw new Error(`${field} must be "you" (Player) or "agent", got ${JSON.stringify(v)}`);
  }
  return v;
}

function zoneList(card: Card): string[] {
  return game.players[card.controller].zones[card.zone];
}

function removeFromZone(card: Card) {
  const list = zoneList(card);
  const i = list.indexOf(card.id);
  if (i >= 0) list.splice(i, 1);
}

/** The ONE zone change: unlink from the old zone, rewrite the card's placement
 * fields, hand back the destination list so the caller picks the spot in it.
 * Visibility always resets — explicit grants are re-applied by the caller. */
/** The card sitting directly beneath `card` in its pile, if any. */
function cardBeneath(card: Card): Card | null {
  for (const o of Object.values(game.cards)) if (o.under === card.id) return o;
  return null;
}

/** Pull a card out of its pile alone: whatever sat beneath it closes the gap. */
function spliceOutOfPile(card: Card) {
  const below = cardBeneath(card);
  if (below) below.under = card.under;
  card.under = null;
}

function relocateCard(card: Card, zone: Zone, player: PlayerId): string[] {
  const from = card.zone;
  spliceOutOfPile(card);
  removeFromZone(card);
  card.zone = zone;
  card.controller = player;
  card.visibleTo = [];
  // Every card ON THE TABLE has a position, and the stack is on the table:
  // an unresolved card is drawn on the board like any other. So both zones
  // get one and everywhere else clears it — the client never invents a spot.
  // A card resolving off the stack keeps the one it was already sitting at,
  // which is what makes a creature resolve exactly where it was hovering.
  // A card resolving off the stack keeps the spot it was already sitting at,
  // which is what makes a creature resolve exactly where it was hovering.
  // Everything else arrives unplaced.
  const keepsItsSpot = from === "stack" && (zone === "battlefield" || zone === "stack") && card.pos;
  card.pos = keepsItsSpot ? card.pos! : null;
  return game.players[player].zones[zone];
}

/** relocateCard onto the usual landing spot: the end of the destination zone. */
function placeCard(card: Card, zone: Zone, player: PlayerId) {
  relocateCard(card, zone, player).push(card.id);
}

/** A DFC IS its active face: switching faces rewrites card.name (and every
 * card.name consumer — logs, stack text, views — is right by construction). */
export function applyFace(card: Card, face: number) {
  if (!card.faces || face < 0 || face >= card.faces.length) {
    throw new Error(`${card.name} has no face ${face}`);
  }
  card.face = face;
  card.name = card.faces[face].name ?? card.name;
}

/** Public description of a card for the log: name if publicly visible, else "a face-down card". */
function publicDesc(card: Card): string {
  const publiclyVisible = PLAYERS.every((p) => cardVisibleTo(card, p));
  return publiclyVisible ? card.name : "a hidden card";
}

/** A block declaration as one line per ATTACKER — "Llanowar Elves, Plant →
 *  Marchesa, the Black Rose" — attackers in the order they were first named.
 *
 *  Three creatures ganging up on one attacker is ONE decision, and per-pair
 *  sentences said it three times: "Writhing Chrysalis blocks Marchesa, the
 *  Black Rose; Agate Instigator blocks Marchesa, the Black Rose; Llanowar
 *  Elves blocks Marchesa, the Black Rose". The word that differs sits at the
 *  front of a phrase you have to read to the end of, once per blocker.
 *
 *  Shared by the declaration and by the lock-in log so that the same combat
 *  cannot be described two ways seconds apart. */
function blockLines(pairs: any[]): string[] {
  const byAttacker = new Map<string, string[]>();
  for (const pair of pairs) {
    const blocker = publicDesc(getCard(pair.blocker));
    const attacker = getCard(pair.attacker).id;
    byAttacker.set(attacker, [...(byAttacker.get(attacker) ?? []), blocker]);
  }
  return [...byAttacker].map(([id, bs]) => `${bs.join(", ")} → ${publicDesc(getCard(id))}`);
}

export function getCard(cardId: string): Card {
  const c = game.cards[cardId];
  if (!c) throw new Error(`no card with id ${cardId}`);
  return c;
}

/** Resolve "top:you" / "top:agent" / plain card id. */
export function resolveCardRef(ref: string): Card {
  const m = /^top:(you|agent)$/.exec(ref);
  if (m) {
    const lib = game.players[m[1] as PlayerId].zones.library;
    if (!lib.length) throw new Error(`${m[1]}'s library is empty`);
    return game.cards[lib[0]];
  }
  return getCard(ref);
}

export function shuffleZone(player: PlayerId, zone: Zone = "library") {
  const list = game.players[player].zones[zone];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
}

/** A seat's attack declaration that is on the stack and not yet locked in.
 *
 *  Declaring attackers is ONE act however many creatures it names, so this is
 *  both where a new attacker is added and the reason adding one is not its own
 *  undo step: while this item is open, the declaration is still being made. */
export const openAttackDeclaration = (actor: PlayerId): StackItem | undefined =>
  game.stack.find((i) => i.player === actor && i.apply?.type === "attack");

/** The ONE way an item reaches the stack. Its id is derived from the seq of
 * the log line the caller writes next ("s" + seq) — the frontend pairs chat
 * lines with live stack items by that id, so nothing else may mint one. */
function pushStackItem(actor: PlayerId, item: Omit<StackItem, "id" | "player">): StackItem {
  const entry: StackItem = { id: "s" + (game.seq + 1), player: actor, ...item };
  game.stack.push(entry);
  return entry;
}

/**
 * MTR shortcut semantics: responding at item X holds the proposer to that
 * point — retractable items ABOVE X (planned follow-ups) unwind as if never
 * taken; mandatory triggers stay. Cards return to their owner's hand.
 */
function retractTailAbove(actor: PlayerId, respondAt: string) {
  const idx = game.stack.findIndex((i) => i.id === respondAt);
  if (idx < 0) throw new Error(`no stack item ${respondAt}`);
  const retracted: string[] = [];
  for (let i = game.stack.length - 1; i > idx; i--) {
    const item = game.stack[i];
    if (!item.retractable || item.player === actor) continue;
    game.stack.splice(i, 1);
    if (item.cardId) {
      const card = getCard(item.cardId);
      placeCard(card, "hand", card.owner);
      retracted.push(card.name);
    } else {
      retracted.push(item.text);
    }
  }
  if (retracted.length) {
    addLog(actor, `${who(actor)} responds below the proposed sequence — retracted (never happened): ${retracted.join("; ")}`);
  }
}

// ---------------------------------------------------------------------------
// Actions. Every action returns data for the actor (possibly private info).
// The caller (HTTP layer) broadcasts the state update.
// ---------------------------------------------------------------------------

export interface ActionCtx {
  actor: PlayerId;
}

export type ActionResult = { ok: true; [k: string]: any };

/** A countered item leaving the stack: the card fizzles to its owner's graveyard, no effect. */
function fizzleItem(ctx: ActionCtx, item: StackItem): ActionResult {
  if (item.cardId) {
    const card = getCard(item.cardId);
    placeCard(card, "graveyard", card.owner);
    addLog(ctx.actor, `${card.name} was countered — fizzles → ${who(card.owner)}'s graveyard`, "countered");
  } else {
    // the same event either way. Only the card branch used to make a noise —
    // the regex that caught it wanted a card name and an arrow, so a countered
    // TRIGGER fizzled in silence for no reason anybody chose
    addLog(ctx.actor, `Countered item fizzles: ${item.text}`, "countered");
  }
  return { ok: true, fizzled: item.text };
}

/** Apply one already-removed stack item: combat/phase/turn payloads, text, or card resolution. */
function resolveStackItem(ctx: ActionCtx, item: StackItem, p: any): ActionResult {
  if (item.apply?.type === "attack") {
    const parts: string[] = [];
    for (const pair of item.apply.pairs) {
      const c = getCard(pair.attacker);
      c.attacking = pair.target;
      c.tapped = true;
      parts.push(publicDesc(c));
    }
    game.phase = "combat";
    // locking attackers in IS entering combat, whether or not set_phase was
    // called first — so this is deliberately unguarded (spec deviation: the
    // spec guards it on "attackers", but an attack locked in from main must
    // still open the blockers step, or damage() would owe no blocks)
    game.combat = "blockers";
    addLog(ctx.actor, `Attacks locked in: ${parts.join(", ")} (attackers tapped)`, "attacks_locked");
    return { ok: true, resolved: item.text };
  }
  if (item.apply?.type === "phase") {
    // phases stacked before they applied immediately, so nothing writes this
    // payload any more — but a save from back then can still hold one, with a
    // label from before the vocabulary existed
    game.phase = normalizePhase(item.apply.phase);
    addLog(ctx.actor, `Phase: ${game.phase}`);
    return { ok: true, resolved: item.text };
  }
  if (item.apply?.type === "turn") {
    const player = item.apply.player;
    if (player === "you" && game.turn !== "you") game.turnNumber++;
    game.turn = player;
    game.waitingOn = player;
    game.phase = "untap/upkeep";
    game.combat = null;
    clearCombatMarks();
    resetTurnDone();
    addLog(ctx.actor, `— Round ${game.turnNumber}: ${who(player)}'s turn —`, "round_start");
    return { ok: true, resolved: item.text };
  }
  if (item.apply?.type === "damage") {
    // Only COMBAT damage ends the damage step, and only a combat that is
    // still owed damage can end. The flag is what separates the two: a ping
    // announced in main and resolved after combat opened must not close a
    // blockers step it merely resolved into, and a combat that has moved on
    // (or never started) must not be resurrected by a late item. "blockers"
    // is a legal source — later per-creature block declarations may still be
    // resolving under it.
    if (item.apply.combatDamage && (game.combat === "damage" || game.combat === "blockers")) {
      game.combat = "done";
    }
    const parts: string[] = [];
    for (const hit of item.apply.hits) {
      if (hit.target !== "you" && hit.target !== "agent") continue; // creature hits are the announcement; deaths do the work
      const ps = game.players[hit.target];
      const before = ps.life;
      ps.life -= hit.amount;
      parts.push(`${who(hit.target)} ${before} → ${ps.life}`);
      // the second number a commander hit owes, applied off the same call
      const src = game.cards[hit.source];
      if (src?.isCommander) {
        ps.commanderDamage[src.name] = (ps.commanderDamage[src.name] || 0) + hit.amount;
        if (!ps.commanderDamage[src.name]) delete ps.commanderDamage[src.name];
        parts.push(`${src.name} → ${who(hit.target)} commander damage ${ps.commanderDamage[src.name] || 0}`);
      }
    }
    addLog(ctx.actor, `Damage applied: ${parts.join("; ") || "no life change"}`);
    // deaths ride the normal move, so death triggers surface the way they do
    // for any other creature reaching a graveyard
    const dead = item.apply.dies.filter((id) => game.cards[id]);
    const deaths = dead.length ? actions.move(ctx, { cards: dead, toZone: "graveyard" }) : null;
    return { ok: true, resolved: item.text, life: parts, ...(deaths ? { deaths } : {}) };
  }
  if (item.apply?.type === "block") {
    if (game.combat === "blockers") game.combat = "damage";
    for (const pair of item.apply.pairs) getCard(pair.blocker).blocking = pair.attacker;
    addLog(ctx.actor, `Blocks locked in: ${blockLines(item.apply.pairs).join("; ")}`);
    return { ok: true, resolved: item.text };
  }
  if (!item.cardId) {
    addLog(ctx.actor, `Resolved: ${item.text}`);
    return { ok: true, resolved: item.text };
  }
  const card = getCard(item.cardId);
  // a card with ANY land face is a permanent when played; MDFCs like
  // "Instant // Land" must not be inferred into the graveyard
  const tl = card.typeLine ?? "";
  const isSpell = /\b(instant|sorcery)\b/i.test(tl) && !/\bland\b/i.test(tl);
  const toZone: Zone = (p.to as Zone) ?? item.resolveTo ?? (isSpell ? "graveyard" : "battlefield");
  const resolveOwnerZone =
    toZone === "graveyard" || toZone === "exile" || toZone === "hand" || toZone === "library" || toZone === "command";
  const toPlayer: PlayerId = resolveOwnerZone
    ? card.owner // CR 404.1: these zones are the owner's, whatever was passed
    : p.toPlayer === undefined
      ? item.resolveToPlayer ?? (toZone === "battlefield" ? card.controller : card.owner)
      : asPlayer(p.toPlayer, "toPlayer");
  placeCard(card, toZone, toPlayer);
  // an MDFC whose front face can't exist on the battlefield (Instant // Land)
  // must display the permanent face it actually resolved as
  if (toZone === "battlefield" && card.faces && !card.face) {
    const isPermanent = (t?: string) => !!t && !/\b(instant|sorcery)\b/i.test(t);
    if (!isPermanent(card.faces[0]?.typeLine)) {
      const idx = card.faces.findIndex((f) => isPermanent(f.typeLine));
      if (idx > 0) applyFace(card, idx);
    }
  }
  // Landing on the table and going to the graveyard are different events, and
  // the destination is the only thing that separates them.
  addLog(
    ctx.actor,
    `${card.name} resolved → ${who(toPlayer)}'s ${toZone}`,
    toZone === "battlefield" ? "permanent_resolved" : "spell_resolved"
  );
  const enterWatchers = toZone === "battlefield" ? zoneChangeWatchers("enters") : [];
  return {
    ok: true,
    card: card.id,
    toZone,
    ...(enterWatchers.length
      ? { ENTER_TRIGGER_CANDIDATES: enterWatchers, note: "it entered the battlefield — these cards have trigger text mentioning enters (its own ETB lines included); check which apply and stack them" }
      : {}),
  };
}

export const actions: Record<string, (ctx: ActionCtx, p: any) => ActionResult> = {
  draw(ctx, p) {
    const player: PlayerId = p.player === undefined ? ctx.actor : asPlayer(p.player);
    const n = Math.max(1, Math.min(20, Number(p.n ?? p.count ?? 1)));
    const drawnCards: Card[] = [];
    for (let i = 0; i < n; i++) {
      const lib = game.players[player].zones.library;
      if (!lib.length) break;
      const card = game.cards[lib[0]];
      placeCard(card, "hand", player);
      card.tapped = false;
      drawnCards.push(card);
    }
    game.players[player].turnDone.draw = true;
    const drawn = drawnCards.map((c) => c.name);
    addLog(ctx.actor, `${who(player)} drew ${drawn.length} card${drawn.length === 1 ? "" : "s"}`, "drew", {
      [player]: `${who(player)} drew: ${drawn.join(", ") || "(library empty)"}`,
    });
    // your own draw returns the full cards (same shape as get_state), so the
    // drawn cards are read the moment they hit your hand
    if (player === "agent" && ctx.actor === "agent") markSeenByAgent(drawnCards.map((c) => c.id));
    return {
      ok: true,
      drawn: player === ctx.actor ? drawn : drawn.length,
      ...(player === ctx.actor ? { cards: drawnCards.map((c) => serializeCard(c, ctx.actor)) } : {}),
    };
  },

  /**
   * The universal move — takes one card or many. p: { card | cards: [...],
   * toZone, toPlayer?, position?: "top"|"bottom"|number, faceDown?,
   * revealTo?: "you"|"agent"|"all"|null, note? }
   * Card refs: id, or "top:you"/"top:agent" for the top of a library.
   */
  move(ctx, p) {
    const refs: string[] =
      Array.isArray(p.cards) && p.cards.length ? p.cards : [p.card ?? p.cardId];
    const toZone: Zone = p.toZone;
    if (!ZONES.includes(toZone)) throw new Error(`bad zone ${toZone}`);
    // resolve plain ids up front so a bad ref fails atomically before mutation;
    // "top:player" refs resolve lazily so repeated tops take successive cards
    for (const r of refs) if (!/^top:(you|agent)$/.test(r)) resolveCardRef(r);
    const seen = new Set<string>();
    const cards = refs.map((r) => {
      if (/^top:(you|agent)$/.test(r)) {
        const player = r.slice(4) as PlayerId;
        const lib = game.players[player].zones.library;
        const id = lib.find((x) => !seen.has(x));
        if (!id) throw new Error(`${player}'s library ran out of cards`);
        seen.add(id);
        return game.cards[id];
      }
      const c = resolveCardRef(r);
      seen.add(c.id);
      return c;
    });

    const movedIds: string[] = [];
    const removedTokens: string[] = [];
    // per-viewer name lists: a viewer sees the name if the card was or is visible to them
    const names: Record<PlayerId | "public", string[]> = { you: [], agent: [], public: [] };
    const fromZones = new Set<string>();
    let insertAt: number | null = null;
    let toPlayerForLog: PlayerId = p.toPlayer ?? cards[0].controller;

    let deaths = 0;
    let leftBf = 0;
    let enteredBf = 0;
    for (const card of cards) {
      const fromZone = card.zone;
      fromZones.add(fromZone);
      if (fromZone === "battlefield" && toZone === "graveyard") deaths++;
      else if (fromZone === "battlefield" && toZone !== "battlefield") leftBf++;
      if (toZone === "battlefield" && fromZone !== "battlefield") enteredBf++;
      const preVis = { you: cardVisibleTo(card, "you"), agent: cardVisibleTo(card, "agent") };
      // graveyards, exiles, libraries and command zones belong to the card's
      // OWNER (CR 404.1) — coerced, since a stolen creature dying once landed
      // in the thief's graveyard. There is no such thing as exiling a card to
      // someone else's exile. Hand is deliberately NOT coerced: theft effects
      // at this table put a stolen card in the thief's hand, and an explicit
      // toPlayer says so. Its default is still the owner.
      const ownerZone =
        toZone === "graveyard" || toZone === "exile" || toZone === "library" || toZone === "command";
      const toPlayer: PlayerId = ownerZone
        ? card.owner
        : p.toPlayer === undefined
          ? toZone === "hand"
            ? card.owner
            : card.controller
          : asPlayer(p.toPlayer, "toPlayer");
      toPlayerForLog = toPlayer;

      if (fromZone === "stack") game.stack = game.stack.filter((i) => i.cardId !== card.id);
      const list = relocateCard(card, toZone, toPlayer);
      card.attacking = null;
      card.blocking = null;
      if (toZone !== "battlefield") card.tapped = false;
      // visibility reset by relocateCard, then explicit grants apply
      card.faceDown = !!p.faceDown;
      if (p.revealTo === "all") card.visibleTo = [...PLAYERS];
      else if (p.revealTo === "you" || p.revealTo === "agent") card.visibleTo = [p.revealTo];
      // mover always gets to see a card it placed face-down (it chose the card)
      if (card.faceDown && toZone !== "library" && !card.visibleTo.includes(ctx.actor)) {
        card.visibleTo.push(ctx.actor);
      }

      // tokens cease to exist outside the battlefield
      if (card.isToken && toZone !== "battlefield") {
        delete game.cards[card.id];
        removedTokens.push(card.name);
        continue;
      }

      if (p.position === "bottom") list.push(card.id);
      else if (typeof p.position === "number") {
        list.splice(Math.max(0, Math.min(list.length, p.position + movedIds.length)), 0, card.id);
      } else if (toZone === "library") {
        // default library placement: top, preserving the given order
        insertAt = insertAt === null ? 0 : insertAt;
        list.splice(insertAt++, 0, card.id);
      } else list.push(card.id);
      movedIds.push(card.id);

      const postVis = { you: cardVisibleTo(card, "you"), agent: cardVisibleTo(card, "agent") };
      for (const v of PLAYERS) names[v].push(preVis[v] || postVis[v] ? card.name : "a hidden card");
      names.public.push(postVis.you && postVis.agent ? card.name : "a hidden card");
    }

    const n = cards.length;
    const fromDesc = fromZones.size === 1 ? ` from ${[...fromZones][0]}` : "";
    const suffix = p.note ? ` (${p.note})` : "";
    const fd = p.faceDown ? " face-down" : "";
    const tokenNote = removedTokens.length ? ` (${removedTokens.length} token${removedTokens.length === 1 ? "" : "s"} ceased to exist)` : "";
    const line = (list: string[]) =>
      `${who(ctx.actor)} moved ${n === 1 ? list[0] : `${n} cards (${list.join(", ")})`}${fromDesc} to ${who(toPlayerForLog)}'s ${toZone}${fd}${suffix}${tokenNote}`;
    const publicText = line(names.public);
    const priv: any = {};
    for (const v of PLAYERS) if (line(names[v]) !== publicText) priv[v] = line(names[v]);
    // A permanent reaching a graveyard is the one thing out here anybody
    // listens for. deaths is already counted above for the death triggers, so
    // the event is the count the move itself kept — not a reading of the
    // sentence it wrote, which said nothing at all when the cards came from
    // more than one zone.
    addLog(ctx.actor, publicText, deaths ? "permanent_died" : undefined, Object.keys(priv).length ? priv : undefined);

    const deathWatchers = deaths ? zoneChangeWatchers("dies") : [];
    const leaveWatchers = leftBf ? zoneChangeWatchers("leaves") : [];
    const enterWatchers = enteredBf ? zoneChangeWatchers("enters") : [];
    return {
      ok: true,
      cards: movedIds,
      removedTokens,
      ...(deathWatchers.length
        ? { DEATH_TRIGGER_CANDIDATES: deathWatchers, note: "something just died — these battlefield cards have trigger text mentioning dies/leaves; check which apply and stack them" }
        : {}),
      ...(leaveWatchers.length
        ? { LEAVE_TRIGGER_CANDIDATES: leaveWatchers }
        : {}),
      ...(enterWatchers.length
        ? { ENTER_TRIGGER_CANDIDATES: enterWatchers, note: "something entered the battlefield — these cards have trigger text mentioning enters (the entering card's own ETB lines included); check which apply and stack them" }
        : {}),
    };
  },

  untap(ctx, p) {
    return actions.tap(ctx, { ...p, tapped: false });
  },

  tap(ctx, p) {
    const ids: string[] = p.cards ?? p.cardIds;
    const tapped = p.tapped !== false;
    const names: string[] = [];
    for (const id of ids) {
      const c = getCard(id);
      if (c.zone !== "battlefield") throw new Error(`${c.name} is not on the battlefield`);
      c.tapped = tapped;
      names.push(publicDesc(c));
    }
    // untapping is deliberately not an event: it is bookkeeping at the top of
    // every turn, and it was silent before only because " tapped " happens not
    // to appear inside "untapped"
    addLog(ctx.actor, `${who(ctx.actor)} ${tapped ? "tapped" : "untapped"} ${names.join(", ")}`, tapped ? "tapped" : undefined);
    return { ok: true };
  },

  untap_all(ctx, p) {
    const player: PlayerId = p.player === undefined ? ctx.actor : asPlayer(p.player);
    untapPermanents(player);
    addLog(ctx.actor, `${who(player)} untapped all permanents`);
    return { ok: true };
  },

  counters(ctx, p) {
    const ids: string[] = Array.isArray(p.cards) && p.cards.length ? p.cards : [p.card ?? p.cardId];
    // never silently default the kind — a mis-named param once turned three
    // charge-counter bumps into +1/+1 bumps. Common aliases are accepted.
    const kind: string = p.kind ?? p.type ?? p.counterKind ?? p.counter;
    if (!kind) throw new Error(`counters requires kind (e.g. "+1/+1", "charge", "loyalty")`);
    const pt = kind === "+1/+1" || kind === "-1/-1";
    const parts: string[] = [];
    for (const id of ids) {
      const c = getCard(id);
      if (pt) {
        // +1/+1 and -1/-1 are ONE net quantity — they annihilate (CR 704.5r).
        // Stored under whichever kind the net actually is; never "+1/+1: -2".
        const sign = kind === "-1/-1" ? -1 : 1;
        let net = (c.counters["+1/+1"] || 0) - (c.counters["-1/-1"] || 0);
        net = p.set !== undefined ? sign * p.set : net + sign * (p.delta ?? 1);
        delete c.counters["+1/+1"];
        delete c.counters["-1/-1"];
        if (net > 0) c.counters["+1/+1"] = net;
        else if (net < 0) c.counters["-1/-1"] = -net;
        parts.push(`${publicDesc(c)} → ${net === 0 ? "no P/T counters" : net > 0 ? `${net} +1/+1` : `${-net} -1/-1`}`);
      } else {
        c.counters[kind] = p.set !== undefined ? p.set : (c.counters[kind] || 0) + (p.delta ?? 1);
        if (c.counters[kind] === 0) delete c.counters[kind];
        parts.push(`${publicDesc(c)} → ${c.counters[kind] || 0}`);
      }
    }
    addLog(ctx.actor, `${who(ctx.actor)} set ${pt ? "P/T" : kind} counters: ${parts.join(", ")}`);
    return { ok: true };
  },

  create_token(ctx, p) {
    // a nameless token is always a caller mistake (e.g. {token, count} instead
    // of {name, n}) — fail loudly with the expected shape
    const name = typeof p.name === "string" ? p.name.trim() : "";
    if (!name) {
      throw new Error(
        `create_token requires a non-empty "name" (got keys: ${JSON.stringify(Object.keys(p ?? {}))}). ` +
          `Use { name, n, player, power, toughness, typeLine, oracle }.`
      );
    }
    const n = Math.max(1, Math.min(20, p.n ?? 1));
    const player: PlayerId = p.player === undefined ? ctx.actor : asPlayer(p.player);
    // the deck's token catalog (built from Scryfall all_parts at load) supplies
    // art and copy; explicit params always win
    const cat = game.tokenCatalog?.[String(p.name ?? "").toLowerCase()];
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = newCardId();
      const token = makeCard({
        id,
        name: p.name,
        image: p.image ?? cat?.image,
        oracle: p.oracle ?? cat?.oracle,
        typeLine: p.typeLine || cat?.typeLine || "Token",
        power: p.power ?? cat?.power,
        toughness: p.toughness ?? cat?.toughness,
        owner: player,
        controller: player,
        zone: "battlefield",
        tapped: !!p.tapped,
        isToken: true,
      });
      game.cards[id] = token;
      game.players[player].zones.battlefield.push(id);
      // a batch is ONE object on the table, not n of them scattered across it:
      // each new token slides under the previous, so they arrive as a pile the
      // board already knows how to draw, drag as a unit and take apart.
      if (ids.length) game.cards[id].under = ids[ids.length - 1];
      ids.push(id);
    }
    addLog(ctx.actor, `${who(ctx.actor)} created ${n}x ${p.name} token for ${who(player)}`);
    const enterWatchers = zoneChangeWatchers("enters");
    return {
      ok: true,
      ids,
      ...(enterWatchers.length
        ? { ENTER_TRIGGER_CANDIDATES: enterWatchers, note: "tokens entered the battlefield — these cards have trigger text mentioning enters; check which apply and stack them" }
        : {}),
    };
  },

  /** Override a card's current P/T (layers shorthand); empty/absent power resets to printed. */
  set_pt(ctx, p) {
    const c = getCard(p.card ?? p.cardId);
    if (p.power === undefined || p.power === null || p.power === "") {
      if (c.basePower !== undefined) {
        c.power = c.basePower;
        c.toughness = c.baseToughness;
        delete c.basePower;
        delete c.baseToughness;
      }
      addLog(ctx.actor, `${who(ctx.actor)} reset ${c.name} to printed P/T (${c.power ?? "?"}/${c.toughness ?? "?"})`);
    } else {
      if (c.basePower === undefined) {
        c.basePower = c.power ?? "?";
        c.baseToughness = c.toughness ?? "?";
      }
      c.power = String(p.power);
      c.toughness = String(p.toughness ?? p.power);
      addLog(ctx.actor, `${who(ctx.actor)} set ${c.name} to ${c.power}/${c.toughness} (printed ${c.basePower}/${c.baseToughness})`);
    }
    return { ok: true, power: c.power, toughness: c.toughness };
  },

  // Board piles (replaces attach): tuck a card under another. Equip/auras and
  // board tidying are the same gesture — the pile's top card is the handle.
  tuck(ctx, p) {
    const c = getCard(p.card);
    if (p.under === null || p.under === undefined || p.under === "") {
      if (c.under) {
        spliceOutOfPile(c);
        addLog(ctx.actor, `${who(ctx.actor)} pulled ${publicDesc(c)} out of its pile`);
      }
      return { ok: true };
    }
    const t = getCard(p.under);
    if (t.id === c.id) throw new Error("cannot tuck a card under itself");
    if (t.zone !== "battlefield" || c.zone !== "battlefield") {
      throw new Error("piles only exist on the battlefield");
    }
    // a buried card leaves its pile ALONE; a pile top brings its chain along
    if (c.under) spliceOutOfPile(c);
    // any drop point on a pile means the same thing: slot in under its top
    let top = t;
    while (top.under) top = getCard(top.under);
    // tucking under your own pile (or yourself) would loop the chain
    for (let x: Card | null = c; x; x = cardBeneath(x)) {
      if (x.id === top.id) throw new Error(`${publicDesc(t)} is in ${publicDesc(c)}'s own pile`);
    }
    // c (and anything it carries) slides in directly beneath the top; the
    // displaced rung reattaches beneath the bottom of what c brought
    const prevSecond = cardBeneath(top);
    let bottom = c;
    for (let b = cardBeneath(bottom); b; b = cardBeneath(bottom)) bottom = b;
    c.under = top.id;
    if (prevSecond) prevSecond.under = bottom.id;
    addLog(ctx.actor, `${who(ctx.actor)} tucked ${publicDesc(c)} under ${publicDesc(top)}`);
    return { ok: true };
  },

  life(ctx, p) {
    const player: PlayerId = p.player === undefined ? ctx.actor : asPlayer(p.player);
    const ps = game.players[player];
    // no silent no-ops: a life call with neither field would log a life line
    // while changing nothing
    if (typeof p.set !== "number" && typeof p.delta !== "number") throw new Error("life requires delta or set");
    if (typeof p.set === "number") ps.life = p.set;
    else ps.life += p.delta ?? 0;
    addLog(ctx.actor, `${who(player)}'s life is now ${ps.life}`);
    return { ok: true, life: ps.life };
  },

  commander_tax(ctx, p) {
    const player = asPlayer(p.player, "player");
    const ps = game.players[player];
    if (typeof p.set === "number") ps.commanderTax = Math.max(0, p.set);
    else if (typeof p.delta === "number") ps.commanderTax = Math.max(0, (ps.commanderTax ?? 0) + p.delta);
    else throw new Error("commander_tax requires a numeric delta or set");
    addLog(ctx.actor, `${who(player)}'s commander tax is now ${ps.commanderTax}`);
    return { ok: true, commanderTax: ps.commanderTax };
  },

  commander_damage(ctx, p) {
    if (typeof p.delta !== "number") throw new Error("commander_damage requires a numeric delta");
    const commanders = Object.values(game.cards).filter((c) => c.isCommander);
    // heal any historical id-keyed entries into canonical names — every other
    // tool takes card ids, so models pass them here too, and "4 from c28" is
    // not a scoreboard
    for (const pl of PLAYERS) {
      const dmg = game.players[pl].commanderDamage;
      for (const [k, v] of Object.entries(dmg)) {
        const byId = game.cards[k];
        if (byId) {
          delete dmg[k];
          dmg[byId.name] = (dmg[byId.name] || 0) + v;
        }
      }
    }
    const ref = String(p.commander ?? "");
    const match =
      commanders.find((c) => c.id === ref) ??
      commanders.find((c) => c.name.toLowerCase() === ref.toLowerCase()) ??
      (ref.length >= 4 ? commanders.find((c) => c.name.toLowerCase().includes(ref.toLowerCase())) : undefined);
    if (!match) {
      throw new Error(
        `unknown commander ${JSON.stringify(ref)} — commanders in this game: ${commanders.map((c) => `${c.name} (${c.id})`).join(", ") || "(none)"}`
      );
    }
    const ps = game.players[asPlayer(p.to, "to")];
    ps.commanderDamage[match.name] = (ps.commanderDamage[match.name] || 0) + p.delta;
    if (!ps.commanderDamage[match.name]) delete ps.commanderDamage[match.name];
    addLog(ctx.actor, `${who(p.to)} has taken ${ps.commanderDamage[match.name] || 0} commander damage from ${match.name}`);
    return { ok: true, commander: match.name, total: ps.commanderDamage[match.name] || 0 };
  },

  reveal(ctx, p) {
    const ids: string[] = p.cards;
    const to: "all" | PlayerId = p.to ?? "all";
    const names: string[] = [];
    for (const id of ids) {
      const c = getCard(id);
      const grant = to === "all" ? [...PLAYERS] : [to];
      for (const g of grant) if (!c.visibleTo.includes(g)) c.visibleTo.push(g);
      names.push(c.name);
    }
    const entry =
      to === "all"
        ? addLog(ctx.actor, `${who(ctx.actor)} revealed: ${names.join(", ")}`)
        : addLog(ctx.actor, `${who(ctx.actor)} revealed ${ids.length} card(s) to ${who(to)}`, undefined, {
            [to]: `${who(ctx.actor)} revealed to you: ${names.join(", ")}`,
            [ctx.actor]: `You revealed to ${who(to)}: ${names.join(", ")}`,
          });
    // the cards themselves, for the client to open in a browser — the log line
    // says which cards, this says which CARDS
    entry.cards = [...ids];
    return { ok: true, names };
  },

  /** Read one card's full details by id — anything you can legally see.
   * Free and unlogged, like reading a card across a paper table. */
  read_card(ctx, p) {
    const c = getCard(p.card ?? p.cardId);
    if (!cardVisibleTo(c, ctx.actor)) throw new Error(`${c.zone === "hand" || c.zone === "library" ? "that card is hidden from you" : "that card is face-down"} — read_card only shows cards you can legally see`);
    if (ctx.actor === "agent") markSeenByAgent([c.id]);
    return { ok: true, card: serializeCard(c, ctx.actor) };
  },

  /** Look at top N of a library (scry/surveil/impulse start). Private to the actor. */
  peek(ctx, p) {
    if (p.card ?? p.cardId) {
      throw new Error("peek looks at the TOP of a library ({player, n}) — to read one card's text use read_card {card}");
    }
    const player: PlayerId = p.player === undefined ? ctx.actor : asPlayer(p.player);
    const n = Math.max(1, Math.min(20, p.n ?? 1));
    const lib = game.players[player].zones.library;
    const cards = lib.slice(0, n).map((id) => serializeCard(game.cards[id], ctx.actor, { reveal: true }));
    if (ctx.actor === "agent") markSeenByAgent(lib.slice(0, n));
    addLog(ctx.actor, `${who(ctx.actor)} looked at the top ${n} of ${who(player)}'s library`);
    return { ok: true, cards };
  },

  /** Reorder the top of a library: p.top = ids (new order, first = top), p.toBottom = ids. */
  reorder_top(ctx, p) {
    const player: PlayerId = p.player === undefined ? ctx.actor : asPlayer(p.player);
    const lib = game.players[player].zones.library;
    const moving: string[] = [...(p.top ?? []), ...(p.toBottom ?? [])];
    for (const id of moving) {
      const i = lib.indexOf(id);
      if (i < 0) throw new Error(`card ${id} is not in ${player}'s library`);
      lib.splice(i, 1);
    }
    lib.unshift(...(p.top ?? []));
    lib.push(...(p.toBottom ?? []));
    addLog(
      ctx.actor,
      `${who(ctx.actor)} put ${p.top?.length ?? 0} card(s) on top and ${p.toBottom?.length ?? 0} on the bottom of ${who(player)}'s library`
    );
    return { ok: true };
  },

  /** View a whole zone (search a library, look at a hand via an effect, read a graveyard). */
  view_zone(ctx, p) {
    const player: PlayerId = p.player === undefined ? ctx.actor : asPlayer(p.player);
    const zone: Zone = p.zone;
    const list = game.players[player].zones[zone];
    const cards = list.map((id) => serializeCard(game.cards[id], ctx.actor, { reveal: true }));
    if (ctx.actor === "agent") markSeenByAgent(list);
    if (zone === "library" || (zone === "hand" && player !== ctx.actor)) {
      addLog(ctx.actor, `${who(ctx.actor)} looked at ${who(player)}'s ${zone} (${list.length} cards)`);
    }
    return { ok: true, cards };
  },

  shuffle(ctx, p) {
    const player: PlayerId = p.player === undefined ? ctx.actor : asPlayer(p.player);
    shuffleZone(player);
    addLog(ctx.actor, `${who(player)}'s library was shuffled`);
    return { ok: true };
  },

  /** Take the hand back and deal a fresh one.
   *
   *  One action rather than the move/shuffle/draw it used to be, because a
   *  mulligan is not a play — it is the deal happening again. Three actions
   *  left three undo steps to walk back through and three log lines, one of
   *  which ("Player moved…") is exactly what the next-action prompt reads as
   *  "the player has started", so mulliganing jumped the prompt off its
   *  opening silence and into the turn. Afterwards the table looks the way it
   *  looked when New game dealt it: same turn, same phase, empty stack,
   *  nothing to undo, and one line in the log saying what happened. */
  mulligan(ctx, p) {
    const player: PlayerId = p.player === undefined ? ctx.actor : asPlayer(p.player);
    if (game.turnNumber !== 1 || game.players[player].turnDone.acted) {
      throw new Error("mulligans are decided before anything is played — you have already started the turn");
    }
    const n = Math.max(0, Math.min(20, Number(p.n ?? 7)));
    for (const id of [...game.players[player].zones.hand]) {
      const card = game.cards[id];
      placeCard(card, "library", player);
      card.tapped = false;
      card.faceDown = false;
    }
    shuffleZone(player);
    const drawn: Card[] = [];
    for (let i = 0; i < n; i++) {
      const lib = game.players[player].zones.library;
      if (!lib.length) break;
      const card = game.cards[lib[0]];
      placeCard(card, "hand", player);
      card.tapped = false;
      drawn.push(card);
    }
    addLog(ctx.actor, `${who(player)} mulliganed to ${drawn.length}`, undefined, {
      [player]: `${who(player)} mulliganed to ${drawn.length}: ${drawn.map((c) => c.name).join(", ") || "(library empty)"}`,
    });
    return { ok: true, hand: drawn.length };
  },

  /** Declare a phase/step change — applies immediately. The only turn-structure
   * stack item is the TURN PASS (set_turn); attack/block declarations and any
   * announced triggers still create their own priority windows. */
  set_phase(ctx, p) {
    const phase = normalizePhase(p.phase);
    if (phase === "combat") {
      // a genuine ENTRY resets the sub-machine, marks included; re-declaring
      // combat (or narrating a step label that folds to it — "declare
      // blockers", "combat damage") mid-combat changes nothing. Sweeping on
      // every combat-folding label wiped the live combat's attackers the
      // moment a seat named the step it was already in. A second combat in a
      // turn flows through main 2 first, and restarting one in place is what
      // undo and clear_combat are for.
      if (game.phase !== "combat") {
        game.combat = "attackers";
        clearCombatMarks();
      }
    } else if (game.combat !== null) {
      // Leaving combat ends it, marks included. The marks used to linger
      // until the turn passed — three creatures stood ringed as blocking
      // Rats that had ceased to exist two log lines earlier.
      game.combat = null;
      clearCombatMarks();
    }
    game.phase = phase;
    // The untap step is the one part of a turn with nothing to decide in it, so
    // it should not be something a seat can forget — and it was. The untap
    // lived in the client, which meant it happened for Player and never for the
    // agent: the agent moved the marker to "untap" and its lands stayed tapped.
    // It did that twice in one game and then explained the board as though they
    // had untapped, which cost two windows of argument to unpick.
    //
    // The ACTIVE player's permanents, not the actor's: whoever moves the marker,
    // an untap step untaps the seat whose turn it is.
    //
    // The RAW label decides, not the folded phase: "upkeep" and "draw" fold into
    // untap/upkeep but are not the untap step, and declaring one of them never
    // untapped before the vocabulary existed either.
    //
    // And once per turn: the turn remembers its untap, so re-announcing the
    // step a seat is already past does not turn a creature tapped for mana
    // back over. Saying it outright (untap_all) is still always allowed.
    const rawKey = String(p.phase ?? "").trim().toLowerCase();
    const isUntapStep = phase === "untap/upkeep" && (rawKey === "untap" || rawKey === "untap/upkeep");
    const untapped = isUntapStep && !game.players[game.turn].turnDone.untap ? untapPermanents(game.turn) : 0;
    addLog(
      ctx.actor,
      `${who(ctx.actor)} moves to ${phase}` + (untapped ? ` — untapped ${untapped} permanent${untapped === 1 ? "" : "s"}` : ""),
      "phase_change"
    );
    return { ok: true, stackSize: game.stack.length, ...(untapped ? { untapped } : {}) };
  },

  /** Declare the turn pass — goes ON THE STACK; resolving it is the opponent's end-of-turn sign-off. */
  set_turn(ctx, p) {
    if (game.stack.length) {
      throw new Error(
        `cannot pass the turn with ${game.stack.length} item(s) on the stack — resolve, counter, or take them back first: ${game.stack.map((i) => i.text.slice(0, 40)).join(" · ")}`
      );
    }
    const player: PlayerId = asPlayer(p.player);
    // Handing the turn to whoever already has it is almost always a slip of
    // the wrist, and it does not read as one: the round counter only moves
    // when the turn comes back round to the player, so a seat passing to
    // itself silently replays the same round. An extra turn IS a real thing,
    // so it stays available — it just has to be meant.
    const extra = p.extra === true;
    if (player === game.turn && !extra) {
      throw new Error(
        `it is already ${who(player)}'s turn — pass to the other seat, or if a spell is granting an extra turn, pass extra: true`
      );
    }
    pushStackItem(ctx.actor, {
      cardId: null,
      text: extra && player === game.turn
        ? `EXTRA TURN: ${who(player)} takes another turn when this resolves`
        : `TURN PASS: ${who(player)}'s turn begins when this resolves`,
      apply: { type: "turn", player },
    });
    addLog(
      ctx.actor,
      `${who(ctx.actor)} declares ${extra && player === game.turn ? "an extra turn for" : "the turn pass to"} ${who(player)} (on the stack)`,
      "turn_pass_declared"
    );
    return { ok: true, stackSize: game.stack.length };
  },

  /** Declare attackers — goes ON THE STACK; the defender resolves to lock it in (or responds first). */
  attack(ctx, p) {
    // Only the active player has an attack step. This is not a judgment call
    // the two seats can argue about like a targeting restriction — a defender
    // declaring attackers is a category error, and it happened: an attack of
    // Player's landed on the stack during the agent's combat, and the agent
    // had to stop, refuse it, and ask for it to be taken back. The seat that
    // is being attacked declares BLOCKS.
    if (game.turn !== ctx.actor) {
      throw new Error(
        `it is ${who(game.turn)}'s turn, so only ${who(game.turn)} declares attackers — use block to declare blockers (declaring none is still a declaration)`
      );
    }
    // ONE declaration, however many creatures it took to say it. Tapping four
    // attackers with E is four calls, and each used to push its own stack item
    // and its own undo step — so undo peeled one creature off a declaration
    // the UI had presented as a single action ("Finish declaring attackers"),
    // and the stack read as four declarations instead of one attack.
    const open = openAttackDeclaration(ctx.actor);
    const pairs = open?.apply?.type === "attack" ? [...open.apply.pairs] : [];
    for (const pair of p.pairs) {
      getCard(pair.attacker); // resolves, so a bad id fails before anything changes
      // re-declaring a creature already in it changes its target, not its count
      const at = pairs.findIndex((x) => x.attacker === pair.attacker);
      if (at >= 0) pairs[at] = pair;
      else pairs.push(pair);
    }
    const all = pairs.map((pair) => {
      const c = getCard(pair.attacker);
      const tgt = pair.target === "you" || pair.target === "agent" ? who(pair.target) : publicDesc(getCard(pair.target));
      return `${publicDesc(c)} → ${tgt}`;
    });
    if (open) {
      open.text = `ATTACKS: ${all.join("; ")}`;
      open.apply = { type: "attack", pairs };
      // declaring another creature means you are not finished any more
      delete open.finished;
    } else {
      pushStackItem(ctx.actor, { cardId: null, text: `ATTACKS: ${all.join("; ")}`, apply: { type: "attack", pairs } });
    }
    // the log names the whole declaration as it now stands, so the ↩ notice
    // for taking it back names the same thing the stack shows
    addLog(ctx.actor, `${who(ctx.actor)} declares attackers (on the stack): ${all.join("; ")}`, "attackers_declared");
    return { ok: true, stackSize: game.stack.length, attacking: all };
  },

  /** Declare blockers — goes ON THE STACK; the attacker resolves to lock it in. */
  block(ctx, p) {
    const lines = blockLines(p.pairs);
    // The stack item renders lines[] as rows under its headline (see the
    // damage announcement, which does the same), so a multi-attacker block is
    // a short list rather than one sentence with five semicolons in it.
    //
    // One group needs no headline over it: "BLOCKS: 1 blocker on 1 attacker"
    // is a summary longer than the thing it summarises. Declaring nothing is
    // still a real declaration and says so, rather than leaving a stack item
    // that trails off after the colon.
    const summary = !lines.length
      ? "no blocks"
      : lines.length === 1
        ? lines[0]
        : `${p.pairs.length} blockers on ${lines.length} attackers`;
    pushStackItem(ctx.actor, {
      cardId: null,
      text: `BLOCKS: ${summary}`,
      ...(lines.length > 1 ? { lines } : {}),
      apply: { type: "block", pairs: p.pairs },
    });
    addLog(ctx.actor, `${who(ctx.actor)} declares blockers (on the stack): ${lines.join("; ") || "no blocks"}`, "blockers_declared");
    return { ok: true, stackSize: game.stack.length };
  },

  /** Announce damage — the whole damage step as ONE stack item.
   *
   *  Announcing and applying used to be four calls (stack_push, then life,
   *  then commander_damage, then move) and four chances to drop one. Commander
   *  damage was the one that got dropped: a 3-point commander hit is two
   *  numbers, and only the first one is visible on the life counter.
   *
   *  Resolving it applies exactly what was DECLARED — nothing here decides
   *  lethality or reads a creature's power. Damage on a creature that lives is
   *  not tracked either: a counter that nothing clears at end of turn would be
   *  a worse lie than no counter at all. */
  damage(ctx, p) {
    // Combat has an order. This is the whole reason game.combat exists: the
    // agent once announced "unblocked ×3" before the defender had a
    // declare-blockers step, and nothing here objected. "attackers" and
    // "blockers" both mean blocks are still owed — a declaration on the stack
    // is not an answer until the attacker locks it in. null and "done" pass:
    // a ping in main owes nobody a blocks step, and re-announcing after
    // damage resolved is a legal correction.
    if (game.combat === "attackers" || game.combat === "blockers") {
      throw new Error(
        "declare blockers first — blocks must be declared AND locked in (stack_resolve) before damage is announced. A defender with nothing to block declares block with pairs: [], and resolving that opens the damage step."
      );
    }
    const raw: any[] = Array.isArray(p.hits) ? p.hits : [];
    const hits: DamageHit[] = raw.map((h, i) => {
      const source = getCard(String(h?.source ?? ""));
      const amount = Number(h?.amount);
      if (!Number.isFinite(amount)) throw new Error(`hit ${i + 1} (${source.name}): amount must be a number`);
      const target = h?.target === "you" || h?.target === "agent" ? (h.target as PlayerId) : getCard(String(h?.target ?? "")).id;
      return { source: source.id, target, amount, ...(h?.note ? { note: String(h.note) } : {}) };
    });
    // resolved up front so a bad id fails before anything reaches the stack
    const dies: string[] = (Array.isArray(p.dies) ? p.dies : []).map((id: string) => getCard(String(id)).id);
    if (!hits.length && !dies.length) throw new Error("damage needs at least one hit, or a card in dies");

    const lines = [
      ...hits.map((h) => {
        const src = getCard(h.source);
        const toPlayer = h.target === "you" || h.target === "agent";
        const tgt = toPlayer ? who(h.target as PlayerId) : publicDesc(getCard(h.target));
        const cmd = toPlayer && src.isCommander ? " (commander damage)" : "";
        return `${publicDesc(src)} → ${tgt}: ${h.amount}${cmd}${h.note ? ` — ${h.note}` : ""}`;
      }),
      ...dies.map((id) => `${publicDesc(getCard(id))} dies`),
    ];
    pushStackItem(ctx.actor, {
      cardId: null,
      text: String(p.text || "COMBAT DAMAGE"),
      lines,
      // whether this is COMBAT damage is decided here, when it is announced,
      // not where it resolves: a ping announced in main is not combat damage
      // however long it sits on the stack under a combat that started later
      apply: { type: "damage", hits, dies, combatDamage: game.combat !== null },
    });
    addLog(ctx.actor, `${who(ctx.actor)} announces damage (on the stack): ${lines.join("; ")}`);
    return { ok: true, stackSize: game.stack.length };
  },

  clear_combat(ctx, _p) {
    // Two jobs share this one button. Before damage it is "Cancel attack":
    // the combat goes back to declaring attackers, so the swing can be made
    // again — leaving it null stranded the sub-machine, since re-declaring
    // the phase you are already in is a no-op. AFTER damage it is tidying up
    // a combat that is over, and "done" is still the truth: saying
    // "attackers" there would refuse a legal second damage announcement, and
    // would take a bare "main" back to main 1. Outside combat there is
    // nothing to return to, and clearing stray marks simply ends it.
    game.combat = game.phase !== "combat" ? null : game.combat === "done" ? "done" : "attackers";
    clearCombatMarks();
    addLog(ctx.actor, `Combat cleared`);
    return { ok: true };
  },

  /**
   * Cast a spell: the card goes onto the shared stack, publicly visible.
   * EXCEPTION (CR 115.2a): playing a land is a special action — it never uses
   * the stack and can't be responded to; it goes straight to the battlefield.
   */
  cast(ctx, p) {
    if (p.respondAt) retractTailAbove(ctx.actor, p.respondAt);
    const card = resolveCardRef(p.card ?? p.cardId);
    // "read the card before playing it" is enforced, not just prompted: the
    // agent can only cast what has actually been delivered to its context
    if (ctx.actor === "agent" && !(game.agentSeen ??= {})[card.id]) {
      throw new Error(
        `READ FIRST: ${card.name}'s oracle text has not been shown to you this game — call get_state (hand and command zone), read_card, or view_zone, then cast it`
      );
    }
    if (p.face !== undefined) applyFace(card, Number(p.face));
    // the effective type is the ACTIVE face's for DFCs: the explicit face
    // param, else whatever face the card is already flipped to (a card turned
    // to its land side in hand must play as a land), else the front face.
    // Never the whole card's — a DFC's composite type line names BOTH faces
    // ("Sorcery // Land"), so every test against it answers yes twice.
    const activeFace = p.face !== undefined ? Number(p.face) : (card.face ?? 0);
    const effType = (card.faces ? card.faces[activeFace]?.typeLine : undefined) ?? card.typeLine ?? "";
    // an explicit resolveTo means this is an EFFECT moving the card (reanimate,
    // return to hand), not a land drop — those always use the stack
    const isLandPlay = !p.resolveTo && /\bland\b/i.test(effType) && !/\b(instant|sorcery)\b/i.test(effType);
    if (isLandPlay) {
      placeCard(card, "battlefield", ctx.actor);
      card.faceDown = false;
      game.players[ctx.actor].turnDone.lands += 1;
      addLog(ctx.actor, `${who(ctx.actor)} played ${card.name}${p.note ? ` (${p.note})` : ""} — land drop, special action, no stack`, "land_played");
      const landTrig = triggerLines(card);
      const landWatchers = zoneChangeWatchers("enters");
      return {
        ok: true,
        card: card.id,
        landPlay: true,
        ...(landTrig.length
          ? { TRIGGERS_ON_THIS_CARD: landTrig, note: "the land drop itself is stackless, but these triggers still go on the stack (stack_push)" }
          : {}),
        ...(landWatchers.length ? { ENTER_TRIGGER_CANDIDATES: landWatchers } : {}),
      };
    }
    // declared targets are PUBLIC stack information — resolve them before any
    // mutation so a bad ref fails atomically, and bake them into the item text
    const targetNames = (Array.isArray(p.targets) ? p.targets : []).map((t: string) =>
      t === "you" || t === "agent" ? who(t as PlayerId) : publicDesc(getCard(t))
    );
    const targetText = targetNames.length ? ` ⟶ ${targetNames.join(", ")}` : "";
    // The {2}-per-previous-cast surcharge, charged where the cast happens
    // rather than left for whoever remembers. It was a counter both seats had
    // to bump by hand, and in a real game neither did. A land played off the
    // command zone returned above, so this is only reached by a real cast.
    if (card.zone === "command") game.players[card.owner].commanderTax = (game.players[card.owner].commanderTax ?? 0) + 2;
    // recasting something already on the stack drops its old item first
    if (card.zone === "stack") game.stack = game.stack.filter((i) => i.cardId !== card.id);
    placeCard(card, "stack", ctx.actor);
    card.faceDown = false;
    card.tapped = false;
    pushStackItem(ctx.actor, {
      cardId: card.id,
      text: `${p.note ? `${card.name} — ${p.note}` : card.name}${targetText}`,
      // Which face was cast is known HERE and nowhere later: on the stack a
      // DFC is one card with one composite type line, and the resolver reading
      // it cannot tell a Sorcery // Land cast as a sorcery from the same card
      // cast as a land. It guessed permanent, and Sundering Eruption resolved
      // as Volcanic Fissure onto the battlefield. So the face decides the
      // destination at cast time, and resolve just obeys.
      ...(p.resolveTo
        ? { resolveTo: p.resolveTo as Zone }
        : card.faces
          ? { resolveTo: (/\b(instant|sorcery)\b/i.test(effType) ? "graveyard" : "battlefield") as Zone }
          : {}),
      ...(p.resolveToPlayer ? { resolveToPlayer: asPlayer(p.resolveToPlayer, "resolveToPlayer") } : {}),
    });
    const verb = /\bland\b/i.test(effType) ? "played" : "cast";
    addLog(ctx.actor, `${who(ctx.actor)} ${verb} ${card.name}${p.note ? ` (${p.note})` : ""}${targetText} → on the stack`, "cast");
    const trig = triggerLines(card);
    return {
      ok: true,
      card: card.id,
      stackSize: game.stack.length,
      ...(trig.length
        ? { TRIGGERS_ON_THIS_CARD: trig, note: "batch the applicable ones onto the stack WITH this cast (stack_batch) — a trigger not on the stack did not happen" }
        : {}),
    };
  },

  /** Announce a trigger or activated ability as a text-only stack item.
   * p.source: the id of the permanent the ability comes from (validated). */
  stack_push(ctx, p) {
    const text = p.text ?? p.note;
    if (!text || !String(text).trim()) throw new Error("stack_push requires text");
    if (p.respondAt) retractTailAbove(ctx.actor, p.respondAt);
    const sourceId = p.source ? getCard(p.source).id : undefined;
    const lines = Array.isArray(p.lines) && p.lines.length ? p.lines.map((l: any) => String(l).slice(0, 300)).slice(0, 30) : undefined;
    pushStackItem(ctx.actor, {
      cardId: null,
      text: String(text),
      ...(sourceId ? { sourceId } : {}),
      ...(lines ? { lines } : {}),
    });
    addLog(
      ctx.actor,
      `${who(ctx.actor)} put on the stack: ${text}${lines ? "\n" + lines.map((l: string, i: number) => `  ${i + 1}. ${l}`).join("\n") : ""}`,
      "ability_stacked"
    );
    return { ok: true, stackSize: game.stack.length };
  },

  /**
   * Push several items as ONE proposed sequence (MTR-style shortcut): an event
   * plus all its triggers, or a planned run of casts. Items share a groupId so
   * the opponent can accept the lot with stack_resolve_all, or respond at any
   * point (respondAt) — which retracts the retractable tail above that point.
   * Each item: { card?, text?, face?, resolveTo?, retractable? }. Lands inside
   * a batch stay special actions (straight to battlefield, CR 115.2a).
   */
  stack_batch(ctx, p) {
    if (!Array.isArray(p.items) || !p.items.length) throw new Error("stack_batch requires items");
    const groupId = "g" + (game.seq + 1);
    const pushed: string[] = [];
    for (const item of p.items) {
      const before = game.stack.length;
      if (item.card ?? item.cardId) {
        actions.cast(ctx, { ...item, respondAt: undefined });
      } else {
        actions.stack_push(ctx, { ...item, respondAt: undefined });
      }
      if (game.stack.length > before) {
        const top = game.stack[game.stack.length - 1];
        top.groupId = groupId;
        if (item.retractable) top.retractable = true;
        pushed.push(top.id);
      }
    }
    if (pushed.length > 1) {
      addLog(
        ctx.actor,
        `${who(ctx.actor)} proposed the ${pushed.length} items above as one sequence — resolve all, or respond at any point`,
        "sequence_proposed"
      );
    }
    return { ok: true, groupId, items: pushed, stackSize: game.stack.length };
  },

  /** Resolve any of the OPPONENT's stack items (p.item targets by id; default =
   * top) — no top-only rule, but you never resolve your own item: resolving is
   * the opponent's acknowledgment. A COUNTERED item resolves as a fizzle. */
  stack_resolve(ctx, p) {
    const idx = p.item ? game.stack.findIndex((i) => i.id === p.item) : game.stack.length - 1;
    const item = idx >= 0 ? game.stack[idx] : undefined;
    if (!item) throw new Error(p.item ? `no stack item ${p.item}` : "the stack is empty");
    if (item.player === ctx.actor) {
      throw new Error("that's your own item — the opponent resolves it (or take it back with stack_remove)");
    }
    game.stack.splice(idx, 1);
    if (item.countered) return fizzleItem(ctx, item);
    return resolveStackItem(ctx, item, p);
  },

  /**
   * Accept an opponent's whole proposal: resolve items LIFO from the top for
   * as long as they belong to the opponent (optionally only one groupId).
   * Refuses if the top item is your own — you can't resolve your own proposal.
   */
  stack_resolve_all(ctx, p) {
    if (!game.stack.length) throw new Error("the stack is empty");
    if (game.stack[game.stack.length - 1].player === ctx.actor) {
      throw new Error("the top of the stack is your own item — the opponent resolves those");
    }
    // take the contiguous opponent-owned run from the top
    let from = game.stack.length;
    while (from > 0 && game.stack[from - 1].player !== ctx.actor && (!p.group || game.stack[from - 1].groupId === p.group)) from--;
    const run = game.stack.splice(from);
    // a grouped segment is an accepted PROPOSAL: it executes in proposal order
    // (each item was contingent on the one before it). Ungrouped items are a
    // true stack and resolve LIFO. Walk top-down, reversing each group run.
    const order: StackItem[] = [];
    for (let i = run.length - 1; i >= 0; ) {
      if (run[i].groupId) {
        const gid = run[i].groupId;
        let j = i;
        while (j >= 0 && run[j].groupId === gid) j--;
        for (let k = j + 1; k <= i; k++) order.push(run[k]);
        i = j;
      } else {
        order.push(run[i]);
        i--;
      }
    }
    const resolved: string[] = [];
    for (const item of order) {
      resolved.push(item.text);
      if (item.countered) fizzleItem(ctx, item);
      else resolveStackItem(ctx, item, {});
    }
    return { ok: true, resolved };
  },

  /** Counter MARKS a stack item (toggle) — it stays on the stack so responses
   * can reference it; resolving it later fizzles it. p.item targets by id;
   * default top. */
  stack_counter(ctx, p) {
    const item = p.item ? game.stack.find((i) => i.id === p.item) : game.stack[game.stack.length - 1];
    if (!item) throw new Error(p.item ? `no stack item ${p.item}` : "the stack is empty");
    item.countered = !item.countered;
    addLog(
      ctx.actor,
      item.countered
        ? `${who(ctx.actor)} countered: ${item.text} (marked — resolve it to fizzle)`
        : `${who(ctx.actor)} un-countered: ${item.text}`
    );
    return { ok: true, countered: item.countered };
  },

  /** Take back an illegal/mistaken stack item: card returns to its owner's hand. p.index targets a specific item (0 = bottom); default top. */
  stack_remove(ctx, p) {
    if (!game.stack.length) throw new Error("the stack is empty");
    const index = typeof p.index === "number" ? p.index : game.stack.length - 1;
    const [item] = game.stack.splice(index, 1);
    if (!item) throw new Error(`no stack item at index ${index}`);
    if (item.cardId) {
      const card = getCard(item.cardId);
      placeCard(card, "hand", card.owner);
      addLog(ctx.actor, `${who(ctx.actor)} took ${card.name} back off the stack → ${who(card.owner)}'s hand`);
    } else {
      addLog(ctx.actor, `${who(ctx.actor)} removed from the stack: ${item.text}`);
    }
    return { ok: true };
  },

  /**
   * Turn a card face-down (or back up) in place — morphs, cloaked cards, any
   * "keep this secret" moment. Either player may flip any card; while face-down
   * the server hides it from everyone except the players who already know it.
   */
  flip_card(ctx, p) {
    const ids: string[] = Array.isArray(p.cards) && p.cards.length ? p.cards : [p.card ?? p.cardId];
    const faceDown = p.faceDown !== false;
    const names: string[] = [];
    for (const id of ids) {
      const c = getCard(id);
      names.push(c.name);
      c.faceDown = faceDown;
      if (faceDown) {
        // the flipper knows what it is; everyone else loses sight of it
        c.visibleTo = c.visibleTo.filter((v) => v === ctx.actor);
        if (!c.visibleTo.includes(ctx.actor)) c.visibleTo.push(ctx.actor);
      } else {
        c.visibleTo = [...PLAYERS];
      }
    }
    const n = ids.length;
    if (faceDown) {
      addLog(
        ctx.actor,
        `${who(ctx.actor)} turned ${n === 1 ? "a card" : `${n} cards`} face-down`,
        { [ctx.actor]: `You turned ${names.join(", ")} face-down` } as any
      );
    } else {
      addLog(ctx.actor, `${who(ctx.actor)} turned ${names.join(", ")} face-up`);
    }
    return { ok: true, faceDown, cards: ids };
  },

  /** Show a different face of a double-faced card (MDFC land side, transformed creature, …). */
  set_face(ctx, p) {
    const c = getCard(p.card ?? p.cardId);
    const face = Number(p.face ?? 0);
    applyFace(c, face);
    // flipping a HIDDEN card (in hand) must not leak its name to the opponent
    const detail = `${who(ctx.actor)} turned to ${c.name} (${face === 0 ? "front" : "back"} face)`;
    const opponent: PlayerId = ctx.actor === "you" ? "agent" : "you";
    if (cardVisibleTo(c, opponent)) {
      addLog(ctx.actor, detail);
    } else {
      addLog(ctx.actor, `${who(ctx.actor)} turned a hidden card to its other face`, undefined, { [ctx.actor]: detail });
    }
    return { ok: true, face, name: c.name };
  },

  /** Move cards around the table surface. Cosmetic: no log entry, no undo
   *  step, and it never wakes the agent — sliding a card is not a game action.
   *  Either seat may place any battlefield card; the table is shared. */
  place(_ctx, p) {
    const positions: { card: string; x: number; y: number }[] = p.positions ?? [];
    const moved: string[] = [];
    for (const at of positions) {
      const c = getCard(at.card);
      // unresolved cards sit on the table too — placing one pre-chooses the
      // spot it resolves into
      if (c.zone !== "battlefield" && c.zone !== "stack") {
        throw new Error(`${c.name} is in ${c.zone} — only cards on the table (battlefield or stack) have a position`);
      }
      c.pos = { x: clamp01(Number(at.x)), y: clamp01(Number(at.y)) };
      c.z = nextZ();
      moved.push(c.id);
    }
    return { ok: true, placed: moved.length };
  },

  roll(ctx, p) {
    const sides = p.sides ?? 20;
    const result = 1 + Math.floor(Math.random() * sides);
    addLog(ctx.actor, `${who(ctx.actor)} rolled a d${sides}: ${result}`);
    return { ok: true, result };
  },

  flip(ctx, _p) {
    const result = Math.random() < 0.5 ? "heads" : "tails";
    addLog(ctx.actor, `${who(ctx.actor)} flipped a coin: ${result}`);
    return { ok: true, result };
  },

  chat(ctx, p) {
    const text = p.text ?? p.message ?? p.msg;
    if (!text || !String(text).trim()) throw new Error("chat requires text");
    addTalk(ctx.actor, `💬 ${who(ctx.actor)}: ${text}`);
    if (ctx.actor === "you" && game.pendingQuestion) game.pendingQuestion = null;
    return { ok: true };
  },

  ask_user(ctx, p) {
    const question = p.question ?? p.text ?? p.message;
    if (!question || !String(question).trim()) throw new Error("ask_user requires question");
    game.pendingQuestion = question;
    addTalk(ctx.actor, `❓ ${who(ctx.actor)} asks: ${question}`);
    return { ok: true };
  },

  done(ctx, _p) {
    // passing is a response, not a play: it is one player telling the other
    // they are finished. Nothing about the game changed, so it stays out of
    // the undo history in both directions.
    game.waitingOn = ctx.actor === "you" ? "agent" : "you";
    addTalk(ctx.actor, `${who(ctx.actor)} passes — ${who(game.waitingOn)}'s window`);
    return { ok: true };
  },

  /** The last thing you do when declaring attackers: the declaration is
   *  finished, and it is the defender's to answer.
   *
   *  This hands priority over exactly the way done does, and for a while it
   *  WAS done — which cost it everything a pass is not. A pass is not a play,
   *  so it is not undoable, so pressing this button could not be taken back;
   *  it says "Player passes", so the log never told the defender what it was
   *  being handed; and it is the same event as passing on an empty stack, so
   *  nothing downstream could treat the two differently. Finishing a
   *  declaration is the closing move of a play, and it is undoable, named,
   *  and its own event here. */
  finish_attacks(ctx, _p) {
    const decl = openAttackDeclaration(ctx.actor);
    if (!decl) throw new Error("no attack declaration to finish — declare attackers first (attack)");
    const pairs = decl.apply?.type === "attack" ? decl.apply.pairs : [];
    decl.finished = true;
    const names = pairs.map((pair) => publicDesc(getCard(pair.attacker))).join(", ");
    game.waitingOn = ctx.actor === "you" ? "agent" : "you";
    addLog(
      ctx.actor,
      `${who(ctx.actor)} finishes declaring attackers: ${names} — ${who(game.waitingOn)} to lock them in or respond`,
      "attacks_finished"
    );
    return { ok: true, attackers: names };
  },
};

/** The actions that count as having STARTED PLAYING — the same set the old
 *  HAS_STARTED_PLAYING regex named by its log verbs, now named by action.
 *  Deliberately excludes draw (the deal draws for you), mulligan (taking the
 *  offer must not revoke it), and pure bookkeeping (life, counters). */
const PLAY_ACTIONS = new Set(["cast", "tap", "untap_all", "move", "create_token", "attack", "block", "stack_push", "set_phase", "set_turn", "damage", "finish_attacks"]);

export function applyAction(actor: PlayerId, type: string, params: any): ActionResult {
  const fn = actions[type];
  if (!fn) throw new Error(`unknown action ${type}`);
  const res = fn({ actor }, params ?? {});
  if (PLAY_ACTIONS.has(type)) game.players[actor].turnDone.acted = true;
  return res;
}
