// Agent harness with two transports behind one interface:
//
//  - "cli": a persistent `claude -p` child on the machine owner's own Claude
//    Code login (stream-json stdin/stdout, MCP tools via mcp-tools.ts,
//    --resume across respawns). Zero marginal cost on a subscription. Used
//    once a test call has verified the login (keystore marker).
//  - "api": an in-process Messages API tool loop on a pasted API key
//    (keystore.ts), with 1h-TTL cache breakpoints and per-game usage
//    tracking.
//
// Which one a brain gets is decided by company, not by what happens to be
// configured. CLAUDE PLAYS ON THE SUBSCRIPTION OR IT DOES NOT PLAY:
// api.anthropic.com bills per token and this table never spends that way, so
// a Claude brain reaches the CLI or stays dark. There is no Anthropic key to
// paste — index.ts refuses to store one — and so no way for a Claude window
// to become a metered request. Everyone else is the reverse: the CLI can run
// nothing but Claude, so DeepSeek and a custom endpoint are API-only.
//
// Every non-Claude brain in the catalog (models.ts) rides that one API loop:
// DeepSeek differs from a custom provider by a row in a table — base url,
// key, wire model id — not by a code path.
//
// Wake windows, preemption, the brain panel, and persistence are shared.
// Preemption aborts the in-flight API request or interrupts the CLI child;
// completed tool calls stay applied either way.

import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cardVisibleTo, effectivePT, game, markSeenByAgent, renderLogFor, transcript, triggerLines, type Card, type PlayerId } from "./game";
import { TOOLS, callTable } from "./mcp-tools";
import { loadKey, isCliVerified, loadProvider } from "./keystore";
import { DEFAULT_MODEL, PROVIDERS, modelSpec, type ProviderId } from "./models";

const MAX_LOOP = 60; // API tool-loop iterations per window — runaway backstop

const PROJECT_DIR = new URL("..", import.meta.url).pathname;

/** The claude binary, wherever this machine keeps it — Finder-launched apps
 * have a bare PATH, so the well-known install locations are checked too. */
export function resolveClaudeBin(): string | null {
  if (process.env.CLAUDE_BIN) return existsSync(process.env.CLAUDE_BIN) ? process.env.CLAUDE_BIN : null;
  const found = Bun.which("claude");
  if (found) return found;
  for (const p of [
    join(homedir(), ".local/bin/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    join(homedir(), ".claude/local/claude"),
  ]) {
    if (existsSync(p)) return p;
  }
  return null;
}

export type Transport = "api" | "cli" | "custom" | "none";

/** Which transport a wake on this model would use right now. A deliberately
 * configured custom endpoint wins; after that the rule is per company.
 *
 * Claude goes to the CLI or nowhere. The CLI needs the binary and a one-time
 * verified test call (Chat tab); short of that a Claude brain is dark, and
 * "dark" is the correct answer rather than a fall back to the metered
 * endpoint. Every other brain is API-only, since the CLI can run nothing but
 * Claude: a DeepSeek brain lives or dies by a DeepSeek key.
 *
 * AGENT_TRANSPORT overrides the lot. It is a harness switch — the suite points
 * a runner at a local fake with it — and with it removed there is no path from
 * a Claude brain to a billed request. */
export function transportChoice(model = DEFAULT_MODEL): Transport {
  const forced = process.env.AGENT_TRANSPORT;
  if (forced === "api" || forced === "cli") return forced;
  if (loadProvider()) return "custom";
  const { provider } = modelSpec(model);
  if (provider === "anthropic") return resolveClaudeBin() && isCliVerified() ? "cli" : "none";
  return loadKey(provider) ? "api" : "none";
}

/** Where a model-API wake goes: a custom provider verbatim, or the catalog
 * entry for the game's model. `anthropic` gates the fields only
 * api.anthropic.com understands (cache_control, the beta header). */
interface Endpoint {
  baseUrl: string;
  apiKey: string;
  model: string;
  anthropic: boolean;
}

export interface BrainEntry {
  seq: number;
  ts: number;
  kind: "thinking" | "text" | "tool" | "status" | "error";
  text: string;
}

type BrainListener = (e: BrainEntry) => void;

export interface AgentUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  calls: number;
  /** One row per call, oldest first: [missed input, cached input, cache
   *  written, output].
   *
   *  The totals alone cannot answer the only question worth asking about the
   *  bill. Missed input is the expensive kind — roughly 30x a cached token on
   *  DeepSeek — and it is missed because something rewrote the history and
   *  dropped the prefix cache. A sum says how much; only the per-call series
   *  says WHICH calls, and a rewrite shows up in it as one call whose miss is
   *  an order of magnitude off its neighbours. Working that out from the sums
   *  took a replay of the saved game against the live API.
   *
   *  A tuple rather than an object: there is one per call, and the field names
   *  would be most of the bytes. */
  perCall?: CallUsage[];
  /** Calls the table interrupted, and roughly what their input weighed.
   *
   *  A preempted call is thrown away before it answers, so there is no usage
   *  to read and for a long time these did not appear in any number here —
   *  spend nobody could see. They are real: send a prefix, abort it, send the
   *  same prefix again, and it comes back a cache hit, which means the server
   *  had already prefilled the prompt. Prefilled is processed, and processed
   *  is billed.
   *
   *  The other half of that is a consolation. Because the abort leaves the
   *  prefix cached, the window that restarts behind it reads almost entirely
   *  from cache — so an interruption costs its own missed input and whatever
   *  it managed to generate, not the whole conversation twice.
   *
   *  Estimated from the request body, since the exact figure would need the
   *  streaming API: message_start carries the input counts before any of the
   *  answer arrives, and an abort after that point would know them. */
  aborted?: number;
  abortedInput?: number;
}

/** Characters per token in this app's own conversations — JSON runs denser
 *  than prose. Measured by replaying saved games against the live API;
 *  tools/token-cost.ts prints the implied figure on every --measure run, which
 *  is how to recheck it. Four such runs read 3.50, 3.57, 3.59 and 3.50, so the
 *  earlier 3.42 was low. Only ever an estimate, and only used where the real
 *  count is unavailable. */
export const CHARS_PER_TOKEN = 3.55;

/** [missed input, cached input, cache written, output] — see AgentUsage.perCall */
export type CallUsage = [number, number, number, number];

/** Enough for any real game (a window is capped at 60 calls), and a bound so a
 *  runaway cannot grow the save file without limit. */
export const USAGE_LOG_LIMIT = 2000;

/** What the system prompt is built FROM. Saved instead of the built string,
 *  so the prompt is rebuilt from current code on every request: an edit to
 *  the rules below used to sit inert until somebody started a new game, and
 *  the agent would confidently deny having a tool it had been given. */
export interface PromptArgs {
  agentDeck: string;
  decklist: string[];
  userDeck: string;
}

export interface AgentSnapshot {
  sessionId?: string | null;
  /** legacy saves froze the built prompt; new ones save promptArgs */
  systemPrompt?: string;
  promptArgs?: PromptArgs | null;
  model: string;
  lastSeenSeq: number;
  brain: BrainEntry[];
  brainSeq: number;
  messages?: any[];
  historyModel?: string;
  usage?: AgentUsage;
}

const emptyUsage = (): AgentUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 });

export const SUPERSEDED_STATE = "(superseded — a newer look at the same thing appears below; read that one)";

/** One permanent, as short as it can be said. */
function permanentLine(c: Card): string {
  const bits = [c.name];
  const pt = effectivePT(c);
  if (pt) bits.push(pt);
  if (c.tapped) bits.push("(T)");
  if (c.faceDown) bits.push("(face-down)");
  if (c.attacking) bits.push("(attacking)");
  if (c.blocking) bits.push("(blocking)");
  // +1/+1 and -1/-1 are already inside the P/T; loyalty and charge are not
  const other = Object.entries(c.counters ?? {}).filter(([k, v]) => k !== "+1/+1" && k !== "-1/-1" && v);
  if (other.length) bits.push(`{${other.map(([k, v]) => `${k}×${v}`).join(" ")}}`);
  return bits.join(" ");
}

