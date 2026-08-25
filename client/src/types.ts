// The wire shape of GET /api/state?viewer=you. Mirrors serializeCard/viewFor in
// server/game.ts plus the fields server/index.ts hangs off the view.

export type PlayerId = "you" | "agent";
export type Zone = "library" | "hand" | "battlefield" | "graveyard" | "exile" | "command" | "stack";

export interface CardFace {
  name: string;
  image?: string;
  oracle?: string;
  mana?: string;
  typeLine?: string;
  power?: string;
  toughness?: string;
}

/** A card as the client sees it. `hidden` cards carry nothing but the base
 *  fields — every read of a name, image or type line has to survive that. */
export interface Card {
  id: string;
  zone: Zone;
  owner: PlayerId;
  controller: PlayerId;
  tapped: boolean;
  faceDown: boolean;
  counters: Record<string, number>;
  under: string | null;
  isToken: boolean;
  isCommander: boolean;
  attacking: string | null;
  blocking: string | null;
  /** table-surface fraction, both halves in one space; battlefield only */
  /** Null until the card is placed. The server never invents one — see
   *  game/settle.ts, which places anything on the table that lacks one. */
  pos?: { x: number; y: number } | null;
  /** Paint order among the cards on the table, low to high: bumped every time
   *  the card is put down, so the last one you touched lies on top. */
  z?: number;
  hidden?: boolean;

  name?: string;
  image?: string;
  oracle?: string;
  mana?: string;
  typeLine?: string;
  power?: string;
  toughness?: string;
  basePower?: string;
  baseToughness?: string;
  faceCount?: number;
  face?: number;
  faces?: CardFace[];
  revealedTo?: PlayerId[];
}

export interface StackItem {
  id: string;
  player: PlayerId;
  text: string;
  groupId?: string;
  retractable?: boolean;
  finished?: boolean;
  resolveTo?: Zone;
  source?: string;
  countered?: boolean;
  lines?: string[];
  attackPairs?: { attacker: string; target?: string }[];
  blockPairs?: { blocker: string; attacker: string }[];
  turnPassTo?: PlayerId;
  card: Card | null;
}

/** What a log line IS. Mirrors GAME_EVENTS in server/game.ts — the two lists
 *  are asserted identical in tests/sounds.test.ts, because a name that only
 *  one side knows is a sound that silently stops happening. */
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

/** The sounds sfx.js can make — the keys of client/public/sounds.json. */
export type SoundId =
  | "stack"
  | "thump"
  | "attack"
  | "glimmer"
  | "hit"
  | "draw"
  | "tap"
  | "lockin"
  | "block"
  | "phase"
  | "passturn"
  | "spell";

export interface LogEntry {
  seq: number;
  ts: number;
  actor: PlayerId | "system";
  text: string;
  /** what happened, as the server named it — never parsed out of the text */
  event?: GameEvent;
  /** the cards this entry is about, as ids — set by reveal, and only ever
   *  carrying ids this viewer is allowed to look up (see renderLogFor) */
  cards?: string[];
}

export interface PlayerView {
  life: number;
  commanderDamage: Record<string, number>;
  /** the {2}-per-previous-cast surcharge, tracked not enforced */
  commanderTax: number;
  deckName?: string;
  /** what this seat has already done this turn — see PlayerState in
   *  server/game.ts. The prompt reads these instead of scanning the log */
  turnDone: { untap: boolean; draw: boolean; lands: number; acted: boolean };
  counts: Record<Zone, number>;
  zones: Record<Zone, Card[]>;
}

export interface GameView {
  started: boolean;
  viewer: PlayerId;
  turn: PlayerId;
  turnNumber: number;
  phase: string;
  /** where combat is — null outside combat; see CombatStep in server/game.ts */
  combat?: "attackers" | "blockers" | "damage" | "done" | null;
  waitingOn?: PlayerId | null;
  pendingQuestion?: string | null;
  /** is a mulligan still on the table for this viewer — the server's call */
  canMulligan?: boolean;
  players: Record<PlayerId, PlayerView>;
  stack: StackItem[];
  log: LogEntry[];
  seq: number;
  tokenCatalog?: Record<string, Card>;
  lastDecks?: { you: number; agent: number } | null;
  /** which providers have a key stored — the keys themselves never leave the
   *  server, only this yes/no */
  keys?: Record<string, boolean>;
  agentModel?: string;
  /** the brains on offer, straight from the server's catalog: `ready` means
   *  picking it would actually give the agent something to think with */
  models?: { value: string; name: string; note: string; provider: string; ready: boolean }[];
  agentTransport?: "none" | "cli" | "api" | "custom";
  /** epoch ms the agent wakes at, null when nothing is pending. How long the
   *  wait is depends on what triggered it — see server/wake.ts */
  wakeAt?: number | null;
  cliInstalled?: boolean;
  canRedo?: boolean;
}

export type BrainKind = "text" | "thinking" | "tool" | "status" | "error";
export interface BrainEntry {
  seq: number;
  kind: BrainKind;
  text: string;
}

/** Every card destination is described by one of these — see menus/dest.ts. */
export interface MoveParams {
  toZone: Zone;
  toPlayer?: PlayerId;
  position?: "top" | "bottom";
  faceDown?: boolean;
  revealTo?: PlayerId;
  note?: string;
  /** This card ARRIVES in play without being cast — an effect that has already
   *  resolved putting it there, not a spell going on the stack. Client-side
   *  intent only: runDest reads it and strips it, so the server sees a plain
   *  move. Without it, anything landing on a battlefield is treated as a play
   *  (see isPlay in game/dest.ts). */
  put?: true;
}
