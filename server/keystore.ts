// Credential storage for the agent's transports, all 0600 files in the data
// dir. Nothing here is ever sent back to a client — the UI only learns
// configured yes/no. Paths resolve per call so tests can redirect them
// with env vars regardless of module load order.
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./datadir";
import { PROVIDER_IDS, type ProviderId } from "./models";

// ── One API key per provider (pasted in the UI; the env vars come from a
// .env in the repo root, which Bun loads at boot, and the *_KEY_FILE vars let
// the tests redirect the store)

const KEY_FILES: Record<ProviderId, { file: string; fileEnv: string; keyEnv: string }> = {
  anthropic: { file: "anthropic-key", fileEnv: "ANTHROPIC_KEY_FILE", keyEnv: "ANTHROPIC_API_KEY" },
  deepseek: { file: "deepseek-key", fileEnv: "DEEPSEEK_KEY_FILE", keyEnv: "DEEPSEEK_API_KEY" },
};

const keyFile = (p: ProviderId) => process.env[KEY_FILES[p].fileEnv] ?? join(DATA_DIR, KEY_FILES[p].file);

export function loadKey(p: ProviderId): string | null {
  try {
    const k = readFileSync(keyFile(p), "utf8").trim();
    if (k) return k;
  } catch {}
  return process.env[KEY_FILES[p].keyEnv] || null;
}

export function saveKey(p: ProviderId, key: string) {
  writeFileSync(keyFile(p), key.trim(), { mode: 0o600 });
}

export function deleteKey(p: ProviderId) {
  try {
    unlinkSync(keyFile(p));
  } catch {}
}

/** Which providers have a key, for the UI — the keys themselves never leave. */
export const configuredKeys = (): Record<ProviderId, boolean> =>
  Object.fromEntries(PROVIDER_IDS.map((p) => [p, !!loadKey(p)])) as Record<ProviderId, boolean>;

// ── Archidekt sign-in, for the deck studio only. Archidekt has no API tokens,
// so editing a deck costs a real username and password. Env first (put them in
// .env and they never touch the store), else whatever the studio's own sign-in
// prompt wrote. The table app never asks: reading a public deck needs nobody.

export interface ArchidektLogin {
  user: string;
  pass: string;
}

const archidektFile = () => process.env.ARCHIDEKT_FILE ?? join(DATA_DIR, "archidekt.json");

export function loadArchidekt(): ArchidektLogin | null {
  const user = process.env.ARCHIDEKT_USER;
  const pass = process.env.ARCHIDEKT_PASS;
  if (user && pass) return { user, pass };
  try {
    const a = JSON.parse(readFileSync(archidektFile(), "utf8"));
    if (a?.user && a?.pass) return { user: a.user, pass: a.pass };
  } catch {}
  return null;
}

export function saveArchidekt(a: ArchidektLogin) {
  writeFileSync(archidektFile(), JSON.stringify({ user: a.user.trim(), pass: a.pass }), { mode: 0o600 });
}

export function deleteArchidekt() {
  try {
    unlinkSync(archidektFile());
  } catch {}
}

/** For the studio page: signed in yes/no, and as whom. The password never
 *  leaves, and an env-configured login cannot be deleted from the UI. */
export const archidektStatus = () => {
  const a = loadArchidekt();
  return { configured: !!a, user: a?.user ?? null, fromEnv: !!(process.env.ARCHIDEKT_USER && process.env.ARCHIDEKT_PASS) };
};

// ── Claude Code CLI: a marker set by the one-time successful test call in the
// setup screen — an installed-but-unauthed CLI must not count as a transport

const cliMarker = () => process.env.CLAUDE_CLI_MARKER ?? join(DATA_DIR, "claude-cli-ok");

export function isCliVerified(): boolean {
  try {
    readFileSync(cliMarker());
    return true;
  } catch {
    return false;
  }
}

export function setCliVerified() {
  writeFileSync(cliMarker(), new Date().toISOString());
}

export function clearCliVerified() {
  try {
    unlinkSync(cliMarker());
  } catch {}
}

// ── Custom provider: the escape hatch for a Messages-compatible endpoint the
// catalog in models.ts has never heard of (OpenRouter, llama.cpp, LM Studio,
// Ollama…). Configuring one is an explicit choice that outranks the model
// picker and every other transport; deleting it puts the picker back in
// charge. Anything worth choosing twice belongs in MODELS instead.

export interface Provider {
  baseUrl: string;
  apiKey: string;
  model: string;
}

const providerFile = () => process.env.PROVIDER_FILE ?? join(DATA_DIR, "provider.json");

export function loadProvider(): Provider | null {
  try {
    const p = JSON.parse(readFileSync(providerFile(), "utf8"));
    if (p?.baseUrl && p?.apiKey && p?.model) return p;
  } catch {}
  return null;
}

export function saveProvider(p: Provider) {
  writeFileSync(providerFile(), JSON.stringify(p), { mode: 0o600 });
}

export function deleteProvider() {
  try {
    unlinkSync(providerFile());
  } catch {}
}
