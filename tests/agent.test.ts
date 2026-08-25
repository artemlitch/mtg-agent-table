// The Messages-API transport: tool loop, cache breakpoints, auth headers,
// preemption bookkeeping — against a scripted fake Anthropic endpoint and a
// stub table server, no network.
import { describe, test, expect, afterAll } from "vitest";

process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
// hermetic: the keystore reads the machine's real data dir otherwise, and a
// developer who has configured a DeepSeek key or a custom provider would see
// this suite pass or fail on their own credentials
process.env.ANTHROPIC_KEY_FILE = "/tmp/mtg-agent-test-absent-anthropic-key";
process.env.DEEPSEEK_KEY_FILE = "/tmp/mtg-agent-test-absent-deepseek-key";
process.env.PROVIDER_FILE = "/tmp/mtg-agent-test-absent-provider.json";
// the CLI marker lives in the real data dir too, and whether the developer
// running this has verified their Claude Code login must not decide what the
// chooser answers
process.env.CLAUDE_CLI_MARKER = "/tmp/mtg-agent-test-absent-cli-marker";
const KEY_FILES = {
  anthropic: process.env.ANTHROPIC_KEY_FILE,
  deepseek: process.env.DEEPSEEK_KEY_FILE,
  provider: process.env.PROVIDER_FILE,
};

// This file exercises the Messages loop against the fake below. The chooser no
// longer routes a Claude brain there — Claude plays on the subscription or not
// at all — so the loop is reached the documented way a harness reaches it, and
// the model id is then just a string on the wire. The tests that are about the
// CHOOSER lift the force first; see unforced().
process.env.AGENT_TRANSPORT = "api";

/** Run something with the suite-wide transport force lifted, so the real
 *  priority rules answer. */
async function unforced<T>(fn: () => T | Promise<T>): Promise<T> {
  delete process.env.AGENT_TRANSPORT;
  try {
    return await fn();
  } finally {
    process.env.AGENT_TRANSPORT = "api";
  }
}

// scripted model responses, consumed in order; every request is captured
const modelRequests: any[] = [];
let modelScript: any[] = [];
const fakeAnthropic = Bun.serve({
  port: 0,
  async fetch(req) {
    const body = await req.json();
    modelRequests.push({ headers: Object.fromEntries(req.headers), body });
    const next = modelScript.shift();
    if (!next) return new Response(JSON.stringify({ type: "error", error: { message: "script exhausted" } }), { status: 500 });
    return new Response(JSON.stringify(next), { headers: { "Content-Type": "application/json" } });
  },
});

