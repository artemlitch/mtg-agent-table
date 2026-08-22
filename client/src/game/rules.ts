// The client's small share of the rules: how a card is filed on the board,
// where a stack item lands, and which permanent a text trigger came from.
// None of this is authoritative — the server decides. It exists so the table
// can draw the right thing before the server answers.
import { act } from "../api";
import { cardById, gameView } from "../store/game";
import type { Card, PlayerId, StackItem } from "../types";

export function typeCat(c: Card): "creature" | "land" | "other" {
  const t = (c.typeLine || "").toLowerCase();
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
