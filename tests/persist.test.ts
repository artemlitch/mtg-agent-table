// Persistence: game + agent state must survive a server restart.
import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { game, resetGameState, applyAction, newCardId } from "../server/game";
import { serializeState, restoreState } from "../server/persist";
import { AgentRunner } from "../server/agent";

const TMP = "/tmp/mtg-table-test-state.json";

beforeEach(() => {
  resetGameState();
});

describe("state serialization", () => {
  test("round-trips game state including cards, log, and life", () => {
    applyAction("you", "create_token", { name: "Treasure", n: 2 });
    applyAction("you", "life", { player: "you", delta: -5 });
    applyAction("you", "chat", { text: "checkpoint" });
    const tokenIds = [...game.players.you.zones.battlefield];
    const snap = serializeState({ agent: null, lastDecks: { you: 1, agent: 2 } });

    resetGameState();
    expect(game.players.you.life).toBe(40);

    const extra = restoreState(JSON.parse(JSON.stringify(snap)));
    expect(game.players.you.life).toBe(35);
    expect(game.players.you.zones.battlefield).toEqual(tokenIds);
    expect(game.cards[tokenIds[0]].name).toBe("Treasure");
    expect(game.log.at(-1)!.text).toContain("checkpoint");
    expect(extra.lastDecks).toEqual({ you: 1, agent: 2 });
  });

  test("card id counter survives: no id collisions after restore", () => {
    applyAction("you", "create_token", { name: "Clue", n: 3 });
    const snap = serializeState({ agent: null, lastDecks: null });
    resetGameState();
    restoreState(snap);
    const fresh = newCardId();
    expect(game.cards[fresh]).toBeUndefined();
    expect(Object.keys(game.cards)).not.toContain(fresh);
  });

  test("agent runner state round-trips", () => {
    const a = new AgentRunner();
    a.sessionId = "sess-123";
    a.systemPrompt = "you are gonti";
    a.model = "opus";
    a.lastSeenSeq = 42;
    a.push("text", "I am thinking");
    const snap = serializeState({ agent: a.serialize(), lastDecks: null });

    const b = new AgentRunner();
    const extra = restoreState(JSON.parse(JSON.stringify(snap)));
    b.restore(extra.agent!);
    expect(b.sessionId).toBe("sess-123");
    expect(b.systemPrompt).toBe("you are gonti");
    expect(b.lastSeenSeq).toBe(42);
    expect(b.brain.at(-1)!.text).toBe("I am thinking");
    // brain seq continues without collision
    b.push("text", "next");
    expect(b.brain.at(-1)!.seq).toBeGreaterThan(b.brain.at(-2)!.seq);
  });
});

describe("server restart integration", () => {
  const PORT = 4798;
  const BASE = `http://localhost:${PORT}`;
  let proc: Bun.Subprocess | null = null;

  async function startServer() {
    proc = Bun.spawn(["bun", "run", new URL("../server/index.ts", import.meta.url).pathname], {
      env: { ...process.env, PORT: String(PORT), AGENT_DISABLED: "1", STATE_FILE: TMP },
      stdout: "pipe",
      stderr: "pipe",
    });
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(BASE + "/api/state?viewer=you");
        return;
      } catch {
        await Bun.sleep(100);
      }
    }
    throw new Error("server did not start");
  }
  const act = async (type: string, params: any = {}) => {
    const res = await fetch(BASE + "/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor: "you", type, params }),
    });
    return res.json() as Promise<any>;
  };

  afterAll(async () => {
    proc?.kill();
    await Bun.file(TMP).exists() && (await Bun.write(TMP, "")); // scrub
  });

  test("game survives a kill and restart", async () => {
    await Bun.write(TMP, ""); // start clean
    await startServer();
    await act("create_token", { name: "Treasure", n: 1 });
    await act("life", { player: "agent", delta: -7 });
    await act("chat", { text: "persist me" });
    await Bun.sleep(400); // allow debounced save

    proc!.kill();
    await proc!.exited;
    await startServer();

    const res = await fetch(BASE + "/api/state?viewer=you");
    const s: any = await res.json();
    expect(s.players.agent.life).toBe(33);
    expect(s.players.you.zones.battlefield.map((c: any) => c.name)).toEqual(["Treasure"]);
    expect(JSON.stringify(s.log)).toContain("persist me");
  }, 20000);
});

describe("saveNow", () => {
  test("writes the full snapshot synchronously", async () => {
    const { saveNow } = await import("../server/persist");
    resetGameState();
    applyAction("you", "life", { player: "you", delta: -4 });
    const path = "/tmp/mtg-table-savenow-test.json";
    await saveNow(path, () => ({ agent: null, lastDecks: null }));
    const snap = await Bun.file(path).json();
    expect(snap.game.players.you.life).toBe(36);
  });
});
