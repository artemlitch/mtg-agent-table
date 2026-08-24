// Does thinking less cost less, and does it decide differently?
//
// Deliberation is billed at the output rate — $3.96/M on DeepSeek V4 Pro, 90x
// a cached input token — and it is not evenly valuable. The first call of a
// window forms a plan; the calls after it carry the plan out. A reaction
// window over an empty stack decides nothing at all.
//
// The cheap half of that question is "how many tokens". The half that matters
// is "does it still play the same". So this replays a saved game and, at each
// call the policy would downgrade, asks the model TWICE from the identical
// prefix — once at full effort, once reduced — and scores both against what
// the agent actually did at that point in the real game.
//
// Agreement is a proxy, not a verdict: two different lines can both be right,
// and a disagreement on a rich board may be the cheaper setting finding
// something else reasonable. It is a strong signal on exactly the calls this
// policy targets, though, because those are the ones where there should be
// nothing to think about.
//
//   bun run tools/effort-test.ts <state.json> [--sample 30] [--effort low]
//
// Spends real money: two generating calls per sampled decision.

import { trimOldThinking, collapseSupersededState, buildSystemPrompt, TRIM_ABOVE_CHARS, KEEP_THINKING_WINDOWS } from "../server/agent";
import { TOOLS } from "../server/mcp-tools";
import { loadKey } from "../server/keystore";

const PRICE = { miss: 1.32, hit: 0.044, out: 3.96 }; // V4 Pro, peak, per 1M

const isWakePrompt = (m: any) => m?.role === "user" && Array.isArray(m.content) && m.content[0]?.type === "text";
const TOOL_DEFS = Object.entries(TOOLS).map(([name, def]: any) => ({ name, description: def.description, input_schema: def.schema }));

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith("--"))!;
const flag = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const SAMPLE = Number(flag("sample", "30"));
const LATER_EFFORT = flag("effort", "low");
const MINIMAL_EFFORT = flag("minimal", "minimal");
const MODEL = flag("model", "deepseek-v4-pro");

const key = loadKey("deepseek");
if (!key) throw new Error("no DeepSeek key");
const agent = JSON.parse(require("fs").readFileSync(path, "utf8")).agent;
const source: any[] = agent.messages;
const a = agent.promptArgs;
const SYSTEM = a ? buildSystemPrompt(a.agentDeck, a.decklist, a.userDeck) : (agent.systemPrompt ?? "");

/** Which calls the policy would downgrade, and to what. */
function classify(ms: any[]) {
  const plan = new Map<number, { effort: string; why: string }>();
  const wins: number[] = [];
  ms.forEach((m, i) => isWakePrompt(m) && wins.push(i));
  for (let w = 0; w < wins.length; w++) {
    const start = wins[w];
    const end = wins[w + 1] ?? ms.length;
    const text = ms[start].content[0].text as string;
    const react = /reaction window|PRIORITY in reaction/i.test(text);
    const liveStack = text.includes("THE STACK");
    const turns: number[] = [];
    for (let i = start + 1; i < end; i++) if (ms[i]?.role === "assistant") turns.push(i);
    turns.forEach((i, n) => {
      if (n > 0) plan.set(i, { effort: LATER_EFFORT, why: "carrying out a plan already made" });
      else if (react && !liveStack) plan.set(i, { effort: MINIMAL_EFFORT, why: "reaction window, empty stack" });
    });
  }
  return plan;
}

async function ask(system: string, messages: any[], effort?: string) {
  const body: any = { model: MODEL, max_tokens: 4096, system: [{ type: "text", text: system }], tools: TOOL_DEFS, messages };
  if (effort) body.reasoning_effort = effort;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.deepseek.com/anthropic/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key!, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return await res.json();
    const t = (await res.text()).slice(0, 200);
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, [2000, 5000, 12000][attempt]));
      continue;
    }
    throw new Error(`${res.status}: ${t}`);
  }
}

const toolsOf = (content: any[]) => (content ?? []).filter((b: any) => b?.type === "tool_use").map((b: any) => b.name);
const same = (x: string[], y: string[]) => x.length === y.length && x.every((v, i) => v === y[i]);

const plan = classify(source);
const targets = [...plan.keys()].sort((x, y) => x - y);
const step = Math.max(1, Math.floor(targets.length / SAMPLE));
const sampled = new Set(targets.filter((_, i) => i % step === 0).slice(0, SAMPLE));

console.log(`${path.split("/").pop()} — ${source.length} messages`);
console.log(`policy would downgrade ${targets.length} calls; sampling ${sampled.size} of them`);
console.log(`  later in a window -> reasoning_effort "${LATER_EFFORT}"`);
console.log(`  reaction window, empty stack -> "${MINIMAL_EFFORT}"\n`);

const rows: any[] = [];
const ms: any[] = [];
for (let i = 0; i < source.length; i++) {
  ms.push(structuredClone(source[i]));
  if (isWakePrompt(source[i])) trimOldThinking(ms, KEEP_THINKING_WINDOWS, TRIM_ABOVE_CHARS);
  const next = i + 1;
  if (source[next]?.role !== "assistant") continue;
  if (sampled.has(next)) {
    const truth = toolsOf(source[next].content);
    const { effort, why } = plan.get(next)!;
    // identical prefix both times; the second is fully cached by the first
    const full = await ask(SYSTEM, ms);
    const cheap = await ask(SYSTEM, ms, effort);
    const fT = toolsOf(full.content);
    const cT = toolsOf(cheap.content);
    rows.push({
      i: next,
      effort,
      why,
      truth,
      fullOut: full.usage.output_tokens ?? 0,
      cheapOut: cheap.usage.output_tokens ?? 0,
      fullMatch: same(fT, truth),
      cheapMatch: same(cT, truth),
      agree: same(fT, cT),
      fT,
      cT,
    });
    const r = rows.at(-1)!;
    console.log(
      `  #${String(next).padStart(3)} ${effort.padEnd(8)} out ${String(r.fullOut).padStart(5)} -> ${String(r.cheapOut).padStart(5)}` +
        `  truth[${truth.join(",") || "-"}]  full[${fT.join(",") || "-"}]  cheap[${cT.join(",") || "-"}]`
    );
  }
  collapseSupersededState(ms);
}

const sum = (f: (r: any) => number) => rows.reduce((n, r) => n + f(r), 0);
const fullOut = sum((r) => r.fullOut);
const cheapOut = sum((r) => r.cheapOut);
console.log(`\n${rows.length} decisions sampled`);
console.log(`  output tokens   full ${fullOut}   reduced ${cheapOut}   (${Math.round((1 - cheapOut / fullOut) * 100)}% less)`);
console.log(`  matched what the agent really did:  full ${rows.filter((r) => r.fullMatch).length}/${rows.length}   reduced ${rows.filter((r) => r.cheapMatch).length}/${rows.length}`);
console.log(`  full and reduced chose the same:    ${rows.filter((r) => r.agree).length}/${rows.length}`);
const perCall = (fullOut - cheapOut) / rows.length;
console.log(`\n  saving per downgraded call: ${Math.round(perCall)} output tokens = $${((perCall * PRICE.out) / 1e6).toFixed(4)}`);
console.log(`  over the ${targets.length} this game would downgrade: $${((perCall * targets.length * PRICE.out) / 1e6).toFixed(2)}`);