/** The table as it stands, in a few hundred characters, on EVERY wake.
 *
 *  The agent reads the board with get_state and then plays for a long time off
 *  its own prose about what it read. In one measured game it called get_state
 *  at conversation messages 1, 15, 73 and then not again until 266 — the whole
 *  midgame decided from memory, with its own stale sentences sitting closer in
 *  context than the snapshot. This puts the current board at the top of every
 *  window instead, where nothing older can outrank it.
 *
 *  Deliberately not a substitute for get_state: no card text, no ids, no zones
 *  beyond counts. It is the thing you glance up at, not the thing you study. */
function boardDigest(): string {
  const side = (p: PlayerId) => {
    const bf = game.players[p].zones.battlefield.map((id) => game.cards[id]).filter(Boolean) as Card[];
    return bf.length ? bf.map(permanentLine).join(" · ") : "(empty)";
  };
  const n = (p: PlayerId, z: "hand" | "library" | "graveyard" | "exile" | "command") => game.players[p].zones[z].length;
  const counts = (["hand", "library", "graveyard", "exile", "command"] as const)
    .map((z) => `${z} ${n("agent", z)}/${n("you", z)}`)
    .join(" · ");
  return (
    `\nBOARD NOW (the table as it stands — this outranks anything about the board earlier in this conversation):\n` +
    `  YOURS: ${side("agent")}\n` +
    `  PLAYER'S: ${side("you")}\n` +
    `  yours/Player's — life ${game.players.agent.life}/${game.players.you.life} · ${counts}\n`
  );
}

/** How much dead board has to pile up before it is worth rewriting history.
 *
 *  Rewriting drops everything after the edit out of the provider's prefix
 *  cache, and a re-read is billed at roughly 31x a cached token. Collapsing one
 *  stale snapshot at a time pays that toll once per snapshot; waiting for a few
 *  pays it once for all of them, because the edit lands at the oldest either
 *  way. Simulated over this project's own saved game, collapsing on sight was
 *  worth about 5c and waiting about 7c, so the gap is small and the curve is
 *  flat — 80k characters is roughly four board snapshots, chosen from that
 *  flat region rather than from a sharp optimum. */
export const COLLAPSE_THRESHOLD_CHARS = 80_000;

/** Room to finish a thought. This was 8192, and a real turn died on it: the
 *  agent was six sentences into working out whether a 50/50 Thromok survives
 *  the crack-back, hit the cap before it emitted a single tool call, and the
 *  window closed having done nothing — a full call paid for, a turn lost, and
 *  8k of truncated reasoning left in the history.
 *
 *  It was never near a real ceiling: DeepSeek's V4 models take up to 384k
 *  output. A cap still earns its place as a runaway backstop, so this is
 *  generous rather than maximal — deliberation is billed at the output rate,
 *  the priciest of the three. */
export const MAX_OUTPUT_TOKENS = 32768;

/** Every call resends the whole conversation, so an old get_state is a board
 *  the game has already moved past that we pay for on every future call. Only
 *  the newest one describes anything real; the wake prompt narrates each change
 *  since. Collapse the rest.
 *
 *  Rewrites in place, newest-but-one first, and leaves an already-collapsed
 *  result alone. Prefix caches key on the unchanged head of the conversation,
 *  so touching only the snapshot that just went stale keeps the invalidation
 *  point near the tail — a short re-read instead of the whole game. */
/** How many windows keep their reasoning.
 *
 *  Two was the minimum that works: the current window needs its reasoning to
 *  finish the thought, and the one before it holds the plan that thought just
 *  produced. Four because the margin turned out to be nearly free — with the
 *  trim running, thinking is about 1.2k of a 49k conversation, so two more
 *  windows cost roughly a thousand tokens. The thing being protected is a plan
 *  the agent has formed and not yet said out loud ("hold this for lethal"),
 *  which lives in the thinking blocks and nowhere else, and is worth more than
 *  a thousand tokens. */
export const KEEP_THINKING_WINDOWS = 4;

/** How big the conversation has to get before any thinking is dropped.
 *
 *  The trim used to run on every wake, and that was the single most expensive
 *  thing the agent did. Rewriting a message four windows back drops the
 *  provider's prefix cache from the edit to the end, and the tail is re-read at
 *  the miss rate — about 30x a cached token on DeepSeek.
 *
 *  Replayed against the live API over this project's own saved 157-call game
 *  (tools/token-cost.ts), on deepseek-v4-pro at peak rates:
 *
 *    trim every wake (what shipped)   813k missed   $1.40
 *    trim never                       279k missed   $0.77
 *
 *  45% of the bill, and what it bought was 19k tokens of headroom — the
 *  history ended at 90k tokens instead of 109k, in a window that accepted a
 *  136k-token prompt without complaint. Nobody needed that room.
 *
 *  So the trim is demand-driven now: while the conversation fits, nothing is
 *  rewritten and the cache holds the whole game. 340k characters is about 100k
 *  tokens at the 3.42 chars/token this history measures, which leaves the 32k
 *  output cap its room inside a context known to hold at least 137k. A game
 *  long enough to cross it starts paying the toll then, which is the point at
 *  which the room is worth more than the money. */
export const TRIM_ABOVE_CHARS = 340_000;

export const DROPPED_THINKING = "(thought this through in an earlier window; the board has moved on since)";

/** A window opens with a wake prompt — the only user message that is prose
 *  rather than tool results. */
const isWakePrompt = (m: any) => m?.role === "user" && Array.isArray(m.content) && m.content[0]?.type === "text";

/** Deliberation about a board the game has moved past, dropped once the window
 *  it belongs to is two windows old.
 *
 *  It is graded rather than total because the agent's plan is not always
 *  written down: "hold Fling for lethal" can live in a thinking block and
 *  nowhere else until the turn it pays off. What it SAID and what it DID
 *  always survive — only the private reasoning goes, and only once it is stale.
 *  The match history survives too, in the log every get_state carries and in
 *  the events every wake prompt opens with.
 *
 *  Like the snapshot collapse, this settles: after the first pass only the
 *  window that just aged out still has thinking to remove, so the edit stays
 *  near the tail and the prefix cache keeps most of its head.
 *
 *  "Most of its head" was still the wrong trade to make every wake — see
 *  TRIM_ABOVE_CHARS for what it measured. Nothing happens until the
 *  conversation is big enough to need the room. */
export function trimOldThinking(messages: any[], keepWindows = KEEP_THINKING_WINDOWS, above = TRIM_ABOVE_CHARS) {
  if (above > 0) {
    let size = 0;
    for (const m of messages) size += JSON.stringify(m).length;
    if (size < above) return;
  }
  const starts: number[] = [];
  messages.forEach((m, i) => isWakePrompt(m) && starts.push(i));
  if (starts.length <= keepWindows) return;
  const cutoff = starts[starts.length - keepWindows];
  for (let i = 0; i < cutoff; i++) {
    const m = messages[i];
    if (m?.role !== "assistant" || !Array.isArray(m.content)) continue;
    const kept = m.content.filter((b: any) => b?.type !== "thinking" && b?.type !== "redacted_thinking");
    if (kept.length === m.content.length) continue;
    // A message stripped to nothing cannot be sent, and dropping it would leave
    // two user turns back to back. It gets a marker instead — and it is worth
    // the trouble, because a thinking-only message is usually a thought that
    // hit max_tokens before it could act: the biggest and least useful block
    // in the conversation.
    messages[i] = { ...m, content: kept.length ? kept : [{ type: "text", text: DROPPED_THINKING }] };
  }
}