// stub table: records actions, answers ok
const tableActions: any[] = [];
let statePad = "";
const fakeTable = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/api/action") {
      const body = await req.json();
      tableActions.push(body);
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/api/state") {
      // padded on demand: whether a stale board is worth collapsing is a
      // question about its size, so the size has to be controllable
      return new Response(JSON.stringify({ players: {}, stub: true, pad: statePad }), { headers: { "Content-Type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  },
});

const { AgentRunner, transportChoice, SUPERSEDED_STATE, trimOldThinking, DROPPED_THINKING, collapseSupersededState, KEEP_THINKING_WINDOWS, TRIM_ABOVE_CHARS } =
  await import("../server/agent");
const { resetGameState, makeCard, game, applyAction } = await import("../server/game");

afterAll(() => {
  fakeAnthropic.stop(true);
  fakeTable.stop(true);
});

function usage(n = 100) {
  return { input_tokens: n, output_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 7 };
}

describe("agent transport", () => {
  test("tool loop: narrates, executes a tool, finishes on end_turn", async () => {
    resetGameState();
    const a = new AgentRunner();
    a.tableUrl = `http://localhost:${fakeTable.port}`;
    a.baseUrls = { anthropic: `http://localhost:${fakeAnthropic.port}` };
    a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
    modelScript = [
      {
        stop_reason: "tool_use",
        usage: usage(),
        content: [
          { type: "text", text: "I shall speak." },
          { type: "tool_use", id: "tu_1", name: "say", input: { text: "greetings" } },
        ],
      },
      { stop_reason: "end_turn", usage: usage(), content: [{ type: "text", text: "done thinking" }] },
    ];
    modelRequests.length = 0;
    tableActions.length = 0;

    await a.wake("window");

    // the say tool became a chat action against the table
    expect(tableActions).toEqual([{ actor: "agent", type: "chat", params: { text: "greetings" } }]);
    // brain saw narration, the tool call, and both statuses
    const kinds = a.brain.map((e) => e.kind);
    expect(kinds).toContain("text");
    expect(kinds).toContain("tool");
    expect(a.busy).toBe(false);
    // history: wake prompt, assistant, tool_result, assistant
    expect(a.messages.map((m: any) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(a.messages[2].content[0].type).toBe("tool_result");
    expect(a.messages[2].content[0].tool_use_id).toBe("tu_1");
    // usage accumulated across both calls
    expect(a.usage.calls).toBe(2);
    expect(a.usage.input).toBe(200);
    expect(a.usage.cacheWrite).toBe(14);
  });

  test("requests carry auth, 1h cache breakpoints, and the tool catalog", () => {
    const first = modelRequests[0];
    // room to finish a thought: at 8192 a real turn died mid-sentence
    expect(first.body.max_tokens).toBe(32768);
    expect(first.headers["x-api-key"]).toBe("sk-ant-test-key");
    expect(first.headers["anthropic-beta"]).toContain("extended-cache-ttl");
    expect(first.body.system[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    const toolNames = first.body.tools.map((t: any) => t.name);
    expect(toolNames).toContain("get_state");
    expect(toolNames).toContain("say");
    expect(toolNames).toContain("done");
    // last content block of the last message carries the turn breakpoint
    const lastMsg = first.body.messages.at(-1);
    expect(lastMsg.content.at(-1).cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    // stored history must stay clean — breakpoints are wire-only
    expect(JSON.stringify(modelRequests[1].body.messages[0])).not.toContain("cache_control");
  });

  test("no CLI: wake refuses with a brain error, never calls the model", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_BIN = "/tmp/mtg-agent-nonexistent-claude";
    try {
      const a = new AgentRunner();
      a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
      modelRequests.length = 0;
      await unforced(() => a.wake("window"));
      expect(a.busy).toBe(false);
      expect(a.brain.some((e) => e.kind === "error" && e.text.includes("subscription"))).toBe(true);
      expect(modelRequests.length).toBe(0);
    } finally {
      process.env.ANTHROPIC_API_KEY = saved;
      delete process.env.CLAUDE_BIN;
    }
  });

  test("the prompt is rebuilt from its inputs, so a rules edit reaches a game in progress", () => {
    const a = new AgentRunner();
    a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
    // restoring a save carries the INPUTS, never a frozen prompt string — a
    // game saved before a rule existed still gets the rule on its next turn
    const b = new AgentRunner();
    b.restore(JSON.parse(JSON.stringify(a.serialize())));
    expect(b.serialize().systemPrompt).toBeUndefined();
    expect(b.systemPrompt).toBe(a.systemPrompt);
    // and every tool the agent is offered is named by the rules it plays by
    expect(b.systemPrompt).toContain("place");
  });

  test("the first window of a game is the mulligan decision, and says so", () => {
    // the game opens on PLAYER's turn 1, so the agent's first wake reads as an
    // ordinary reaction window. It kept a seven-card hand with no lands in it
    // and only realised three turns later, because nothing ever asked.
    resetGameState();
    const a = new AgentRunner();
    a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
    const first = a.composeWakePrompt("window");
    expect(first).toMatch(/opening hand/i);
    expect(first).toMatch(/keep or mulligan/i);
  });

  test("and every window after it is not", () => {
    resetGameState();
    const a = new AgentRunner();
    a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
    a.messages.push({ role: "user", content: [{ type: "text", text: "the first window happened" }] });
    expect(a.composeWakePrompt("window")).not.toMatch(/opening hand/i);
  });

  test("what it is holding never gets spoken aloud", () => {
    // it opened a game with "Opening hand: Rogue's Passage, Sundering Eruption,
    // Disciple of Freyalise, …" — seven cards handed over in one sentence. The
    // server had done its half: draw and mulligan write the names only into the
    // drawing seat's own view. This was the agent saying them.
    resetGameState();
    const a = new AgentRunner();
    a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
    expect(a.systemPrompt).toMatch(/NEVER name a card Player cannot see/);
    // and the opening window, which is the one that used to ask for it
    const first = a.composeWakePrompt("window");
    expect(first).toMatch(/DECISION ONLY/);
    expect(first).toMatch(/Do not name a single card/);
  });

  test("every window opens with the board as it stands", () => {
    // The agent reads the board with get_state and then plays for a long time
    // off its own prose about what it read — in one measured game, get_state at
    // messages 1, 15, 73 and then nothing until 266. So the board rides every
    // wake, where nothing older can outrank it.
    resetGameState();
    const bear = makeCard({ id: "b1", name: "Bear", owner: "agent", controller: "agent", zone: "battlefield", power: "2", toughness: "2", counters: { "+1/+1": 3 }, tapped: true });
    const land = makeCard({ id: "l1", name: "Island", owner: "you", controller: "you", zone: "battlefield" });
    for (const c of [bear, land]) {
      game.cards[c.id] = c;
      game.players[c.controller].zones.battlefield.push(c.id);
    }
    const a = new AgentRunner();
    a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
    const prompt = a.composeWakePrompt("react");

    expect(prompt).toContain("BOARD NOW");
    // the sum, not the parts — a 2/2 under three counters is a 5/5
    expect(prompt).toContain("Bear 5/5 (T)");
    expect(prompt).toContain("PLAYER'S: Island");
    expect(prompt).toMatch(/life 40\/40/);
    // it is the glance, not the study: no card text, no ids
    expect(prompt).not.toContain("b1");
  });

  test("owed combat damage rides every window until it lands — even when Player attacked", () => {
    // The failure this exists for: Player attacked, the agent locked the attack
    // in, read the combat procedure as "the attacker announces damage" and
    // passed. Three damage and three commander damage were never applied.
    resetGameState();
    const gonti = makeCard({ id: "g1", name: "Gonti", owner: "you", controller: "you", zone: "battlefield", isCommander: true, power: "2", toughness: "3" });
    game.cards[gonti.id] = gonti;
    game.players.you.zones.battlefield.push(gonti.id);
    applyAction("you", "attack", { pairs: [{ attacker: gonti.id, target: "agent" }] });
    applyAction("agent", "stack_resolve", {});

    const a = new AgentRunner();
    a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
    expect(a.composeWakePrompt("react")).toContain("COMBAT DAMAGE IS OWED");

    applyAction("agent", "damage", { hits: [{ source: gonti.id, target: "agent", amount: 3 }] });
    applyAction("you", "stack_resolve", {});
    expect(game.players.agent.life).toBe(37);
    expect(a.composeWakePrompt("react")).not.toContain("COMBAT DAMAGE IS OWED");
  });

  test("…and says so plainly when a seat has nothing out", () => {
    resetGameState();
    const a = new AgentRunner();
    a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
    expect(a.composeWakePrompt("react")).toContain("YOURS: (empty)");
  });

  test("a save from before rebuildable prompts keeps the prompt it froze", () => {
    const b = new AgentRunner();
    b.restore({ systemPrompt: "you are gonti", model: "opus", lastSeenSeq: 0, brain: [], brainSeq: 0 });
    expect(b.systemPrompt).toBe("you are gonti");
  });

  test("mid-game model switch strips thinking blocks from the replayed history", async () => {
    resetGameState();
    const a = new AgentRunner();
    a.tableUrl = `http://localhost:${fakeTable.port}`;
    a.baseUrls = { anthropic: `http://localhost:${fakeAnthropic.port}` };
    a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
    modelScript = [
      {
        stop_reason: "end_turn",
        usage: usage(),
        content: [
          { type: "thinking", thinking: "let me ponder", signature: "opus-sig" },
          { type: "text", text: "pondered" },
        ],
      },
    ];
    await a.wake("window");
    expect(a.historyModel).toBe("claude-opus-5");
    expect(JSON.stringify(a.messages)).toContain("opus-sig");

    a.model = "sonnet";
    modelScript = [{ stop_reason: "end_turn", usage: usage(), content: [{ type: "text", text: "ok" }] }];
    modelRequests.length = 0;
    await a.wake("window");
    expect(a.historyModel).toBe("claude-sonnet-5");
    // neither the stored history nor the wire request carries the old
    // model's thinking blocks
    expect(JSON.stringify(a.messages)).not.toContain("opus-sig");
    expect(JSON.stringify(modelRequests[0].body.messages)).not.toContain("thinking");
  });

  test("calling done ends the window — the loop must not offer another model call", async () => {
    resetGameState();
    const a = new AgentRunner();
    a.tableUrl = `http://localhost:${fakeTable.port}`;
    a.baseUrls = { anthropic: `http://localhost:${fakeAnthropic.port}` };
    a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
    modelScript = [
      {
        stop_reason: "tool_use",
        usage: usage(),
        content: [
          { type: "text", text: "passing" },
          { type: "tool_use", id: "tu_d", name: "done", input: {} },
        ],
      },
      // if the loop leaks past done, it consumes this and the count betrays it
      { stop_reason: "end_turn", usage: usage(), content: [{ type: "text", text: "SHOULD NOT RUN" }] },
    ];
    modelRequests.length = 0;
    await a.wake("window");
    expect(modelRequests.length).toBe(1);
    expect(a.busy).toBe(false);
    // history still closes with the done tool_result
    expect(a.messages.at(-1).content[0].type).toBe("tool_result");
    modelScript = [];
  });

  test("custom provider: wins priority, uses the provider model, sends no anthropic-only fields", async () => {
    const { saveProvider, deleteProvider } = await import("../server/keystore");
    try {
      // the real priority rules, not the harness force: a custom endpoint is a
      // deliberate choice and outranks everything the catalog would have picked
      await unforced(async () => {
        saveProvider({ baseUrl: `http://localhost:${fakeAnthropic.port}`, apiKey: "sk-local-test", model: "some-local-model" });
        expect(transportChoice()).toBe("custom");
        resetGameState();
        const a = new AgentRunner();
        a.tableUrl = `http://localhost:${fakeTable.port}`;
        a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
        modelScript = [{ stop_reason: "end_turn", usage: usage(), content: [{ type: "text", text: "hello from a local model" }] }];
        modelRequests.length = 0;
        await a.wake("window");
        const req = modelRequests[0];
        expect(req.body.model).toBe("some-local-model");
        expect(req.headers["x-api-key"]).toBe("sk-local-test");
        expect(req.headers["anthropic-beta"]).toBeUndefined();
        expect(JSON.stringify(req.body)).not.toContain("cache_control");
        expect(a.brain.some((e) => e.kind === "text" && e.text.includes("hello from a local model"))).toBe(true);
        expect(a.historyModel).toBe("some-local-model");
      });
    } finally {
      deleteProvider();
      process.env.PROVIDER_FILE = KEY_FILES.provider;
    }
  });

  test("401 from Anthropic surfaces as a key error and closes the window", async () => {
    const bad = Bun.serve({
      port: 0,
      fetch: () => new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), { status: 401 }),
    });
    try {
      const a = new AgentRunner();
      a.tableUrl = `http://localhost:${fakeTable.port}`;
      a.baseUrls = { anthropic: `http://localhost:${bad.port}` };
      a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
      await a.wake("window");
      expect(a.busy).toBe(false);
      expect(a.brain.some((e) => e.kind === "error" && e.text.includes("rejected the API key"))).toBe(true);
    } finally {
      bad.stop(true);
    }
  });
});

// Every call resends the whole conversation, so a board snapshot the game has
// already moved past is dead weight we pay for on every future call.
describe("superseded board snapshots", () => {
  const look = (id: string) => ({
    stop_reason: "tool_use",
    usage: usage(),
    content: [{ type: "tool_use", id, name: "get_state", input: {} }],
  });
  const resultFor = (a: any, id: string) =>
    a.messages
      .flatMap((m: any) => (Array.isArray(m.content) ? m.content : []))
      .find((b: any) => b.type === "tool_result" && b.tool_use_id === id);

  // each fake board is 45k characters, so two stale ones clear the 80k
  // threshold and one does not
  const runner = () => {
    resetGameState();
    const a = new AgentRunner();
    a.tableUrl = `http://localhost:${fakeTable.port}`;
    a.baseUrls = { anthropic: `http://localhost:${fakeAnthropic.port}` };
    a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
    statePad = "x".repeat(45_000);
    return a;
  };
  afterAll(() => { statePad = ""; });

  test("one stale board is left alone — not worth a cache invalidation", async () => {
    const a = runner();
    modelScript = [look("tu_1"), look("tu_2"), { stop_reason: "end_turn", usage: usage(), content: [{ type: "text", text: "ok" }] }];
    await a.wake("window");
    // rewriting history drops everything after the edit out of the prefix
    // cache; one board is not enough dead weight to pay for that
    expect(resultFor(a, "tu_1").content).not.toBe(SUPERSEDED_STATE);
    expect(resultFor(a, "tu_2").content).not.toBe(SUPERSEDED_STATE);
  });

  test("once enough dead board piles up, all of it goes at once", async () => {
    const a = runner();
    modelScript = [
      look("tu_a"),
      { stop_reason: "tool_use", usage: usage(), content: [{ type: "tool_use", id: "tu_say", name: "say", input: { text: "hm" } }] },
      look("tu_b"),
      look("tu_c"),
      { stop_reason: "end_turn", usage: usage(), content: [{ type: "text", text: "seen enough" }] },
    ];
    await a.wake("window");

    expect(resultFor(a, "tu_c").content).toContain("stub"); // the live board, untouched
    expect(resultFor(a, "tu_a").content).toBe(SUPERSEDED_STATE);
    expect(resultFor(a, "tu_b").content).toBe(SUPERSEDED_STATE);
    // an ordinary tool result is not a snapshot and is never rewritten
    expect(resultFor(a, "tu_say").content).not.toBe(SUPERSEDED_STATE);
  });

  test("a board already collapsed is never rewritten again", async () => {
    const a = runner();
    modelScript = [look("tu_1"), look("tu_2"), look("tu_3"), { stop_reason: "end_turn", usage: usage(), content: [{ type: "text", text: "ok" }] }];
    await a.wake("window");
    // the stub object identity is what a prefix cache keys on: leaving it alone
    // on later passes is what keeps the invalidation point near the tail
    const stubbed = resultFor(a, "tu_1");
    expect(stubbed.content).toBe(SUPERSEDED_STATE);

    modelScript = [look("tu_4"), look("tu_5"), { stop_reason: "end_turn", usage: usage(), content: [{ type: "text", text: "ok" }] }];
    await a.wake("react");
    expect(resultFor(a, "tu_1")).toBe(stubbed); // untouched second time around
    expect(resultFor(a, "tu_5").content).toContain("stub");
  });

  test("a game restored from disk gets its stale snapshots collapsed", async () => {
    resetGameState();
    const a = new AgentRunner();
    a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
    const board = (n: number) => `{"board":${n},"pad":"${"x".repeat(45_000)}"}`;
    a.restore({
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "older", name: "get_state", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "older", content: board(1) }] },
        { role: "assistant", content: [{ type: "tool_use", id: "old", name: "get_state", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "old", content: board(2) }] },
        { role: "assistant", content: [{ type: "tool_use", id: "new", name: "get_state", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "new", content: board(3) }] },
      ],
    } as any);
    expect(resultFor(a, "older").content).toBe(SUPERSEDED_STATE);
    expect(resultFor(a, "old").content).toBe(SUPERSEDED_STATE);
    expect(resultFor(a, "new").content).toBe(board(3));
  });

  test("a stale library listing collapses too — it is a snapshot of a zone", () => {
    // three library searches were 45% of a real game's whole conversation
    const listing = (n: number) => `{"cards":[${"x".repeat(45_000)}],"n":${n}}`;
    const messages = [
      { role: "assistant", content: [{ type: "tool_use", id: "v1", name: "view_zone", input: { player: "agent", zone: "library" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "v1", content: listing(1) }] },
      { role: "assistant", content: [{ type: "tool_use", id: "v2", name: "view_zone", input: { player: "agent", zone: "library" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "v2", content: listing(2) }] },
      { role: "assistant", content: [{ type: "tool_use", id: "v3", name: "view_zone", input: { player: "agent", zone: "library" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "v3", content: listing(3) }] },
    ];
    collapseSupersededState(messages);
    expect(messages[1].content[0].content).toBe(SUPERSEDED_STATE);
    expect(messages[3].content[0].content).toBe(SUPERSEDED_STATE);
    expect(messages[5].content[0].content).toBe(listing(3)); // the live one stays
  });

  test("a different zone is not superseded by a library search", () => {
    // reading a graveyard says nothing about what is left in the library
    const big = (s: string) => `{"${s}":"${"x".repeat(45_000)}"}`;
    const messages = [
      { role: "assistant", content: [{ type: "tool_use", id: "g1", name: "view_zone", input: { player: "you", zone: "graveyard" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "g1", content: big("gy") }] },
      { role: "assistant", content: [{ type: "tool_use", id: "l1", name: "view_zone", input: { player: "agent", zone: "library" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "l1", content: big("lib") }] },
    ];
    collapseSupersededState(messages);
    expect(messages[1].content[0].content).toBe(big("gy"));
    expect(messages[3].content[0].content).toBe(big("lib"));
  });

  test("the threshold is a knob, so a caller can still collapse on sight", () => {
    const messages = [
      { role: "assistant", content: [{ type: "tool_use", id: "old", name: "get_state", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "old", content: '{"tiny":1}' }] },
      { role: "assistant", content: [{ type: "tool_use", id: "new", name: "get_state", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "new", content: '{"live":1}' }] },
    ];
    collapseSupersededState(messages, 0);
    expect(messages[1].content[0].content).toBe(SUPERSEDED_STATE);
  });
});

// Deliberation about a board the game has moved past is the largest thing left
// in the context. The plan still in flight is not, so the trim is graded.
describe("thinking from closed windows", () => {
  // Nothing is rewritten until the conversation needs the room, so a thought
  // here has to be the size a real one is — the trim is not reached by a
  // conversation made of single letters, and neither is a real game.
  const FILLER = " considering the crack-back before combat damage.".repeat(950);
  const thought = (text: string, tool?: string) => ({
    stop_reason: tool ? "tool_use" : "end_turn",
    usage: usage(),
    content: [
      { type: "thinking", thinking: text + FILLER },
      ...(tool ? [{ type: "tool_use", id: tool, name: "say", input: { text } }] : []),
    ],
  });
  // a window is a wake prompt and everything the agent did in reply to it
  const windows = (a: any) => {
    const out: any[][] = [];
    for (const m of a.messages) {
      if (m.role === "user" && m.content[0]?.type === "text") out.push([]);
      if (out.length) out[out.length - 1].push(m);
    }
    return out.map((w) => w.flatMap((m: any) => (Array.isArray(m.content) ? m.content : [])).filter((b: any) => b.type === "thinking").length);
  };

  test("the most recent windows keep their reasoning, older ones lose it", async () => {
    resetGameState();
    const a = new AgentRunner();
    a.tableUrl = `http://localhost:${fakeTable.port}`;
    a.baseUrls = { anthropic: `http://localhost:${fakeAnthropic.port}` };
    a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
    // two more windows than are kept, so there is something to strip whatever
    // the setting is — the boundary is the point, not the number
    const n = KEEP_THINKING_WINDOWS + 2;
    for (let i = 0; i < n; i++) {
      modelScript = [thought(`w${i} a`, `tu_${i}`), thought(`w${i} b`)];
      await a.wake("window");
    }
    expect(windows(a)).toEqual([...Array(2).fill(0), ...Array(KEEP_THINKING_WINDOWS).fill(2)]);
  });

  test("what the agent said and did survives the trim", async () => {
    resetGameState();
    const a = new AgentRunner();
    a.tableUrl = `http://localhost:${fakeTable.port}`;
    a.baseUrls = { anthropic: `http://localhost:${fakeAnthropic.port}` };
    a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
    // one more window than is kept, so the oldest has aged out
    for (let i = 0; i <= KEEP_THINKING_WINDOWS; i++) {
      modelScript = [thought(`w${i} a`, `tu_${i}`), thought(`w${i} b`)];
      await a.wake("window");
    }
    const blocks = a.messages.flatMap((m: any) => (Array.isArray(m.content) ? m.content : []));
    // the oldest window kept its action and its result, only the thought went
    expect(blocks.some((b: any) => b.type === "tool_use" && b.id === "tu_0")).toBe(true);
    expect(blocks.some((b: any) => b.type === "tool_result" && b.tool_use_id === "tu_0")).toBe(true);
    expect(blocks.some((b: any) => b.type === "thinking" && b.thinking.startsWith("w0 a"))).toBe(false);
  });

  test("a message that is nothing but thinking leaves a marker, not an empty message", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "wake 1" }] },
      // what a max_tokens truncation leaves behind: a long thought, no action
      { role: "assistant", content: [{ type: "thinking", thinking: "only a thought" }] },
      { role: "user", content: [{ type: "text", text: "wake 2" }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "b" }, { type: "text", text: "said" }] },
      { role: "user", content: [{ type: "text", text: "wake 3" }] },
      { role: "user", content: [{ type: "text", text: "wake 4" }] },
    ];
    // keeping one window, so everything before the last is stale — the marker
    // is what is under test here, not how many windows survive. above=0 asks
    // for the mechanism regardless of size; the size gate has its own test.
    trimOldThinking(messages, 1, 0);
    // an empty content array is not a legal message, and dropping the message
    // would leave two user turns back to back
    expect(messages[1].content).toEqual([{ type: "text", text: DROPPED_THINKING }]);
    expect(messages[3].content).toEqual([{ type: "text", text: "said" }]);
  });

  test("a short game keeps every thought", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "wake 1" }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "a" }, { type: "text", text: "x" }] },
      { role: "user", content: [{ type: "text", text: "wake 2" }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "b" }, { type: "text", text: "y" }] },
    ];
    trimOldThinking(messages, undefined, 0);
    expect(messages.flatMap((m) => m.content).filter((b: any) => b.type === "thinking")).toHaveLength(2);
  });

  test("nothing is rewritten until the conversation needs the room", () => {
    // enough windows that the trim would fire on window count alone
    const messages: any[] = [];
    for (let w = 0; w < 10; w++) {
      messages.push({ role: "user", content: [{ type: "text", text: `wake ${w}` }] });
      messages.push({ role: "assistant", content: [{ type: "thinking", thinking: `thought ${w}` }, { type: "text", text: "x" }] });
    }
    const thoughts = () => messages.flatMap((m) => m.content).filter((b: any) => b.type === "thinking").length;

    // a rewrite costs the prefix cache from the edit to the end, so a small
    // conversation pays nothing and keeps everything
    trimOldThinking(messages);
    expect(thoughts()).toBe(10);

    // over the budget it does its job — and the default budget is a real one,
    // not so low that an ordinary game trips it
    trimOldThinking(messages, KEEP_THINKING_WINDOWS, 100);
    expect(thoughts()).toBe(KEEP_THINKING_WINDOWS);
    expect(TRIM_ABOVE_CHARS).toBeGreaterThan(100_000);
  });
});

