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
const KEY_FILES = {
  anthropic: process.env.ANTHROPIC_KEY_FILE,
  deepseek: process.env.DEEPSEEK_KEY_FILE,
  provider: process.env.PROVIDER_FILE,
};

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
      return new Response(JSON.stringify({ players: {}, stub: true }), { headers: { "Content-Type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  },
});

const { AgentRunner, transportChoice, SUPERSEDED_STATE, trimOldThinking, DROPPED_THINKING } = await import("../server/agent");
const { resetGameState } = await import("../server/game");

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

  test("no API key and no CLI: wake refuses with a brain error, never calls the model", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_BIN = "/tmp/mtg-agent-nonexistent-claude";
    try {
      const a = new AgentRunner();
      a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
      modelRequests.length = 0;
      await a.wake("window");
      expect(a.busy).toBe(false);
      expect(a.brain.some((e) => e.kind === "error" && e.text.includes("API key"))).toBe(true);
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
      saveProvider({ baseUrl: `http://localhost:${fakeAnthropic.port}`, apiKey: "sk-local-test", model: "some-local-model" });
      // ANTHROPIC_API_KEY is set for this whole file — the provider must outrank it
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

  test("only the newest get_state keeps its board; the older ones collapse to a stub", async () => {
    resetGameState();
    const a = new AgentRunner();
    a.tableUrl = `http://localhost:${fakeTable.port}`;
    a.baseUrls = { anthropic: `http://localhost:${fakeAnthropic.port}` };
    a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
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

  test("collapsing rewrites only the snapshot that just went stale", async () => {
    resetGameState();
    const a = new AgentRunner();
    a.tableUrl = `http://localhost:${fakeTable.port}`;
    a.baseUrls = { anthropic: `http://localhost:${fakeAnthropic.port}` };
    a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
    modelScript = [look("tu_1"), look("tu_2"), { stop_reason: "end_turn", usage: usage(), content: [{ type: "text", text: "ok" }] }];
    await a.wake("window");
    // the stub object identity is what a prefix cache keys on: leaving it alone
    // on later passes is what keeps the invalidation point near the tail
    const stubbed = resultFor(a, "tu_1");
    expect(stubbed.content).toBe(SUPERSEDED_STATE);

    modelScript = [look("tu_3"), { stop_reason: "end_turn", usage: usage(), content: [{ type: "text", text: "ok" }] }];
    await a.wake("react");
    expect(resultFor(a, "tu_1")).toBe(stubbed); // untouched second time around
    expect(resultFor(a, "tu_2").content).toBe(SUPERSEDED_STATE);
    expect(resultFor(a, "tu_3").content).toContain("stub");
  });

  test("a game restored from disk gets its stale snapshots collapsed", async () => {
    resetGameState();
    const a = new AgentRunner();
    a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
    a.restore({
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "old", name: "get_state", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "old", content: '{"a very large board":1}' }] },
        { role: "assistant", content: [{ type: "tool_use", id: "new", name: "get_state", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "new", content: '{"the current board":1}' }] },
      ],
    } as any);
    expect(resultFor(a, "old").content).toBe(SUPERSEDED_STATE);
    expect(resultFor(a, "new").content).toBe('{"the current board":1}');
  });
});

// Deliberation about a board the game has moved past is the largest thing left
// in the context. The plan still in flight is not, so the trim is graded.
describe("thinking from closed windows", () => {
  const thought = (text: string, tool?: string) => ({
    stop_reason: tool ? "tool_use" : "end_turn",
    usage: usage(),
    content: [
      { type: "thinking", thinking: text },
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

  test("the last two windows keep their reasoning, older ones lose it", async () => {
    resetGameState();
    const a = new AgentRunner();
    a.tableUrl = `http://localhost:${fakeTable.port}`;
    a.baseUrls = { anthropic: `http://localhost:${fakeAnthropic.port}` };
    a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
    for (const n of ["one", "two", "three", "four"]) {
      modelScript = [thought(`${n} a`, `tu_${n}`), thought(`${n} b`)];
      await a.wake("window");
    }
    // four windows: the two oldest are stripped, the newest two keep theirs
    expect(windows(a)).toEqual([0, 0, 2, 2]);
  });

  test("what the agent said and did survives the trim", async () => {
    resetGameState();
    const a = new AgentRunner();
    a.tableUrl = `http://localhost:${fakeTable.port}`;
    a.baseUrls = { anthropic: `http://localhost:${fakeAnthropic.port}` };
    a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
    for (const n of ["one", "two", "three"]) {
      modelScript = [thought(`${n} a`, `tu_${n}`), thought(`${n} b`)];
      await a.wake("window");
    }
    const blocks = a.messages.flatMap((m: any) => (Array.isArray(m.content) ? m.content : []));
    // the oldest window kept its action and its result, only the thought went
    expect(blocks.some((b: any) => b.type === "tool_use" && b.id === "tu_one")).toBe(true);
    expect(blocks.some((b: any) => b.type === "tool_result" && b.tool_use_id === "tu_one")).toBe(true);
    expect(blocks.some((b: any) => b.type === "thinking" && b.thinking === "one a")).toBe(false);
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
    trimOldThinking(messages);
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
    trimOldThinking(messages);
    expect(messages.flatMap((m) => m.content).filter((b: any) => b.type === "thinking")).toHaveLength(2);
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
      expect(transportChoice("deepseek-pro")).toBe("api");
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
      expect(transportChoice("deepseek")).toBe("api");
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

  test("a DeepSeek brain with no DeepSeek key stays dark — the Anthropic key is not its key", async () => {
    // ANTHROPIC_API_KEY is set for this whole file, and this machine may well
    // have a verified Claude Code login: neither one is a DeepSeek brain
    expect(transportChoice("deepseek")).toBe("none");
    expect(transportChoice("opus")).toBe("api");

    const a = sitDown("deepseek");
    await a.wake("window");
    expect(modelRequests.length).toBe(0);
    expect(a.busy).toBe(false);
    expect(a.brain.some((e) => e.kind === "error" && e.text.includes("DeepSeek"))).toBe(true);
  });

  test("an id the catalog does not know is passed to Anthropic verbatim", async () => {
    const a = sitDown("claude-opus-4-5-20251101");
    a.baseUrls = { anthropic: `http://localhost:${fakeAnthropic.port}` };
    modelScript = [{ stop_reason: "end_turn", usage: usage(), content: [{ type: "text", text: "ok" }] }];
    await a.wake("window");
    expect(modelRequests[0].body.model).toBe("claude-opus-4-5-20251101");
    expect(modelRequests[0].headers["x-api-key"]).toBe("sk-ant-test-key");
  });
});
