// Agent harness: drives an Opus pilot through the `claude` CLI in -p mode with
// --resume to keep one conversation per game. Tools come from mcp-tools.ts.

import { game, viewFor, renderLogFor } from "./game";

export interface BrainEntry {
  seq: number;
  ts: number;
  kind: "thinking" | "text" | "tool" | "status" | "error";
  text: string;
}

type BrainListener = (e: BrainEntry) => void;

const PROJECT_DIR = new URL("..", import.meta.url).pathname;

export class AgentRunner {
  sessionId: string | null = null;
  systemPrompt = "";
  model = "opus";
  busy = false;
  pendingWake = false;
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

  composeWakePrompt(): string {
    const events = this.newEventsText();
    this.lastSeenSeq = game.seq;
    const header = this.sessionId
      ? "New events at the table since your last window:"
      : "The game has started. Events so far:";
    return (
      `${header}\n${events || "(nothing new)"}\n\n` +
      `It is ${game.turn === "agent" ? "YOUR turn" : "Artem's turn"} ` +
      `(turn ${game.turnNumber}, phase: ${game.phase}). This is your window to act.\n` +
      `Use your table tools. Call get_state first if you need to re-inspect anything. ` +
      `Narrate your reasoning in plain text BEFORE each action. ` +
      `When you are finished, call done to pass back to Artem, or ask_user if you need something from him. ` +
      `Speak to Artem with the say tool — plain response text is your visible thought process, not chat.`
    );
  }

  async wake() {
    if (this.busy) {
      this.pendingWake = true;
      return;
    }
    this.busy = true;
    this.pendingWake = false;
    const prompt = this.composeWakePrompt();
    this.push("status", this.sessionId ? "Agent waking up (new events)…" : "Agent sitting down at the table…");

    const args = [
      "-p",
      prompt,
      "--model",
      this.model,
      "--output-format",
      "stream-json",
      "--verbose",
      "--mcp-config",
      PROJECT_DIR + "mcp.json",
      "--allowedTools",
      "mcp__table",
      "--append-system-prompt",
      this.systemPrompt,
    ];
    if (this.sessionId) args.push("--resume", this.sessionId);

    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    delete env.ANTHROPIC_API_KEY;

    try {
      this.proc = Bun.spawn(["claude", ...args], {
        cwd: PROJECT_DIR,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const reader = this.proc.stdout as ReadableStream;
      let buf = "";
      for await (const chunk of reader) {
        buf += new TextDecoder().decode(chunk);
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) this.handleLine(line);
        }
      }
      const stderrText = await new Response(this.proc.stderr as ReadableStream).text();
      const code = await this.proc.exited;
      if (code !== 0) this.push("error", `agent process exited ${code}: ${stderrText.slice(0, 500)}`);
    } catch (e: any) {
      this.push("error", `agent spawn failed: ${e.message}`);
    } finally {
      this.proc = null;
      this.busy = false;
      this.push("status", "Agent window closed.");
      if (this.pendingWake || game.seq > this.lastSeenSeq) {
        // more happened while it was thinking — only re-wake if user acted
        if (this.pendingWake) setTimeout(() => this.wake(), 500);
      }
    }
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
      if (msg.is_error) this.push("error", `agent error: ${String(msg.result ?? msg.subtype).slice(0, 800)}`);
      if (msg.session_id) this.sessionId = msg.session_id;
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
3. Take your actions with tools. Track your own mana: tap your lands with the tap tool when you cast things, and say what you cast. Move a card from hand to battlefield to play it. Use set_phase/set_turn to advance the game structure on your turn.
4. Play honestly: respect mana costs, one land drop per turn, summoning sickness, casting your commander from the command zone with commander tax (+2 per prior cast).
5. On combat: use attack with your attacker card ids. Wait for Artem's blocks (call done and say you're waiting on blocks). Apply damage with life / commander_damage / move (to graveyard) once blocks are known.
6. You may interact with Artem's cards and zones when a game effect allows it (e.g. your theft effects exiling from his library, tapping his creatures). Every such action is logged for him — never touch his cards without a game reason, and say which card/effect authorizes it.
7. If Artem does something you don't understand, or state seems wrong, use ask_user to ask him — then call done and wait for his answer.
8. Use say for things you want to tell Artem directly (announcements, responses, banter). Use ask_user for questions that block you.
9. End EVERY window by calling done (passes back to Artem) unless you asked a blocking question.
10. Instant-speed windows: when Artem passes to you mid-turn (after casting something), you may respond with instants/abilities or just call done to let it resolve.

MULLIGAN: at game start, look at your opening hand (get_state shows it). Decide keep or mulligan (say your reasoning). To mulligan: move your hand cards back with move (toZone library), shuffle, draw 7, then put N cards on the bottom (London mulligan).

Keep the game moving. Be a good opponent: play to win, explain your plays, and be graceful about rules mistakes in either direction.`;
}
