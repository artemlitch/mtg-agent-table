// Per-action snapshot ring buffer powering undo. Game state only — the
// agent's conversation can't be unwound, so undo leaves the agent untouched
// and it learns about the rewind from the ↩ log entry.

import { game, getNextCardId, setNextCardId } from "./game";
import { serializeState, restoreState } from "./persist";

const history: any[] = [];
const MAX = 100;

export function recordSnapshot() {
  history.push(serializeState({ agent: null, lastDecks: null }));
  if (history.length > MAX) history.shift();
}

export function dropLastSnapshot() {
  history.pop();
}

export function historySize() {
  return history.length;
}

export function clearHistory() {
  history.length = 0;
}

/** Rewind one action. Returns the (public) description of what was undone, or null. */
export function undoLast(): string | null {
  const snap = history.pop();
  if (!snap) return null;
  const undone = game.log.at(-1)?.text ?? "(unknown action)";
  const seqBefore = game.seq;
  const idBefore = getNextCardId();
  restoreState(snap);
  // seq and card ids stay monotonic so later log entries / references never collide
  game.seq = Math.max(game.seq, seqBefore);
  setNextCardId(Math.max(getNextCardId(), idBefore));
  return undone;
}
