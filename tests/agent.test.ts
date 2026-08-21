// The Messages-API transport: tool loop, cache breakpoints, auth headers,
// preemption bookkeeping — against a scripted fake Anthropic endpoint and a
// stub table server, no network.
import { describe, test, expect, beforeAll, afterAll } from "bun:test";

process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";

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

const { AgentRunner } = await import("../server/agent");
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
    a.apiUrl = `http://localhost:${fakeAnthropic.port}`;
    a.reset("SYSTEM PROMPT");
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
    process.env.ANTHROPIC_KEY_FILE = "/tmp/mtg-agent-nonexistent-key";
    process.env.CLAUDE_BIN = "/tmp/mtg-agent-nonexistent-claude";
    try {
      const a = new AgentRunner();
      a.reset("SYSTEM");
      modelRequests.length = 0;
      await a.wake("window");
      expect(a.busy).toBe(false);
      expect(a.brain.some((e) => e.kind === "error" && e.text.includes("API key"))).toBe(true);
      expect(modelRequests.length).toBe(0);
    } finally {
      process.env.ANTHROPIC_API_KEY = saved;
      delete process.env.ANTHROPIC_KEY_FILE;
      delete process.env.CLAUDE_BIN;
    }
  });

  test("mid-game model switch strips thinking blocks from the replayed history", async () => {
    resetGameState();
    const a = new AgentRunner();
    a.tableUrl = `http://localhost:${fakeTable.port}`;
    a.apiUrl = `http://localhost:${fakeAnthropic.port}`;
    a.reset("SYSTEM");
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

  test("401 from Anthropic surfaces as a key error and closes the window", async () => {
    const bad = Bun.serve({
      port: 0,
      fetch: () => new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), { status: 401 }),
    });
    try {
      const a = new AgentRunner();
      a.tableUrl = `http://localhost:${fakeTable.port}`;
      a.apiUrl = `http://localhost:${bad.port}`;
      a.reset("SYSTEM");
      await a.wake("window");
      expect(a.busy).toBe(false);
      expect(a.brain.some((e) => e.kind === "error" && e.text.includes("rejected the API key"))).toBe(true);
    } finally {
      bad.stop(true);
    }
  });
});
