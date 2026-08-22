// Standalone deck-studio server — LOCAL-ONLY, fully separate from the table
// app that ships in Electron. Serves the /swap page and the studio API on its
// own port with its own persistence; Archidekt credentials only ever matter
// here. Run: bun run server/studio-server.ts
import * as studio from "./deckstudio";
import { cardSearch, cardLookup, edhrecCommander } from "./cardsearch";
import { DATA_DIR } from "./datadir";
import { join } from "node:path";
import { existsSync } from "node:fs";

const PORT = Number(process.env.STUDIO_PORT ?? 4781);
const WEB_DIR = new URL("../web/", import.meta.url).pathname;
const STATE_FILE = join(DATA_DIR, "studio.json");

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveSoon() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    Bun.write(STATE_FILE, JSON.stringify({ studio: studio.serializeStudio() }));
  }, 300);
}

{
  let snap: any = null;
  if (existsSync(STATE_FILE)) snap = await Bun.file(STATE_FILE).json().catch(() => null);
  if (!snap) {
    // first boot after the split: lift the studio board out of the table's
    // state.json, where it used to ride
    const legacy = join(DATA_DIR, "state.json");
    if (existsSync(legacy)) {
      const s = await Bun.file(legacy).json().catch(() => null);
      if (s?.studio) snap = { studio: s.studio };
    }
  }
  if (snap?.studio) studio.restoreStudio(snap.studio);
}

// CORS is open so the table page (a different origin) can probe /swap to
// decide whether to show its studio link
const CORS = { "Access-Control-Allow-Origin": "*" };

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...CORS } });
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

    if (path === "/api/studio" && req.method === "GET") {
      // the deck shown is always Archidekt's current list (throttled re-read)
      await studio.syncDeck();
      return json(studio.studioView(!!url.searchParams.get("lean")));
    }
    if (path.startsWith("/api/studio/") && req.method === "POST") {
      const op = path.slice("/api/studio/".length);
      let body: any = {};
      try {
        body = await req.json();
      } catch {}
      try {
        return json(await studioOp(op, body));
      } catch (e: any) {
        return json({ ok: false, error: e.message }, 400);
      }
    }

    const file = path === "/" || path === "/swap" ? "swap.html" : path.slice(1);
    if (/^[\w.-]+(\/[\w.-]+)*$/.test(file) && !file.includes("..")) {
      const f = Bun.file(WEB_DIR + file);
      if (await f.exists()) return new Response(f, { headers: CORS });
    }
    return new Response("not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      ws.subscribe("studio");
    },
    message() {},
  },
});

/** One dispatcher for every studio operation; the MCP proxy and the page share it. */
async function studioOp(op: string, body: any): Promise<any> {
  switch (op) {
    case "decks":
      return { decks: await studio.listDecks() };
    case "select":
      await studio.selectDeck(Number(body.deckId));
      return studio.studioView(!!body.lean);
    case "refresh":
      await studio.refreshDeck();
      return studio.studioView(!!body.lean);
    case "propose": {
      await studio.syncDeck();
      const p = await studio.propose(body);
      const view = studio.studioView(true).proposals.find((x) => x.id === p.id);
      return { ok: true, proposal: view };
    }
    case "withdraw":
      studio.withdraw(body.id);
      return { ok: true };
    case "dismiss":
      studio.dismiss(body.id);
      return { ok: true };
    case "clear":
      studio.clearProposals(!!body.includeApplied);
      return { ok: true };
    case "confirm": {
      const p = await studio.confirm(body.id, body.choice);
      return { ok: true, applied: { id: p.id, chosen: p.chosen }, metadata: studio.deckMetadata(studio.studio.cards) };
    }
    case "card_search":
      return await cardSearch(body);
    case "card_lookup":
      return await cardLookup(body.names ?? []);
    case "edhrec":
      return await edhrecCommander(body.commander, body.limit);
    default:
      throw new Error(`unknown studio op ${op}`);
  }
}

studio.onStudioChange(() => {
  saveSoon();
  server.publish("studio", JSON.stringify({ type: "studio" }));
});

console.log(`deck studio listening on http://localhost:${PORT}`);
