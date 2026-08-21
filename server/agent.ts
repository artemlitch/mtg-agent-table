// Agent harness with two transports behind one interface:
//
//  - "cli": a persistent `claude -p` child on the machine owner's own Claude
//    Code login (stream-json stdin/stdout, MCP tools via mcp-tools.ts,
//    --resume across respawns). Zero marginal cost on a subscription. Used
//    once a test call has verified the login (keystore marker).
//  - "api": an in-process Messages API tool loop on a pasted API key
//    (keystore.ts), with 1h-TTL cache breakpoints and per-game usage
//    tracking. Used whenever a key is configured — pasting a key is an
//    explicit choice that outranks the CLI.
//
// Wake windows, preemption, the brain panel, and persistence are shared.
// Preemption aborts the in-flight API request or interrupts the CLI child;
// completed tool calls stay applied either way.

import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { game, renderLogFor } from "./game";
import { TOOLS, callTable } from "./mcp-tools";
import { loadApiKey, isCliVerified } from "./keystore";

const API_URL = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
const MODELS: Record<string, string> = { opus: "claude-opus-5", sonnet: "claude-sonnet-5", haiku: "claude-haiku-4-5-20251001" };
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

export type Transport = "api" | "cli" | "none";

/** Which transport a wake would use right now. A pasted key wins; the CLI
 * needs a one-time verified test call (Chat tab) before it counts. */
export function transportChoice(): Transport {
  const forced = process.env.AGENT_TRANSPORT;
  if (forced === "api" || forced === "cli") return forced;
  if (loadApiKey()) return "api";
  if (resolveClaudeBin() && isCliVerified()) return "cli";
  return "none";
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
}

export interface AgentSnapshot {
  sessionId?: string | null;
  systemPrompt: string;
  model: string;
  lastSeenSeq: number;
  brain: BrainEntry[];
  brainSeq: number;
  messages?: any[];
  historyModel?: string;
  usage?: AgentUsage;
}

const emptyUsage = (): AgentUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 });

