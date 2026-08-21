// Game server: REST + WebSocket + static frontend. Single source of truth.

import { game, applyAction, viewFor, resetGameState, addLog, renderLogFor, leanCard, type PlayerId } from "./game";
import { loadPlayerDeck, scryfallToken } from "./decks";
import { agent, buildSystemPrompt } from "./agent";
import { loadStateFile, scheduleSave, saveNow, serializeState } from "./persist";
import { archiveGame } from "./archive";
import { recordSnapshot, dropLastSnapshot, undoLast, clearHistory, getHistory, setHistory } from "./history";

import { STATE_FILE, GAMES_DIR } from "./datadir";

const PORT = Number(process.env.PORT ?? 4780);
const AGENT_DISABLED = process.env.AGENT_DISABLED === "1";
const WEB_DIR = new URL("../web/", import.meta.url).pathname;
const wakeAgent = (reason: "window" | "react" = "window") => {
  if (!AGENT_DISABLED) agent.wake(reason);
};
agent.tableUrl = `http://localhost:${PORT}`;

let lastDecks: { you: number; agent: number } | null = null;

// Everything persisted beside the game itself. A backup carries the table as
// it stands; the live state file adds the undo history.
const tableSnapshot = () => ({ agent: agent.serialize(), lastDecks });
const collectState = () => ({ ...tableSnapshot(), history: getHistory() });

const saveSoon = () => scheduleSave(STATE_FILE, collectState);

/** Park the game that is ending: a timestamped state backup plus a games/
 * archive entry (json + readable transcript). Returns the archive base path. */
async function backupAndArchive(): Promise<string | null> {
  const backup = STATE_FILE.replace(/\.json$/, "") + `-backup-${Date.now()}.json`;
  await Bun.write(backup, JSON.stringify(serializeState(tableSnapshot())));
  return await archiveGame(game, GAMES_DIR).catch((e) => {
    console.error("archive failed:", e);
    return null;
  });
}

{
  const restored = await loadStateFile(STATE_FILE);
  if (restored) {
    if (restored.agent) agent.restore(restored.agent);
    lastDecks = restored.lastDecks;
    setHistory(restored.history ?? []);
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
      const view: any = { ...viewFor(viewer, viewer === "agent" ? 60 : 200), lastDecks, tokenCatalog: game.tokenCatalog };
      // lean view for the agent: hidden library/hand stubs carry zero information
      // beyond the zone counts, and image urls are for human eyes only
      if (url.searchParams.get("lean")) {
        for (const p of Object.values<any>(view.players)) {
          for (const z of Object.keys(p.zones)) {
            let cards = p.zones[z];
            if (z === "library" || z === "hand") cards = cards.filter((c: any) => !c.hidden);
            p.zones[z] = cards.map((c: any) => leanCard(c));
          }
        }
        view.tokenCatalog = Object.fromEntries(
          Object.entries<any>(view.tokenCatalog).map(([k, { image, ...t }]) => [k, t])
        );
        delete view.lastDecks;
      }
      return json(view);
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
        // enrich tokens with scryfall art when the deck catalog doesn't have them
        if (
          body.type === "create_token" &&
          !body.params?.image &&
          !game.tokenCatalog[String(body.params?.name ?? "").toLowerCase()]
        ) {
          const info = await scryfallToken(body.params.name).catch(() => null);
          if (info) {
            body.params = { ...body.params, image: info.image, oracle: body.params.oracle ?? info.oracle, typeLine: body.params.typeLine ?? info.typeLine, power: body.params.power ?? info.power, toughness: body.params.toughness ?? info.toughness };
          }
        }
        const cosmetic = body.type === "place";
        // chat is conversation, not a game action — it never becomes an undo step
        const undoable = !cosmetic && body.type !== "chat";
        if (undoable) recordSnapshot();
        let result;
        try {
          result = applyAction(actor, body.type, body.params);
        } catch (e) {
          if (undoable) dropLastSnapshot();
          throw e;
        }
        saveSoon();
        broadcast({ type: "update", seq: game.seq });
        // mid-window injection: anything Player did/said while the agent was
        // working rides back inside the agent's next tool result, so it can
        // factor the new information in BEFORE continuing its line of play
        if (actor === "agent" && agent.busy) {
          const fresh = game.log.filter((e) => e.seq > agent.lastSeenSeq && e.actor === "you");
          if (fresh.length) {
            (result as any).NEW_FROM_PLAYER_WHILE_YOU_WERE_ACTING = fresh.map(
              (e) => `[${e.seq}] ${renderLogFor(e, "agent").text}`
            );
            (result as any).note =
              "Player acted or spoke while you were working — read the entries above and factor them in before continuing.";
            agent.lastSeenSeq = game.seq;
          }
        }
        // Wake policy. Every wake costs a fresh CLI spawn + a full-context
        // inference (10s+, and it grows the session that slows later wakes),
        // so only response-worthy actions wake the agent:
        // - full window on done/chat, and on ANY action during the agent's
        //   turn (acting hands the table back so it continues its turn)
        // - reaction window on stack traffic and combat during YOUR turn
        // - everything else (draws, taps, life, moves, phases) just lands in
        //   the log and is seen at the agent's next wake
        if (actor === "you" && game.started && !cosmetic) {
          const REACTIVE = new Set([
            "cast", "stack_push", "stack_batch", "stack_resolve", "stack_resolve_all",
            "stack_counter", "stack_remove", "attack", "block", "set_turn", "create_token",
          ]);
          if (body.type === "done" || body.type === "chat" || game.turn === "agent") {
            queueMicrotask(() => wakeAgent("window"));
          } else if (REACTIVE.has(body.type)) {
            queueMicrotask(() => wakeAgent("react"));
          }
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
      // deliberately NOT waking the agent: it would act immediately and pile
      // new state on top, making it impossible to keep rewinding
      return json({ ok: true, undone });
    }

    // end the current game now: archive it and clear the table (no new decks)
    if (path === "/api/end_game" && req.method === "POST") {
      if (!game.started) return json({ ok: false, error: "no game in progress" }, 400);
      const archived = await backupAndArchive();
      resetGameState();
      clearHistory();
      agent.kill();
      addLog("system", "— Game ended and archived —");
      saveSoon();
      broadcast({ type: "update", seq: game.seq });
      return json({ ok: true, archived });
    }

    if (path === "/api/new_game" && req.method === "POST") {
      let body: any = {};
      try {
        body = await req.json();
      } catch {}
      // accept a bare id or any archidekt.com URL
      const parseDeckRef = (v: unknown) => Number(String(v ?? "").match(/(\d{4,})/)?.[1] ?? NaN);
      const youDeck = parseDeckRef(body.youDeck ?? lastDecks?.you);
      const agentDeck = parseDeckRef(body.agentDeck ?? lastDecks?.agent);
      if (!youDeck || !agentDeck) return json({ ok: false, error: "youDeck and agentDeck required (Archidekt URL or deck id)" }, 400);
      try {
        // never lose a game to a reset: back up the old one first, and file it
        // into the games/ archive (json + readable transcript) for analysis
        if (game.started) {
          const archived = await backupAndArchive();
          addLog("system", `(previous game backed up${archived ? ` and archived: ${archived.split("/").pop()}` : ""})`);
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
    if (/^[\w.-]+(\/[\w.-]+)*$/.test(file) && !file.includes("..")) {
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
    await saveNow(STATE_FILE, collectState);
    process.exit(0);
  });
}

console.log(`mtg-agent-table listening on http://localhost:${PORT}`);
