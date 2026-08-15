// Game server: REST + WebSocket + static frontend. Single source of truth.

import { game, applyAction, viewFor, resetGameState, addLog, type PlayerId } from "./game";
import { loadPlayerDeck, scryfallToken } from "./decks";
import { agent, buildSystemPrompt } from "./agent";
import { loadStateFile, scheduleSave, saveNow, serializeState } from "./persist";
import { recordSnapshot, dropLastSnapshot, undoLast, clearHistory } from "./history";

const PORT = Number(process.env.PORT ?? 4780);
const AGENT_DISABLED = process.env.AGENT_DISABLED === "1";
const WEB_DIR = new URL("../web/", import.meta.url).pathname;
const STATE_FILE = process.env.STATE_FILE ?? new URL("../state.json", import.meta.url).pathname;
const wakeAgent = (reason: "window" | "react" = "window") => {
  if (!AGENT_DISABLED) agent.wake(reason);
};

let lastDecks: { you: number; agent: number } | null = null;

const saveSoon = () =>
  scheduleSave(STATE_FILE, () => ({ agent: agent.serialize(), lastDecks }));

{
  const restored = await loadStateFile(STATE_FILE);
  if (restored) {
    if (restored.agent) agent.restore(restored.agent);
    lastDecks = restored.lastDecks;
    console.log(`restored game from ${STATE_FILE} (turn ${game.turnNumber}, seq ${game.seq})`);
  }
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 120,
  async fetch(req, srv) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/ws") {
      if (srv.upgrade(req)) return undefined as any;
      return new Response("ws upgrade failed", { status: 400 });
    }

    if (path === "/api/state") {
      const viewer = (url.searchParams.get("viewer") ?? "you") as PlayerId;
      if (viewer !== "you" && viewer !== "agent") return json({ error: "bad viewer" }, 400);
      return json(viewFor(viewer, viewer === "agent" ? 60 : 200));
    }

    if (path === "/api/brain") {
      return json({ entries: agent.brain, busy: agent.busy });
    }

    if (path === "/api/action" && req.method === "POST") {
      let body: any;
      try {
        body = await req.json();
      } catch {
        return json({ ok: false, error: "bad json" }, 400);
      }
      const actor = body.actor as PlayerId;
      if (actor !== "you" && actor !== "agent") return json({ ok: false, error: "bad actor" }, 400);
      try {
        // enrich tokens with scryfall art when available (exact token match only)
        if (body.type === "create_token" && !body.params?.image) {
          const info = await scryfallToken(body.params.name).catch(() => null);
          if (info) {
            body.params = { ...body.params, image: info.image, oracle: info.oracle, typeLine: info.typeLine, power: body.params.power ?? info.power, toughness: body.params.toughness ?? info.toughness };
          }
        }
        const cosmetic = body.type === "place";
        if (!cosmetic) recordSnapshot();
        let result;
        try {
          result = applyAction(actor, body.type, body.params);
        } catch (e) {
          if (!cosmetic) dropLastSnapshot();
          throw e;
        }
        saveSoon();
        broadcast({ type: "update", seq: game.seq });
        // every user action passes priority to the agent: full window on
        // done/chat, reaction window on everything else. Drags are cosmetic.
        if (actor === "you" && game.started && !cosmetic) {
          const reason = body.type === "done" || body.type === "chat" ? "window" : "react";
          queueMicrotask(() => wakeAgent(reason));
        }
        return json(result);
      } catch (e: any) {
        return json({ ok: false, error: e.message }, 400);
      }
    }

    if (path === "/api/undo" && req.method === "POST") {
      const undone = undoLast();
      if (undone === null) return json({ ok: false, error: "nothing to undo" }, 400);
      addLog("system", `↩ Artem undid: ${undone}`);
      saveSoon();
      broadcast({ type: "update", seq: game.seq });
      if (game.started) queueMicrotask(() => wakeAgent("react"));
      return json({ ok: true, undone });
    }

    if (path === "/api/new_game" && req.method === "POST") {
      let body: any = {};
      try {
        body = await req.json();
      } catch {}
      const youDeck = Number(body.youDeck ?? lastDecks?.you);
      const agentDeck = Number(body.agentDeck ?? lastDecks?.agent);
      if (!youDeck || !agentDeck) return json({ ok: false, error: "youDeck and agentDeck required" }, 400);
      try {
        // never lose a game to a reset: back up the old one first
        if (game.started) {
          const backup = STATE_FILE.replace(/\.json$/, "") + `-backup-${Date.now()}.json`;
          await Bun.write(backup, JSON.stringify(serializeState({ agent: agent.serialize(), lastDecks })));
          addLog("system", `(previous game backed up)`);
        }
        resetGameState();
        clearHistory();
        agent.kill();
        addLog("system", "— New game — both players at 40 life —");
        const [yours, theirs] = await Promise.all([
          loadPlayerDeck("you", youDeck),
          loadPlayerDeck("agent", agentDeck),
        ]);
        lastDecks = { you: youDeck, agent: agentDeck };
        // opening hands
        applyAction("you", "draw", { n: 7 });
        applyAction("agent", "draw", { player: "agent", n: 7 });
        game.started = true;
        game.waitingOn = "you";
        addLog("system", "Opening hands drawn. Artem goes first (no draw on turn 1).");

        const decklist = theirs.cards.flatMap((c) => Array(1).fill(c.isCommander ? `${c.name} (COMMANDER)` : c.name));
        agent.reset(buildSystemPrompt(theirs.name, decklist, yours.name));
        if (body.model) agent.model = body.model;
        saveSoon();
        broadcast({ type: "update", seq: game.seq });
        // let the agent look at its hand and decide keep/mull
        queueMicrotask(wakeAgent);
        return json({ ok: true, you: yours.name, agent: theirs.name });
      } catch (e: any) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    // static frontend
    const file = path === "/" ? "index.html" : path.slice(1);
    if (/^[\w.-]+$/.test(file)) {
      const f = Bun.file(WEB_DIR + file);
      if (await f.exists()) return new Response(f);
    }
    return new Response("not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      ws.subscribe("table");
    },
    message() {},
    close() {},
  },
});

function broadcast(msg: any) {
  server.publish("table", JSON.stringify(msg));
}

agent.onBrain((entry) => {
  saveSoon();
  broadcast({ type: "brain", entry, busy: agent.busy });
});

// flush state on shutdown so kills never lose the debounce window
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await saveNow(STATE_FILE, () => ({ agent: agent.serialize(), lastDecks }));
    process.exit(0);
  });
}

console.log(`mtg-agent-table listening on http://localhost:${PORT}`);
