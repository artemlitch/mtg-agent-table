// Minimal stdio MCP server exposing the DECK STUDIO to an agent CLI — the
// studio-only sibling of mcp-tools.ts, LOCAL-ONLY like studio-server.ts.
// All calls proxy to the standalone studio server's HTTP API.

const STUDIO_URL = process.env.STUDIO_URL || "http://localhost:4781";

type Schema = Record<string, any>;
const obj = (props: Schema, required: string[] = []): Schema => ({
  type: "object",
  properties: props,
  required,
});
const str = (description: string, enums?: string[]): Schema => ({ type: "string", description, ...(enums ? { enum: enums } : {}) });
const num = (description: string): Schema => ({ type: "number", description });
const arr = (items: Schema, description: string): Schema => ({ type: "array", items, description });

interface ToolDef {
  description: string;
  schema: Schema;
  op: string; // studio op name; "get" maps to GET /api/studio
}

const TOOLS: Record<string, ToolDef> = {
  // ─── deck studio: the /swap page. Proposals only — Artem confirms in the UI,
  // and that confirm is the only thing that writes to Archidekt. ───
  studio_get: {
    description:
      "Deck studio snapshot, re-read live from Archidekt: the selected deck (every card with qty, category, mana, mv, type — note basics carry qty>1, so metadata.count is the real card count, not the list length), its metadata (count, lands, avg mv, mana curve, per-category counts, color pips) and every proposal on the board with per-option 'deck after this swap' metadata. Start here.",
    schema: obj({}),
    op: "get",
  },
  studio_list_decks: { description: "Artem's Archidekt decks (id + name) — what the page's dropdown shows.", schema: obj({}), op: "decks" },
  studio_select_deck: {
    description: "Select the deck being discussed (by Archidekt deck id). Loads it and clears proposals if it is a different deck. Artem can also do this from the page dropdown.",
    schema: obj({ deckId: num("archidekt deck id") }, ["deckId"]),
    op: "select",
  },
  studio_propose: {
    description:
      "File ONE swap proposal on the board. Two styles: kind='cut' — 'this card in the deck is weak; here are cards to bring in instead' (card = the deck card, options = replacements, each with the deck category it would join); kind='add' — 'this card is great, add it; here are deck cards to cut for it' (card = the new card, category = the category it joins, options = deck cards to cut). Every name must be an exact Scryfall name (front face for DFCs) — the board renders art for all of them and rejects anything it cannot picture. Mark one option primary. why/note are shown to Artem: one or two sharp sentences each. Response carries the finalized-deck metadata for every option — read it and fix your own proposal if a number looks wrong.",
    schema: obj(
      {
        kind: str("cut | add", ["cut", "add"]),
        card: str("the card this proposal is about (deck card for cut, new card for add)"),
        category: str("add only: deck category the new card joins (e.g. 'Theft', 'Interaction')"),
        package: str("optional grouping label, e.g. 'Counter glue' — proposals with the same package render together"),
        why: str("why this card should leave (cut) or come in (add)"),
        options: arr(
          obj(
            {
              name: str("card name"),
              category: str("cut: category the replacement would join (required). add: ignored — the deck card's own category is used"),
              note: str("one line: why this option, and what it costs"),
              primary: { type: "boolean", description: "the recommended option (exactly one)" },
            },
            ["name"]
          ),
          "cut: replacements to bring in · add: deck cards that could leave. 1-5 options, best first"
        ),
      },
      ["kind", "card", "why", "options"]
    ),
    op: "propose",
  },
  studio_withdraw: { description: "Remove a proposal you filed (by id).", schema: obj({ id: str("proposal id") }, ["id"]), op: "withdraw" },
  studio_clear: { description: "Remove every open/dismissed proposal from the board (applied ones stay unless includeApplied).", schema: obj({ includeApplied: { type: "boolean" } }), op: "clear" },
  studio_refresh: { description: "Force an immediate re-read of the deck from Archidekt. Rarely needed: studio_get and studio_propose already re-read Archidekt (throttled to once per 10s), so the deck you see IS the live deck.", schema: obj({}), op: "refresh" },

  // ─── card research, normalized for deck building ───
  card_search: {
    description:
      "Scryfall search with full Scryfall syntax (otag:theft, o:\"triggers an additional time\", t:equipment, is:gamechanger, cmc<=3 …). Unless deckFilter=false, the query is scoped to legal:commander, paper, and the selected deck's color identity. Results are normalized (name, mana, mv, type, oracle, color identity, commanderLegal, gameChanger, edhrecRank, priceUsd) and flagged inDeck / offColor against the selected deck. Prefer otag: (human-curated function tags) over oracle regex when enumerating an effect family.",
    schema: obj({ q: str("scryfall query"), limit: num("max results (default 30, max 175)"), order: str("scryfall order: edhrec (default), cmc, name, usd, released"), deckFilter: { type: "boolean", description: "false = raw query, no legality/color scoping" } }, ["q"]),
    op: "card_search",
  },
  card_lookup: {
    description: "Batch lookup of exact card names (up to 75 per call) → the same normalized card info as card_search plus notFound[]. Use it to verify names, legality, game-changer status and color identity before proposing.",
    schema: obj({ names: arr(str("exact card name"), "card names") }, ["names"]),
    op: "card_lookup",
  },
  edhrec_commander: {
    description: "EDHREC page for a commander (default: the selected deck's Commander-category card): cards ranked by synergy then inclusion %, with the EDHREC section tag and an inDeck flag. The consensus check — anything high-synergy that is not inDeck is a probable miss.",
    schema: obj({ commander: str("commander name (default: the selected deck's)"), limit: num("max cards (default 60)") }),
    op: "edhrec",
  },
};

async function callStudio(tool: string, args: any): Promise<string> {
  const def = TOOLS[tool];
  if (def.op === "get") return await (await fetch(`${STUDIO_URL}/api/studio?lean=1`)).text();
  const res = await fetch(`${STUDIO_URL}/api/studio/${def.op}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(args ?? {}), lean: true }),
  });
  return await res.text();
}

function reply(id: any, result: any) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}
function replyError(id: any, message: string) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message } }) + "\n");
}

async function handle(msg: any) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    reply(id, {
      protocolVersion: params?.protocolVersion ?? "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "studio", version: "1.0.0" },
    });
    return;
  }
  if (method === "notifications/initialized" || String(method).startsWith("notifications/")) return;
  if (method === "tools/list") {
    reply(id, {
      tools: Object.entries(TOOLS).map(([name, def]) => ({
        name,
        description: def.description,
        inputSchema: def.schema,
      })),
    });
    return;
  }
  if (method === "tools/call") {
    const name = params.name as string;
    if (!TOOLS[name]) return replyError(id, `unknown tool ${name}`);
    try {
      const text = await callStudio(name, params.arguments);
      let isError = false;
      try {
        const parsed = JSON.parse(text);
        isError = parsed?.ok === false || !!parsed?.error;
      } catch {}
      reply(id, { content: [{ type: "text", text }], isError });
    } catch (e: any) {
      reply(id, { content: [{ type: "text", text: `studio server error: ${e.message}` }], isError: true });
    }
    return;
  }
  if (id !== undefined) replyError(id, `unknown method ${method}`);
}

let buf = "";
process.stdin.on("data", (chunk: Buffer) => {
  buf += chunk.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try {
      handle(JSON.parse(line));
    } catch (e) {
      // ignore malformed lines
    }
  }
});