/** What a snapshot is a snapshot OF, or null if the tool is not one.
 *
 *  get_state is the whole board, so there is only ever one current answer. A
 *  zone listing is only current for the zone it read: a graveyard search says
 *  nothing about what is left in the library, so those supersede separately. */
function snapshotKey(name: string, input: any): string | null {
  if (TOOLS[name]?.special === "state") return "state";
  if (name === "view_zone") return `zone:${input?.player ?? "?"}:${input?.zone ?? "?"}`;
  return null;
}

export function collapseSupersededState(messages: any[], threshold = COLLAPSE_THRESHOLD_CHARS) {
  const keyOf = new Map<string, string>();
  for (const m of messages) {
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b?.type !== "tool_use") continue;
      const key = snapshotKey(b.name, b.input);
      if (key) keyOf.set(b.id, key);
    }
  }
  // find every stale snapshot before rewriting any of them: whether the rewrite
  // is worth its cache invalidation is a question about all of them together
  const stale: { content: any[]; j: number }[] = [];
  const seen = new Set<string>();
  for (let i = messages.length - 1; i >= 0; i--) {
    const content = messages[i]?.content;
    if (!Array.isArray(content)) continue;
    for (let j = content.length - 1; j >= 0; j--) {
      const b = content[j];
      const key = b?.type === "tool_result" ? keyOf.get(b.tool_use_id) : undefined;
      if (!key) continue;
      // a failed snapshot is small and says why — collapsing it would replace
      // an error the model still has to reckon with by a pointer to a board
      if (b.is_error) continue;
      if (!seen.has(key)) seen.add(key);
      else if (b.content !== SUPERSEDED_STATE) stale.push({ content, j });
    }
  }
  const dead = stale.reduce((n, s) => n + String(s.content[s.j].content ?? "").length, 0);
  if (dead < threshold) return;
  for (const { content, j } of stale) content[j] = { ...content[j], content: SUPERSEDED_STATE };
}

export class AgentRunner {
  sessionId: string | null = null; // cli transport conversation
  promptArgs: PromptArgs | null = null;
  /** only for games saved before the prompt became rebuildable */
  legacyPrompt = "";
  /** Built fresh every time it is read, so changes to the rules reach the
   *  agent on its next turn rather than its next game. Deterministic, so the
   *  1h prompt cache still hits until the code itself changes. */
  get systemPrompt(): string {
    const a = this.promptArgs;
    return a ? buildSystemPrompt(a.agentDeck, a.decklist, a.userDeck) : this.legacyPrompt;
  }
  model = DEFAULT_MODEL;
  // set by the server at boot — the agent's tools MUST talk to the instance
  // that spawned it (a hardcoded url once let a sandbox agent act on the
  // live table)
  tableUrl = "http://localhost:4780";
  /** per-provider base-url overrides; the tests point these at local fakes */
  baseUrls: Partial<Record<ProviderId, string>> = {};
  busy = false;
  pendingWake = false;
  pendingReason: "window" | null = null;
  lastSeenSeq = 0;
  brain: BrainEntry[] = [];
  messages: any[] = []; // api transport conversation
  historyModel = ""; // resolved model id the api history was produced by
  usage: AgentUsage = emptyUsage();
  private brainSeq = 0;
  private listeners: BrainListener[] = [];
  private inflight: AbortController | null = null;
  private proc: Bun.Subprocess | null = null;

  onBrain(fn: BrainListener) {
    this.listeners.push(fn);
  }

  push(kind: BrainEntry["kind"], text: string) {
    const e: BrainEntry = { seq: ++this.brainSeq, ts: Date.now(), kind, text };
    this.brain.push(e);
    for (const fn of this.listeners) fn(e);
  }

  serialize(): AgentSnapshot {
    return {
      sessionId: this.sessionId,
      promptArgs: this.promptArgs,
      model: this.model,
      lastSeenSeq: this.lastSeenSeq,
      brain: this.brain,
      brainSeq: this.brainSeq,
      messages: this.messages,
      historyModel: this.historyModel,
      usage: this.usage,
    };
  }

  restore(snap: AgentSnapshot) {
    this.sessionId = snap.sessionId ?? null;
    this.promptArgs = snap.promptArgs ?? null;
    this.legacyPrompt = snap.systemPrompt ?? "";
    this.model = snap.model ?? DEFAULT_MODEL;
    this.lastSeenSeq = snap.lastSeenSeq ?? 0;
    this.brain = snap.brain ?? [];
    this.brainSeq = snap.brainSeq ?? (this.brain.at(-1)?.seq ?? 0);
    this.messages = snap.messages ?? [];
    // games saved before this collapsed on write carry every stale snapshot
    collapseSupersededState(this.messages);
    this.historyModel = snap.historyModel ?? "";
    this.usage = snap.usage ?? emptyUsage();
  }

  reset(promptArgs: PromptArgs) {
    this.kill();
    this.sessionId = null;
    this.promptArgs = promptArgs;
    this.legacyPrompt = "";
    this.lastSeenSeq = 0;
    this.brain = [];
    this.brainSeq = 0;
    this.messages = [];
    this.historyModel = "";
    this.usage = emptyUsage();
    this.pendingWake = false;
  }

  kill() {
    if (this.inflight) {
      this.expectAbort = true;
      this.inflight.abort();
      this.inflight = null;
    }
    if (this.proc) {
      this.expectExit = true;
      try {
        this.proc.kill();
      } catch {}
      this.proc = null;
    }
    this.busy = false;
  }

  /** Events since the agent last saw the table, as the agent may see them. */
  newEvents(): ReturnType<typeof renderLogFor>[] {
    return transcript()
      .filter((e) => e.seq > this.lastSeenSeq)
      .map((e) => renderLogFor(e, "agent"));
  }

  /** Events since the agent last saw the table, rendered from its viewpoint. */
  newEventsText(): string {
    return this.newEvents().map((e) => `[${e.seq}] ${e.text}`).join("\n");
  }

