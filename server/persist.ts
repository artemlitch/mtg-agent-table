// Snapshot/restore of the whole table (game + agent session) so a server
// restart doesn't throw the game away.

import { game, getNextCardId, setNextCardId } from "./game";
import type { AgentSnapshot } from "./agent";

export interface PersistedExtra {
  agent: AgentSnapshot | null;
  lastDecks: { you: number; agent: number } | null;
  history?: any[];
}

export function serializeState(extra: PersistedExtra) {
  // deep-copy: the snapshot must not alias live singletons
  return JSON.parse(
    JSON.stringify({
      v: 1,
      game,
      nextCardId: getNextCardId(),
      agent: extra.agent,
      lastDecks: extra.lastDecks,
      ...(extra.history ? { history: extra.history } : {}),
    })
  );
}

export function restoreState(snap: any): PersistedExtra {
  Object.assign(game, snap.game);
  // migrations for snapshots from before the stack existed
  (game as any).stack ??= [];
  for (const p of Object.values(game.players)) (p.zones as any).stack ??= [];
  setNextCardId(snap.nextCardId ?? 1);
  return { agent: snap.agent ?? null, lastDecks: snap.lastDecks ?? null, history: snap.history ?? [] };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Immediate full snapshot write. */
export function saveNow(file: string, collect: () => PersistedExtra) {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  return Bun.write(file, JSON.stringify(serializeState(collect()))).catch((e) =>
    console.error("state save failed:", e)
  );
}

/** Debounced save; collect() is called at write time so it sees latest state. */
export function scheduleSave(file: string, collect: () => PersistedExtra) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow(file, collect);
  }, 200);
}

export async function loadStateFile(file: string): Promise<PersistedExtra | null> {
  try {
    const f = Bun.file(file);
    if (!(await f.exists())) return null;
    const text = await f.text();
    if (!text.trim()) return null;
    return restoreState(JSON.parse(text));
  } catch (e) {
    console.error("state load failed (starting fresh):", e);
    return null;
  }
}
