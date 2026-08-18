// One-time retro-conversion: turn every state-backup-*.json into a games/
// archive entry (json + md transcript). Idempotent — same backup, same stamp,
// same filename. Run: bun tools/archive-backups.ts
import { readdirSync } from "node:fs";
import { archiveGame } from "../server/archive";

const ROOT = new URL("..", import.meta.url).pathname;
const GAMES = ROOT + "games";

for (const f of readdirSync(ROOT).sort()) {
  const m = f.match(/^state-backup-(\d+)\.json$/);
  if (!m) continue;
  const snap = await Bun.file(ROOT + f).json();
  if (!snap?.game?.started) {
    console.log(`skip ${f} (no started game)`);
    continue;
  }
  const base = await archiveGame(snap.game, GAMES, Number(m[1]));
  console.log(`archived ${f} -> ${base.split("/").pop()}`);
}
