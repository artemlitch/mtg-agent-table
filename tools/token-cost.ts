// What a history policy costs, predicted and actually billed.
//
// Every call resends the whole conversation, so the bill is decided by the
// provider's prefix cache: a cached token is ~30x cheaper than a fresh one.
// Anything that REWRITES history — trimOldThinking, collapseSupersededState —
// drops the cache from the edit to the end and re-reads the tail at full
// price. Which of them is worth its toll is not a thing to reason about. It is
// a thing to measure.
//
// So this replays a saved game twice over the same walk:
//
//   estimate  a model of the prefix cache, free, instant
//   measure   the same prefixes sent to DeepSeek, reading the cache numbers
//             off the real responses
//
// and prints the delta. Once the estimator agrees with the meter you can sweep
// policies for nothing; when it stops agreeing, the model has missed something
// real and the delta is the bug report.
//
// What the delta does NOT tell you is whether the replayed history resembles
// the game that was played. Both runs walk the same reconstructed messages, so
// agreement between them validates the cache model and nothing else. The check
// on the reconstruction is the game's own recorded usage, printed at the top:
// against it, the rebuilt history reads about 30% high on missed tokens,
// because the thinking it puts back is a guess at the size of what was
// deleted. Trust the ranking between policies, which share an input; treat the
// dollars as an upper bound.
//
//   bun run tools/token-cost.ts <state.json> [--policy 80000:4:340000] [--measure]
//   bun run tools/token-cost.ts <state.json> --sweep            # free
//
// A policy is "<collapse>:<keepWindows>:<trimAbove>". The collapse threshold
// is in characters and may be "eager" (on sight) or "never"; keepWindows may
// be "never" (keep every thought); trimAbove is the conversation size the trim
// waits for and may be "always" (trim every wake) or "never". Omitted parts
// take the shipping value.
//
// --measure spends real money on the DeepSeek key in the keystore: one call
// per call in the original game, at max_tokens 16 since only the input side is
// being measured. A ~150-call game runs about a dollar on Pro.

import {
  trimOldThinking,
  collapseSupersededState,
  buildSystemPrompt,
  SUPERSEDED_STATE,
  DROPPED_THINKING,
  COLLAPSE_THRESHOLD_CHARS,
  KEEP_THINKING_WINDOWS,
  TRIM_ABOVE_CHARS,
  CHARS_PER_TOKEN,
} from "../server/agent";
import { TOOLS } from "../server/mcp-tools";
import { loadKey } from "../server/keystore";

/** DeepSeek V4 Pro, dollars per 1M tokens. Peak; off-peak is half. */
const PRICE = { miss: 1.32, hit: 0.044, out: 3.96 };

const isWakePrompt = (m: any) => m?.role === "user" && Array.isArray(m.content) && m.content[0]?.type === "text";
const chars = (v: any) => JSON.stringify(v ?? "").length;
const snapshotKey = (name: string, input: any) =>
  name === "get_state" ? "state" : name === "view_zone" ? `zone:${input?.player}:${input?.zone}` : null;

interface Policy {
  label: string;
  threshold: number;
  keep: number;
  /** conversation size below which the trim does nothing */
  above: number;
}

function parsePolicy(s: string): Policy {
  const [c, k = String(KEEP_THINKING_WINDOWS), a = String(TRIM_ABOVE_CHARS)] = s.split(":");
  return {
    label: s,
    threshold: c === "eager" ? 0 : c === "never" ? Infinity : Number(c),
    keep: k === "never" ? Infinity : Number(k),
    above: a === "always" ? 0 : a === "never" ? Infinity : Number(a),
  };
}

// ── reconstruction ────────────────────────────────────────────────────────
//
// A saved game is the history AFTER the policies ran on it: the stale
// snapshots are already pointers and the old thinking is already gone. Replay
// it as-is and the two things being priced are both invisible. So both are put
// back first, using real content of the right size — filler of repeated
// characters would tokenize nothing like a board, and the tokenizer is the
// thing being measured.

function reconstruct(messages: any[]) {
  const keyOf = new Map<string, string>();
  for (const m of messages) {
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b?.type !== "tool_use") continue;
      const k = snapshotKey(b.name, b.input);
      if (k) keyOf.set(b.id, k);
    }
  }

  const samples = new Map<string, string>();
  const thinking: string[] = [];
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b?.type === "thinking" && b.thinking) thinking.push(b.thinking);
      const k = b?.type === "tool_result" ? keyOf.get(b.tool_use_id) : undefined;
      if (k && typeof b.content === "string" && b.content !== SUPERSEDED_STATE && !samples.has(k)) samples.set(k, b.content);
    }
  }

  let snapshots = 0;
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content) {
      const k = b?.type === "tool_result" ? keyOf.get(b.tool_use_id) : undefined;
      if (k && b.content === SUPERSEDED_STATE) {
        b.content = samples.get(k) ?? samples.get("state") ?? "{}";
        snapshots++;
      }
    }
  }

  let thoughts = 0;
  if (thinking.length) {
    thinking.sort((a, b) => a.length - b.length);
    const typical = thinking[Math.floor(thinking.length / 2)];
    for (const m of messages) {
      if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
      if (m.content.some((b: any) => b?.type === "thinking")) continue;
      const body = m.content.filter((b: any) => !(b?.type === "text" && b.text === DROPPED_THINKING));
      if (!body.length) continue;
      // a turn whose only act is `done` did not deliberate — measured across a
      // full game, 42 of them carried 123 characters of thinking between them.
      // Handing each one a median-sized thought invents more history than the
      // game had, and it does so unevenly, which makes two variants of the same
      // game incomparable
      const tools = body.filter((b: any) => b?.type === "tool_use");
      if (tools.length === 1 && tools[0].name === "done") continue;
      m.content = [{ type: "thinking", thinking: typical }, ...body];
      thoughts++;
    }
  }
  return { keyOf, snapshots, thoughts };
}

