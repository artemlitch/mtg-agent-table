// Where persistent data lives: the platform application-data directory, not
// the repo. Games, keys and the live state file all land here, so a checkout
// stays disposable and a `git clean` never eats a game.
// DATA_DIR/STATE_FILE/GAMES_DIR override it (tests, dev experiments).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const APP_NAME = "MTG Battlefield";

function platformDataDir(): string {
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", APP_NAME);
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), APP_NAME);
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), APP_NAME);
}

export const DATA_DIR = process.env.DATA_DIR ?? platformDataDir();
mkdirSync(DATA_DIR, { recursive: true });

export const STATE_FILE = process.env.STATE_FILE ?? join(DATA_DIR, "state.json");
export const GAMES_DIR = process.env.GAMES_DIR ?? join(DATA_DIR, "games");
mkdirSync(GAMES_DIR, { recursive: true });

/** Sound libraries to audition against, unpacked here rather than in the
 *  checkout. A commercial library is tens of gigabytes and tens of thousands
 *  of files; none of that belongs in git, and none of it should be copied into
 *  web/ by every build. The sounds that survive an audition get copied into
 *  client/public/assets/sounds, which is the part worth keeping. */
export const SAMPLE_LIB_DIR = process.env.SAMPLE_LIB_DIR ?? join(DATA_DIR, "sample-libraries");
mkdirSync(SAMPLE_LIB_DIR, { recursive: true });
