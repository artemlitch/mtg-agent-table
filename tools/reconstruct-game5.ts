// One-off: rebuild the round-6 Marchesa-vs-Thromok game lost to the truncated
// state.json (2026-08-16). Source of truth: the agent session event log
// (game5-log.txt) + the pre-crash board screenshot. Run against a fresh
// AGENT_DISABLED server, then patch the agent session id into state.json.
const URL_BASE = process.env.TABLE_URL ?? "http://localhost:4780";

async function act(actor: "you" | "agent", type: string, params: any = {}) {
  const res = await fetch(`${URL_BASE}/api/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actor, type, params }),
  });
  const data: any = await res.json();
  if (!data.ok) throw new Error(`${type}: ${data.error}`);
  return data;
}

async function state() {
  return (await fetch(`${URL_BASE}/api/state?viewer=you`)).json() as any;
}

async function findInLibrary(player: "you" | "agent", name: string): Promise<string> {
  const r = await act(player, "view_zone", { player, zone: "library" });
  const hit = (r.cards as any[]).find((c) => c.name === name || c.name?.startsWith(name));
  if (!hit) throw new Error(`${name} not in ${player}'s library`);
  return hit.id;
}

async function toBattlefield(player: "you" | "agent", name: string, opts: { tapped?: boolean; face?: number } = {}) {
  const id = await findInLibrary(player, name);
  await act(player, "move", { cards: [id], toZone: "battlefield", note: "reconstruction" });
  if (opts.face !== undefined) await act(player, "set_face", { card: id, face: opts.face });
  if (opts.tapped) await act(player, "tap", { cards: [id] });
  return id;
}

// --- fresh game (loads both decks + token catalog) ---
const ng = await fetch(`${URL_BASE}/api/new_game`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ youDeck: 25319832, agentDeck: 2638949 }),
});
if (!((await ng.json()) as any).ok) throw new Error("new_game failed");

// both fresh 7-card hands back into the libraries, shuffle
let s = await state();
for (const p of ["you", "agent"] as const) {
  const hand = s.players[p].zones.hand.map((c: any) => c.id);
  if (hand.length) await act(p, "move", { cards: hand, toZone: "library", note: "reconstruction reset" });
  await act(p, "shuffle", { player: p });
}

// --- Player's side: 36 life, 6 tapped lands, Marchesa + Crew + Cutthroat, Berserker in gy ---
await act("you", "life", { player: "you", set: 36 });
for (const land of ["Xander's Lounge", "Command Tower", "Mountain", "Graven Cairns", "Volrath's Stronghold", "Island"]) {
  await toBattlefield("you", land, { tapped: true });
}
s = await state();
const marchesa = s.players.you.zones.command.find((c: any) => c.name.includes("Marchesa"));
await act("you", "move", { cards: [marchesa.id], toZone: "battlefield", note: "reconstruction: cast on round 4 (tax 1 next time)" });
await toBattlefield("you", "Captivating Crew");
await toBattlefield("you", "Zulaport Cutthroat");
{
  const id = await findInLibrary("you", "Scorn-Blade Berserker");
  await act("you", "move", { cards: [id], toZone: "graveyard", note: "reconstruction: sacked round 3" });
}
// known hand cards (last draw unknown — Player will name it)
for (const c of ["Agent of Treachery", "Scalding Tarn", "The Meathook Massacre", "Fiery Islet"]) {
  const id = await findInLibrary("you", c);
  await act("you", "move", { cards: [id], toZone: "hand", note: "reconstruction" });
}
await act("you", "shuffle", { player: "you" });

// --- Agent's side: 35 life ---
await act("you", "life", { player: "agent", set: 35 });
await toBattlefield("agent", "Disciple of Freyalise", { face: 1, tapped: false }); // Garden of Freyalise, untapped
await toBattlefield("agent", "Den of the Bugbear", { tapped: true });
await toBattlefield("agent", "Taiga");
await toBattlefield("agent", "Forest", { tapped: true });
await toBattlefield("agent", "Forest", { tapped: true });
await toBattlefield("agent", "Kessig Wolf Run");
await toBattlefield("agent", "Stomping Ground", { tapped: true });
await toBattlefield("agent", "Wood Elves");
const gk = await toBattlefield("agent", "Molten Gatekeeper", { tapped: true });
await act("agent", "counters", { cards: [gk], kind: "+1/+1", set: 1, note: "dethrone (attacked while stolen)" });
await act("agent", "create_token", { name: "Elemental", n: 4, player: "agent" });
for (const c of ["Three Visits", "Tempt with Vengeance"]) {
  const id = await findInLibrary("agent", c);
  await act("agent", "move", { cards: [id], toZone: "graveyard", note: "reconstruction" });
}
for (const c of ["Reclamation Sage", "Valakut Awakening", "Khalni Ambush"]) {
  const id = await findInLibrary("agent", c);
  await act("agent", "move", { cards: [id], toZone: "hand", note: "reconstruction" });
}
await act("agent", "shuffle", { player: "agent" });

// --- turn structure: round 6, Player's turn-pass is live on the stack ---
await act("you", "set_phase", { phase: "end" });
{
  const st = await state();
  const top = st.stack[st.stack.length - 1];
  await act("agent", "stack_resolve", { item: top.id }); // phase resolves; round counter handled below
}
await act("you", "chat", { text: "— RECONSTRUCTION — state.json was truncated by a killed server (bug fixed: saves are atomic now). Board rebuilt from the agent session log through event [313]: round 6, my turn ending, 36 vs 35, Gatekeeper back with you (tapped, 1 counter) after the Crew borrowed it. My turn pass goes back on the stack now. Libraries reshuffled; my last-drawn card TBD — I'll add it when Player names it. Flag anything that looks off." });
await act("you", "set_turn", { player: "agent" });
console.log("reconstructed; verify:");
s = await state();
console.log("round", s.turnNumber, "turn", s.turn, "lives", s.players.you.life, s.players.agent.life);
