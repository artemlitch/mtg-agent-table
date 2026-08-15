// HTTP integration tests: spawn the real server on a test port with the agent
// harness disabled. Deck-loading tests hit Archidekt/Scryfall and are gated
// behind RUN_NET=1 (they need network):  RUN_NET=1 bun test
import { describe, test, expect, beforeAll, afterAll } from "bun:test";

const PORT = 4799;
const BASE = `http://localhost:${PORT}`;
let proc: Bun.Subprocess;

async function api(path: string, body?: any) {
  const res = await fetch(BASE + path, body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : undefined);
  return res.json() as Promise<any>;
}
const act = (actor: string, type: string, params: any = {}) =>
  api("/api/action", { actor, type, params });

beforeAll(async () => {
  proc = Bun.spawn(["bun", "run", new URL("../server/index.ts", import.meta.url).pathname], {
    env: { ...process.env, PORT: String(PORT), AGENT_DISABLED: "1" },
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
});

afterAll(() => {
  proc?.kill();
});

describe("api basics", () => {
  test("serves the frontend", async () => {
    const res = await fetch(BASE + "/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("MTG Agent Table");
  });

  test("rejects bad viewer", async () => {
    const res = await fetch(BASE + "/api/state?viewer=hacker");
    expect(res.status).toBe(400);
  });

  test("rejects bad actor and unknown action", async () => {
    expect((await act("nobody", "draw")).ok).toBeFalsy();
    expect((await act("you", "hack_mainframe")).ok).toBeFalsy();
  });

  test("life action round-trips through the API", async () => {
    const r = await act("you", "life", { player: "you", set: 40 });
    expect(r.life).toBe(40);
    const r2 = await act("agent", "life", { player: "you", delta: -3 });
    expect(r2.life).toBe(37);
  });

  test("chat appears in both views; brain endpoint responds", async () => {
    await act("you", "chat", { text: "hello agent" });
    const s = await api("/api/state?viewer=agent");
    expect(JSON.stringify(s.log)).toContain("hello agent");
    const b = await api("/api/brain");
    expect(b.busy).toBe(false);
  });
});

describe.if(!!process.env.RUN_NET)("deck loading (network)", () => {
  test("new_game loads two Archidekt decks, deals hands, redacts them", async () => {
    const r = await api("/api/new_game", { youDeck: 25353034, agentDeck: 25351001 });
    expect(r.ok).toBe(true);
    expect(r.you).toContain("Kotis");

    const you = await api("/api/state?viewer=you");
    const agent = await api("/api/state?viewer=agent");
    // 100-card decks: 1 commander, 7 in hand, 92 in library
    for (const view of [you, agent]) {
      for (const p of ["you", "agent"]) {
        expect(view.players[p].counts.command).toBe(1);
        expect(view.players[p].counts.hand).toBe(7);
        expect(view.players[p].counts.library).toBe(92);
      }
    }
    // each side sees own hand, not the other's
    expect(you.players.you.zones.hand.every((c: any) => !c.hidden)).toBe(true);
    expect(you.players.agent.zones.hand.every((c: any) => c.hidden)).toBe(true);
    expect(agent.players.agent.zones.hand.every((c: any) => !c.hidden)).toBe(true);
    expect(agent.players.you.zones.hand.every((c: any) => c.hidden)).toBe(true);
    // commanders are public and hydrated with images
    expect(you.players.agent.zones.command[0].name).toContain("Gonti");
    expect(you.players.agent.zones.command[0].image).toContain("scryfall");
  }, 60000);

  test("theft flow over the API: agent exiles my top card face-down, only agent sees it", async () => {
    const r = await act("agent", "move", {
      card: "top:you",
      toZone: "exile",
      toPlayer: "you",
      faceDown: true,
      revealTo: "agent",
      note: "Gonti trigger",
    });
    expect(r.ok).toBe(true);
    const you = await api("/api/state?viewer=you");
    const agent = await api("/api/state?viewer=agent");
    expect(you.players.you.zones.exile[0].hidden).toBe(true);
    expect(agent.players.you.zones.exile[0].hidden).toBe(false);
    expect(agent.players.you.zones.exile[0].name).toBeTruthy();
  });
});
