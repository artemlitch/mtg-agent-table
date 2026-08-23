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
  resolveTo?: Zone;
  source?: string;
  countered?: boolean;
  lines?: string[];
  attackPairs?: { attacker: string; target?: string }[];
  turnPassTo?: PlayerId;
  card: Card | null;
}

export interface LogEntry {
  seq: number;
  ts: number;
  actor: PlayerId | "system";
  text: string;
}

export interface PlayerView {
  life: number;
  commanderDamage: Record<string, number>;
  /** the {2}-per-previous-cast surcharge, tracked not enforced */
  commanderTax: number;
  deckName?: string;
  counts: Record<Zone, number>;
  zones: Record<Zone, Card[]>;
}

export interface GameView {
  started: boolean;
  viewer: PlayerId;
  turn: PlayerId;
  turnNumber: number;
  phase: string;
  waitingOn?: PlayerId | null;
  pendingQuestion?: string | null;
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
  /** epoch ms the agent wakes at, null when nothing is pending */
  wakeAt?: number | null;
  wakeDelay?: number;
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
}
