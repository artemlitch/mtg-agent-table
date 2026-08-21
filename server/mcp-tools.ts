// Minimal stdio MCP server exposing the game table to the agent CLI.
// All calls proxy to the game server HTTP API as actor=agent, so redaction
// is enforced server-side. Zero dependencies: hand-rolled JSON-RPC over stdio.

import { leanCard } from "./game";

const TABLE_URL = process.env.TABLE_URL || "http://localhost:4780";

type Schema = Record<string, any>;
const obj = (props: Schema, required: string[] = []): Schema => ({
  type: "object",
  properties: props,
  required,
});
const str = (description: string, enums?: string[]): Schema => ({ type: "string", description, ...(enums ? { enum: enums } : {}) });
const num = (description: string): Schema => ({ type: "number", description });
const arr = (items: Schema, description: string): Schema => ({ type: "array", items, description });

const PLAYER = str("which player", ["you", "agent"]); // "you" = Player (the human), "agent" = you
const ZONE = str("zone", ["library", "hand", "battlefield", "graveyard", "exile", "command"]);

export interface ToolDef {
  description: string;
  schema: Schema;
  action?: string; // /api/action type; defaults to tool name
  special?: "state";
  // result carries a card list: trim it the way the lean state view is trimmed,
  // so art urls and board positions never burn context here either
  leanCards?: boolean;
}