  composeWakePrompt(reason: "window" | "react" = "window"): string {
    const entries = this.newEvents();
    const events = entries.map((e) => `[${e.seq}] ${e.text}`).join("\n");
    this.lastSeenSeq = game.seq;
    const header = this.messages.length || this.sessionId
      ? "New events at the table since your last window:"
      : "The game has started. Events so far:";
    const stackText = game.stack.length
      ? `\nTHE STACK (bottom → top): ${game.stack.map((i) => `[${i.player}] ${i.text}`).join(" · ")}\n`
      : "";
    // regardless of wake reason: Player's items on the stack are the agent's to
    // acknowledge — without this, window wakes routinely leave them sitting
    const playerItems = game.stack.filter((i) => i.player === "you").length;
    const stackDuty = playerItems
      ? `\n⚠ ${playerItems} of the stack item(s) are PLAYER'S — deal with them FIRST (see PLAYER'S ITEMS ON THE STACK).\n`
      : "";
    // Refereeing a payment takes two facts, and the window used to carry
    // neither. It named the spell ("Buster Sword") and drew the lands with (T)
    // beside them, and left the price to a model that had never seen the card
    // and the counting to a digest whose whole job is to be glanced at. Live
    // game, round 2: two basic Forests tapped, a {3} artifact cast off them,
    // resolved without a word. The check can only happen in THIS window —
    // the untap step wipes the evidence, and after resolution taking it back
    // is an argument instead of a question.
    //
    // Facts, not a verdict. The table still enforces nothing: a rock, a
    // ritual, a land that taps for two, an alternative cost or a cost
    // reduction are all reasons the sum can look short and the play be legal,
    // and the seat holding the cards knows which. Handing over the price and
    // the sideways permanents is the most the table can say without reading
    // a card and deciding what it does.
    //
    // ...and the same window is the one the agent has to work out what the
    // card DOES in, which it was left to do from memory. Live game, round 5,
    // asked to resolve Archdruid's Charm: "Its modes: - Search your library …
    // (or put creature onto battlefield? Let me recall.) - Create a 3/3 green
    // Beast token? No. - Put a +1/+1 counter…? Hmm. … Wait, let me get the
    // exact text." A whole thinking block spent reconstructing a card whose
    // oracle was sitting on the server, before it thought to call get_state.
    //
    // The table already refuses to let the agent cast a card whose text it has
    // never been shown (READ FIRST, in cast) — so it guaranteed the agent had
    // read its OWN cards and guaranteed nothing about the one it is being
    // asked to adjudicate. This is that guarantee, from the other side.
    const theirs = game.stack
      .filter((i) => i.player === "you" && i.cardId)
      .map((i) => game.cards[i.cardId!])
      // a face-down item is text the agent has not been shown, and printing it
      // here would leak exactly what turning it over hid
      .filter((c): c is Card => !!c && cardVisibleTo(c, "agent"));
    const theirTapped = game.players.you.zones.battlefield
      .map((id) => game.cards[id])
      .filter((c): c is Card => !!c?.tapped);
    /** Long enough for a charm's three modes; read_card is there for the rest. */
    const oracleFor = (c: Card) => {
      const text = (c.oracle ?? "").trim();
      if (!text) return "";
      const clipped = text.length > 700 ? `${text.slice(0, 700)}… (read_card for the rest)` : text;
      return clipped.split("\n").map((l) => `\n      ${l}`).join("");
    };
    const paymentCheck = theirs.length
      ? `\n⚠ PLAYER'S ITEM(S) ARE YOURS TO ADJUDICATE — the text and the price, so neither is yours to remember:\n` +
        theirs.map((c) => `  · ${c.name}${c.mana ? ` costs ${c.mana}` : ""}${oracleFor(c)}`).join("\n") +
        `\n  PAYMENT CHECK — price that against what Player turned sideways BEFORE you resolve.` +
        // an attacker is turned sideways by attacking, not for mana, and in a
        // combat trick it would otherwise pad the count with creatures that
        // paid for nothing. Marked rather than dropped: which permanents make
        // mana is a card reading, and the table does not do those.
        `\n  Player's tapped permanents (${theirTapped.length}): ${theirTapped.length ? theirTapped.map((c) => `${c.name}${c.attacking ? " (attacking)" : ""}`).join(", ") : "none"}\n` +
        `  Do the sum yourself and say it. Not every tapped permanent is mana and one can make more than one, so short does not prove illegal — but if it does not obviously cover the cost, ASK in chat before resolving.\n`
      : "";
    // Every card the events just NAMED, whose text the agent has not been shown
    // this game — delivered once, here, and marked seen.
    //
    // This is the general form of the stack block above, and the reason naming
    // a card in the log registers it (see named() in game.ts). A name on its
    // own is not knowing: the agent reconstructed Archdruid's Charm's three
    // modes from memory rather than look. The table already refuses to let it
    // cast a card whose text never reached it — READ FIRST — so this is that
    // same guarantee pointed at the cards the OTHER seat plays.
    //
    // Once, not every window: agentSeen is the same ledger READ FIRST keeps, so
    // a card delivered here never arrives twice, and the ones on the stack are
    // skipped because the block above prints them in full for as long as they
    // sit there.
    const onStack = new Set(theirs.map((c) => c.id));
    const fresh = [...new Set(entries.flatMap((e) => e.cards ?? []))]
      .filter((id) => !onStack.has(id) && !(game.agentSeen ?? {})[id])
      .map((id) => game.cards[id])
      .filter((c): c is Card => !!c?.oracle);
    markSeenByAgent(fresh.map((c) => c.id));
    const cardText = fresh.length
      ? `\nCARDS NAMED ABOVE (their full text, so you never have to remember one):\n` +
        fresh.map((c) => `  · ${c.name}${c.mana ? ` — ${c.mana}` : ""}${oracleFor(c)}`).join("\n") +
        "\n"
      : "";
    // Combat has an order, and game.combat is where it currently is. This used
    // to be read back out of the log — which line came last — and the reading
    // fired the damage prompt while the blockers step was still open, telling
    // the agent to use a tool that would refuse it and leaving it to argue with
    // the refusal. Each step names the move that is actually available in it.
    //
    // Damage is still the step that gets dropped, and it is the agent's to
    // announce in EVERY combat — including the ones Player attacks in, which is
    // the reading rule 6 used to leave open. So it is said in every window
    // until it lands. Already on the stack is not owed: re-announcing an
    // unresolved damage item deals it twice.
    //
    // A declaration is owed until the OPPONENT resolves it, and blocks are the
    // same as damage that way: the step stays open while the item sits there.
    // Nagging for blocks already on the stack asks for a SECOND declaration —
    // and a second one is what holds the damage step shut, since resolving
    // either leaves the other still owed (resolveStackItem's stillOwed).
    //
    // And a declaration of PLAYER'S that they have not finished is not an item
    // at all yet, however much it looks like one. Blocks stopped waking the
    // agent when they became Player's to finish (see REACTIVE in wake.ts), but
    // a countdown armed by something EARLIER still fires — the defender
    // resolving the ATTACKS item is a stack_resolve, which is reactive — and
    // the agent woke seconds later and locked in a blocks declaration with one
    // creature in it while Player was still hovering the second (live, round
    // 10). The gate is conduct rather than a refusal, exactly as it is for
    // attacks, so the wake has to say which state the table is in.
    const declaring = game.stack.find(
      (i) => i.player === "you" && (i.apply?.type === "block" || i.apply?.type === "attack") && !i.finished
    );
    const damageAnnounced = game.stack.some((i) => i.apply?.type === "damage" && i.apply.combatDamage);
    const blocksDeclared = game.stack.some((i) => i.apply?.type === "block" && i.player === "agent");
    const combatDuty = declaring
      ? `\n⚠ PLAYER IS STILL DECLARING — their ${declaring.apply?.type === "block" ? "BLOCKS" : "ATTACKS"} item on the stack is NOT FINISHED and they are still adding to it. Do NOT resolve it. Respond on top at instant speed if you want to, or wait — however many windows that takes; it becomes yours to resolve only once the log says they have finished declaring.\n`
      : game.combat === "blockers" && blocksDeclared
        ? `\nYour blocks declaration is on the stack — waiting for Player to lock it in. Nothing more is owed in this step; do not declare blocks again.\n`
        : game.combat === "blockers"
          ? game.turn === "agent"
            ? `\n⚠ THE BLOCKERS STEP IS OPEN and the declaration is PLAYER'S to make — you are the attacker. Wait for it, or ask; lock it in with stack_resolve when it arrives. Damage cannot be announced before that.\n`
            : `\n⚠ BLOCKS ARE OWED AND THEY ARE YOURS — Player's attackers are locked in and you are the defender. Declare them with the block tool; blocking nothing is still an answer, declared as block with pairs: []. Damage cannot be announced until that declaration is locked in.\n`
          : game.combat === "damage" && !damageAnnounced
            ? `\n⚠ COMBAT DAMAGE IS OWED, and announcing it is YOURS whoever attacked (rule 6a) — blocks are locked in and nothing has applied damage since. Use the damage tool.\n`
            : "";
    // turn-based trigger hints: "At the beginning of…" lines on the agent's
    // own battlefield, surfaced at the top of its turn (text-grep, not rulings)
    const turnTriggers =
      reason === "window" && game.turn === "agent"
        ? game.players.agent.zones.battlefield
            .map((id) => game.cards[id])
            .filter(Boolean)
            .flatMap((c) => triggerLines(c!).filter((l) => /at the beginning of/i.test(l)).map((l) => `${c!.name}: ${l.slice(0, 100)}`))
            .slice(0, 8)
        : [];
    const turnTrigText = turnTriggers.length
      ? `\n⚠ TURN-BASED TRIGGERS on your battlefield (from card text — check which apply this turn):\n${turnTriggers.map((l) => `  · ${l}`).join("\n")}\n`
      : "";
    const situation =
      `It is ${game.turn === "agent" ? "YOUR turn" : "Player's turn"} ` +
      `(round ${game.turnNumber}, phase: ${game.phase}).`;
    // Which window this is, and nothing more. The instructions for each kind
    // are in the system prompt (TWO KINDS OF WINDOW): spelled out here they
    // were 430 characters repeated into all 74 windows of a measured game, and
    // half of what they said already appeared in the system prompt anyway. The
    // system prompt is the head of the prefix and the most cacheable thing in
    // the request; a wake message is body, and body is where a rewrite lands.
    const directive = reason === "react" ? `This is a REACTION WINDOW.` : `This is YOUR WINDOW to act.`;
    const interrupted = this.interruptNote
      ? `(Your previous window was INTERRUPTED mid-thought because the table changed. Any actions you completed before the cut are already applied — re-check the state rather than assuming your plan finished.)\n`
      : "";
    this.interruptNote = false;
    // The game opens on PLAYER's turn, so without this the agent's first
    // window reads as an ordinary reaction window — it checks for instant-speed
    // responses, finds none, and passes, having never decided whether to keep
    // its hand. It kept a seven-card hand with no lands in it that way and
    // only said so three turns later. The first window of a game IS the
    // mulligan decision, and nothing else was ever going to ask.
    const opening = !this.messages.length && !this.sessionId
      ? `\n⚠ THIS IS YOUR OPENING HAND — decide KEEP or MULLIGAN before anything else. ` +
        `Look at it first (get_state shows your hand). No lands, or one land with nothing castable off it, is a mulligan. ` +
        `FRIENDLY MULLIGANS: the mulligan tool shuffles back and deals a fresh SEVEN, as many times as you like — you never bottom a card, so mulligan a hand that cannot function. ` +
        `Finish with a say that gives the DECISION ONLY — "keeping" or "mulliganing" — and that you are ready to play, so Player knows the game can start. ` +
        `Do not name a single card in it, or count its lands, or describe what it does: that hand stays hidden all game and saying it once gives Player your whole plan (see rule 9b). ` +
        `Do not close this window without making that call — there is no later window that asks.\n`
      : "";
    // the narration and say-vs-text rules used to close every wake; they are
    // points 2 and 9 of the system prompt and did not need saying twice
    return `${interrupted}${header}\n${events || "(nothing new)"}\n${stackText}${stackDuty}${paymentCheck}${cardText}${combatDuty}${boardDigest()}${turnTrigText}${opening}\n${situation} ${directive}`;
  }

