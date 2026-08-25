// The client's small share of the rules: how a card is filed on the board,
// where a stack item lands, and which permanent a text trigger came from.
// None of this is authoritative — the server decides. It exists so the table
// can draw the right thing before the server answers.
import { act } from "../api";
import { cardById, gameView, lastLogIndex } from "../store/game";
import type { Card, GameView, PlayerId, StackItem } from "../types";

export type TypeCat = "creature" | "land" | "spell" | "other";

/** Which row a card belongs in. A DFC is whichever face it is showing.
 *  Instants and sorceries are checked first: they never rest on the
 *  battlefield at all, so they get a casting spot near the midline rather
 *  than a place in one of the permanent rows. */
export function typeCat(c: Card): TypeCat {
  const t = (c.faces?.[c.face ?? 0]?.typeLine ?? c.typeLine ?? "").toLowerCase();
  if (/\b(instant|sorcery)\b/.test(t)) return "spell";
  if (t.includes("creature")) return "creature";
  if (t.includes("land")) return "land";
  return "other"; // artifacts, enchantments, planeswalkers → side column
}

export function manaValue(mana?: string): number {
  if (!mana) return 0;
  let mv = 0;
  for (const sym of mana.match(/\{[^}]+\}/g) ?? []) {
    const s = sym.slice(1, -1);
    if (/^\d+$/.test(s)) mv += Number(s);
    else if (s.toUpperCase() !== "X") mv += 1; // colored/hybrid/phyrexian = 1, X = 0
  }
  return mv;
}

export function cardColors(c: Card): Set<string> {
  const set = new Set<string>();
  for (const ch of (c.mana || "").toUpperCase()) if ("WUBRG".includes(ch)) set.add(ch);
  return set;
}

/** Where a stack item's card lands when it resolves — the client's copy of the
 *  server's rule: a declared resolveTo wins, else instants and sorceries go to
 *  the graveyard and everything with a land face to the battlefield. */
export function resolveZoneOf(item: StackItem): string {
  const tl = item.card?.typeLine || "";
  const isSpell = /\b(instant|sorcery)\b/i.test(tl) && !/\bland\b/i.test(tl);
  return item.resolveTo ?? (isSpell ? "graveyard" : "battlefield");
}

/** The patterns that mean the player has stopped setting up and started
 *  playing. Shared by the next-action prompt's opening silence and the
 *  mulligan offer, because they answer the same question. A mulligan is
 *  deliberately absent: it is the deal happening again, not a play. */
export const HAS_STARTED_PLAYING =
  /^Player (played|cast|tapped|untapped|moved|created|declares|put on the stack|moves to)/;

/** Is a mulligan still on the table? Your opening turn, cards in hand, and
 *  nothing played yet — once a land is down the offer would be a lie. */
export function canMulligan(view: GameView | null | undefined): boolean {
  if (!view?.started || view.turnNumber !== 1 || view.turn !== "you") return false;
  if (!view.players.you.zones.hand.length) return false;
  return lastLogIndex(view.log ?? [], HAS_STARTED_PLAYING) < 0;
}

/** A pile deeper than this stops being drawn as a cascade of peeking corners
 *  and becomes one chonky stack. Past a few cards the corners cover the board
 *  and none of them can be read anyway. */
export const CHONKY_PILE_AT = 3;

/** Which board cards a chonky stack swallows, and how many cards each pile
 *  that earns one is holding.
 *
 *  Keyed by the card that owns the position — `under` points at the card
 *  ABOVE, so the anchor is the one without it, and it is the only card in the
 *  pile still drawn. Pure in its argument rather than reading the store, so
 *  the board it describes is the board it was handed. */
export function chonkyPiles(board: Card[]): { size: Map<string, number>; swallowed: Set<string> } {
  const beneath = new Map<string, Card>();
  for (const c of board) if (c.under) beneath.set(c.under, c);
  const size = new Map<string, number>();
  const swallowed = new Set<string>();
  for (const top of board) {
    if (top.under) continue;
    const chain: Card[] = [];
    // guarded: a malformed `under` must not lock the board up
    for (let cur = beneath.get(top.id), n = 0; cur && n < 50; cur = beneath.get(cur.id), n++) chain.push(cur);
    if (chain.length + 1 <= CHONKY_PILE_AT) continue;
    size.set(top.id, chain.length + 1);
    for (const c of chain) swallowed.add(c.id);
  }
  return { size, swallowed };
}

/** The agent's creatures currently attacking you. */
export function incomingAttackers(): Card[] {
  return (gameView()?.players.agent.zones.battlefield ?? []).filter((c) => c.attacking);
}

/** The attacker to answer next: the first one nothing of yours is already
 *  declared against, so pressing E down a row of creatures spreads the blocks
 *  out instead of piling them all onto the same attacker. */
export function nextUnblockedAttacker(): Card | null {
  const attackers = incomingAttackers();
  if (!attackers.length) return null;
  const answered = new Set((gameView()?.players.you.zones.battlefield ?? []).map((c) => c.blocking).filter(Boolean));
  return attackers.find((a) => !answered.has(a.id)) ?? attackers[0];
}