export const TOOLS: Record<string, ToolDef> = {
  get_state: {
    description:
      "Full table snapshot as you are allowed to see it: both battlefields, graveyards, exiles, command zones, life totals, YOUR hand (Player's hand/library are hidden), zone counts, and the recent event log. Card ids in the snapshot are what every other tool takes.",
    schema: obj({}),
    special: "state",
  },
  draw: {
    description: "Draw N cards from your library into your hand. Returns the drawn cards privately with their full oracle text — read it before you play them.",
    schema: obj({ n: num("how many (default 1)") }),
    leanCards: true,
  },
  move: {
    description:
      "The universal card mover — moves ONE OR MANY cards in a single call (always batch with `cards` when moving several: mulligans, mass discard, board wipes, mill N). Uses: discard, exile, bounce, mill, return a whole hand to the library, etc. Card refs: card id, or 'top:you'/'top:agent' for the top of a library. Use faceDown+revealTo for face-down exile theft effects (revealTo 'agent' keeps it visible to you only). position: 'top'|'bottom'|number for library placement (batch order preserved). Remember: spells and land drops normally go through cast, not move.",
    schema: obj(
      {
        cards: arr(str("card id, or top:you / top:agent"), "cards to move together (preferred)"),
        card: str("single card id (alternative to cards)"),
        toZone: ZONE,
        toPlayer: PLAYER,
        position: str("top | bottom | index (library placement)"),
        faceDown: { type: "boolean" },
        revealTo: str("who may see a face-down card", ["you", "agent", "all"]),
        note: str("short reason shown in the log, e.g. 'Gonti trigger'"),
      },
      ["toZone"]
    ),
  },
  cast: {
    description:
      "Cast a spell (goes on the stack; announce targets with say, then call done — Player resolves or responds) OR play a land: lands are special actions per CR 115.2a and this tool routes them STRAIGHT to the battlefield, no stack, no responses. For a double-faced card pass face (0 front / 1 back) to say which face you are playing.",
    schema: obj({
      card: str("card id"),
      note: str("short cast note, e.g. 'targeting Kotis'"),
      face: num("double-faced cards: which face you are playing (0 front / 1 back)"),
      resolveTo: str("where it goes when it resolves — declare for MDFC faces or exile-on-resolve effects; otherwise inferred", ["battlefield", "graveyard", "exile", "hand", "library", "command"]),
      resolveToPlayer: str("who gets it on resolve, when not the caster", ["you", "agent"]),
      respondAt: str("stack item id you are responding at (inside Player's proposed sequence) — their retractable planned items above it unwind"),
    }, ["card"]),
  },
  stack_push: {
    description: "Put a triggered or activated ability on the stack as a text item (e.g. 'Gonti trigger — exile top of Player's library'). Then call done for responses. respondAt: when responding inside Player's proposed sequence, the stack item id you are responding at — their retractable planned items above it unwind automatically.",
    schema: obj({ text: str("what the ability does (the HEADLINE for multi-part announcements)"), lines: arr(str("one part"), "multi-part announcements (combat damage): ONE entry per pairing/part — the table renders them as a table. ALWAYS use this instead of cramming pairings into text"), source: str("card id of the permanent this trigger/ability comes from — ALWAYS pass it when the ability belongs to a permanent (the table lifts that card visually)"), respondAt: str("stack item id you are responding at (inside a proposed sequence)") }, ["text"]),
  },
  stack_batch: {
    description:
      "PREFERRED for busy turns: push a whole sequence as ONE call — an event plus ALL its triggers (CR: simultaneous triggers stack together before anyone gets priority), or a planned run of casts. Mark planned follow-up casts retractable:true; mandatory triggers are NOT retractable. Player can accept everything with one resolve-all, or respond at any point — which retracts your retractable tail above that point (MTR shortcut rules: what came before stays committed). Then call done ONCE.",
    schema: obj({
      items: arr(obj({
        card: str("card id to cast (omit for a text-only trigger/ability)"),
        text: str("trigger/ability text (when no card)"),
        lines: arr(str("one part"), "multi-part announcement parts, one per entry (rendered as a table)"),
        source: str("for text items: card id of the permanent the trigger/ability comes from"),
        note: str("cast note, e.g. targets"),
        face: num("DFC face to cast (0 front / 1 back)"),
        resolveTo: str("destination override on resolve", ["battlefield", "graveyard", "exile", "hand", "library", "command"]),
        retractable: { type: "boolean", description: "true = planned follow-up that unwinds if Player responds below it" },
      }), "items bottom-first: the thing that happens first goes first"),
    }, ["items"]),
  },
  stack_resolve: {
    description:
      "Resolve a stack item — any item, any time (default: top; pass item for a specific one). Cards: permanents → battlefield, instants/sorceries → graveyard; 'to' overrides (e.g. exile). A COUNTERED item resolves as a fizzle: the card goes to its owner's graveyard with no effect. Etiquette: give Player a response window (done) before resolving your own spells.",
    schema: obj({ item: str("stack item id (default: top of stack)"), to: str("override destination zone", ["battlefield", "graveyard", "exile", "hand", "library"]) }),
  },
  stack_resolve_all: {
    description:
      "Accept Player's whole proposal in one call: resolves items top-down for as long as they are theirs (stops at your own items). Use this instead of many stack_resolve calls when you have no responses. group limits it to one proposed sequence.",
    schema: obj({ group: str("only resolve items of this groupId") }),
  },
  stack_counter: {
    description: "MARK a stack item as countered (toggle) — it STAYS on the stack so responses can reference it; resolving it later fizzles it (card → owner's graveyard, no effect). Default = top; pass item for a specific one.",
    schema: obj({ item: str("stack item id (default: top of stack)") }),
  },
  stack_remove: {
    description: "Take back an illegal/mistaken stack item (discuss in chat first). The card returns to its owner's hand. index targets a specific item (0 = bottom); default = top.",
    schema: obj({ index: num("stack index to remove") }),
  },
  flip_card: {
    description:
      "Turn a card face-down in place (morph, cloak, 'keep this secret'), or pass faceDown:false to turn it face-up. Either player may flip ANY card, including the opponent's. While face-down the server hides it from everyone but you; every flip is logged.",
    schema: obj({ cards: arr(str("card id"), "cards to flip together"), card: str("single card id"), faceDown: { type: "boolean", description: "true (default) = face-down, false = face-up" } }),
  },
  set_face: {
    description:
      "Show a different face of a DOUBLE-FACED card (MDFC land side, transformed creature). face 0 = front, 1 = back. Different from flip_card, which hides a card entirely.",
    schema: obj({ card: str("card id"), face: num("0 = front, 1 = back") }, ["card", "face"]),
  },
  tap: {
    description: "Tap or untap battlefield cards (yours, or Player's when an effect says so). tapped=false to untap.",
    schema: obj({ cards: arr(str("card id"), "card ids"), tapped: { type: "boolean" } }, ["cards"]),
  },
  untap_all: { description: "Untap all of a player's permanents (start of turn).", schema: obj({ player: PLAYER }) },
  counters: {
    description: "Add/remove counters on one or many cards at once. kind is REQUIRED, e.g. '+1/+1', 'loyalty', 'charge'. delta may be negative; set overrides to an absolute count.",
    schema: obj({ cards: arr(str("card id"), "cards to change together"), card: str("single card id"), kind: str("counter kind"), delta: num("change"), set: num("absolute count (instead of delta)") }, ["kind"]),
  },
  create_token: {
    description:
      "Create N token permanents under a player's control. Art and text come from your deck's own token printings when available (else Scryfall). ALWAYS pass power/toughness/typeLine/oracle too — if no art exists the table renders a text placeholder with exactly the copy you give, so a missing P/T means a blank token.",
    schema: obj(
      { name: str("token name, e.g. 'Treasure'"), n: num("count"), player: PLAYER, power: str("power"), toughness: str("toughness"), typeLine: str("type line, e.g. 'Token Creature — Elemental'"), oracle: str("token rules text, e.g. 'Haste'"), tapped: { type: "boolean", description: "token enters tapped" } },
      ["name"]
    ),
  },
  tuck: { description: "Tuck card under another battlefield card, forming a pile (equipment/auras, or board tidying). The pile's top card is the handle and carries the pile when it moves. Pass under '' to pull a card out of its pile.", schema: obj({ card: str("card id"), under: str("card id to tuck under, or '' to pull out") }, ["card"]) },
  life: { description: "Change a player's life: delta (+/-) or set (absolute).", schema: obj({ player: PLAYER, delta: num("life change"), set: num("absolute value") }, ["player"]) },
  commander_damage: {
    description: "Track commander combat damage dealt to a player.",
    schema: obj({ to: PLAYER, commander: str("commander name"), delta: num("damage dealt") }, ["to", "commander", "delta"]),
  },
  reveal: { description: "Reveal cards (from your hand etc.) to 'all' or one player.", schema: obj({ cards: arr(str("card id"), "card ids"), to: str("audience", ["all", "you", "agent"]) }, ["cards"]) },
  peek: {
    description: "Look at the top N cards of a library privately (scry/surveil/impulse effects). Follow with reorder_top or move.",
    schema: obj({ player: PLAYER, n: num("how many") }, ["n"]),
    leanCards: true,
  },
  reorder_top: {
    description: "Finish a scry: top = card ids in new order (first = top), toBottom = ids to bottom the library.",
    schema: obj({ player: PLAYER, top: arr(str("card id"), "new top order"), toBottom: arr(str("card id"), "to bottom") }),
  },
  view_zone: {
    description:
      "See every card in a zone: search your own library (then shuffle!), read a graveyard, or look at Player's hand/library WHEN A GAME EFFECT ALLOWS IT (this is logged loudly — cite the effect with say).",
    schema: obj({ player: PLAYER, zone: ZONE }, ["player", "zone"]),
    leanCards: true,
  },
  shuffle: { description: "Shuffle a library (after searching).", schema: obj({ player: PLAYER }) },
  read_card: {
    description: "Read ONE card's full details (oracle text, type, P/T, faces) by card id — any card you can legally see: battlefields, graveyards, stack, your hand, revealed cards. Free and unlogged. This is the tool for checking what a card does; peek is only for library tops.",
    schema: obj({ card: str("card id") }, ["card"]),
  },
  set_phase: { description: "Declare a phase/step change — applies IMMEDIATELY (logged, no stack item). The only turn-structure stack item is the TURN PASS (set_turn); attack/block declarations still go on the stack, and end-of-turn responses happen against the TURN PASS.", schema: obj({ phase: str("phase label") }, ["phase"]) },
  set_turn: { description: "Declare the turn pass — goes ON THE STACK as the end-of-turn priority window; the turn changes when Player resolves it. Rejected while anything else is on the stack.", schema: obj({ player: PLAYER }, ["player"]) },
  attack: {
    description:
      "Declare attackers — goes ON THE STACK like everything else: pairs of {attacker: cardId, target: 'you'|'agent'|planeswalker cardId}. The defender resolves the item to lock attacks in (attackers tap then), or responds on top first. After declaring, call done.",
    schema: obj({ pairs: arr(obj({ attacker: str("card id"), target: str("defending player or card id") }, ["attacker", "target"]), "attacks") }, ["pairs"]),
  },
  block: {
    description:
      "Declare blockers — goes ON THE STACK: pairs of {blocker: cardId, attacker: cardId}. The attacker resolves the item to lock blocks in. After declaring, call done.",
    schema: obj({ pairs: arr(obj({ blocker: str("card id"), attacker: str("card id") }, ["blocker", "attacker"]), "blocks") }, ["pairs"]),
  },
  clear_combat: { description: "Clear all attack/block annotations after damage.", schema: obj({}) },
  roll: { description: "Roll a die.", schema: obj({ sides: num("sides, default 20") }) },
  flip: { description: "Flip a coin.", schema: obj({}) },
  say: { description: "Say something to Player in the chat (announcements, responses, banter).", schema: obj({ text: str("message") }, ["text"]), action: "chat" },
  ask_user: {
    description: "Ask Player a blocking question (rules confusion, 'any responses?', clarify their action). Their answer arrives in your next window.",
    schema: obj({ question: str("the question") }, ["question"]),
  },
  done: {
    description:
      "End your window and pass priority back to Player. Call this to finish EVERY window (full turns AND reaction windows) unless you asked a blocking question. Also how you pass after putting something on the stack.",
    schema: obj({}),
  },
};

