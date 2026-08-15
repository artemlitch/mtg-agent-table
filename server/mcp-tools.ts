// Minimal stdio MCP server exposing the game table to the agent CLI.
// All calls proxy to the game server HTTP API as actor=agent, so redaction
// is enforced server-side. Zero dependencies: hand-rolled JSON-RPC over stdio.

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

const PLAYER = str("which player", ["you", "agent"]); // "you" = Artem (the human), "agent" = you
const ZONE = str("zone", ["library", "hand", "battlefield", "graveyard", "exile", "command"]);

interface ToolDef {
  description: string;
  schema: Schema;
  action?: string; // /api/action type; defaults to tool name
  special?: "state";
}

const TOOLS: Record<string, ToolDef> = {
  get_state: {
    description:
      "Full table snapshot as you are allowed to see it: both battlefields, graveyards, exiles, command zones, life totals, YOUR hand (Artem's hand/library are hidden), zone counts, and the recent event log. Card ids in the snapshot are what every other tool takes.",
    schema: obj({}),
    special: "state",
  },
  draw: {
    description: "Draw N cards from your library into your hand. Returns the names privately.",
    schema: obj({ n: num("how many (default 1)") }),
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
      "Cast a spell (goes on the stack; announce targets with say, then call done — Artem resolves or responds) OR play a land: lands are special actions per CR 115.2a and this tool routes them STRAIGHT to the battlefield, no stack, no responses. For a double-faced card pass face (0 front / 1 back) to say which face you are playing.",
    schema: obj({
      card: str("card id"),
      note: str("short cast note, e.g. 'targeting Kotis'"),
      resolveTo: str("where it goes when it resolves — declare for MDFC faces or exile-on-resolve effects; otherwise inferred", ["battlefield", "graveyard", "exile", "hand", "library", "command"]),
    }, ["card"]),
  },
  stack_push: {
    description: "Put a triggered or activated ability on the stack as a text item (e.g. 'Gonti trigger — exile top of Artem's library'). Then call done for responses.",
    schema: obj({ text: str("what the ability does") }, ["text"]),
  },
  stack_resolve: {
    description:
      "Resolve the TOP item of the stack (last in, first out) after the opponent had a chance to respond. Cards: permanents → battlefield, instants/sorceries → graveyard; 'to' overrides (e.g. exile). Text items just resolve.",
    schema: obj({ to: str("override destination zone", ["battlefield", "graveyard", "exile", "hand", "library"]) }),
  },
  stack_counter: {
    description: "Counter the TOP item of the stack: the card goes to its owner's graveyard.",
    schema: obj({}),
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
    description: "Tap or untap battlefield cards (yours, or Artem's when an effect says so). tapped=false to untap.",
    schema: obj({ cards: arr(str("card id"), "card ids"), tapped: { type: "boolean" } }, ["cards"]),
  },
  untap_all: { description: "Untap all of a player's permanents (start of turn).", schema: obj({ player: PLAYER }) },
  counters: {
    description: "Add/remove counters on one or many cards at once. kind e.g. '+1/+1', 'loyalty', 'charge'. delta may be negative.",
    schema: obj({ cards: arr(str("card id"), "cards to change together"), card: str("single card id"), kind: str("counter kind"), delta: num("change") }),
  },
  create_token: {
    description: "Create N token permanents under a player's control. Provide name; power/toughness/typeLine optional.",
    schema: obj(
      { name: str("token name, e.g. 'Treasure'"), n: num("count"), player: PLAYER, power: str("power"), toughness: str("toughness"), typeLine: str("type line") },
      ["name"]
    ),
  },
  attach: { description: "Attach card (equipment/aura) to target, or pass target '' to unattach.", schema: obj({ card: str("card id"), target: str("target card id or '' to unattach") }, ["card"]) },
  life: { description: "Change a player's life: delta (+/-) or set (absolute).", schema: obj({ player: PLAYER, delta: num("life change"), set: num("absolute value") }, ["player"]) },
  commander_damage: {
    description: "Track commander combat damage dealt to a player.",
    schema: obj({ to: PLAYER, commander: str("commander name"), delta: num("damage dealt") }, ["to", "commander", "delta"]),
  },
  reveal: { description: "Reveal cards (from your hand etc.) to 'all' or one player.", schema: obj({ cards: arr(str("card id"), "card ids"), to: str("audience", ["all", "you", "agent"]) }, ["cards"]) },
  peek: {
    description: "Look at the top N cards of a library privately (scry/surveil/impulse effects). Follow with reorder_top or move.",
    schema: obj({ player: PLAYER, n: num("how many") }, ["n"]),
  },
  reorder_top: {
    description: "Finish a scry: top = card ids in new order (first = top), toBottom = ids to bottom the library.",
    schema: obj({ player: PLAYER, top: arr(str("card id"), "new top order"), toBottom: arr(str("card id"), "to bottom") }),
  },
  view_zone: {
    description:
      "See every card in a zone: search your own library (then shuffle!), read a graveyard, or look at Artem's hand/library WHEN A GAME EFFECT ALLOWS IT (this is logged loudly — cite the effect with say).",
    schema: obj({ player: PLAYER, zone: ZONE }, ["player", "zone"]),
  },
  shuffle: { description: "Shuffle a library (after searching).", schema: obj({ player: PLAYER }) },
  set_phase: { description: "Declare a phase/step change (untap/upkeep, main 1, combat, main 2, end) — it goes ON THE STACK as a priority window: Artem responds at that step or resolves it. Then call done.", schema: obj({ phase: str("phase label") }, ["phase"]) },
  set_turn: { description: "Declare the turn pass — goes ON THE STACK as the end-of-turn priority window; the turn changes when Artem resolves it. Rejected while anything else is on the stack.", schema: obj({ player: PLAYER }, ["player"]) },
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
  say: { description: "Say something to Artem in the chat (announcements, responses, banter).", schema: obj({ text: str("message") }, ["text"]), action: "chat" },
  ask_user: {
    description: "Ask Artem a blocking question (rules confusion, 'any responses?', clarify his action). His answer arrives in your next window.",
    schema: obj({ question: str("the question") }, ["question"]),
  },
  done: {
    description:
      "End your window and pass priority back to Artem. Call this to finish EVERY window (full turns AND reaction windows) unless you asked a blocking question. Also how you pass after putting something on the stack.",
    schema: obj({}),
  },
};

async function callTable(tool: string, args: any): Promise<string> {
  const def = TOOLS[tool];
  if (def.special === "state") {
    const res = await fetch(`${TABLE_URL}/api/state?viewer=agent`);
    return await res.text();
  }
  const res = await fetch(`${TABLE_URL}/api/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actor: "agent", type: def.action ?? tool, params: args ?? {} }),
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
