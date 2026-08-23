// The brains the agent can wear, and where each one lives.
//
// Every model in here speaks the Anthropic Messages API — Claude natively,
// DeepSeek through the /anthropic skin it publishes — so the tool loop in
// agent.ts drives all of them without knowing whose model it is talking to.
// A new brain is a row in MODELS and, if it is a new company, a row in
// PROVIDERS plus a key file in keystore.ts.
//
// Base URLs resolve per call, never at import: the tests point runners at
// local fakes, and a module-level read would freeze whatever the environment
// happened to say when this file was first loaded.

export type ProviderId = "anthropic" | "deepseek";

export interface ProviderSpec {
  /** what to call it in the UI and in error messages */
  name: string;
  baseUrl(): string;
  /** true only for api.anthropic.com: cache_control and the extended-cache
   *  beta header are theirs, and stricter servers reject unknown fields */
  anthropic: boolean;
  /** a cheap GET off the same origin that answers 401 to a bad key */
  probePath: string;
  probeHeaders(key: string): Record<string, string>;
  looksLikeKey(key: string): boolean;
  /** placeholder for the paste box */
  keyHint: string;
}

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  anthropic: {
    name: "Anthropic",
    baseUrl: () => process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com",
    anthropic: true,
    probePath: "/v1/models",
    probeHeaders: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
    looksLikeKey: (key) => key.startsWith("sk-ant-") && key.length >= 20,
    keyHint: "sk-ant-…",
  },
  deepseek: {
    name: "DeepSeek",
    baseUrl: () => process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/anthropic",
    anthropic: false,
    // DeepSeek's Messages endpoint hangs off /anthropic, but the model list
    // is at the root — hence a path against the origin rather than the base
    probePath: "/models",
    probeHeaders: (key) => ({ Authorization: `Bearer ${key}` }),
    looksLikeKey: (key) => key.startsWith("sk-") && key.length >= 20,
    keyHint: "sk-…",
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export const isProviderId = (v: unknown): v is ProviderId => typeof v === "string" && v in PROVIDERS;

/** Where to check a key before storing it. */
export const probeUrl = (p: ProviderId) => new URL(PROVIDERS[p].probePath, PROVIDERS[p].baseUrl()).toString();

export interface ModelSpec {
  /** short name, for the brain header */
  name: string;
  /** the half-sentence after the dash in the picker */
  note: string;
  /** the id that goes on the wire */
  wire: string;
  provider: ProviderId;
}

export const MODELS: Record<string, ModelSpec> = {
  opus: { name: "Opus", note: "strongest", wire: "claude-opus-5", provider: "anthropic" },
  sonnet: { name: "Sonnet", note: "strong", wire: "claude-sonnet-5", provider: "anthropic" },
  haiku: { name: "Haiku", note: "casual", wire: "claude-haiku-4-5-20251001", provider: "anthropic" },
  deepseek: { name: "DeepSeek", note: "cheapest", wire: "deepseek-v4-flash", provider: "deepseek" },
};

export const DEFAULT_MODEL = "opus";

/** The catalog entry for an id, or a pass-through: a full Anthropic model id
 *  typed in by hand still works, which is how a model newer than this file
 *  gets played without an edit. */
export function modelSpec(id: string): ModelSpec {
  return MODELS[id] ?? { name: id, note: "custom", wire: id, provider: "anthropic" };
}
