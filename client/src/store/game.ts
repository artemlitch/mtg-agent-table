// The server's view of the table, mirrored into a store. The server is the
// only source of truth: nothing here invents game state. Two exceptions, both
// about not flickering while the network catches up:
//
//   pendingPos / pendingUnder — a card you just dropped keeps the spot you put
//     it in until the server's view agrees, so an unrelated poll landing in
//     between can't snap it back.
//   dragging — while a pointer is down on a card, incoming views park in
//     `parked` and land the moment the drag ends.
import { create } from "zustand";
import type { BrainEntry, Card, GameView, PlayerId } from "../types";

interface GameStore {
  view: GameView | null;
  brain: BrainEntry[];
  agentBusy: boolean;
  dragging: boolean;
  /** a view that arrived mid-drag, waiting for the pointer to come up */
  parked: GameView | null;
  pendingPos: Map<string, { x: number; y: number }>;
  pendingUnder: Map<string, string | null>;

  applyView(v: GameView): void;
  setDragging(on: boolean): void;
  setBrain(entries: BrainEntry[], busy: boolean): void;
  pushBrain(entry: BrainEntry, busy: boolean): void;
  /** claim a card's position locally until the server reports the same one */
  expectPos(id: string, pos: { x: number; y: number }): void;
  expectUnder(id: string, under: string | null): void;
}

const samePos = (a: Card["pos"], b: { x: number; y: number }) =>
  !!a && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

/** Overwrite the incoming view with anything still in flight, and forget the
 *  claims the server has caught up with. Mutates the fresh view in place — it
 *  was just parsed from JSON and nothing else holds a reference to it. */
function reconcile(v: GameView, pendingPos: Map<string, { x: number; y: number }>, pendingUnder: Map<string, string | null>) {
  if (!pendingPos.size && !pendingUnder.size) return v;
  for (const p of ["you", "agent"] as PlayerId[]) {
    for (const c of v.players[p].zones.battlefield) {
      const pos = pendingPos.get(c.id);
      if (pos) {
        if (samePos(c.pos, pos)) pendingPos.delete(c.id);
        else c.pos = pos;
      }
      if (pendingUnder.has(c.id)) {
        const under = pendingUnder.get(c.id) ?? null;
        if ((c.under ?? null) === under) pendingUnder.delete(c.id);
        else c.under = under;
      }
    }
  }
  return v;
}

export const useGame = create<GameStore>((set, get) => ({
  view: null,
  brain: [],
  agentBusy: false,
  dragging: false,
  parked: null,
  pendingPos: new Map(),
  pendingUnder: new Map(),

  applyView(v) {
    const { dragging, pendingPos, pendingUnder } = get();
    if (dragging) return set({ parked: v });
    set({ view: reconcile(v, pendingPos, pendingUnder), parked: null });
  },

  setDragging(on) {
    if (on) return set({ dragging: true });
    const { parked, pendingPos, pendingUnder } = get();
    set(parked ? { dragging: false, view: reconcile(parked, pendingPos, pendingUnder), parked: null } : { dragging: false });
  },

  setBrain(brain, agentBusy) {
    set({ brain, agentBusy });
  },
  pushBrain(entry, agentBusy) {
    set((s) => ({ brain: [...s.brain, entry], agentBusy }));
  },

  expectPos(id, pos) {
    get().pendingPos.set(id, pos);
  },
  expectUnder(id, under) {
    get().pendingUnder.set(id, under);
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

/** Did this happen already during the current round? (log-scan: the turn
 *  structure isn't tracked in state, and the round marker bounds the scan) */
export function didThisTurn(re: RegExp): boolean {
  const log = gameView()?.log ?? [];
  for (let i = log.length - 1; i >= 0; i--) {
    const t = log[i].text || "";
    if (/^—\s*Round \d+/.test(t)) return false;
    if (re.test(t)) return true;
  }
  return false;
}
