// A sound that belongs to a CARD rather than to an event.
//
// Blor the Impervious gets a noise every time it does something — swings,
// blocks, arrives, dies. That is not an event in the game's vocabulary: the
// table has no "a particular creature attacked" event and should not grow one
// per card. It is a fact about the BOARD, so it is read off the board, by
// comparing this view's battlefield with the last one.
//
// Which cards have one is data, not code: a sound in sounds.json with a `card`
// field follows the card it names. Adding another is a field in the lab's
// file, not an edit here.
//
// These play ON TOP. Everything in sounds.ts is deduped to one sound per
// category and staggered 140ms apart, so a busy refresh does not arrive as a
// chord; this deliberately skips that queue, because the whole point is that
// Blor's noise lands WITH the swing rather than in a queue behind it.
import type { Card, GameView, PlayerId } from "../types";

const PLAYERS: PlayerId[] = ["you", "agent"];

/** Does this card's name belong to that sound? "Blor" claims "Blor the
 *  Impervious" and would not claim a "Blorette" — the name has to run out on a
 *  word boundary, or a short name quietly adopts every card that starts with
 *  the same letters. */
const claims = (cardName: string, want: string) => {
  const n = cardName.toLowerCase();
  const w = want.toLowerCase();
  return n === w || (n.startsWith(w) && !/[a-z0-9]/.test(n[w.length] ?? " "));
};

interface Seen {
  name: string;
  attacking: boolean;
  blocking: boolean;
}

// What the battlefield looked like last time. null means we have not looked
// yet, and the first look is where we START — otherwise every card already on
// the table reads as having just arrived, and a page reload is a fanfare.
let before: Map<string, Seen> | null = null;

const battlefield = (view: GameView): Card[] =>
  PLAYERS.flatMap((p) => view.players[p].zones.battlefield ?? []);

/** Who is DECLARED as attacking or blocking, which is not the same as who is
 *  marked. Tapping a creature with E puts a declaration on the stack; the flag
 *  on the card is only set when that declaration resolves, which is the
 *  defender's move and can be a minute later. Waiting for the flag meant Blor
 *  swung in silence and then made its noise long after, during someone else's
 *  press. Read from the view's own stack rather than the store, so this
 *  function answers for the view it was handed. */
function declared(view: GameView) {
  const attackers = new Set<string>();
  const blockers = new Set<string>();
  for (const item of view.stack ?? []) {
    for (const pair of item.attackPairs ?? []) attackers.add(pair.attacker);
    for (const pair of item.blockPairs ?? []) blockers.add(pair.blocker);
  }
  return { attackers, blockers };
}

export function processCardSounds(view: GameView) {
  if (typeof SFX === "undefined") return;
  // every sound that names a card, and the name it wants
  const watched = Object.entries(SFX.SOUNDS)
    .map(([sound, def]) => [sound, (def as { card?: string }).card] as const)
    .filter((e): e is readonly [string, string] => !!e[1]);

  const { attackers, blockers } = declared(view);
  const now = new Map<string, Seen>();
  for (const c of battlefield(view)) {
    now.set(c.id, {
      name: c.name ?? "",
      attacking: !!c.attacking || attackers.has(c.id),
      blocking: !!c.blocking || blockers.has(c.id),
    });
  }

  if (before && watched.length) {
    const fired = new Set<string>();
    const ring = (name: string) => {
      for (const [sound, want] of watched) if (claims(name, want)) fired.add(sound);
    };
    for (const [id, is] of now) {
      const was = before.get(id);
      // arrived, or started doing something it was not doing. Not "is
      // attacking" — that stays true for the whole combat, and a sound on a
      // STATE rather than a change fires on every refresh until it clears.
      if (!was || (is.attacking && !was.attacking) || (is.blocking && !was.blocking)) ring(is.name);
    }
    // and gone: the name comes from what we remembered, since the card is not
    // in this view to be asked
    for (const [id, was] of before) if (!now.has(id)) ring(was.name);
    for (const s of fired) SFX.play(s);
  }

  before = now;
}
