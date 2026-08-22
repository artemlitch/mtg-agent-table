// Per-action snapshot ring buffer powering undo. Game state only — the
// agent's conversation can't be unwound, so undo leaves the agent untouched
// and it learns about the rewind from the ↩ log entry.

import { game, getNextCardId, homePos, setNextCardId } from "./game";
import { serializeState, restoreState } from "./persist";

let history: any[] = [];
// Snapshots stepped back over. Redo walks forward through these, and any new
// action throws them away — they describe a future that no longer follows
// from where the game now is. In memory only: a server restart forgets them.
let future: any[] = [];
// full game snapshots are heavy; 30 steps of undo is plenty and keeps the
// persisted file manageable
const MAX = 30;

export function getHistory() {
  return history;
}

export function setHistory(h: any[]) {
  history = Array.isArray(h) ? h.slice(-MAX) : [];
}

const snapshot = () => serializeState({ agent: null, lastDecks: null });
/** The last real action in the log, never an undo/redo notice about one. */
const lastAction = () =>
  [...game.log].reverse().find((e) => !/^[↩↪]/.test(e.text))?.text ?? "(unknown action)";

/** Restore a snapshot, keeping counters monotonic so nothing later collides,
 *  and leaving every card where it currently sits.
 *
 *  Position is not part of the game. Sliding a card around the table makes no
 *  undo step (place is cosmetic), so no undo step is allowed to slide one
 *  either — otherwise rewinding an unrelated action drags the whole board
 *  back to an arrangement nobody asked for. The snapshot decides what is
 *  where in the RULES sense; the table keeps its own layout. */
function restore(snap: any) {
  const seqBefore = game.seq;
  const idBefore = getNextCardId();
  const layout = new Map<string, { x: number; y: number }>();
  for (const [id, c] of Object.entries(game.cards)) if (c.pos) layout.set(id, c.pos);

  restoreState(snap);
  game.seq = Math.max(game.seq, seqBefore);
  setNextCardId(Math.max(getNextCardId(), idBefore));

  for (const c of Object.values(game.cards)) {
    // the invariant relocateCard keeps: on the table means it has a spot,
    // anywhere else means it has none
    if (c.zone !== "battlefield" && c.zone !== "stack") {
      c.pos = null;
      continue;
    }
    // a card that was already out keeps where you put it; one the rewind
    // brought back has only the snapshot's spot, or needs a fresh one
    c.pos = layout.get(c.id) ?? c.pos ?? homePos(c.controller, c);
  }
}

export function recordSnapshot() {
  history.push(snapshot());
  if (history.length > MAX) history.shift();
  future.length = 0; // a new action is a new branch; the old forward path is gone
}

export function dropLastSnapshot() {
  history.pop();
}

export function historySize() {
  return history.length;
}

export function redoSize() {
  return future.length;
}

export function clearHistory() {
  history.length = 0;
  future.length = 0;
}

/** Rewind one action. Returns the (public) description of what was undone, or null. */
export function undoLast(): string | null {
  const snap = history.pop();
  if (!snap) return null;
  const undone = lastAction();
  future.push(snapshot()); // where we were, so redo can come back to it
  restore(snap);
  return undone;
}

/** Step forward again over an undone action, if nothing new has happened. */
export function redoLast(): string | null {
  const snap = future.pop();
  if (!snap) return null;
  history.push(snapshot()); // undoable again from here
  restore(snap);
  return lastAction(); // the action the snapshot we just restored had performed
}
