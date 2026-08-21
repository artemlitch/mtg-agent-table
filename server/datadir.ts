// Where persistent data lives: the platform application-data directory, not
// the repo. STATE_FILE/GAMES_DIR envs override (tests, dev experiments).
import { existsSync, mkdirSync, renameSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const APP_NAME = "MTG Battlefield";
const REPO_ROOT = new URL("..", import.meta.url).pathname;

function platformDataDir(): string {
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", APP_NAME);
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), APP_NAME);
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), APP_NAME);
}

export const DATA_DIR = process.env.DATA_DIR ?? platformDataDir();
mkdirSync(DATA_DIR, { recursive: true });

export const STATE_FILE = process.env.STATE_FILE ?? join(DATA_DIR, "state.json");
export const GAMES_DIR = process.env.GAMES_DIR ?? join(DATA_DIR, "games");

// one-time migration from the old repo layout; skipped entirely when the
// caller overrides the paths (tests must never move real data)
if (!process.env.STATE_FILE && !process.env.GAMES_DIR && !process.env.DATA_DIR) {
  if (!existsSync(STATE_FILE) && existsSync(join(REPO_ROOT, "state.json"))) {
    renameSync(join(REPO_ROOT, "state.json"), STATE_FILE);
  }
  if (!existsSync(GAMES_DIR) && existsSync(join(REPO_ROOT, "games"))) {
    renameSync(join(REPO_ROOT, "games"), GAMES_DIR);
  }
  for (const f of readdirSync(REPO_ROOT)) {
    if (/^state-backup-\d+\.json$/.test(f) && !existsSync(join(DATA_DIR, f))) {
      renameSync(join(REPO_ROOT, f), join(DATA_DIR, f));
    }
  }
}
mkdirSync(GAMES_DIR, { recursive: true });
