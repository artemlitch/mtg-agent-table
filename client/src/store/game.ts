// The server's view of the table, mirrored into a store. The server is the
// only source of truth: nothing here invents game state. Two exceptions, both
// about not flickering while the network catches up:
//
//   pendingPos — a card you just dropped keeps the spot you put it in until
//     the server's view agrees, so an unrelated poll landing in between
//     cannot snap it back.
//   dragging — while a card is in the air, incoming views park in `parked`
//     and land the moment the drag ends. Applying one mid-gesture re-renders
//     the whole table underneath the pointer.
import { create } from "zustand";
import { dlog, pt } from "../game/debug";
import type { BrainEntry, Card, GameView, PlayerId } from "../types";

interface GameStore {
  view: GameView | null;
  brain: BrainEntry[];
  agentBusy: boolean;
  dragging: boolean;
  /** a view that arrived mid-drag, waiting for the pointer to come up */
  parked: GameView | null;
  pendingPos: Map<string, { x: number; y: number }>;

  applyView(v: GameView): void;
  setDragging(on: boolean): void;
  setBrain(entries: BrainEntry[], busy: boolean): void;
  pushBrain(entry: BrainEntry, busy: boolean): void;
  /** claim a card's position locally until the server reports the same one */
  expectPos(id: string, pos: { x: number; y: number }): void;
}

const samePos = (a: Card["pos"], b: { x: number; y: number }) => !!a && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

/** Overwrite the incoming view with any position still in flight, and forget
 *  the claims the server has caught up with. Mutates the fresh view in place —
 *  it was just parsed from JSON and nothing else holds a reference to it. */
function reconcile(v: GameView, pending: Map<string, { x: number; y: number }>) {
  if (!pending.size) return v;
  const claim = (c: Card) => {
    const pos = pending.get(c.id);
    if (!pos) return;
    if (samePos(c.pos, pos)) {
      pending.delete(c.id);
      dlog(`server agrees ${c.name ?? "?"}`, { pos: pt(pos), claimReleased: true });
    } else {
      dlog(`holding claim ${c.name ?? "?"}`, { claimed: pt(pos), serverSays: c.pos ? pt(c.pos) : "null" });
      c.pos = pos;
    }
  };
  for (const p of ["you", "agent"] as PlayerId[]) for (const c of v.players[p].zones.battlefield) claim(c);
  // unresolved cards hold positions too (pre-placed while on the stack)
  for (const it of v.stack ?? []) if (it.card) claim(it.card);
  return v;
}

export const useGame = create<GameStore>((set, get) => ({
  view: null,
  brain: [],
  agentBusy: false,
  dragging: false,
  parked: null,
  pendingPos: new Map(),

  applyView(v) {
    const { dragging, pendingPos } = get();
    if (dragging) return set({ parked: v });
    set({ view: reconcile(v, pendingPos), parked: null });
  },

  setDragging(on) {
    if (on) return set({ dragging: true });
    const { parked, pendingPos } = get();
    set(parked ? { dragging: false, view: reconcile(parked, pendingPos), parked: null } : { dragging: false });
  },

  expectPos(id, pos) {
    dlog("claim", { card: id, pos: pt(pos) });
    get().pendingPos.set(id, pos);
  },

  setBrain(brain, agentBusy) {
    set({ brain, agentBusy });
  },
  pushBrain(entry, agentBusy) {
    set((s) => ({ brain: [...s.brain, entry], agentBusy }));
  },
}));

/** The view, or a throw — for code paths that only run once a game is up. */
export const gameView = () => useGame.getState().view;

/** Find a card anywhere on the table (both players, every zone). */
export function cardById(id: string): Card | null {
  const v = gameView();
  if (!v) return null;
  for (const p of ["you", "agent"] as PlayerId[])
    for (const zone of Object.values(v.players[p].zones))
      for (const c of zone) if (c.id === id) return c;
  return null;
}

/** The card a hover preview should draw, given the snapshot the pointer
 *  arrived on.
 *
 *  Normally the LIVE card wins: hovering snapshots a Card object, and one that
 *  changes while you are looking at it — turned over with its flip button,
 *  given a counter, tapped — would otherwise go on showing the side it had a
 *  moment ago.
 *
 *  But a live copy can be FACELESS. Every zone is serialized into the view,
 *  including the libraries, and a library card is always hidden (see
 *  cardVisibleTo) — id, zone and owner, no name and no art. A search window's
 *  cards are exactly those: view_zone earned the look and handed over the only
 *  copy with a face on it, and preferring the table's stub over it drew a card
 *  with nothing in it. A stub is not a fresher version of the snapshot, so it
 *  never wins.
 *
 *  Falls back to the snapshot for previewable things that are not on the table
 *  at all, which is why the lookup missing entirely is the same answer. */
export function previewCard(snapshot: Card): Card {
  const live = cardById(snapshot.id);
  return live && !live.hidden ? live : snapshot;
}

/** Is there anything to draw for this card?
 *
 *  A card whose face you were never given has no preview, and an empty one is
 *  worse than none: the layer is a fixed-width box that then just sits over
 *  the table with nothing in it, following the cursor. No face, no hover.
 *
 *  A token we drew ourselves has a name and no printed art and still previews
 *  fine — TokenFace draws it — so the test is a face of ANY kind, not an
 *  image. */
export const previewable = (c: Card) => !c.hidden && !!(c.name || c.image || c.faces?.length);

/** The card tucked directly beneath `id` — piles may span controllers, so
 *  both battlefields are searched. */
export function cardBeneathOf(id: string): Card | null {
  const v = gameView();
  if (!v) return null;
  for (const p of ["you", "agent"] as PlayerId[])
    for (const c of v.players[p].zones.battlefield) if (c.under === id) return c;
  return null;
}

/** The chain hanging beneath `id`, top-down. */
/** Walk a pile up to the card that owns the position — `under` points at the
 *  card above, so the top is the one without it. */
export function pileTopOf(id: string): Card | null {
  let cur = cardById(id) ?? null;
  let guard = 0;
  while (cur?.under && guard++ < 50) {
    const next = cardById(cur.under);
    if (!next) break;
    cur = next;
  }
  return cur;
}

export function pileChainBelow(id: string): Card[] {
  const out: Card[] = [];
  let cur = cardBeneathOf(id);
  let guard = 0;
  while (cur && guard++ < 50) {
    out.push(cur);
    cur = cardBeneathOf(cur.id);
  }
  return out;
}
