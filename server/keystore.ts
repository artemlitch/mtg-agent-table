// Credential storage for the agent's transports, all 0600 files in the data
// dir. Nothing here is ever sent back to a client — the UI only learns
// configured yes/no. Paths resolve per call so tests can redirect them
// with env vars regardless of module load order.
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./datadir";

// ── Anthropic API key (pasted in the UI; ANTHROPIC_API_KEY env is a dev fallback)

const keyFile = () => process.env.ANTHROPIC_KEY_FILE ?? join(DATA_DIR, "anthropic-key");

export function loadApiKey(): string | null {
  try {
    const k = readFileSync(keyFile(), "utf8").trim();
    if (k) return k;
  } catch {}
  return process.env.ANTHROPIC_API_KEY || null;
}

export function saveApiKey(key: string) {
  writeFileSync(keyFile(), key.trim(), { mode: 0o600 });
}

export function deleteApiKey() {
  try {
    unlinkSync(keyFile());
  } catch {}
}

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

// ── Custom provider: any Anthropic-Messages-compatible endpoint (DeepSeek's
// /anthropic skin, OpenRouter, llama.cpp, LM Studio, Ollama…). Configuring
// one is an explicit choice that outranks every other transport; deleting it
// reverts to the Anthropic key / Claude Code order.

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