  private preempted = false;
  private interruptNote = false;
  private expectAbort = false;
  private expectExit = false;
  private interruptWatchdog: ReturnType<typeof setTimeout> | null = null;
  private stderrTail = "";

  async wake(reason: "window" | "react" = "window") {
    if (this.busy) {
      // PREEMPT: new information arrived mid-thought — cut the in-flight turn
      // and rewake with the full picture. Completed actions and the
      // transcript stay; only the unfinished thought dies.
      this.pendingWake = true;
      if (reason === "window") this.pendingReason = "window";
      this.preempted = true;
      this.interruptNote = true;
      this.push("status", "⟳ Interrupted — restarting with the new information…");
      if (this.inflight) {
        this.expectAbort = true;
        this.inflight.abort();
      }
      if (this.proc) {
        try {
          this.write({ type: "control_request", request_id: "int-" + Date.now(), request: { subtype: "interrupt" } });
          if (!this.interruptWatchdog) {
            this.interruptWatchdog = setTimeout(() => {
              this.interruptWatchdog = null;
              if (this.busy && this.preempted) {
                this.expectExit = true;
                try {
                  this.proc?.kill();
                } catch {}
              }
            }, 15000);
          }
        } catch {
          this.expectExit = true;
          try {
            this.proc?.kill();
          } catch {}
        }
      }
      return;
    }
    const transport = transportChoice(this.model);
    if (transport === "none") {
      this.push("error", this.noBrainMessage());
      return;
    }
    const custom = transport === "custom" ? loadProvider() : null;
    const endpoint: Endpoint | null =
      transport === "custom" && custom
        ? { baseUrl: custom.baseUrl, apiKey: custom.apiKey, model: custom.model, anthropic: custom.baseUrl.startsWith("https://api.anthropic.com") }
        : transport === "api"
          ? this.endpoint()
          : null;
    if (transport === "api" && !endpoint) {
      this.push("error", this.noBrainMessage());
      return;
    }
    this.busy = true;
    this.pendingWake = false;
    reason = this.pendingReason ?? reason;
    this.pendingReason = null;
    if (endpoint) {
      // thinking-block signatures are model-specific: a mid-game model switch
      // must strip them from the replayed history or the API rejects it
      if (this.historyModel && this.historyModel !== endpoint.model) {
        this.messages = this.messages
          .map((m) => (Array.isArray(m.content) ? { ...m, content: m.content.filter((b: any) => b.type !== "thinking" && b.type !== "redacted_thinking") } : m))
          .filter((m) => !Array.isArray(m.content) || m.content.length > 0);
      }
      this.historyModel = endpoint.model;
    }
    const prompt = this.composeWakePrompt(reason);
    this.push("status", this.messages.length || this.sessionId ? "Agent waking up (new events)…" : "Agent sitting down at the table…");
    if (endpoint) {
      this.messages.push({ role: "user", content: [{ type: "text", text: prompt }] });
      // the window that just closed is now one back; whatever was two back has
      // nothing left to reason about
      trimOldThinking(this.messages);
      try {
        await this.runApiTurn(endpoint);
      } catch (e: any) {
        this.push("error", `agent transport failed: ${e.message}`);
      }
      this.endTurn();
    } else {
      try {
        this.ensureProc();
        this.write({ type: "user", message: { role: "user", content: [{ type: "text", text: prompt }] } });
      } catch (e: any) {
        this.push("error", `agent transport failed: ${e.message}`);
        this.busy = false;
      }
    }
  }

  // ───────────────────────── api transport ─────────────────────────

  /** The catalog entry for the game's model, resolved to a call. Null when
   *  that provider has no key — the caller says so rather than posting to a
   *  stranger with someone else's credentials. */
  private endpoint(): Endpoint | null {
    const spec = modelSpec(this.model);
    const key = loadKey(spec.provider);
    if (!key) return null;
    const provider = PROVIDERS[spec.provider];
    return {
      baseUrl: this.baseUrls[spec.provider] ?? provider.baseUrl(),
      apiKey: key,
      model: spec.wire,
      anthropic: provider.anthropic,
    };
  }

  private noBrainMessage(): string {
    const { provider } = modelSpec(this.model);
    return provider === "anthropic"
      ? "The agent has no brain yet — Claude plays on your Claude Code subscription, so set that up in the Chat tab (or pick another brain in New game)."
      : `The agent has no brain yet — paste a ${PROVIDERS[provider].name} API key in the Chat tab.`;
  }

