// Persistence: game + agent state must survive a server restart.
import { describe, test, expect, beforeEach, afterAll } from "vitest";
import { game, resetGameState, applyAction, newCardId, getSaid } from "../server/game";
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
    const snap = serializeState({ agent: null, lastDecks: { you: 1, agent: 2 }, said: getSaid() });

    resetGameState();
    expect(game.players.you.life).toBe(40);

    const extra = restoreState(JSON.parse(JSON.stringify(snap)));
    expect(game.players.you.life).toBe(35);
    expect(game.players.you.zones.battlefield).toEqual(tokenIds);
    expect(game.cards[tokenIds[0]].name).toBe("Treasure");
    expect(game.log.at(-1)!.text).toContain("life is now 35");
    expect(extra.lastDecks).toEqual({ you: 1, agent: 2 });
    // the conversation rides alongside the game, never inside it
    expect(extra.said!.some((e: any) => e.text.includes("checkpoint"))).toBe(true);
  });

  test("a game snapshot carries no conversation — that is what keeps undo off it", () => {
    applyAction("you", "life", { player: "you", delta: -1 });
    applyAction("you", "chat", { text: "not a play" });
    // the shape history.ts snapshots with: game only, no extras
    const snap = serializeState({ agent: null, lastDecks: null });
    expect(JSON.stringify(snap.game)).not.toContain("not a play");
    expect(snap.said).toBeUndefined();
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

  test("legacy attachedTo migrates to under, fans linearize into chains", () => {
    applyAction("you", "create_token", { name: "Bearer", n: 1 });
    applyAction("you", "create_token", { name: "Sword", n: 1 });
    applyAction("you", "create_token", { name: "Shield", n: 1 });
    const [bearer, sword, shield] = [...game.players.you.zones.battlefield];
    const snap = serializeState({ agent: null, lastDecks: null });
    // rewrite the snapshot into the old shape: two cards attached to one target
    for (const [id, tgt] of [[sword, bearer], [shield, bearer]] as const) {
      const c = snap.game.cards[id];
      delete c.under;
      c.attachedTo = tgt;
    }
    delete snap.game.cards[bearer].under;
    snap.game.cards[bearer].attachedTo = null;

    resetGameState();
    restoreState(snap);
    const cards = game.cards as any;
    expect(cards[sword].attachedTo).toBeUndefined();
    // linear pile: bearer on top, the fan chained beneath it one per rung
    expect(cards[sword].under).toBe(bearer);
    expect(cards[shield].under).toBe(sword);
  });

  test("agent runner state round-trips", () => {
    const a = new AgentRunner();
    a.promptArgs = { agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" };
    a.model = "opus";
    a.lastSeenSeq = 42;
    a.messages = [{ role: "user", content: [{ type: "text", text: "the game has started" }] }];
    a.push("text", "I am thinking");
    const snap = serializeState({ agent: a.serialize(), lastDecks: null });

    const b = new AgentRunner();
    const extra = restoreState(JSON.parse(JSON.stringify(snap)));
    b.restore(extra.agent!);
    expect(b.messages.length).toBe(1);
    expect(b.messages[0].content[0].text).toBe("the game has started");
    // the prompt is rebuilt from its inputs, not restored as a frozen string,
    // so a rules edit reaches a game already in progress
    expect(b.promptArgs).toEqual({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
    expect(b.systemPrompt).toContain("Gonti");
    expect(b.systemPrompt).toContain("Sol Ring");
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

describe("undo history survives restarts", () => {
  test("history is serialized and restored", async () => {
    const { recordSnapshot, clearHistory, historySize, getHistory, setHistory, undoLast } = await import("../server/history");
    resetGameState();
    clearHistory();
    recordSnapshot();
    applyAction("you", "life", { player: "you", delta: -9 });
    expect(game.players.you.life).toBe(31);
    const saved = getHistory();
    expect(saved.length).toBe(1);

    // simulate a restart: fresh state, history reloaded from disk
    const snapshot = JSON.parse(JSON.stringify({ game, history: saved }));
    resetGameState();
    clearHistory();
    Object.assign(game, snapshot.game);
    setHistory(snapshot.history);
    expect(historySize()).toBe(1);
    undoLast();
    expect(game.players.you.life).toBe(40);
  });
});

describe("atomic saves", () => {
  test("saveNow leaves no tmp file and the target always parses", async () => {
    const { saveNow } = await import("../server/persist");
    const path = "/tmp/mtg-table-atomic-test.json";
    await saveNow(path, () => ({ agent: null, lastDecks: null }));
    expect(await Bun.file(path + ".tmp").exists()).toBe(false);
    JSON.parse(await Bun.file(path).text()); // throws if truncated
  });

  test("a pre-existing good file survives a save that produces empty output", async () => {
    // simulate the truncation scenario: good file on disk, then a save writes
    // via tmp+rename — a killed process leaves the tmp, never the target
    const { saveNow } = await import("../server/persist");
    const path = "/tmp/mtg-table-atomic-keep.json";
    await saveNow(path, () => ({ agent: null, lastDecks: null }));
    const before = await Bun.file(path).text();
    await Bun.write(path + ".tmp", ""); // stale tmp from a killed writer
    const after = await Bun.file(path).text();
    expect(after).toBe(before);
  });
});