// The whole point of the catalog: a brain is a row in it, and the tool loop
// above does not know or care which company answers the POST.
describe("model catalog", () => {
  const sitDown = (model: string) => {
    resetGameState();
    const a = new AgentRunner();
    a.tableUrl = `http://localhost:${fakeTable.port}`;
    a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
    a.model = model;
    modelRequests.length = 0;
    tableActions.length = 0;
    return a;
  };

  test("both DeepSeek tiers ride the same key and endpoint, differing only on the wire", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-deepseek-test";
    try {
      expect(await unforced(() => transportChoice("deepseek-pro"))).toBe("api");
      const a = sitDown("deepseek-pro");
      a.baseUrls = { deepseek: `http://localhost:${fakeAnthropic.port}` };
      modelScript = [{ stop_reason: "end_turn", usage: usage(), content: [{ type: "text", text: "thought about it" }] }];
      await a.wake("window");
      expect(modelRequests[0].body.model).toBe("deepseek-v4-pro");
      expect(modelRequests[0].headers["x-api-key"]).toBe("sk-deepseek-test");
    } finally {
      delete process.env.DEEPSEEK_API_KEY;
    }
  });

  test("a game saved before pro existed still names the flash tier", () => {
    // the picker key is what lands in state.json — renaming the label must not
    // strand a game in progress
    const b = new AgentRunner();
    b.restore({ model: "deepseek", lastSeenSeq: 0, brain: [], brainSeq: 0 });
    expect(b.model).toBe("deepseek");
  });

  test("DeepSeek plays through the same tool loop, on its own endpoint and key", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-deepseek-test";
    try {
      expect(await unforced(() => transportChoice("deepseek"))).toBe("api");
      const a = sitDown("deepseek");
      a.baseUrls = { deepseek: `http://localhost:${fakeAnthropic.port}` };
      modelScript = [
        { stop_reason: "tool_use", usage: usage(), content: [{ type: "tool_use", id: "tu_1", name: "say", input: { text: "greetings" } }] },
        { stop_reason: "end_turn", usage: usage(), content: [{ type: "text", text: "your move" }] },
      ];
      await a.wake("window");

      const req = modelRequests[0];
      expect(req.body.model).toBe("deepseek-v4-flash");
      expect(req.headers["x-api-key"]).toBe("sk-deepseek-test");
      // cache_control and the beta header are Anthropic's alone
      expect(req.headers["anthropic-beta"]).toBeUndefined();
      expect(JSON.stringify(req.body)).not.toContain("cache_control");
      // and it is the same loop: tools offered, tool calls applied to the table
      expect(req.body.tools.map((t: any) => t.name)).toContain("say");
      expect(tableActions).toEqual([{ actor: "agent", type: "chat", params: { text: "greetings" } }]);
      expect(a.historyModel).toBe("deepseek-v4-flash");
      expect(a.busy).toBe(false);
    } finally {
      delete process.env.DEEPSEEK_API_KEY;
    }
  });

  test("Claude plays on the subscription or not at all — a key never buys it a window", async () => {
    const { setCliVerified, clearCliVerified } = await import("../server/keystore");
    // ANTHROPIC_API_KEY is set for this whole file and it buys a Claude brain
    // nothing. api.anthropic.com bills per token; this table does not spend
    // that way, so the only answers for Claude are the CLI and the dark.
    process.env.CLAUDE_BIN = "/bin/sh"; // a binary that exists, so the machine's own install cannot decide this
    try {
      expect(await unforced(() => transportChoice("opus"))).toBe("none");
      // and the same for a wire id the catalog has never heard of, which
      // modelSpec files under Anthropic
      expect(await unforced(() => transportChoice("claude-opus-4-5-20251101"))).toBe("none");

      // the behaviour behind the choice: the window closes without a request
      const a = sitDown("opus");
      a.baseUrls = { anthropic: `http://localhost:${fakeAnthropic.port}` };
      modelScript = [{ stop_reason: "end_turn", usage: usage(), content: [{ type: "text", text: "should never be asked for" }] }];
      await unforced(() => a.wake("window"));
      expect(modelRequests.length).toBe(0);
      expect(a.brain.some((e) => e.kind === "error" && e.text.includes("subscription"))).toBe(true);
      modelScript = [];

      // verify the login and the CLI is there — still never "api"
      setCliVerified();
      expect(await unforced(() => transportChoice("opus"))).toBe("cli");
    } finally {
      clearCliVerified();
      delete process.env.CLAUDE_BIN;
    }
  });

  test("a DeepSeek brain with no DeepSeek key stays dark — the Anthropic key is not its key", async () => {
    // ANTHROPIC_API_KEY is set for this whole file; it is not a DeepSeek brain
    expect(await unforced(() => transportChoice("deepseek"))).toBe("none");

    const a = sitDown("deepseek");
    await a.wake("window");
    expect(modelRequests.length).toBe(0);
    expect(a.busy).toBe(false);
    expect(a.brain.some((e) => e.kind === "error" && e.text.includes("DeepSeek"))).toBe(true);
  });

  test("an id the catalog does not know goes on the wire verbatim", async () => {
    const a = sitDown("claude-opus-4-5-20251101");
    a.baseUrls = { anthropic: `http://localhost:${fakeAnthropic.port}` };
    modelScript = [{ stop_reason: "end_turn", usage: usage(), content: [{ type: "text", text: "ok" }] }];
    await a.wake("window");
    expect(modelRequests[0].body.model).toBe("claude-opus-4-5-20251101");
    expect(modelRequests[0].headers["x-api-key"]).toBe("sk-ant-test-key");
  });
});