/** Attacking or blocking as DECLARED, not as locked in.
 *
 *  A declaration sits on the stack until the other seat acknowledges it, and
 *  card.attacking / card.blocking are only written when they do. Through that
 *  whole wait a committed creature looked exactly like one standing around,
 *  and a block you had just declared read as a block that never registered. */
export const declaredAttacking = (c: Card): boolean =>
  !!c.attacking || (gameView()?.stack ?? []).some((it) => it.attackPairs?.some((pr) => pr.attacker === c.id));

export const declaredBlocking = (c: Card): boolean =>
  !!c.blocking || (gameView()?.stack ?? []).some((it) => it.blockPairs?.some((pr) => pr.blocker === c.id));

/** Creatures named in a combat declaration that is still on the stack, matched
 *  to the seat whose board they sit on. They lift off the felt the way a
 *  pending trigger's source does, and settle back the moment the declaration
 *  is locked in — the lift IS the waiting. */
export function liftedDeclarations(p: PlayerId): { item: StackItem; source: Card }[] {
  const out: { item: StackItem; source: Card }[] = [];
  const v = gameView();
  if (!v) return out;
  const bf = v.players[p].zones.battlefield;
  for (const it of v.stack ?? []) {
    const ids = [...(it.attackPairs ?? []).map((pr) => pr.attacker), ...(it.blockPairs ?? []).map((pr) => pr.blocker)];
    for (const id of ids) {
      const source = bf.find((c) => c.id === id && !c.hidden);
      if (source) out.push({ item: it, source });
    }
  }
  return out;
}

/** The pending (unresolved) attack declaration containing this card, if any. */
export function pendingAttackOf(cardId: string): StackItem | null {
  for (const it of gameView()?.stack ?? []) {
    if (it.attackPairs?.some((pair) => pair.attacker === cardId)) return it;
  }
  return null;
}

/** Pull one attacker out of a pending declaration (re-declaring the rest). */
export async function removeAttacker(c: Card, pendingAtk: StackItem) {
  const stack = gameView()?.stack ?? [];
  const idx = stack.findIndex((i) => i.id === pendingAtk.id);
  await act("stack_remove", { index: idx });
  const rest = (pendingAtk.attackPairs ?? []).filter((pair) => pair.attacker !== c.id);
  if (rest.length) await act("attack", { pairs: rest });
}

/** The card a stack item is about: the card itself for a spell, or the
 *  permanent a trigger came from. Only ones we can actually picture. */
export function stackItemCard(item: StackItem | null | undefined): Card | null {
  const c = item?.card ?? (item?.source ? cardById(item.source) : null);
  return c && c.image && !c.hidden ? c : null;
}

/** What the item SAYS, minus the card title and mana cost the agent writes in
 *  front of it — the picture beside the text already names the card. Targets
 *  (⟶ …) survive; an item that is nothing but its title comes back empty. */
export function stackSubText(item: StackItem | null | undefined, card: Card | null): string {
  let t = String(item?.text || "").split("\n")[0];
  const name = card?.name || item?.card?.name;
  if (name && t.toLowerCase().startsWith(name.toLowerCase())) t = t.slice(name.length);
  t = t.replace(/^\s*(\{[^}]*\}\s*)+/, "").replace(/^\s*[—–:-]\s*/, "");
  return t.trim();
}

/** Visible cards on the stack that belong to p — unresolved cards, drawn on
 *  the table like any other card, in their unresolved state. */
export function stackCardsOf(p: PlayerId): StackItem[] {
  return (gameView()?.stack ?? []).filter((it) => it.card && !it.card.hidden && it.player === p);
}

/** Text-only stack items (triggered/activated abilities) matched to their
 *  source permanent on p's battlefield — the source lifts off the board. */
export function liftedTriggers(p: PlayerId): { item: StackItem; source: Card }[] {
  const out: { item: StackItem; source: Card }[] = [];
  const v = gameView();
  if (!v) return out;
  const bf = v.players[p].zones.battlefield;
  for (const it of v.stack ?? []) {
    if (it.card || /^(ATTACKS|BLOCKS|STEP|TURN PASS):/.test(it.text)) continue;
    // structured source id (stack_push { source }) is authoritative
    if (it.source) {
      const src = bf.find((c) => c.id === it.source);
      if (src && !src.hidden) out.push({ item: it, source: src });
      continue;
    }
    // fallback for source-less items (composer text): earliest-mentioned
    // battlefield card — ability texts lead with the source, while payment
    // and target mentions come later. Ties go to the longer name.
    const t = it.text.toLowerCase();
    let best: { card: Card; idx: number; len: number } | null = null;
    for (const c of bf) {
      if (c.hidden || !c.name) continue;
      const n = c.name.toLowerCase();
      const idx = t.indexOf(n);
      if (idx < 0) continue;
      if (!best || idx < best.idx || (idx === best.idx && n.length > best.len)) best = { card: c, idx, len: n.length };
    }
    if (best) out.push({ item: it, source: best.card });
  }
  return out;
}

/** Lands sink below everything else in a target list — they're rarely it. */
export const isLand = (c: Card) =>
  /\bland\b/i.test(c.typeLine || "") && !/\b(creature|instant|sorcery)\b/i.test(c.typeLine || "");
