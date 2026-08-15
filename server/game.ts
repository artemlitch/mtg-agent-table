// Game state, actions, and per-viewer redaction. No rules engine — this is a
// shared tabletop with enforced information hiding.

export type PlayerId = "you" | "agent";
export type Zone = "library" | "hand" | "battlefield" | "graveyard" | "exile" | "command" | "stack";

export const PLAYERS: PlayerId[] = ["you", "agent"];
export const ZONES: Zone[] = ["library", "hand", "battlefield", "graveyard", "exile", "command", "stack"];

export interface Card {
  id: string;
  name: string;
  image?: string;
  oracle?: string;
  mana?: string;
  typeLine?: string;
  power?: string;
  toughness?: string;
  owner: PlayerId;
  controller: PlayerId;
  zone: Zone;
  tapped: boolean;
  faceDown: boolean;
  counters: Record<string, number>;
  attachedTo: string | null;
  isToken: boolean;
  isCommander: boolean;
  // Extra visibility grants beyond what the zone implies (revealed hand cards,
  // face-down exile the thief may look at, etc.)
  visibleTo: PlayerId[];
  attacking: string | null; // defender description ("you", "agent", or a card id)
  blocking: string | null;  // attacker card id
  // cosmetic drag position on the battlefield, fractional 0..1; null = auto-layout
  pos?: { x: number; y: number } | null;
}

export interface PlayerState {
  life: number;
  commanderDamage: Record<string, number>; // key: commander card name
  zones: Record<Zone, string[]>; // ordered card ids; library[0] = TOP
  deckName?: string;
  deckId?: number;
}

export interface LogEntry {
  seq: number;
  ts: number;
  actor: PlayerId | "system";
  text: string; // public rendering
  private?: Partial<Record<PlayerId, string>>; // richer rendering for viewers allowed to know
}

export interface StackItem {
  id: string;
  player: PlayerId;
  cardId: string | null;
  text: string;
}

export interface GameState {
  started: boolean;
  turn: PlayerId;
  turnNumber: number;
  phase: string;
  players: Record<PlayerId, PlayerState>;
  cards: Record<string, Card>;
  stack: StackItem[];
  log: LogEntry[];
  seq: number;
  waitingOn: PlayerId; // whose window it is
  pendingQuestion: string | null; // agent question awaiting user answer
}

let nextCardId = 1;
export function newCardId() {
  return "c" + nextCardId++;
}

export function emptyPlayer(): PlayerState {
  return {
    life: 40,
    commanderDamage: {},
    zones: { library: [], hand: [], battlefield: [], graveyard: [], exile: [], command: [], stack: [] },
  };
}

export function newGameState(): GameState {
  return {
    started: false,
    turn: "you",
    turnNumber: 1,
    phase: "main 1",
    players: { you: emptyPlayer(), agent: emptyPlayer() },
    cards: {},
    stack: [],
    log: [],
    seq: 0,
    waitingOn: "you",
    pendingQuestion: null,
  };
}

export const game: GameState = newGameState();

export function resetGameState() {
  const fresh = newGameState();
  Object.assign(game, fresh);
  nextCardId = 1;
}

export function getNextCardId() {
  return nextCardId;
}

export function setNextCardId(n: number) {
  nextCardId = n;
}

export function addLog(actor: LogEntry["actor"], text: string, priv?: LogEntry["private"]): LogEntry {
  const entry: LogEntry = { seq: ++game.seq, ts: Date.now(), actor, text, ...(priv ? { private: priv } : {}) };
  game.log.push(entry);
  return entry;
}

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

function redactCard(card: Card, viewer: PlayerId) {
  const visible = cardVisibleTo(card, viewer);
  const base = {
    id: card.id,
    zone: card.zone,
    owner: card.owner,
    controller: card.controller,
    tapped: card.tapped,
    faceDown: card.faceDown,
    counters: card.counters,
    attachedTo: card.attachedTo,
    isToken: card.isToken,
    isCommander: card.isCommander,
    attacking: card.attacking,
    blocking: card.blocking,
    pos: card.pos ?? null,
  };
  if (!visible) return { ...base, hidden: true as const };
  return {
    ...base,
    hidden: false as const,
    name: card.name,
    image: card.image,
    oracle: card.oracle,
    mana: card.mana,
    typeLine: card.typeLine,
    power: card.power,
    toughness: card.toughness,
    revealedTo: card.visibleTo,
  };
}