  /** The tool loop: call the model, apply its tool calls, repeat to end_turn. */
  private async runApiTurn(endpoint: Endpoint) {
    for (let i = 0; i < MAX_LOOP; i++) {
      const res = await this.callModel(endpoint);
      if (res === "aborted") return;
      if (res === null) return; // hard error, already pushed
      this.usage.calls++;
      const u = res.usage ?? {};
      const call: CallUsage = [
        u.input_tokens ?? 0,
        u.cache_read_input_tokens ?? 0,
        u.cache_creation_input_tokens ?? 0,
        u.output_tokens ?? 0,
      ];
      this.usage.input += call[0];
      this.usage.cacheRead += call[1];
      this.usage.cacheWrite += call[2];
      this.usage.output += call[3];
      (this.usage.perCall ??= []).push(call);
      if (this.usage.perCall.length > USAGE_LOG_LIMIT) this.usage.perCall.splice(0, this.usage.perCall.length - USAGE_LOG_LIMIT);

      const content = res.content ?? [];
      // the full content array (thinking blocks included, signatures intact)
      // must be replayed as the assistant message for the loop to continue
      this.messages.push({ role: "assistant", content });

      const toolUses: any[] = [];
      for (const block of content) {
        if (block.type === "thinking" && block.thinking) this.push("thinking", block.thinking);
        if (block.type === "text" && block.text?.trim()) this.push("text", block.text);
        if (block.type === "tool_use") {
          toolUses.push(block);
          this.push("tool", `${block.name} ${JSON.stringify(block.input ?? {})}`);
        }
      }

      if (res.stop_reason !== "tool_use" || toolUses.length === 0) {
        if (res.stop_reason === "max_tokens") this.push("error", "agent hit the response length limit mid-thought — waking again may help");
        return;
      }

      const results: any[] = [];
      for (const t of toolUses) {
        let text: string;
        let isError = false;
        try {
          text = await callTable(t.name, t.input ?? {}, this.tableUrl);
          try {
            const parsed = JSON.parse(text);
            isError = parsed?.ok === false || !!parsed?.error;
          } catch {}
        } catch (e: any) {
          text = `table server error: ${e.message}`;
          isError = true;
        }
        results.push({ type: "tool_result", tool_use_id: t.id, content: text, ...(isError ? { is_error: true } : {}) });
      }
      this.messages.push({ role: "user", content: results });
      collapseSupersededState(this.messages);
      // done/ask_user END the window — in the CLI transport the result event
      // closes it, but here they are ordinary tool calls, and without this a
      // model happily keeps acting into windows it already passed
      if (toolUses.some((t) => t.name === "done" || t.name === "ask_user")) return;
      if (this.preempted) return; // interrupted between iterations
    }
    this.push("error", `agent tool loop hit the ${MAX_LOOP}-iteration backstop — window closed`);
  }