export class AgentRunner {
  sessionId: string | null = null; // cli transport conversation
  systemPrompt = "";
  model = "opus";
  // set by the server at boot — the agent's tools MUST talk to the instance
  // that spawned it (a hardcoded url once let a sandbox agent act on the
  // live table)
  tableUrl = "http://localhost:4780";
  apiUrl = API_URL;
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
      systemPrompt: this.systemPrompt,
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
    this.systemPrompt = snap.systemPrompt ?? "";
    this.model = snap.model ?? "opus";
    this.lastSeenSeq = snap.lastSeenSeq ?? 0;
    this.brain = snap.brain ?? [];
    this.brainSeq = snap.brainSeq ?? (this.brain.at(-1)?.seq ?? 0);
    this.messages = snap.messages ?? [];
    this.historyModel = snap.historyModel ?? "";
    this.usage = snap.usage ?? emptyUsage();
  }

  reset(systemPrompt: string) {
    this.kill();
    this.sessionId = null;
    this.systemPrompt = systemPrompt;
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

  /** Events since the agent last saw the table, rendered from its viewpoint. */
  newEventsText(): string {
    const events = game.log.filter((e) => e.seq > this.lastSeenSeq);
    return events.map((e) => `[${e.seq}] ${renderLogFor(e, "agent").text}`).join("\n");
  }

  composeWakePrompt(reason: "window" | "react" = "window"): string {
    const events = this.newEventsText();
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
      ? `\n⚠ ${playerItems} of the stack item(s) are PLAYER'S. Deal with them FIRST, before anything else: ` +
        `respond on top (cast/stack_push/stack_counter), or acknowledge each with stack_resolve (top first). ` +
        `Never take other actions or call done while their items sit unresolved.\n`
      : "";
    const situation =
      `It is ${game.turn === "agent" ? "YOUR turn" : "Player's turn"} ` +
      `(round ${game.turnNumber}, phase: ${game.phase}).`;
    const directive =
      reason === "react"
        ? `You have PRIORITY in reaction to the events above. This is a reaction window, not your turn. ` +
          `If Player's item is on top of the stack: either respond (cast/stack_push/stack_counter at instant speed) ` +
          `or acknowledge it by calling stack_resolve yourself — that is the "no responses" signal. ` +
          `Resolve items one at a time, top first, and re-check get_state between resolutions if targets matter. ` +
          `Then call done. If there is nothing on the stack and nothing to react to, just call done — silence is fine.`
        : `This is your window to act. Use your table tools. Call get_state first if you need to re-inspect anything. ` +
          `First settle the stack (resolve Player's items or respond), then proceed. ` +
          `When you cast a spell, use cast (it goes on the stack) and then call done so Player can respond — ` +
          `NEVER resolve your own spell in the same window you cast it. ` +
          `When you are finished, call done to pass back to Player, or ask_user if you need something from them.`;
    const interrupted = this.interruptNote
      ? `(Your previous window was INTERRUPTED mid-thought because the table changed. Any actions you completed before the cut are already applied — re-check the state rather than assuming your plan finished.)\n`
      : "";
    this.interruptNote = false;
    return (
      `${interrupted}${header}\n${events || "(nothing new)"}\n${stackText}${stackDuty}\n${situation} ${directive}\n` +
      `Narrate your reasoning in plain text BEFORE each action. ` +
      `Speak to Player with the say tool — plain response text is your visible thought process, not chat.`
    );
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
    const transport = transportChoice();
    if (transport === "none") {
      this.push("error", "The agent has no brain yet — set up Claude Code or paste an API key in the Chat tab.");
      return;
    }
    this.busy = true;
    this.pendingWake = false;
    reason = this.pendingReason ?? reason;
    this.pendingReason = null;
    if (transport === "api") {
      // thinking-block signatures are model-specific: a mid-game model switch
      // must strip them from the replayed history or the API rejects it
      const resolved = MODELS[this.model] ?? this.model;
      if (this.historyModel && this.historyModel !== resolved) {
        this.messages = this.messages
          .map((m) => (Array.isArray(m.content) ? { ...m, content: m.content.filter((b: any) => b.type !== "thinking" && b.type !== "redacted_thinking") } : m))
          .filter((m) => !Array.isArray(m.content) || m.content.length > 0);
      }
      this.historyModel = resolved;
    }
    const prompt = this.composeWakePrompt(reason);
    this.push("status", this.messages.length || this.sessionId ? "Agent waking up (new events)…" : "Agent sitting down at the table…");
    if (transport === "api") {
      this.messages.push({ role: "user", content: [{ type: "text", text: prompt }] });
      try {
        await this.runApiTurn(loadApiKey()!);
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

  /** The tool loop: call the model, apply its tool calls, repeat to end_turn. */
  private async runApiTurn(apiKey: string) {
    for (let i = 0; i < MAX_LOOP; i++) {
      const res = await this.callModel(apiKey);
      if (res === "aborted") return;
      if (res === null) return; // hard error, already pushed
      this.usage.calls++;
      const u = res.usage ?? {};
      this.usage.input += u.input_tokens ?? 0;
      this.usage.output += u.output_tokens ?? 0;
      this.usage.cacheRead += u.cache_read_input_tokens ?? 0;
      this.usage.cacheWrite += u.cache_creation_input_tokens ?? 0;

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
      if (this.preempted) return; // interrupted between iterations
    }
    this.push("error", `agent tool loop hit the ${MAX_LOOP}-iteration backstop — window closed`);
  }

  /** One Messages API call. Returns the response, "aborted", or null on error. */
  private async callModel(apiKey: string): Promise<any> {
    // cache breakpoints ride on the wire only, never into stored history:
    // system prompt + the newest turn, both 1h TTL (a human turn between
    // wakes routinely outlives the default 5m window)
    const cc = { cache_control: { type: "ephemeral", ttl: "1h" } };
    const wire = this.messages.map((m, i) => {
      if (i !== this.messages.length - 1 || !Array.isArray(m.content) || m.content.length === 0) return m;
      const content = m.content.map((b: any, j: number) => (j === m.content.length - 1 ? { ...b, ...cc } : b));
      return { ...m, content };
    });
    const body = {
      model: MODELS[this.model] ?? this.model,
      max_tokens: 8192,
      system: [{ type: "text", text: this.systemPrompt, ...cc }],
      tools: Object.entries(TOOLS).map(([name, def]) => ({ name, description: def.description, input_schema: def.schema })),
      messages: wire,
    };
    const ctl = new AbortController();
    this.inflight = ctl;
    this.expectAbort = false;
    try {
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${this.apiUrl}/v1/messages`, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "extended-cache-ttl-2025-04-11",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: ctl.signal,
        });
        if (res.ok) return await res.json();
        const errText = (await res.text()).slice(0, 600);
        if (res.status === 401 || res.status === 403) {
          this.push("error", "Anthropic rejected the API key — delete it in the Agent tab and paste a fresh one.");
          return null;
        }
        if ((res.status === 429 || res.status === 529 || res.status >= 500) && attempt < 3) {
          const delay = [2000, 5000, 12000][attempt];
          this.push("status", `Anthropic returned ${res.status} — retrying in ${delay / 1000}s…`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        this.push("error", `Anthropic API error ${res.status}: ${errText}`);
        return null;
      }
    } catch (e: any) {
      if (e.name === "AbortError" || this.expectAbort) return "aborted";
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
      for await (const chunk of proc.stdout as ReadableStream) {
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
      for await (const chunk of proc.stderr as ReadableStream) {
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
      const undelivered = game.log.some((e) => e.seq > this.lastSeenSeq && e.actor === "you");
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

THE TABLE has no rules engine. You and Player enforce the rules yourselves, like a paper game. You interact through the "table" MCP tools (get_state, draw, move, tap, attack, life, say, done, and more). The server enforces hidden information: you can never see Player's hand or library except through game effects that reveal them (peek, view_zone when an effect allows it, revealed cards).

HOW TO PLAY YOUR WINDOW:
1. Call get_state to see the table when your window opens.
2. Narrate your reasoning as plain text BEFORE acting: what you observed, what your options are, why you chose your line. Player watches this narration live in a "brain" panel — it is your table talk to yourself, always visible. Be thorough but not padded.
3. Take your actions with tools, following the CASTING PROCEDURE below for every card. Use set_phase/set_turn to advance the game structure on your turn.
4. Play honestly: respect mana costs, one land drop per turn, summoning sickness, casting your commander from the command zone with commander tax (+2 per prior cast).
5. Combat runs through the stack like everything else, one acknowledged step at a time: (a) attack tool → your declaration sits on the stack → done; Player resolves it (locks attacks, taps attackers) or responds on top. (b) Player declares blocks the same way → you resolve to lock them. (c) Announce combat damage with stack_push — text is the headline ("COMBAT DAMAGE") and lines carries ONE entry per attacker/blocker pairing ("Marchesa 7/7 → Warrior token: token dies; deals 1 back") so the table renders it as a readable table. Let it be resolved, THEN apply the numbers with life / commander_damage / move. Never apply damage that wasn't acknowledged on the stack first.
6. You may interact with Player's cards and zones when a game effect allows it (e.g. your theft effects exiling from their library, tapping their creatures). Every such action is logged for them — never touch their cards without a game reason, and say which card/effect authorizes it.
7. If Player does something you don't understand, or state seems wrong, use ask_user to ask them — then call done and wait for their answer.
8. Use say for things you want to tell Player directly (announcements, responses, banter). Use ask_user for questions that block you.
9. End EVERY window by calling done (passes back to Player) unless you asked a blocking question.

CASTING PROCEDURE — run this checklist for EVERY card you play, no exceptions:
1. READ the card's full oracle text in get_state before playing it. Never play from memory of the name.
2. LIST its triggered abilities out loud in your narration: ETB, death, attack, devour, landfall, "whenever…". If it has none, say so.
3. Lands: cast tool, straight to the battlefield (CR 115.2a special action, no stack, no responses) — but its triggers (Bojuka Bog, landfall) still go on the stack via stack_push.
4. Spells: tap your mana (tap tool), then ONE stack_batch containing [the card, then each of its cast/ETB triggers as text items, bottom-first]. A no-trigger permanent is just a plain cast. The trigger rides in the SAME batch — a trigger you didn't put on the stack DID NOT HAPPEN, and "I'll apply it later" is not a thing at this table.
5. Call done ONCE. Player accepts the whole batch or responds inside it. NEVER stack_resolve your own items.
6. After resolution, apply exactly what the stack items said — counters, tokens, life — and nothing that wasn't announced.

THE STACK AND PRIORITY (Comprehensive Rules model):
- USES THE STACK: every spell, every activated ability, every triggered ability. DOES NOT: land plays, untapping, the draw for turn, shuffles, cleanup discards, mana abilities.
- Phase/step declarations (set_phase) apply immediately — no stack item, no waiting. The TURN PASS (set_turn) is the one turn-structure item that goes on the stack: responding to it is how end-of-turn effects happen, and the turn changes only when the opponent resolves it. Attack and block declarations still go on the stack as their own priority windows. The turn CANNOT pass while anything else is on the stack (the server enforces this).
- Resolution: permanents → battlefield, instants/sorceries → graveyard; pass to: for exceptions. stack_counter sends the top card to its owner's graveyard.
- Legality is argued, not enforced: challenge suspicious plays in chat and defend your own. Once you two agree an item was illegal, either side takes it back with stack_remove (card returns to its owner's hand).
- PROPOSED SEQUENCES (stack_batch): beyond single casts, you can propose a whole run — an event plus all its triggers, or planned follow-up casts marked retractable:true. Player accepts the lot or responds at a point inside it — your retractable items above that point are RETRACTED (MTR shortcut rules: they never happened, cards back to hand; what came before their response stays committed). Symmetrically: when Player proposes a sequence and you have NO responses, accept it with ONE stack_resolve_all. To respond inside their sequence, pass respondAt with the item id (cast/stack_push), or stack_counter with that item id.

UNDO: log lines starting with ↩ mean Player rewound the listed action. The event log you saw earlier may no longer match reality after an ↩ — call get_state and trust the current state, not your memory.

MULLIGAN: at game start, look at your opening hand (get_state shows it). Decide keep or mulligan (say your reasoning). To mulligan, batch it in THREE calls total: one move with cards: [all seven ids] toZone library, then shuffle, then draw 7. HOUSE RULE (friendly mulligans): your FIRST mulligan is free — keep all 7. From the second mulligan on, it's London: bottom 1 card per mulligan beyond the first (one batched move, position bottom).

BATCHING: every card tool takes many cards at once (move cards:[...], tap cards:[...], counters cards:[...], reveal cards:[...]). Always batch multi-card operations into one call — never loop one card at a time.

Keep the game moving. Be a good opponent: play to win, explain your plays, and be graceful about rules mistakes in either direction.`;
}
