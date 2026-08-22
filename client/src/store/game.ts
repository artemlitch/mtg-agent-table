// The server's view of the table, mirrored into a store. The server is the
// only source of truth: nothing here invents game state.
import { create } from "zustand";
import type { BrainEntry, Card, GameView, PlayerId } from "../types";

interface GameStore {
  view: GameView | null;
  brain: BrainEntry[];
  agentBusy: boolean;

  applyView(v: GameView): void;
  setBrain(entries: BrainEntry[], busy: boolean): void;
  pushBrain(entry: BrainEntry, busy: boolean): void;
}

export const useGame = create<GameStore>((set) => ({
  view: null,
  brain: [],
  agentBusy: false,

  applyView(v) {
    set({ view: v });
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