/** No soft assumptions: arguments that don't fit the tool's schema fail
 * loudly with a message the model can act on — an unknown key once turned
 * three charge-counter bumps into silent +1/+1 bumps. */
export function validateArgs(tool: string, args: any): string | null {
  const schema = TOOLS[tool]?.schema ?? {};
  const props = schema.properties ?? {};
  const a = args ?? {};
  if (typeof a !== "object" || Array.isArray(a)) return "arguments must be a JSON object";
  const unknown = Object.keys(a).filter((k) => !(k in props));
  if (unknown.length) {
    return `unknown parameter${unknown.length > 1 ? "s" : ""} ${unknown.map((k) => `"${k}"`).join(", ")} — ${tool} takes: ${Object.keys(props).join(", ") || "(no parameters)"}`;
  }
  const missing = (schema.required ?? []).filter((k: string) => a[k] === undefined);
  if (missing.length) return `missing required parameter${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`;
  return null;
}

export async function callTable(tool: string, args: any, tableUrl: string = TABLE_URL): Promise<string> {
  const def = TOOLS[tool];
  const invalid = validateArgs(tool, args);
  if (invalid) return JSON.stringify({ ok: false, error: `${tool}: ${invalid}` });
  if (def.special === "state") {
    // lean: no hidden library/hand stubs, no image urls — the full view is
    // ~77KB and the CLI offloads it to a file the model then greps by hand
    const res = await fetch(`${tableUrl}/api/state?viewer=agent&lean=1`);
    return await res.text();
  }
  const res = await fetch(`${tableUrl}/api/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actor: "agent", type: def.action ?? tool, params: args ?? {} }),
  });
  const text = await res.text();
  if (!def.leanCards) return text;
  try {
    const data = JSON.parse(text);
    // errors and card-less results pass through untouched
    if (!Array.isArray(data?.cards)) return text;
    return JSON.stringify({ ...data, cards: data.cards.map((c: any) => leanCard(c)) });
  } catch {
    return text;
  }
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
      serverInfo: { name: "table", version: "1.0.0" },
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
      const text = await callTable(name, params.arguments);
      let isError = false;
      try {
        const parsed = JSON.parse(text);
        isError = parsed?.ok === false || !!parsed?.error;
      } catch {}
      reply(id, { content: [{ type: "text", text }], isError });
    } catch (e: any) {
      reply(id, { content: [{ type: "text", text: `table server error: ${e.message}` }], isError: true });
    }
    return;
  }
  if (id !== undefined) replyError(id, `unknown method ${method}`);
}

// the stdio loop only runs when this file IS the MCP server process — the
// in-process agent transport imports TOOLS/callTable without touching stdin
if (import.meta.main) {
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
}