// ── the walk ──────────────────────────────────────────────────────────────

interface Step {
  /** the prefix this call sent */
  messages: any[];
  /** earliest message rewritten since the last call, or Infinity */
  dirtyFrom: number;
}

/** Rebuild the conversation the way the runner built it, applying the real
 *  trim and collapse, and hand each resulting call to `onCall`. */
async function walk(messages: any[], policy: Policy, onCall: (s: Step) => Promise<void> | void) {
  const ms: any[] = [];
  let dirtyFrom = Infinity;

  /** the policies rewrite in place; note how far back they reached */
  const noteEdit = (before: string[], after: string[]) => {
    for (let i = 0; i < after.length; i++) {
      if (before[i] !== after[i]) return (dirtyFrom = Math.min(dirtyFrom, i));
    }
  };
  const snapshot = () => ms.map((m) => JSON.stringify(m));

  for (let i = 0; i < messages.length; i++) {
    ms.push(structuredClone(messages[i]));
    if (isWakePrompt(messages[i]) && Number.isFinite(policy.keep) && Number.isFinite(policy.above)) {
      const before = snapshot();
      trimOldThinking(ms, policy.keep, policy.above);
      noteEdit(before, snapshot());
    }
    // an assistant message next means a call happened on what is here now
    if (messages[i + 1]?.role !== "assistant") continue;
    await onCall({ messages: ms, dirtyFrom });
    dirtyFrom = Infinity;
    // its tool results land, then the collapse rule runs — as index.ts does
    if (Number.isFinite(policy.threshold)) {
      const before = snapshot();
      collapseSupersededState(ms, policy.threshold);
      noteEdit(before, snapshot());
    }
  }
}

// ── the two runs ──────────────────────────────────────────────────────────

interface Totals {
  calls: number;
  miss: number;
  hit: number;
  perCall: { miss: number; hit: number }[];
}

const empty = (): Totals => ({ calls: 0, miss: 0, hit: 0, perCall: [] });
const cost = (t: Totals) => (t.miss * PRICE.miss + t.hit * PRICE.hit) / 1e6;

/** The cache model: valid for the longest prefix already sent and not rewritten
 *  since. Everything past that point is billed as a miss. */
async function estimate(messages: any[], policy: Policy, systemChars: number): Promise<Totals> {
  const t = empty();
  let sentUpTo = 0;
  await walk(messages, policy, ({ messages: ms, dirtyFrom }) => {
    const sizes = ms.map(chars);
    const upto = (n: number) => sizes.slice(0, n).reduce((a, c) => a + c, 0);
    const total = upto(ms.length) + systemChars;
    const cachedTo = Math.min(sentUpTo, dirtyFrom);
    const cached = cachedTo > 0 ? upto(cachedTo) + systemChars : 0;
    const miss = Math.round(Math.max(0, total - cached) / CHARS_PER_TOKEN);
    const hit = Math.round(cached / CHARS_PER_TOKEN);
    t.calls++;
    t.miss += miss;
    t.hit += hit;
    t.perCall.push({ miss, hit });
    sentUpTo = ms.length;
  });
  return t;
}

const TOOL_DEFS = Object.entries(TOOLS).map(([name, def]: any) => ({ name, description: def.description, input_schema: def.schema }));

async function measure(messages: any[], policy: Policy, system: string, model: string): Promise<Totals> {
  const key = loadKey("deepseek");
  if (!key) throw new Error("no DeepSeek key in the keystore — --measure needs one");
  const t = empty();
  await walk(messages, policy, async ({ messages: ms }) => {
    const usage = await post(key, model, system, ms);
    const miss = usage.input_tokens ?? 0;
    const hit = usage.cache_read_input_tokens ?? 0;
    t.calls++;
    t.miss += miss;
    t.hit += hit;
    t.perCall.push({ miss, hit });
    if (t.calls % 20 === 0) process.stderr.write(`    ${policy.label}: ${t.calls} calls, ${fmt(t.miss)} miss\n`);
  });
  return t;
}

