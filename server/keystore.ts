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

// Claude Code CLI: a marker set by the one-time successful test call in the
// setup screen — an installed-but-unauthed CLI must not count as a transport
const CLI_MARKER = process.env.CLAUDE_CLI_MARKER ?? join(DATA_DIR, "claude-cli-ok");

export function isCliVerified(): boolean {
  try {
    readFileSync(CLI_MARKER);
    return true;
  } catch {
    return false;
  }
}

export function setCliVerified() {
  writeFileSync(CLI_MARKER, new Date().toISOString());
}

export function clearCliVerified() {
  try {
    unlinkSync(CLI_MARKER);
  } catch {}
}
