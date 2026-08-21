// Anthropic API key storage: a 0600 file in the data dir, pasted in via the
// UI. ANTHROPIC_API_KEY env is a dev fallback when no file exists. The key
// never leaves the server — the client only ever learns configured yes/no.
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./datadir";

const KEY_FILE = process.env.ANTHROPIC_KEY_FILE ?? join(DATA_DIR, "anthropic-key");

export function loadApiKey(): string | null {
  try {
    const k = readFileSync(KEY_FILE, "utf8").trim();
    if (k) return k;
  } catch {}
  return process.env.ANTHROPIC_API_KEY || null;
}

export function saveApiKey(key: string) {
  writeFileSync(KEY_FILE, key.trim(), { mode: 0o600 });
}

export function deleteApiKey() {
  try {
    unlinkSync(KEY_FILE);
  } catch {}
}