async function post(key: string, model: string, system: string, messages: any[]): Promise<any> {
  const body = JSON.stringify({
    model,
    max_tokens: 16, // only the input side is being measured
    system: [{ type: "text", text: system }],
    tools: TOOL_DEFS,
    messages,
  });
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.deepseek.com/anthropic/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body,
    });
    if (res.ok) return (await res.json()).usage ?? {};
    const text = (await res.text()).slice(0, 300);
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, [2000, 5000, 12000][attempt]));
      continue;
    }
    throw new Error(`DeepSeek ${res.status}: ${text}`);
  }
}

// ── output ────────────────────────────────────────────────────────────────

const fmt = (n: number) => (Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2) + "M" : Math.round(n / 1000) + "k");
const pct = (a: number, b: number) => (b === 0 ? "—" : ((a / b - 1) * 100).toFixed(1).padStart(6) + "%");

function main() {
  const args = process.argv.slice(2);
  const path = args.find((a) => !a.startsWith("--"));
  if (!path) {
    console.error("usage: bun run tools/token-cost.ts <state.json> [--policy 80000:4] [--measure] [--sweep]");
    process.exit(1);
  }
  const flag = (name: string, dflt?: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? (args[i + 1]?.startsWith("--") ? "" : args[i + 1]) : dflt;
  };
  const doMeasure = args.includes("--measure");
  const model = flag("model", "deepseek-v4-pro")!;
  const policies = args.includes("--sweep")
    ? [
        `${COLLAPSE_THRESHOLD_CHARS}:${KEEP_THINKING_WINDOWS}:${TRIM_ABOVE_CHARS}`,
        "80000:4:always",
        "80000:2:always",
        "80000:4:never",
        "eager:4:always",
        "never:4:always",
      ]
    : [flag("policy", `${COLLAPSE_THRESHOLD_CHARS}:${KEEP_THINKING_WINDOWS}`)!];

  const agent = JSON.parse(require("fs").readFileSync(path, "utf8")).agent;
  if (!agent?.messages?.length) throw new Error(`${path} has no API history (a CLI game, or a fresh save)`);
  const a = agent.promptArgs;
  const system = a ? buildSystemPrompt(a.agentDeck, a.decklist, a.userDeck) : "";

  return { path, agent, system, policies: policies.map(parsePolicy), doMeasure, model };
}

const { path, agent, system, policies, doMeasure, model } = main();

console.log(`${path.split("/").pop()} — ${agent.model}, ${agent.messages.length} messages`);
if (agent.usage) {
  const u = agent.usage;
  console.log(`  as actually played: ${u.calls} calls, ${fmt(u.input)} miss, ${fmt(u.cacheRead)} hit, ${fmt(u.output)} out`);
  // interrupted calls answer nothing but are prefilled server-side, so they
  // are billed; without this line they are spend with no row anywhere
  if (u.aborted) {
    console.log(`  interrupted: ${u.aborted} calls thrown away, ~${fmt(u.abortedInput ?? 0)} input tokens (estimated, see AgentUsage.aborted)`);
  }
}

const head = `  ${"policy".padEnd(15)}${"calls".padStart(6)}${"miss".padStart(8)}${"hit".padStart(8)}${"cost".padStart(9)}`;
console.log(`\n  ESTIMATED${doMeasure ? " vs MEASURED" : ""}`);
console.log(head + (doMeasure ? `${"miss".padStart(10)}${"hit".padStart(9)}${"cost".padStart(9)}${"Δ miss".padStart(9)}` : ""));

for (const policy of policies) {
  const messages = structuredClone(agent.messages) as any[];
  const { snapshots, thoughts } = reconstruct(messages);
  if (policy === policies[0]) {
    console.log(`  (reconstructed ${snapshots} collapsed snapshots and ${thoughts} trimmed thoughts before replaying)`);
  }
  const est = await estimate(messages, policy, system.length);
  let line = `  ${policy.label.padEnd(15)}${String(est.calls).padStart(6)}${fmt(est.miss).padStart(8)}${fmt(est.hit).padStart(8)}${("$" + cost(est).toFixed(2)).padStart(9)}`;
  if (doMeasure) {
    // a salt keeps each policy's prefix chain unique: without it the second
    // run inherits the first one's warm cache and reads as free
    const salted = `[replay ${policy.label} ${Date.now()}]\n${system}`;
    const act = await measure(messages, policy, salted, model);
    line += `${fmt(act.miss).padStart(10)}${fmt(act.hit).padStart(9)}${("$" + cost(act).toFixed(2)).padStart(9)}${pct(est.miss, act.miss).padStart(9)}`;
    const totalChars = est.perCall.reduce((n, c) => n + c.miss + c.hit, 0) * CHARS_PER_TOKEN;
    const totalTok = act.miss + act.hit;
    line += `\n  ${" ".repeat(15)}implied chars/token ${(totalChars / totalTok).toFixed(2)} (this file assumes ${CHARS_PER_TOKEN})`;
  }
  console.log(line);
}
