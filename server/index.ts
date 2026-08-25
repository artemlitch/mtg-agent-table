// Game server: REST + WebSocket + static frontend. Single source of truth.

import { game, applyAction, viewFor, resetGameState, addLog, renderLogFor, transcript, getSaid, setSaid, leanCard, openAttackDeclaration, openBlockDeclaration, type PlayerId } from "./game";
import { loadPlayerDeck, scryfallToken } from "./decks";
import { agent } from "./agent";
import { loadStateFile, scheduleSave, saveNow, serializeState } from "./persist";
import { archiveGame } from "./archive";
import { recordSnapshot, dropLastSnapshot, undoLast, redoLast, redoSize, historySize, clearHistory, getHistory, setHistory } from "./history";
import { saveKey, deleteKey, configuredKeys, setCliVerified, loadProvider, saveProvider, deleteProvider } from "./keystore";
import { resolveClaudeBin, transportChoice } from "./agent";
import { MODELS, PROVIDERS, isProviderId, probeUrl, type ProviderId } from "./models";
import { WakeScheduler, wakePlanFor } from "./wake";

import { STATE_FILE, GAMES_DIR } from "./datadir";

const PORT = Number(process.env.PORT ?? 4780);
const AGENT_DISABLED = process.env.AGENT_DISABLED === "1";
const WEB_DIR = new URL("../web/", import.meta.url).pathname;
// The sound definitions the lab edits. Two paths for one file: client/public
// is the copy in git — the one a rebuild copies FROM — and web/ is the one
// being served right now. Saving writes both, so a tuned sound is live on the
// next reload AND survives the next `vite build` instead of being overwritten
// by the stale source it was built from.
const SOUNDS_SRC = new URL("../client/public/sounds.json", import.meta.url).pathname;
const SOUNDS_WEB = WEB_DIR + "sounds.json";
const wakeAgent = (reason: "window" | "react" = "window") => {
  if (!AGENT_DISABLED) agent.wake(reason);
};
// The agent thinks once, when you stop moving — see wake.ts. Declared before
// broadcast() exists, so the change hook reaches it lazily.
const wakes = new WakeScheduler(wakeAgent, () => broadcast({ type: "update", seq: game.seq }));
agent.tableUrl = `http://localhost:${PORT}`;

let lastDecks: { you: number; agent: number } | null = null;

/** Actions that never become an undo step — see the note where it is used. */
const NOT_UNDOABLE = new Set(["place", "chat", "done", "mulligan"]);

// Everything persisted beside the game itself. A backup carries the table as
// it stands; the live state file adds the undo history.
const tableSnapshot = () => ({ agent: agent.serialize(), lastDecks, said: getSaid() });
const collectState = () => ({ ...tableSnapshot(), history: getHistory() });

const saveSoon = () => scheduleSave(STATE_FILE, collectState);

/** Park the game that is ending: a timestamped state backup plus a games/
 * archive entry (json + readable transcript). Returns the archive base path. */
