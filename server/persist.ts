// Snapshot/restore of the whole table (game + agent session) so a server
// restart doesn't throw the game away.

import { game, getNextCardId, setNextCardId } from "./game";
import type { AgentSnapshot } from "./agent";

/** Everything saved alongside the game that is NOT the game. The undo history
 *  was always here; the conversation belongs here for the same reason — a
 *  snapshot of the game must not contain it, or undo could rewind it. */
export interface PersistedExtra {
  agent: AgentSnapshot | null;
  lastDecks: { you: number; agent: number } | null;
  history?: any[];
  said?: any[];
  studio?: any;
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
      ...(extra.said ? { said: extra.said } : {}),
      ...(extra.studio ? { studio: extra.studio } : {}),
    })
  );
}

export function restoreState(snap: any): PersistedExtra {
  Object.assign(game, snap.game);
  // migrations for snapshots from before the stack existed
  (game as any).stack ??= [];
  (game as any).tokenCatalog ??= {};
  // Conversation used to live in game.log, where undo could rewind it. Lift
  // the old entries out into `said` so a game in progress gets the same
  // guarantee as a new one. Matching on the rendering is only safe because
  // this runs once per save file, on lines no future code writes.
  const legacyTalk: any[] = [];
  game.log = game.log.filter((e: any) => {
    if (!(e.talk || /^💬 |^❓ | passes — /.test(e.text))) return true;
    legacyTalk.push({ ...e, talk: true });
    return false;
  });
  if (legacyTalk.length) snap.said = [...legacyTalk, ...(snap.said ?? [])].sort((a, b) => a.seq - b.seq);
  // DFC names follow the active face now — rewrite composite names in place
  for (const c of Object.values(game.cards) as any[]) {
    if (c.faces) c.name = c.faces[c.face ?? 0]?.name ?? c.name;
    // attach became board piles: rename the pointer
    if (c.under === undefined) c.under = c.attachedTo ?? null;
    delete c.attachedTo;
    // P/T counters are one net quantity now — normalize legacy negatives
    if (c.counters) {
      const net = (c.counters["+1/+1"] || 0) - (c.counters["-1/-1"] || 0);
      delete c.counters["+1/+1"];
      delete c.counters["-1/-1"];
      if (net > 0) c.counters["+1/+1"] = net;
      else if (net < 0) c.counters["-1/-1"] = -net;
    }
  }
  // piles are linear chains — old attach fans (several cards on one target)
  // chain up beneath each other instead; re-run until no rung holds two cards
  for (let pass = 0; pass < 10; pass++) {
    const byUnder: Record<string, any[]> = {};
    for (const c of Object.values(game.cards) as any[]) {
      if (!c.under) continue;
      if (!game.cards[c.under]) { c.under = null; continue; } // dangling pointer
      (byUnder[c.under] ??= []).push(c);
    }
    let fixed = false;
    for (const list of Object.values(byUnder)) {
      for (let i = 1; i < list.length; i++) { list[i].under = list[i - 1].id; fixed = true; }
    }
    if (!fixed) break;
  }
  for (const p of Object.values(game.players)) (p.zones as any).stack ??= [];
  setNextCardId(snap.nextCardId ?? 1);
  return { agent: snap.agent ?? null, lastDecks: snap.lastDecks ?? null, history: snap.history ?? [], said: snap.said ?? [], studio: snap.studio };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Immediate full snapshot write. */
export async function saveNow(file: string, collect: () => PersistedExtra) {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  // atomic: write to a tmp then rename, so a kill mid-write can never
  // truncate the real file (that exact failure lost a game once)
  try {
    const json = JSON.stringify(serializeState(collect()));
    await Bun.write(file + ".tmp", json);
    const { renameSync } = await import("node:fs");
    renameSync(file + ".tmp", file);
  } catch (e) {
    console.error("state save failed:", e);
  }
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
