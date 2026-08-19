// Agent harness: drives an Opus pilot through ONE persistent `claude` CLI
// process per game (-p with stream-json input/output). Wakes are user messages
// written to its stdin — no per-wake spawn, and the prompt cache stays hot, so
// time-to-first-output is model latency instead of cold-start. Preemption
// sends the interrupt control message. If the child dies, the next wake
// respawns it with --resume (sessionId is persisted). Tools: mcp-tools.ts.

import { writeFileSync } from "node:fs";
import { game, viewFor, renderLogFor } from "./game";

export interface BrainEntry {
  seq: number;
  ts: number;
  kind: "thinking" | "text" | "tool" | "status" | "error";
  text: string;
}

type BrainListener = (e: BrainEntry) => void;

export interface AgentSnapshot {
  sessionId: string | null;
  systemPrompt: string;
  model: string;
  lastSeenSeq: number;
  brain: BrainEntry[];
  brainSeq: number;
}

const PROJECT_DIR = new URL("..", import.meta.url).pathname;

export class AgentRunner {
  sessionId: string | null = null;
  systemPrompt = "";
  model = "opus";
  // set by the server at boot — the agent's tools MUST talk to the instance
  // that spawned it (a hardcoded url once let a sandbox agent act on the
  // live table)
  tableUrl = "http://localhost:4780";
  busy = false;
  pendingWake = false;
  pendingReason: "window" | null = null;
  lastSeenSeq = 0;
  brain: BrainEntry[] = [];
  private brainSeq = 0;
  private listeners: BrainListener[] = [];
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
    };
  }

  restore(snap: AgentSnapshot) {
    this.sessionId = snap.sessionId ?? null;
    this.systemPrompt = snap.systemPrompt ?? "";
    this.model = snap.model ?? "opus";
    this.lastSeenSeq = snap.lastSeenSeq ?? 0;
    this.brain = snap.brain ?? [];
    this.brainSeq = snap.brainSeq ?? (this.brain.at(-1)?.seq ?? 0);
  }

  reset(systemPrompt: string) {
    this.kill();
    this.sessionId = null;
    this.systemPrompt = systemPrompt;
    this.lastSeenSeq = 0;
    this.brain = [];
    this.brainSeq = 0;
    this.pendingWake = false;
  }

  kill() {
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
    const header = this.sessionId
      ? "New events at the table since your last window:"
      : "The game has started. Events so far:";
    const stackText = game.stack.length
      ? `\nTHE STACK (bottom → top): ${game.stack.map((i) => `[${i.player}] ${i.text}`).join(" · ")}\n`
      : "";
    // regardless of wake reason: Artem's items on the stack are the agent's to
    // acknowledge — without this, window wakes routinely leave them sitting
    const artemItems = game.stack.filter((i) => i.player === "you").length;
    const stackDuty = artemItems
      ? `\n⚠ ${artemItems} of the stack item(s) are ARTEM'S. Deal with them FIRST, before anything else: ` +
        `respond on top (cast/stack_push/stack_counter), or acknowledge each with stack_resolve (top first). ` +
        `Never take other actions or call done while his items sit unresolved.\n`
      : "";
    const situation =
      `It is ${game.turn === "agent" ? "YOUR turn" : "Artem's turn"} ` +
      `(round ${game.turnNumber}, phase: ${game.phase}).`;
    const directive =
      reason === "react"
        ? `You have PRIORITY in reaction to the events above. This is a reaction window, not your turn. ` +
          `If Artem's item is on top of the stack: either respond (cast/stack_push/stack_counter at instant speed) ` +
          `or acknowledge it by calling stack_resolve yourself — that is the "no responses" signal. ` +
          `Resolve items one at a time, top first, and re-check get_state between resolutions if targets matter. ` +
          `Then call done. If there is nothing on the stack and nothing to react to, just call done — silence is fine.`
        : `This is your window to act. Use your table tools. Call get_state first if you need to re-inspect anything. ` +
          `First settle the stack (resolve Artem's items or respond), then proceed. ` +
          `When you cast a spell, use cast (it goes on the stack) and then call done so Artem can respond — ` +
          `NEVER resolve your own spell in the same window you cast it. ` +
          `When you are finished, call done to pass back to Artem, or ask_user if you need something from him.`;
    const interrupted = this.interruptNote
      ? `(Your previous window was INTERRUPTED mid-thought because the table changed. Any actions you completed before the cut are already applied — re-check the state rather than assuming your plan finished.)\n`
      : "";
    this.interruptNote = false;
    return (
      `${interrupted}${header}\n${events || "(nothing new)"}\n${stackText}${stackDuty}\n${situation} ${directive}\n` +
      `Narrate your reasoning in plain text BEFORE each action. ` +
      `Speak to Artem with the say tool — plain response text is your visible thought process, not chat.`
    );
  }

  private preempted = false;
  private interruptNote = false;
  private expectExit = false;
  private interruptWatchdog: ReturnType<typeof setTimeout> | null = null;
  private stderrTail = "";

  async wake(reason: "window" | "react" = "window") {
    if (this.busy) {
      // PREEMPT: new information arrived mid-thought — interrupt the in-flight
      // turn (the process survives, warm) and rewake with the full picture.
      // Completed actions and the transcript stay; only the unfinished
      // thought dies. Watchdog hard-kills if the interrupt goes unanswered.
      this.pendingWake = true;
      if (reason === "window") this.pendingReason = "window";
      this.preempted = true;
      this.interruptNote = true;
      this.push("status", "⟳ Interrupted — restarting with the new information…");
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
      return;
    }
    this.busy = true;
    this.pendingWake = false;
    reason = this.pendingReason ?? reason;
    this.pendingReason = null;
    const prompt = this.composeWakePrompt(reason);
    this.push("status", this.sessionId ? "Agent waking up (new events)…" : "Agent sitting down at the table…");
    try {
      this.ensureProc();
      this.write({ type: "user", message: { role: "user", content: [{ type: "text", text: prompt }] } });
    } catch (e: any) {
      this.push("error", `agent transport failed: ${e.message}`);
      this.busy = false;
    }
  }

  /** Spawn the persistent streaming child if it isn't running. */
  private ensureProc() {
    if (this.proc) return;
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
    delete env.ANTHROPIC_API_KEY;
    this.expectExit = false;
    this.stderrTail = "";
    this.proc = Bun.spawn(["claude", ...args], {
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

  /** A turn finished (result event, interrupt, or child death mid-turn). */
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
      // everything was already delivered inline and nothing of Artem's
      // awaits resolution.
      const undelivered = game.log.some((e) => e.seq > this.lastSeenSeq && e.actor === "you");
      const artemsItemWaits = game.stack.length > 0 && game.stack[game.stack.length - 1].player === "you";
      if (this.preempted || undelivered || artemsItemWaits) {
        setTimeout(() => this.wake(this.pendingReason ?? "react"), 500);
      } else {
        this.pendingWake = false;
      }
    }
    this.preempted = false;
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
}

export const agent = new AgentRunner();

export function buildSystemPrompt(agentDeckName: string, decklist: string[], userDeckName: string): string {
  return `You are an expert Magic: The Gathering player piloting a Commander deck at a friendly but competitive table. You are playing against Artem, a human. This is a 1v1 Commander game, both players start at 40 life.

YOUR DECK: "${agentDeckName}". Decklist:
${decklist.join(", ")}

ARTEM'S DECK: "${agentDeckName === userDeckName ? "the same deck" : userDeckName}" — you know the deck name but NOT its contents beyond what is revealed in play.

THE TABLE has no rules engine. You and Artem enforce the rules yourselves, like a paper game. You interact through the "table" MCP tools (get_state, draw, move, tap, attack, life, say, done, and more). The server enforces hidden information: you can never see Artem's hand or library except through game effects that reveal them (peek, view_zone when an effect allows it, revealed cards).

HOW TO PLAY YOUR WINDOW:
1. Call get_state to see the table when your window opens.
2. Narrate your reasoning as plain text BEFORE acting: what you observed, what your options are, why you chose your line. Artem watches this narration live in a "brain" panel — it is your table talk to yourself, always visible. Be thorough but not padded.
3. Take your actions with tools, following the CASTING PROCEDURE below for every card. Use set_phase/set_turn to advance the game structure on your turn.
4. Play honestly: respect mana costs, one land drop per turn, summoning sickness, casting your commander from the command zone with commander tax (+2 per prior cast).
5. Combat runs through the stack like everything else, one acknowledged step at a time: (a) attack tool → your declaration sits on the stack → done; Artem resolves it (locks attacks, taps attackers) or responds on top. (b) Artem declares blocks the same way → you resolve to lock them. (c) Announce combat damage with stack_push ("Combat damage: Klaw 3 → Artem"), let it be resolved, THEN apply the numbers with life / commander_damage / move. Never apply damage that wasn't acknowledged on the stack first.
6. You may interact with Artem's cards and zones when a game effect allows it (e.g. your theft effects exiling from his library, tapping his creatures). Every such action is logged for him — never touch his cards without a game reason, and say which card/effect authorizes it.
7. If Artem does something you don't understand, or state seems wrong, use ask_user to ask him — then call done and wait for his answer.
8. Use say for things you want to tell Artem directly (announcements, responses, banter). Use ask_user for questions that block you.
9. End EVERY window by calling done (passes back to Artem) unless you asked a blocking question.

CASTING PROCEDURE — run this checklist for EVERY card you play, no exceptions:
1. READ the card's full oracle text in get_state before playing it. Never play from memory of the name.
2. LIST its triggered abilities out loud in your narration: ETB, death, attack, devour, landfall, "whenever…". If it has none, say so.
3. Lands: cast tool, straight to the battlefield (CR 115.2a special action, no stack, no responses) — but its triggers (Bojuka Bog, landfall) still go on the stack via stack_push.
4. Spells: tap your mana (tap tool), then ONE stack_batch containing [the card, then each of its cast/ETB triggers as text items, bottom-first]. A no-trigger permanent is just a plain cast. The trigger rides in the SAME batch — a trigger you didn't put on the stack DID NOT HAPPEN, and "I'll apply it later" is not a thing at this table.
5. Call done ONCE. Artem accepts the whole batch or responds inside it. NEVER stack_resolve your own items.
6. After resolution, apply exactly what the stack items said — counters, tokens, life — and nothing that wasn't announced.

THE STACK AND PRIORITY (Comprehensive Rules model):
- USES THE STACK: every spell, every activated ability, every triggered ability. DOES NOT: land plays, untapping, the draw for turn, shuffles, cleanup discards, mana abilities.
- Phase/step declarations (set_phase) apply immediately — no stack item, no waiting. The TURN PASS (set_turn) is the one turn-structure item that goes on the stack: responding to it is how end-of-turn effects happen, and the turn changes only when the opponent resolves it. Attack and block declarations still go on the stack as their own priority windows. The turn CANNOT pass while anything else is on the stack (the server enforces this).
- Resolution: permanents → battlefield, instants/sorceries → graveyard; pass to: for exceptions. stack_counter sends the top card to its owner's graveyard.
- Legality is argued, not enforced: challenge suspicious plays in chat and defend your own. Once you two agree an item was illegal, either side takes it back with stack_remove (card returns to its owner's hand).
- PROPOSED SEQUENCES (stack_batch): beyond single casts, you can propose a whole run — an event plus all its triggers, or planned follow-up casts marked retractable:true. Artem accepts the lot or responds at a point inside it — your retractable items above that point are RETRACTED (MTR shortcut rules: they never happened, cards back to hand; what came before his response stays committed). Symmetrically: when Artem proposes a sequence and you have NO responses, accept it with ONE stack_resolve_all. To respond inside his sequence, pass respondAt with the item id (cast/stack_push), or stack_counter with that item id.

UNDO: log lines starting with ↩ mean Artem rewound the listed action. The event log you saw earlier may no longer match reality after an ↩ — call get_state and trust the current state, not your memory.

MULLIGAN: at game start, look at your opening hand (get_state shows it). Decide keep or mulligan (say your reasoning). To mulligan, batch it in THREE calls total: one move with cards: [all seven ids] toZone library, then shuffle, then draw 7. HOUSE RULE (friendly mulligans): your FIRST mulligan is free — keep all 7. From the second mulligan on, it's London: bottom 1 card per mulligan beyond the first (one batched move, position bottom).

BATCHING: every card tool takes many cards at once (move cards:[...], tap cards:[...], counters cards:[...], reveal cards:[...]). Always batch multi-card operations into one call — never loop one card at a time.

Keep the game moving. Be a good opponent: play to win, explain your plays, and be graceful about rules mistakes in either direction.`;
}