async function backupAndArchive(): Promise<string | null> {
  const backup = STATE_FILE.replace(/\.json$/, "") + `-backup-${Date.now()}.json`;
  await Bun.write(backup, JSON.stringify(serializeState(tableSnapshot())));
  return await archiveGame(game, GAMES_DIR, Date.now(), getSaid()).catch((e) => {
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
    setSaid(restored.said);
    // a game saved before the prompt became rebuildable carries a frozen
    // string. Its inputs are all still on the table, so recover them and the
    // game in progress gets current rules instead of the ones it started with.
    if (!agent.promptArgs && game.started) {
      agent.promptArgs = {
        agentDeck: game.players.agent.deckName ?? "your deck",
        userDeck: game.players.you.deckName ?? "their deck",
        decklist: Object.values(game.cards)
          .filter((c) => c.owner === "agent")
          .map((c) => (c.isCommander ? `${c.name} (COMMANDER)` : c.name)),
      };
      agent.legacyPrompt = "";
    }
    console.log(`restored game from ${STATE_FILE} (turn ${game.turnNumber}, seq ${game.seq})`);
  }
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Is this shaped like the sound file? Returns the first thing wrong with it,
 *  or null. Deliberately structural rather than exhaustive — the lab is what
 *  writes this, and the job here is to refuse an empty or truncated body
 *  before it lands on top of a good file, not to police the numbers. */
function validateSounds(v: any): string | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "expected an object of sounds";
  const names = Object.keys(v);
  if (!names.length) return "no sounds — refusing to write an empty file";
  for (const name of names) {
    const def = v[name];
    if (!def || typeof def !== "object") return `${name}: not an object`;
    if (typeof def.desc !== "string") return `${name}: desc must be a string`;
    if (!Array.isArray(def.layers)) return `${name}: layers must be an array`;
    for (const [i, l] of def.layers.entries()) {
      if (!l || typeof l !== "object") return `${name} layer ${i + 1}: not an object`;
      if (l.kind !== "tone" && l.kind !== "noise") return `${name} layer ${i + 1}: kind must be tone or noise`;
      for (const [k, n] of Object.entries(l)) {
        if (typeof n === "number" && !Number.isFinite(n)) return `${name} layer ${i + 1}: ${k} is not a finite number`;
      }
    }
  }
  return null;
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
      if (viewer === "you" && !url.searchParams.get("lean")) {
        view.keys = configuredKeys();
        view.agentModel = agent.model;
        // "ready" is the same question the wake asks: would this model have a
        // brain if you picked it right now?
        view.models = Object.entries(MODELS).map(([value, m]) => ({
          value,
          name: m.name,
          note: m.note,
          provider: m.provider,
          ready: transportChoice(value) !== "none",
        }));
        view.agentTransport = transportChoice(agent.model);
        // the countdown the client draws above the composer. Only the deadline:
        // how long the wait was depends on what triggered it, and the bar
        // measures what is left rather than the fraction of a fixed span.
        view.wakeAt = wakes.wakeAt;
        view.cliInstalled = !!resolveClaudeBin();
        view.canRedo = redoSize() > 0;
        view.undoDepth = historySize();
      }
      return json(view);
    }

    if (path === "/api/brain") {
      return json({ entries: agent.brain, busy: agent.busy, usage: agent.usage });
    }

    // One key endpoint for every provider in the catalog — Anthropic and
    // DeepSeek differ by a query param. Keys are pasted in the UI, stored
    // server-side (0600 file in the data dir), and never sent back.
    const whichProvider = () => {
      const p = url.searchParams.get("provider") ?? "anthropic";
      return isProviderId(p) ? p : null;
    };
    if (path === "/api/key" && req.method === "GET") {
      return json({ keys: configuredKeys() });
    }
    if (path === "/api/key" && req.method === "POST") {
      let body: any = {};
      try {
        body = await req.json();
      } catch {}
      const id: ProviderId | null = isProviderId(body.provider) ? body.provider : whichProvider();
      if (!id) return json({ ok: false, error: "unknown provider" }, 400);
      // Claude plays on the subscription and nothing else (transportChoice),
      // so a stored Anthropic key could never be spent. Refusing it here is
      // what makes that a property of the app rather than a habit: no key,
      // no metered request, whatever anyone types into the box.
      if (id === "anthropic") {
        return json({ ok: false, error: "Claude runs on your Claude Code subscription here — there is no Anthropic key to paste." }, 400);
      }
      const provider = PROVIDERS[id];
      const key = String(body.key ?? "").trim();
      if (!provider.looksLikeKey(key)) {
        return json({ ok: false, error: `that doesn't look like a ${provider.name} API key (${provider.keyHint})` }, 400);
      }
      // spend one cheap request to find out now, rather than have the agent
      // sit down at the table and fail on its first window
      try {
        const res = await fetch(probeUrl(id), { headers: provider.probeHeaders(key) });
        if (res.status === 401 || res.status === 403) return json({ ok: false, error: `${provider.name} rejected that key` }, 400);
        if (!res.ok) return json({ ok: false, error: `could not validate key (HTTP ${res.status})` }, 502);
      } catch {
        return json({ ok: false, error: `could not reach ${provider.name} to validate the key` }, 502);
      }
      saveKey(id, key);
      broadcast({ type: "update", seq: game.seq });
      return json({ ok: true });
    }
    if (path === "/api/key" && req.method === "DELETE") {
      const id = whichProvider();
      if (!id) return json({ ok: false, error: "unknown provider" }, 400);
      deleteKey(id);
      broadcast({ type: "update", seq: game.seq });
      return json({ ok: true });
    }

    // custom provider: a Messages-compatible endpoint the catalog does not
    // know (OpenRouter, llama.cpp, LM Studio…). Configuring one outranks the
    // model picker and every other transport; the key never returns.
    if (path === "/api/provider" && req.method === "GET") {
      const p = loadProvider();
      return json(p ? { configured: true, baseUrl: p.baseUrl, model: p.model } : { configured: false });
    }
    if (path === "/api/provider" && req.method === "POST") {
      let body: any = {};
      try {
        body = await req.json();
      } catch {}
      const baseUrl = String(body.baseUrl ?? "").trim().replace(/\/$/, "");
      const apiKey = String(body.apiKey ?? "").trim();
      const model = String(body.model ?? "").trim();
      if (!/^https?:\/\//.test(baseUrl)) return json({ ok: false, error: "baseUrl must be an http(s) URL" }, 400);
      if (!apiKey || !model) return json({ ok: false, error: "apiKey and model are required" }, 400);
      saveProvider({ baseUrl, apiKey, model });
      broadcast({ type: "update", seq: game.seq });
      return json({ ok: true });
    }
    if (path === "/api/provider" && req.method === "DELETE") {
      deleteProvider();
      broadcast({ type: "update", seq: game.seq });
      return json({ ok: true });
    }

    // one-time Claude Code check: run a real tiny -p call on the machine's
    // own login; success marks the CLI as a usable transport
    if (path === "/api/claude/test" && req.method === "POST") {
      const bin = resolveClaudeBin();
      if (!bin) return json({ ok: false, error: "claude binary not found — install Claude Code first" }, 400);
      const proc = Bun.spawn([bin, "-p", "Reply with exactly: ok"], {
        env: { ...process.env, CLAUDECODE: undefined, CLAUDE_CODE_ENTRYPOINT: undefined, ANTHROPIC_API_KEY: undefined } as any,
        stdout: "pipe",
        stderr: "pipe",
      });
      const timeout = setTimeout(() => proc.kill(), 90000);
      const [out, err, code] = await Promise.all([
        new Response(proc.stdout as ReadableStream).text(),
        new Response(proc.stderr as ReadableStream).text(),
        proc.exited,
      ]);
      clearTimeout(timeout);
      if (code === 0 && out.trim()) {
        setCliVerified();
        broadcast({ type: "update", seq: game.seq });
        return json({ ok: true });
      }
      return json({ ok: false, error: (err || out || `claude exited ${code}`).trim().slice(0, 400) }, 400);
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
        // Sliding a card around the table changes nothing about the game, so
        // it does not wake the agent either — and neither does a mulligan,
        // which is the deal happening again rather than a move in the game.
        const cosmetic = body.type === "place" || body.type === "mulligan";
        // What cmd+Z steps back through. Undo is for taking back a PLAY, so
        // the things that are not plays stay out of the history: layout,
        // conversation, and passing priority — nobody reaches for undo to
        // un-pass a turn, and a pass between every action turns one undo into
        // three.
        // ...and neither is adding a creature to a declaration you are still
        // making. Declaring attackers is one act however many creatures it
        // names, so while the declaration is open on the stack, another
        // attacker continues the step already recorded rather than starting a
        // new one — one press takes the whole attack back, which is how the
        // UI has always described it ("Finish declaring attackers").
        // ...and the same for blockers, which are declared a creature at a
        // time from the other side of the combat.
        const continues =
          (body.type === "attack" && !!openAttackDeclaration(actor)) ||
          (body.type === "block" && !!openBlockDeclaration(actor));
        const undoable = !NOT_UNDOABLE.has(body.type) && !continues;
        if (undoable) recordSnapshot();
        // who held priority BEFORE this — done overwrites it, and the wake
        // policy needs to know whether a pass actually handed anything over
        const heldPriority = game.waitingOn;
        let result;
        try {
          result = applyAction(actor, body.type, body.params);
        } catch (e) {
          if (undoable) dropLastSnapshot();
          throw e;
        }
        saveSoon();
        // Wake policy lives in wake.ts — which actions are worth a window, and
        // how long each one waits first. Armed or not, the countdown restarts
        // on anything you do: a run of taps is one window, not one per tap.
        // Scheduled BEFORE the broadcast so the update carries the new deadline
        // for the client's countdown.
        if (actor === "you" && game.started && !cosmetic) {
          const { reason, delay } = wakePlanFor(body.type, game.turn === "agent", heldPriority ?? undefined);
          if (reason) wakes.schedule(reason, delay);
          else wakes.defer(delay);
        }
        broadcast({ type: "update", seq: game.seq });
        // mid-window injection: anything Player did/said while the agent was
        // working rides back inside the agent's next tool result, so it can
        // factor the new information in BEFORE continuing its line of play
        if (actor === "agent" && agent.busy) {
          const fresh = transcript().filter((e) => e.seq > agent.lastSeenSeq && e.actor === "you");
          if (fresh.length) {
            (result as any).NEW_FROM_PLAYER_WHILE_YOU_WERE_ACTING = fresh.map(
              (e) => `[${e.seq}] ${renderLogFor(e, "agent").text}`
            );
            (result as any).note =
              "Player acted or spoke while you were working — read the entries above and factor them in before continuing.";
            agent.lastSeenSeq = game.seq;
          }
        }
        return json(result);
      } catch (e: any) {
        return json({ ok: false, error: e.message }, 400);
      }
    }

    // You are mid-sentence in the composer. Not an event — nothing happened at
    // the table, nothing is logged, nothing is undoable — but it is proof you
    // have not finished, so a countdown already running waits for you.
    //
    // defer() and not schedule(): typing must never CREATE a window. Idle
    // keystrokes with nothing pending would otherwise summon the agent, and
    // typing into a chat you decide not to send would wake it for nothing.
    //
    // It matters most right after a message, where the wait is 300ms: that is
    // short because pressing enter says you are finished, and it is exactly
    // wrong when you are already typing the next line.
    if (path === "/api/typing" && req.method === "POST") {
      wakes.defer();
      return json({ ok: true, wakeAt: wakes.wakeAt });
    }

    if (path === "/api/undo" && req.method === "POST") {
      const undone = undoLast();
      if (undone === null) return json({ ok: false, error: "nothing to undo" }, 400);
      addLog("system", `↩ Player undid: ${undone}`);
      saveSoon();
      // Undo does not wake the agent — it would act immediately and pile new
      // state on top, making it impossible to keep rewinding. It also calls
      // OFF a wake that is already armed: undo is strictly last-in-first-out,
      // so the action being rewound is the one that armed it. Nothing happened,
      // so there is nothing to answer.
      wakes.cancel();
      // ...and the window comes back with it. A pass survives a rewind on
      // purpose (see restore in history.ts) — it is something said, not
      // something played. But that only holds if it was HEARD. The wake this
      // pass armed was just cancelled two lines up, so the agent never got
      // the window and never will: nothing is thinking and nothing is
      // scheduled. Leaving waitingOn on the agent then is a deadlock — the
      // client's finish-attacks step reads it and shows "waiting on the
      // agent" instead of the button, and the table sits with each side
      // expecting the other. Undoing an attack declaration wedged a real game
      // exactly this way.
      if (game.waitingOn === "agent" && !agent.busy) game.waitingOn = "you";
      broadcast({ type: "update", seq: game.seq });
      return json({ ok: true, undone });
    }

    if (path === "/api/redo" && req.method === "POST") {
      const redone = redoLast();
      if (redone === null) return json({ ok: false, error: "nothing to redo" }, 400);
      addLog("system", `↪ Player redid: ${redone}`);
      saveSoon();
      wakes.defer();
      broadcast({ type: "update", seq: game.seq });
      return json({ ok: true, redone });
    }

    // end the current game now: archive it and clear the table (no new decks)
    if (path === "/api/end_game" && req.method === "POST") {
      if (!game.started) return json({ ok: false, error: "no game in progress" }, 400);
      const archived = await backupAndArchive();
      resetGameState();
      clearHistory();
      wakes.cancel();
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
        addLog("system", "Opening hands drawn. Player goes first (no draw on turn 1).");

        const decklist = theirs.cards.flatMap((c) => Array(1).fill(c.isCommander ? `${c.name} (COMMANDER)` : c.name));
        agent.reset({ agentDeck: theirs.name, decklist, userDeck: yours.name });
        if (body.model) agent.model = body.model;
        saveSoon();
        wakes.cancel(); // nothing from the last game gets to fire into this one
        broadcast({ type: "update", seq: game.seq });
        // let the agent look at its hand and decide keep/mull — the only wake
        // that skips the countdown, since you did not act to cause it
        queueMicrotask(wakeAgent);
        return json({ ok: true, you: yours.name, agent: theirs.name });
      } catch (e: any) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    // The sound lab saving ONE sound. A dev tool writing a source file, so it
    // is fussy about what it accepts: this is the only endpoint in the server
    // that puts bytes into the checkout, and a malformed write here is a
    // silent table and a file to hand-repair.
    //
    // Read, replace one key, write back — so saving `draw` cannot touch a
    // `block` you were half-way through, and two lab tabs cannot overwrite
    // each other with a whole-file snapshot each took minutes ago.
    if (path === "/api/sounds" && req.method === "POST") {
      let body: any;
      try {
        body = await req.json();
      } catch {
        return json({ ok: false, error: "bad json" }, 400);
      }
      const name = body?.name;
      // a plain identifier: it becomes a key on an object we build, and
      // "__proto__" is a key that does not behave like a key
      if (typeof name !== "string" || !/^[a-z][a-z0-9]{0,31}$/i.test(name)) {
        return json({ ok: false, error: "name must be a plain identifier" }, 400);
      }
      const bad = validateSounds({ [name]: body?.sound });
      if (bad) return json({ ok: false, error: bad }, 400);
      try {
        // the file on disk is what we merge into — never the copy the browser
        // is holding, which is the whole point of saving one at a time
        const current = await Bun.file(SOUNDS_SRC).json();
        const merged = { ...current, [name]: body.sound };
        const text = JSON.stringify(merged, null, 2) + "\n";
        await Bun.write(SOUNDS_SRC, text);
        await Bun.write(SOUNDS_WEB, text);
        // byteLength, not length: the descriptions are full of em-dashes, and
        // a count of UTF-16 units reported 7042 for a 7060-byte file
        return json({ ok: true, saved: name, sounds: Object.keys(merged).length, bytes: Buffer.byteLength(text) });
      } catch (e: any) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    // static frontend
    //
    // no-cache, meaning "you may keep it, but ask me before you use it". Vite
    // hashes the bundle, so THAT is safe to cache forever — but everything
    // beside it is served under a fixed name: index.html, sfx.js, sounds.json,
    // the vendored icon sheet. Nothing here sent a validator, so a browser
    // that had once loaded sfx.js was free to go on using it, and a table
    // holding the version from before the sounds moved into a file never
    // fetched sounds.json at all: every tuned sound landed on disk, was served
    // correctly, and was inaudible.
    const file = path === "/" ? "index.html" : path.slice(1);
    if (/^[\w.-]+(\/[\w.-]+)*$/.test(file) && !file.includes("..")) {
      const f = Bun.file(WEB_DIR + file);
      if (await f.exists()) return new Response(f, { headers: { "Cache-Control": "no-cache" } });
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