  /** One Messages API call. Returns the response, "aborted", or null on error. */
  private async callModel(endpoint: Endpoint): Promise<any> {
    // cache breakpoints ride on the wire only, never into stored history:
    // system prompt + the newest turn, both 1h TTL (a human turn between
    // wakes routinely outlives the default 5m window). Anthropic-only —
    // other Messages-compatible servers cache their own way (or ignore it),
    // and the strictest ones reject unknown fields.
    const cc = endpoint.anthropic ? { cache_control: { type: "ephemeral", ttl: "1h" } } : {};
    const wire = !endpoint.anthropic
      ? this.messages
      : this.messages.map((m, i) => {
          if (i !== this.messages.length - 1 || !Array.isArray(m.content) || m.content.length === 0) return m;
          const content = m.content.map((b: any, j: number) => (j === m.content.length - 1 ? { ...b, ...cc } : b));
          return { ...m, content };
        });
    const body = {
      model: endpoint.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: [{ type: "text", text: this.systemPrompt, ...cc }],
      tools: Object.entries(TOOLS).map(([name, def]) => ({ name, description: def.description, input_schema: def.schema })),
      messages: wire,
    };
    const headers: Record<string, string> = {
      "x-api-key": endpoint.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    };
    if (endpoint.anthropic) headers["anthropic-beta"] = "extended-cache-ttl-2025-04-11";
    const who = endpoint.anthropic ? "Anthropic" : new URL(endpoint.baseUrl).hostname;
    const payload = JSON.stringify(body);
    const ctl = new AbortController();
    this.inflight = ctl;
    this.expectAbort = false;
    try {
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${endpoint.baseUrl}/v1/messages`, {
          method: "POST",
          headers,
          body: payload,
          signal: ctl.signal,
        });
        if (res.ok) return await res.json();
        const errText = (await res.text()).slice(0, 600);
        if (res.status === 401 || res.status === 403) {
          this.push("error", `${who} rejected the API key — check the agent setup and try a fresh key.`);
          return null;
        }
        if ((res.status === 429 || res.status === 529 || res.status >= 500) && attempt < 3) {
          const delay = [2000, 5000, 12000][attempt];
          this.push("status", `${who} returned ${res.status} — retrying in ${delay / 1000}s…`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        this.push("error", `${who} API error ${res.status}: ${errText}`);
        return null;
      }
    } catch (e: any) {
      if (e.name === "AbortError" || this.expectAbort) {
        this.usage.aborted = (this.usage.aborted ?? 0) + 1;
        this.usage.abortedInput = (this.usage.abortedInput ?? 0) + Math.round(payload.length / CHARS_PER_TOKEN);
        return "aborted";
      }
      throw e;
    } finally {
      if (this.inflight === ctl) this.inflight = null;
    }
  }

  // ───────────────────────── cli transport ─────────────────────────

  /** Spawn the persistent streaming child if it isn't running. */
  private ensureProc() {
    if (this.proc) return;
    const bin = resolveClaudeBin();
    if (!bin) throw new Error("claude binary not found");
    // per-instance MCP config so the tools hit THIS server, not a hardcoded port
    const port = new URL(this.tableUrl).port || "80";
    const mcpConfigPath = PROJECT_DIR + `mcp-${port}.json`;
    writeFileSync(
      mcpConfigPath,
      JSON.stringify({
        mcpServers: {
          table: { command: "bun", args: ["run", "server/mcp-tools.ts"], env: { TABLE_URL: this.tableUrl } },
        },
      })
    );
    const args = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--model", this.model,
      "--mcp-config", mcpConfigPath,
      // ONLY the table server: without this the CLI also loads every MCP
      // server configured on the machine, and the opponent sits down carrying
      // tools for GitHub, Linear and an iOS simulator farm. Measured at 3,226
      // tokens of schema in every call, for tools it can never use.
      "--strict-mcp-config",
      "--allowedTools", "mcp__table",
      "--append-system-prompt", this.systemPrompt,
    ];
    if (this.sessionId) args.push("--resume", this.sessionId);
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    delete env.ANTHROPIC_API_KEY; // the CLI runs on the login, never a key
    this.expectExit = false;
    this.stderrTail = "";
    this.proc = Bun.spawn([bin, ...args], {
      cwd: PROJECT_DIR,
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    this.readLoop(this.proc);
    this.drainStderr(this.proc);
  }

  private write(obj: any) {
    if (!this.proc) throw new Error("agent process not running");
    const sink = this.proc.stdin as any;
    sink.write(JSON.stringify(obj) + "\n");
    sink.flush();
  }

  /** Reads the child's event stream for its whole lifetime; handles death. */
  private async readLoop(proc: Bun.Subprocess) {
    try {
      let buf = "";
      // A Bun subprocess pipe IS async-iterable; the DOM's ReadableStream type
      // does not say so, and the DOM lib is in scope here because the tests
      // import both this file and the browser code. So the cast states the
      // thing that is true at runtime rather than the config bending around it.
      for await (const chunk of proc.stdout as unknown as AsyncIterable<Uint8Array>) {
        buf += new TextDecoder().decode(chunk);
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) this.handleLine(line);
        }
      }
    } catch {}
    const code = await proc.exited;
    if (this.proc !== proc) return; // superseded by kill()/reset()
    this.proc = null;
    if (!this.expectExit && code !== 0) {
      this.push("error", `agent process died (${code}): ${this.stderrTail.slice(-400)} — respawning on next wake`);
    }
    this.expectExit = false;
    if (this.busy) this.endTurn(); // died mid-turn: close out and maybe rewake
  }

  private async drainStderr(proc: Bun.Subprocess) {
    try {
      for await (const chunk of proc.stderr as unknown as AsyncIterable<Uint8Array>) {
        this.stderrTail = (this.stderrTail + new TextDecoder().decode(chunk)).slice(-2000);
      }
    } catch {}
  }

  private handleLine(line: string) {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.type === "system" && msg.subtype === "init") {
      this.sessionId = msg.session_id;
      return;
    }
    if (msg.type === "assistant") {
      for (const block of msg.message?.content ?? []) {
        if (block.type === "thinking" && block.thinking) this.push("thinking", block.thinking);
        if (block.type === "text" && block.text?.trim()) this.push("text", block.text);
        if (block.type === "tool_use") {
          const name = String(block.name).replace(/^mcp__table__/, "");
          this.push("tool", `${name} ${JSON.stringify(block.input ?? {})}`);
        }
      }
      return;
    }
    if (msg.type === "result") {
      // an interrupted turn reports error_during_execution — that's the
      // preempt working, not a failure
      if (msg.is_error && !this.preempted) this.push("error", `agent error: ${String(msg.result ?? msg.subtype).slice(0, 800)}`);
      if (msg.session_id) this.sessionId = msg.session_id;
      if (this.busy) this.endTurn();
    }
  }

  // ───────────────────────── shared ─────────────────────────

  /** A turn finished (end_turn/result event, interrupt, or death mid-turn). */
  private endTurn() {
    if (this.interruptWatchdog) {
      clearTimeout(this.interruptWatchdog);
      this.interruptWatchdog = null;
    }
    this.busy = false;
    this.push("status", "Agent window closed.");
    if (this.pendingWake) {
      // more happened while it was thinking — follow up once. A preempted
      // turn ALWAYS rewakes; an uninterrupted one skips the rewake if
      // everything was already delivered inline and nothing of Player's
      // awaits resolution.
      const undelivered = transcript().some((e) => e.seq > this.lastSeenSeq && e.actor === "you");
      const playersItemWaits = game.stack.length > 0 && game.stack[game.stack.length - 1].player === "you";
      if (this.preempted || undelivered || playersItemWaits) {
        setTimeout(() => this.wake(this.pendingReason ?? "react"), 500);
      } else {
        this.pendingWake = false;
      }
    }
    this.preempted = false;
  }
}

export const agent = new AgentRunner();
export function buildSystemPrompt(agentDeckName: string, decklist: string[], userDeckName: string): string {
  return `You are an expert Magic: The Gathering player piloting a Commander deck at a friendly but competitive table. You are playing against Player, a human. This is a 1v1 Commander game, both players start at 40 life.

YOUR DECK: "${agentDeckName}". Decklist:
${decklist.join(", ")}

PLAYER'S DECK: "${agentDeckName === userDeckName ? "the same deck" : userDeckName}" — you know the deck name but NOT its contents beyond what is revealed in play.

THE TABLE has no rules engine. You and Player enforce the rules yourselves, like a paper game. You interact through the "table" MCP tools (get_state, draw, move, tap, attack, life, place, say, done, and more). It is a physical surface, not a list: your cards have x/y coordinates on it and you arrange your own side. The server enforces hidden information: you can never see Player's hand or library except through game effects that reveal them (peek, view_zone when an effect allows it, revealed cards).

HOW TO PLAY YOUR WINDOW:
1. Call get_state to see the table when your window opens.
2. Narrate your reasoning as plain text BEFORE acting: what you observed, what your options are, why you chose your line. Player watches this narration live in a "brain" panel — it is your table talk to yourself, always visible. Be thorough but not padded.
3. Take your actions with tools, following the CASTING PROCEDURE below for every card. MOVE THE MARKER AS YOU GO: open every turn of yours with set_phase untap/upkeep (which untaps you), take your draw with the draw tool, then set_phase main 1 BEFORE you cast anything at sorcery speed; set_turn hands the turn over when you are finished. The phase you display IS part of the game state — casting a sorcery-speed spell while the marker still reads untap/upkeep shows Player a table that is not the one you are playing on.
4. Play honestly: respect mana costs, one land drop per turn, summoning sickness, casting your commander from the command zone with commander tax (+2 per prior cast). The tax is TRACKED on the table: every player in get_state carries commanderTax. Read it before you cast a commander and pay that much extra. The table charges the counter itself, for both seats, whenever a commander is cast out of the command zone — so never bump it yourself except to correct a miscount. If Player's looks wrong for the number of times they have cast, say so rather than silently assuming.
5. You share a physical table with Player, and you may arrange your side of it. Every battlefield card carries a pos on get_state — x 0 (left) to 1 (right), y 0 (your back edge) to 1 (Player's), midline 0.5 — and the place tool moves cards to the coordinates you choose. New cards put themselves down tidily, so use place when you want something somewhere particular: grouping a deck's pieces together, lining up attackers, putting an aura beside what it enchants. Batch several moves into one call. It is cosmetic — no priority, no undo step — so it costs Player nothing.
6. Combat runs through the stack like everything else, one acknowledged step at a time. When YOU attack: (a) attack tool → your declaration sits on the stack → done; Player resolves it (locks attacks, taps attackers) or responds on top. (b) Player declares blocks the same way → you resolve to lock them. (c) you announce damage. When PLAYER attacks the steps are the same with the seats swapped — they declare, you resolve to lock it in, you declare your blocks with block (declaring none is still a declaration) — and step (c) does NOT swap: you announce damage in that combat too.
6a. ANNOUNCING DAMAGE IS ALWAYS YOURS, in every combat, on either side of the table. Player never types a life total; you hold the tools and you do the arithmetic. Use the damage tool: one call carrying every arrow of damage (a blocked attacker and its blocker are two arrows, one each way) plus dies for the creatures it kills. It goes on the stack as one readable item, and resolving it takes the life off, books commander damage for a commander's hit, and puts the dead in the graveyard. Never change life for damage that was not acknowledged on the stack first.
6b. Resolving Player's item acknowledges it; it does not carry it out. The seat that ANNOUNCED an item applies its own effect — when you resolve their trigger, do not also set their counters, move their cards or change their life, or it lands twice. This has actually happened: a dethrone counter went on twice and a Phyrexian Reclamation cost was paid twice. If you think they have forgotten to apply something, say so with say or ask_user rather than doing it for them.
6c. When you HAVE already applied something on Player's behalf — their draw, their life loss, their tokens — report it in the PAST tense and mark it settled: "you lost 1 and drew 2 — already applied, nothing for you to do." Never narrate applied work as an instruction ("you lose 1 and draw 2"): Player reads that as their cue and does it a second time. This has actually happened — two cards and a life point of drift that took three messages to unpick.
7. You may interact with Player's cards and zones when a game effect allows it (e.g. your theft effects exiling from their library, tapping their creatures). Every such action is logged for them — never touch their cards without a game reason, and say which card/effect authorizes it.
8. If Player does something you don't understand, or state seems wrong, use ask_user to ask them — then call done and wait for their answer.
9. Use say for things you want to tell Player directly (announcements, responses, banter). Use ask_user for questions that block you.
9b. NEVER name a card Player cannot see in a say or an ask_user. Your hand, your library, your face-down cards — those are hidden from them exactly as theirs are from you, and one sentence naming them hands over the rest of the game. Say what you are DOING, never what you are HOLDING: "keeping this hand", not which seven; "I have an answer for that", not which answer. This applies to counts and hints too — "two removal spells and a finisher" is the same giveaway in fewer words. The only way a card of yours becomes public is a game effect that reveals it, and then you use the reveal tool, which shows it properly and logs it for both of you.
10. When a window involved several actions or resolutions, close it with ONE short say before done: a one-or-two-sentence recap of what just changed at the table (what resolved, what died, tokens made, life totals moved). Player should never have to reconstruct your turn from the log. Skip the recap for trivial windows — a lone resolve or a bare pass needs no commentary.
11. End EVERY window by calling done (passes back to Player) unless you asked a blocking question.

TWO KINDS OF WINDOW — every wake tells you which one you are in.

YOUR WINDOW is yours to act in. Call get_state first if you need to re-inspect anything. Settle the stack before anything else, then proceed. When you cast a spell, use cast — it goes on the stack — and then call done so Player can respond; NEVER resolve your own spell in the window you cast it. Finish with done, or ask_user if you need something from them, and batch done with your last action when you already know it is the last one.

A REACTION WINDOW means you hold priority in response to what Player just did. It is not your turn. If Player's item is on top of the stack, either respond at instant speed (cast/stack_push/stack_counter) or acknowledge it by calling stack_resolve yourself — that is the "no responses" signal. Resolve items one at a time, top first, and re-check get_state between resolutions if targets matter. Then call done. If there is nothing on the stack and nothing to react to, just call done — silence is fine.

PLAYER'S ITEMS ON THE STACK come before anything else you might do: respond on top (cast/stack_push/stack_counter), or CHECK each and then resolve it with stack_resolve, top first. Resolving is your assent that the item was legal — see LEGALITY IS ARGUED — not a formality. Never take other actions or call done while their items sit unresolved.

AN UNFINISHED DECLARATION IS THE ONE EXCEPTION TO THAT. A declaration of Player's — ATTACKS or BLOCKS — that they have not FINISHED is still being assembled: creatures go in one at a time, and until Player says they are done the item is a draft, not an offer. You can tell: the stack item carries no finished flag, and the log holds no "finishes declaring" line for it. NEVER resolve one. Respond on top at instant speed if you want to, or wait — however many windows that takes — and resolve it only after they have finished. Locking in a half-made declaration takes creatures out of a combat Player was still building.

CASTING PROCEDURE — run this checklist for EVERY card you play, no exceptions:
1. READ the card's full oracle text in get_state before playing it. Never play from memory of the name. The server enforces this: casting a card whose text was never delivered to you is rejected. Draw results include the full text of what you drew.
2. LIST its triggered abilities out loud in your narration: ETB, death, attack, devour, landfall, "whenever…". If it has none, say so.
3. Lands: cast tool, straight to the battlefield (CR 115.2a special action, no stack, no responses) — but its triggers (Bojuka Bog, landfall) still go on the stack via stack_push.
4. Spells: tap your mana (tap tool), then ONE stack_batch containing [the card, then each of its cast/ETB triggers as text items, bottom-first]. A no-trigger permanent is just a plain cast. The trigger rides in the SAME batch — a trigger you didn't put on the stack DID NOT HAPPEN, and "I'll apply it later" is not a thing at this table.
5. Call done ONCE. Player accepts the whole batch or responds inside it. NEVER stack_resolve your own items.
6. After resolution, apply exactly what the stack items said — counters, tokens, life — and nothing that wasn't announced.

THE STACK AND PRIORITY (Comprehensive Rules model):
- USES THE STACK: every spell, every activated ability, every triggered ability. DOES NOT: land plays, untapping, the draw for turn, shuffles, cleanup discards, mana abilities.
- ANNOUNCE ONLY A TRIGGER YOU CAN QUOTE: read the card's printed text again before you stack one, and name the line it comes from. Never infer a trigger from a card's name, its vibe, or what similar cards do — a generous invention corrupts the game exactly as much as a greedy one.
- P/T COUNTERS ARE ONE NET NUMBER, and -1/-1 counters are NEGATIVE. Before you call set_pt or counters, check the sign against the sentence you just announced — if you said -1/-1, the number goes DOWN.
- CHECK EVASION BEFORE YOU BLOCK: read the attacker's text against your blocker's — flying is blocked only by flying or reach, menace needs two or more blockers, and any "can't be blocked…" line is binding. Name the check you made whenever a block could look illegal. The table will not stop an illegal block, which makes not declaring it yours.
- Phase/step declarations (set_phase) apply immediately — no stack item, no waiting. The TURN PASS (set_turn) is the one turn-structure item that goes on the stack: responding to it is how end-of-turn effects happen, and the turn changes only when the opponent resolves it. Attack and block declarations still go on the stack as their own priority windows. The turn CANNOT pass while anything else is on the stack (the server enforces this).
- Resolution: permanents → battlefield, instants/sorceries → graveyard; pass to: for exceptions. stack_counter sends the top card to its owner's graveyard.
- LEGALITY IS ARGUED, NOT ENFORCED, AND REFEREEING PLAYER'S PLAYS IS HALF YOUR SEAT. Before you resolve ANY item of theirs, price the spell against what they turned sideways — the wake window hands you both, under PAYMENT CHECK — and check the timing: a sorcery-speed play needs their own main phase and an otherwise empty stack. Name the check you made whenever a play could look illegal, exactly as you do for blocks. Short mana is not proof (rocks, rituals, cost reductions), so ASK in chat rather than accuse — but ask BEFORE you resolve it, because the untap step wipes the evidence and a resolved item is an argument instead of a question. The table stops nothing, which makes catching it yours. Once you two agree an item was illegal, either side takes it back with stack_remove (card returns to its owner's hand).
- PROPOSED SEQUENCES (stack_batch): beyond single casts, you can propose a whole run — an event plus all its triggers, or planned follow-up casts marked retractable:true. Player accepts the lot or responds at a point inside it — your retractable items above that point are RETRACTED (MTR shortcut rules: they never happened, cards back to hand; what came before their response stays committed). Symmetrically: when Player proposes a sequence and you have NO responses, accept it with ONE stack_resolve_all. To respond inside their sequence, pass respondAt with the item id (cast/stack_push), or stack_counter with that item id.

UNDO: log lines starting with ↩ mean Player rewound the listed action. The event log you saw earlier may no longer match reality after an ↩ — call get_state and trust the current state, not your memory.

MANA SYMBOLS: write mana in Magic's own notation — {G}, {2}{U}{B}, {R}{R} — anywhere you write text. The table draws {W}{U}{B}{R}{G}{C} and plain numbers as real pips, in stack items, in chat and in the log, so "{1}{B}, pay 2 life" reads as symbols rather than braces. Anything it cannot draw ({T}, {X}, hybrids like {B/R}) is left as you wrote it, so use those freely too — just do not invent bracket notation for things that are not mana.

MULLIGAN: at game start, look at your opening hand (get_state shows it). Decide keep or mulligan and say which, with your reasoning, then say you are ready to play. To mulligan, call the mulligan tool — ONE call, which shuffles your hand back and deals a fresh seven. HOUSE RULE — FRIENDLY MULLIGANS, always on: every mulligan is to SEVEN and you never bottom a card, however many you take. So there is no cost to shipping a hand that cannot function: no lands, one land with nothing castable, or all lands. Both seats play by this.

BATCHING: every card tool takes many cards at once (move cards:[...], tap cards:[...], counters cards:[...], reveal cards:[...]). Always batch multi-card operations into one call — never loop one card at a time.

Keep the game moving. Be a good opponent: play to win, explain your plays, and be graceful about rules mistakes in either direction.`;
}