/** Full table snapshot as one viewer is allowed to see it. */
export function viewFor(viewer: PlayerId, logTail = 40) {
  const players: any = {};
  for (const p of PLAYERS) {
    const ps = game.players[p];
    players[p] = {
      life: ps.life,
      commanderDamage: ps.commanderDamage,
      deckName: ps.deckName,
      counts: Object.fromEntries(ZONES.map((z) => [z, ps.zones[z].length])),
      zones: Object.fromEntries(
        ZONES.map((z) => [z, ps.zones[z].map((id) => redactCard(game.cards[id], viewer))])
      ),
    };
  }
  return {
    started: game.started,
    viewer,
    turn: game.turn,
    turnNumber: game.turnNumber,
    phase: game.phase,
    waitingOn: game.waitingOn,
    pendingQuestion: game.pendingQuestion,
    players,
    stack: game.stack.map((item) => ({
      id: item.id,
      player: item.player,
      text: item.text,
      card: item.cardId ? redactCard(game.cards[item.cardId], viewer) : null,
    })),
    log: game.log.slice(-logTail).map((e) => renderLogFor(e, viewer)),
    seq: game.seq,
  };
}

export function renderLogFor(e: LogEntry, viewer: PlayerId) {
  return { seq: e.seq, ts: e.ts, actor: e.actor, text: (e.private && e.private[viewer]) || e.text };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function who(p: PlayerId) {
  return p === "you" ? "Artem" : "Agent";
}

function zoneList(card: Card): string[] {
  return game.players[card.controller].zones[card.zone];
}

function removeFromZone(card: Card) {
  const list = zoneList(card);
  const i = list.indexOf(card.id);
  if (i >= 0) list.splice(i, 1);
}

function cardName(card: Card, forViewerText = false): string {
  return card.name;
}

/** Public description of a card for the log: name if publicly visible, else "a face-down card". */
function publicDesc(card: Card): string {
  const publiclyVisible = PLAYERS.every((p) => cardVisibleTo(card, p));
  return publiclyVisible ? card.name : "a hidden card";
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

// ---------------------------------------------------------------------------
// Actions. Every action returns data for the actor (possibly private info).
// The caller (HTTP layer) broadcasts the state update.
// ---------------------------------------------------------------------------

export interface ActionCtx {
  actor: PlayerId;
}

export type ActionResult = { ok: true; [k: string]: any };

export const actions: Record<string, (ctx: ActionCtx, p: any) => ActionResult> = {
  draw(ctx, p) {
    const player: PlayerId = p.player ?? ctx.actor;
    const n = Math.max(1, Math.min(20, Number(p.n ?? p.count ?? 1)));
    const drawn: string[] = [];
    for (let i = 0; i < n; i++) {
      const lib = game.players[player].zones.library;
      if (!lib.length) break;
      const card = game.cards[lib[0]];
      removeFromZone(card);
      card.zone = "hand";
      card.controller = player;
      card.visibleTo = [];
      card.tapped = false;
      game.players[player].zones.hand.push(card.id);
      drawn.push(card.name);
    }
    addLog(ctx.actor, `${who(player)} drew ${drawn.length} card${drawn.length === 1 ? "" : "s"}`, {
      [player]: `${who(player)} drew: ${drawn.join(", ") || "(library empty)"}`,
    });
    return { ok: true, drawn: player === ctx.actor ? drawn : drawn.length };
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
    // resolve everything up front so a bad ref fails atomically before mutation
    const cards = refs.map((r) => resolveCardRef(r));

    const movedIds: string[] = [];
    const removedTokens: string[] = [];
    // per-viewer name lists: a viewer sees the name if the card was or is visible to them
    const names: Record<PlayerId | "public", string[]> = { you: [], agent: [], public: [] };
    const fromZones = new Set<string>();
    let insertAt: number | null = null;
    let toPlayerForLog: PlayerId = p.toPlayer ?? cards[0].controller;

    for (const card of cards) {
      const fromZone = card.zone;
      fromZones.add(fromZone);
      const preVis = { you: cardVisibleTo(card, "you"), agent: cardVisibleTo(card, "agent") };
      const toPlayer: PlayerId = p.toPlayer ?? card.controller;
      toPlayerForLog = toPlayer;

      removeFromZone(card);
      if (fromZone === "stack") game.stack = game.stack.filter((i) => i.cardId !== card.id);
      card.zone = toZone;
      card.controller = toPlayer;
      card.attachedTo = null;
      card.attacking = null;
      card.blocking = null;
      if (toZone !== "battlefield") card.tapped = false;
      card.pos = null;
      // visibility resets on zone change, then explicit grants apply
      card.faceDown = !!p.faceDown;
      card.visibleTo = [];
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

      const list = game.players[toPlayer].zones[toZone];
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
    addLog(ctx.actor, publicText, Object.keys(priv).length ? priv : undefined);

    return { ok: true, cards: movedIds, removedTokens };
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
    addLog(ctx.actor, `${who(ctx.actor)} ${tapped ? "tapped" : "untapped"} ${names.join(", ")}`);
    return { ok: true };
  },

  untap_all(ctx, p) {
    const player: PlayerId = p.player ?? ctx.actor;
    for (const id of game.players[player].zones.battlefield) game.cards[id].tapped = false;
    addLog(ctx.actor, `${who(player)} untapped all permanents`);
    return { ok: true };
  },

  counters(ctx, p) {
    const ids: string[] = Array.isArray(p.cards) && p.cards.length ? p.cards : [p.card ?? p.cardId];
    const kind: string = p.kind || "+1/+1";
    const delta: number = p.delta ?? 1;
    const parts: string[] = [];
    for (const id of ids) {
      const c = getCard(id);
      c.counters[kind] = (c.counters[kind] || 0) + delta;
      if (c.counters[kind] <= 0) delete c.counters[kind];
      parts.push(`${publicDesc(c)} → ${c.counters[kind] || 0}`);
    }
    addLog(ctx.actor, `${who(ctx.actor)} set ${kind} counters: ${parts.join(", ")}`);
    return { ok: true };
  },

  create_token(ctx, p) {
    const n = Math.max(1, Math.min(20, p.n ?? 1));
    const player: PlayerId = p.player ?? ctx.actor;
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = newCardId();
      game.cards[id] = {
        id,
        name: p.name,
        image: p.image,
        oracle: p.oracle,
        typeLine: p.typeLine || "Token",
        power: p.power,
        toughness: p.toughness,
        owner: player,
        controller: player,
        zone: "battlefield",
        tapped: !!p.tapped,
        faceDown: false,
        counters: {},
        attachedTo: null,
        isToken: true,
        isCommander: false,
        visibleTo: [],
        attacking: null,
        blocking: null,
      };
      game.players[player].zones.battlefield.push(id);
      ids.push(id);
    }
    addLog(ctx.actor, `${who(ctx.actor)} created ${n}x ${p.name} token for ${who(player)}`);
    return { ok: true, ids };
  },

  attach(ctx, p) {
    const c = getCard(p.card);
    if (p.target === null || p.target === undefined || p.target === "") {
      c.attachedTo = null;
      addLog(ctx.actor, `${who(ctx.actor)} unattached ${publicDesc(c)}`);
    } else {
      const t = getCard(p.target);
      c.attachedTo = t.id;
      addLog(ctx.actor, `${who(ctx.actor)} attached ${publicDesc(c)} to ${publicDesc(t)}`);
    }
    return { ok: true };
  },

  life(ctx, p) {
    const player: PlayerId = p.player ?? ctx.actor;
    const ps = game.players[player];
    if (typeof p.set === "number") ps.life = p.set;
    else ps.life += p.delta ?? 0;
    addLog(ctx.actor, `${who(player)}'s life is now ${ps.life}`);
    return { ok: true, life: ps.life };
  },

  commander_damage(ctx, p) {
    // p: { to: PlayerId, commander: card name, delta }
    const ps = game.players[p.to as PlayerId];
    ps.commanderDamage[p.commander] = (ps.commanderDamage[p.commander] || 0) + (p.delta ?? 0);
    addLog(ctx.actor, `${who(p.to)} has taken ${ps.commanderDamage[p.commander]} commander damage from ${p.commander}`);
    return { ok: true };
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
    if (to === "all") addLog(ctx.actor, `${who(ctx.actor)} revealed: ${names.join(", ")}`);
    else
      addLog(ctx.actor, `${who(ctx.actor)} revealed ${ids.length} card(s) to ${who(to)}`, {
        [to]: `${who(ctx.actor)} revealed to you: ${names.join(", ")}`,
        [ctx.actor]: `You revealed to ${who(to)}: ${names.join(", ")}`,
      });
    return { ok: true, names };
  },

  /** Look at top N of a library (scry/surveil/impulse start). Private to the actor. */
  peek(ctx, p) {
    const player: PlayerId = p.player ?? ctx.actor;
    const n = Math.max(1, Math.min(20, p.n ?? 1));
    const lib = game.players[player].zones.library;
    const cards = lib.slice(0, n).map((id) => {
      const c = game.cards[id];
      return { id: c.id, name: c.name, mana: c.mana, typeLine: c.typeLine, oracle: c.oracle, image: c.image };
    });
    addLog(ctx.actor, `${who(ctx.actor)} looked at the top ${n} of ${who(player)}'s library`);
    return { ok: true, cards };
  },

  /** Reorder the top of a library: p.top = ids (new order, first = top), p.toBottom = ids. */
  reorder_top(ctx, p) {
    const player: PlayerId = p.player ?? ctx.actor;
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
    const player: PlayerId = p.player ?? ctx.actor;
    const zone: Zone = p.zone;
    const list = game.players[player].zones[zone];
    const cards = list.map((id) => {
      const c = game.cards[id];
      return { id: c.id, name: c.name, mana: c.mana, typeLine: c.typeLine, oracle: c.oracle, image: c.image, faceDown: c.faceDown };
    });
    if (zone === "library" || (zone === "hand" && player !== ctx.actor)) {
      addLog(ctx.actor, `${who(ctx.actor)} looked at ${who(player)}'s ${zone} (${list.length} cards)`);
    }
    return { ok: true, cards };
  },

  shuffle(ctx, p) {
    const player: PlayerId = p.player ?? ctx.actor;
    shuffleZone(player);
    addLog(ctx.actor, `${who(player)}'s library was shuffled`);
    return { ok: true };
  },

  set_phase(ctx, p) {
    game.phase = String(p.phase).slice(0, 40);
    addLog(ctx.actor, `Phase: ${game.phase}`);
    return { ok: true };
  },

  set_turn(ctx, p) {
    const player: PlayerId = p.player;
    // a "round" completes when the turn comes back to the starting player (you)
    if (player === "you" && game.turn !== "you" && p.increment !== false) game.turnNumber++;
    game.turn = player;
    game.waitingOn = player;
    game.phase = "untap/upkeep";
    // clear combat state
    for (const c of Object.values(game.cards)) {
      c.attacking = null;
      c.blocking = null;
    }
    addLog(ctx.actor, `— Round ${game.turnNumber}: ${who(player)}'s turn —`);
    return { ok: true };
  },

  attack(ctx, p) {
    // p.pairs: [{ attacker: cardId, target: "you"|"agent"|cardId }]
    const parts: string[] = [];
    for (const pair of p.pairs) {
      const c = getCard(pair.attacker);
      c.attacking = pair.target;
      c.tapped = p.tapped !== false ? true : c.tapped;
      const tgt = pair.target === "you" || pair.target === "agent" ? who(pair.target) : publicDesc(getCard(pair.target));
      parts.push(`${publicDesc(c)} → ${tgt}`);
    }
    game.phase = "combat";
    addLog(ctx.actor, `${who(ctx.actor)} attacks: ${parts.join("; ")}`);
    return { ok: true };
  },

  block(ctx, p) {
    const parts: string[] = [];
    for (const pair of p.pairs) {
      const b = getCard(pair.blocker);
      b.blocking = pair.attacker;
      parts.push(`${publicDesc(b)} blocks ${publicDesc(getCard(pair.attacker))}`);
    }
    addLog(ctx.actor, `${who(ctx.actor)} blocks: ${parts.join("; ")}`);
    return { ok: true };
  },

  clear_combat(ctx, _p) {
    for (const c of Object.values(game.cards)) {
      c.attacking = null;
      c.blocking = null;
    }
    addLog(ctx.actor, `Combat cleared`);
    return { ok: true };
  },

  /** Cast a spell: the card goes onto the shared stack, publicly visible. */
  cast(ctx, p) {
    const card = resolveCardRef(p.card ?? p.cardId);
    removeFromZone(card);
    if (card.zone === "stack") game.stack = game.stack.filter((i) => i.cardId !== card.id);
    card.zone = "stack";
    card.controller = ctx.actor;
    card.faceDown = false;
    card.tapped = false;
    card.visibleTo = [];
    game.players[ctx.actor].zones.stack.push(card.id);
    game.stack.push({
      id: "s" + (game.seq + 1),
      player: ctx.actor,
      cardId: card.id,
      text: p.note ? `${card.name} — ${p.note}` : card.name,
    });
    const verb = /\bland\b/i.test(card.typeLine ?? "") ? "played" : "cast";
    addLog(ctx.actor, `${who(ctx.actor)} ${verb} ${card.name}${p.note ? ` (${p.note})` : ""} → on the stack`);
    return { ok: true, card: card.id, stackSize: game.stack.length };
  },

  /** Announce a trigger or activated ability as a text-only stack item. */
  stack_push(ctx, p) {
    const text = p.text ?? p.note;
    if (!text || !String(text).trim()) throw new Error("stack_push requires text");
    game.stack.push({ id: "s" + (game.seq + 1), player: ctx.actor, cardId: null, text: String(text) });
    addLog(ctx.actor, `${who(ctx.actor)} put on the stack: ${text}`);
    return { ok: true, stackSize: game.stack.length };
  },

  /** Resolve the TOP of the stack. Cards: battlefield for permanents, graveyard for instants/sorceries (or explicit p.to). */
  stack_resolve(ctx, p) {
    const item = game.stack.pop();
    if (!item) throw new Error("the stack is empty");
    if (!item.cardId) {
      addLog(ctx.actor, `Resolved: ${item.text}`);
      return { ok: true, resolved: item.text };
    }
    const card = getCard(item.cardId);
    removeFromZone(card);
    const isSpell = /\b(instant|sorcery)\b/i.test(card.typeLine ?? "");
    const toZone: Zone = (p.to as Zone) ?? (isSpell ? "graveyard" : "battlefield");
    const toPlayer: PlayerId = p.toPlayer ?? (toZone === "battlefield" ? card.controller : card.owner);
    card.zone = toZone;
    card.controller = toPlayer;
    card.visibleTo = [];
    game.players[toPlayer].zones[toZone].push(card.id);
    addLog(ctx.actor, `${card.name} resolved → ${who(toPlayer)}'s ${toZone}`);
    return { ok: true, card: card.id, toZone };
  },

  /** Counter the TOP of the stack: card goes to its owner's graveyard. */
  stack_counter(ctx, p) {
    const item = game.stack.pop();
    if (!item) throw new Error("the stack is empty");
    if (item.cardId) {
      const card = getCard(item.cardId);
      removeFromZone(card);
      card.zone = "graveyard";
      card.controller = card.owner;
      card.visibleTo = [];
      game.players[card.owner].zones.graveyard.push(card.id);
      addLog(ctx.actor, `${who(ctx.actor)} countered ${card.name} → ${who(card.owner)}'s graveyard`);
    } else {
      addLog(ctx.actor, `${who(ctx.actor)} countered/removed: ${item.text}`);
    }
    return { ok: true };
  },

  /** Take back an illegal/mistaken stack item: card returns to its owner's hand. p.index targets a specific item (0 = bottom); default top. */
  stack_remove(ctx, p) {
    if (!game.stack.length) throw new Error("the stack is empty");
    const index = typeof p.index === "number" ? p.index : game.stack.length - 1;
    const [item] = game.stack.splice(index, 1);
    if (!item) throw new Error(`no stack item at index ${index}`);
    if (item.cardId) {
      const card = getCard(item.cardId);
      removeFromZone(card);
      card.zone = "hand";
      card.controller = card.owner;
      card.visibleTo = [];
      game.players[card.owner].zones.hand.push(card.id);
      addLog(ctx.actor, `${who(ctx.actor)} took ${card.name} back off the stack → ${who(card.owner)}'s hand`);
    } else {
      addLog(ctx.actor, `${who(ctx.actor)} removed from the stack: ${item.text}`);
    }
    return { ok: true };
  },

  /** Cosmetic drag placement — no log entry, callers must not snapshot/wake for this. */
  place(ctx, p) {
    const positions: { card: string; x: number; y: number }[] = p.positions ?? [];
    for (const pos of positions) {
      const c = getCard(pos.card);
      c.pos = { x: Math.max(0, Math.min(1, Number(pos.x))), y: Math.max(0, Math.min(1, Number(pos.y))) };
    }
    return { ok: true };
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
    addLog(ctx.actor, `💬 ${who(ctx.actor)}: ${text}`);
    if (ctx.actor === "you" && game.pendingQuestion) game.pendingQuestion = null;
    return { ok: true };
  },

  ask_user(ctx, p) {
    const question = p.question ?? p.text ?? p.message;
    if (!question || !String(question).trim()) throw new Error("ask_user requires question");
    game.pendingQuestion = question;
    addLog(ctx.actor, `❓ ${who(ctx.actor)} asks: ${question}`);
    return { ok: true };
  },

  done(ctx, _p) {
    game.waitingOn = ctx.actor === "you" ? "agent" : "you";
    addLog(ctx.actor, `${who(ctx.actor)} passes — ${who(game.waitingOn)}'s window`);
    return { ok: true };
  },
};

export function applyAction(actor: PlayerId, type: string, params: any): ActionResult {
  const fn = actions[type];
  if (!fn) throw new Error(`unknown action ${type}`);
  return fn({ actor }, params ?? {});
}
