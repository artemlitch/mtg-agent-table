// One-off: rebuild the round-11 game that the test-suite STATE_FILE bug
// clobbered on 2026-08-15. Public state reconstructed from session records;
// libraries reshuffled (order was unknowable); the agent keeps its original
// CLI session so its memory of the game is intact. Run with the server STOPPED:
//   bun run tools/reconstruct-round11.ts

import { game, resetGameState, addLog, getCard, type PlayerId, type Zone } from "../server/game";
import { loadPlayerDeck } from "../server/decks";
import { serializeState } from "../server/persist";
import { buildSystemPrompt } from "../server/agent";

const AGENT_SESSION = "9793266b-c6a6-42a6-9ff7-c2668caefae9";
const STATE_FILE = new URL("../state.json", import.meta.url).pathname;

function take(player: PlayerId, name: string, from: Zone = "library"): string {
  const list = game.players[player].zones[from];
  const id = list.find((x) => game.cards[x].name === name);
  if (!id) throw new Error(`${name} not found in ${player}'s ${from}`);
  return id;
}

function put(cardId: string, player: PlayerId, zone: Zone, opts: { faceDown?: boolean; visibleTo?: PlayerId[] } = {}) {
  const card = getCard(cardId);
  const src = game.players[card.controller].zones[card.zone];
  src.splice(src.indexOf(cardId), 1);
  card.zone = zone;
  card.controller = player;
  card.faceDown = !!opts.faceDown;
  card.visibleTo = opts.visibleTo ?? [];
  game.players[player].zones[zone].push(cardId);
}

resetGameState();
addLog("system", "— Reconstructed game (round 11) after a state-file loss; libraries reshuffled —");
const yours = await loadPlayerDeck("you", 25353034);
const theirs = await loadPlayerDeck("agent", 25351001);

// ---- your side: 36 life -------------------------------------------------
game.players.you.life = 36;
for (const n of ["Hinterland Harbor", "Yavimaya Coast", "Bojuka Bog", "Forest", "Forest", "Island", "Woodland Cemetery", "Morphic Pool"])
  put(take("you", n), "you", "battlefield");
for (const n of ["Sol Ring", "Winged Boots", "Whispersilk Cloak", "Nightveil Specter"])
  put(take("you", n), "you", "battlefield");
put(take("you", "Kotis, the Fangkeeper", "command"), "you", "battlefield");
getCard(take2("Winged Boots")).attachedTo = take2("Kotis, the Fangkeeper");
function take2(name: string): string {
  const id = game.players.you.zones.battlefield.find((x) => game.cards[x].name === name);
  if (!id) throw new Error(`${name} not on your battlefield`);
  return id;
}
getCard(take2("Kotis, the Fangkeeper")).tapped = true; // attacked this turn
// mana spent on Nightveil Specter this turn
for (const n of ["Island", "Bojuka Bog", "Hinterland Harbor"]) getCard(take2(n)).tapped = true;
for (const n of ["Bribery", "Reno and Rude", "Arcane Denial", "Damnation", "Nature's Lore"])
  put(take("you", n), "you", "graveyard");
// cards the agent stole from you: face-down in YOUR exile, visible to IT
for (const n of ["An Offer You Can't Refuse", "Siphon Insight"])
  put(take("you", n), "you", "exile", { faceDown: true, visibleTo: ["agent"] });

// Treasure token from its Gonti trigger
{
  const id = "recon-treasure";
  game.cards[id] = {
    id, name: "Treasure", typeLine: "Token Artifact — Treasure",
    oracle: "{T}, Sacrifice this token: Add one mana of any color.",
    image: undefined, owner: "you", controller: "you", zone: "battlefield",
    tapped: false, faceDown: false, counters: {}, attachedTo: null,
    isToken: true, isCommander: false, visibleTo: [], attacking: null, blocking: null,
  } as any;
  game.players.you.zones.battlefield.push(id);
}

// ---- its side: 24 life, 10 commander damage ------------------------------
game.players.agent.life = 24;
game.players.agent.commanderDamage["Kotis, the Fangkeeper"] = 10;
for (let i = 0; i < 7; i++) put(take("agent", "Swamp"), "agent", "battlefield");
for (const n of ["War Room", "Castle Locthwain"]) put(take("agent", n), "agent", "battlefield");
for (const n of ["Klaw, Master of Sound", "Ornate Kanzashi"]) put(take("agent", n), "agent", "battlefield");
put(take("agent", "Gonti, Night Minister", "command"), "agent", "battlefield");
// its hand (best reconstruction — the agent will audit from memory)
for (const n of ["Damnation", "Feed the Swarm", "Swamp"]) put(take("agent", n), "agent", "hand");
// its graveyard
for (const n of [
  "Tinybones, the Pickpocket", "Nashi, Moon Sage's Scion", "Opposition Agent", "Filth",
  "Decree of Pain", "Sign in Blood", "The Eldest Reborn", "Wayfarer's Bauble", "Chaos Wand",
]) put(take("agent", n), "agent", "graveyard");
// your Kotis stash: face-down in ITS exile, visible to YOU
for (const n of ["Black Market Connections", "Reno and Rude", "Murderous Rider // Swift End", "Bojuka Bog", "Swamp", "Swamp", "Swamp", "Swamp", "Swamp"])
  put(take("agent", n), "agent", "exile", { faceDown: true, visibleTo: ["you"] });
// Bloodthirsty Blade: its card, on YOUR battlefield (you free-cast it)
put(take("agent", "Bloodthirsty Blade"), "you", "battlefield");

game.turnNumber = 11;
game.turn = "agent";
game.waitingOn = "agent";
game.phase = "untap/upkeep";
game.started = true;
addLog("system", "Score: Player 36 / Agent 24. Commander damage: 10 from Kotis. Round 11, Agent's turn.");
addLog("system", "Agent: your session memory is intact. Please audit this reconstruction (especially your hand of 3) and fix anything via your tools, then take your turn.");

const agentSnap = {
  sessionId: AGENT_SESSION,
  systemPrompt: buildSystemPrompt(theirs.name, theirs.cards.map((c) => (c.isCommander ? `${c.name} (COMMANDER)` : c.name)), yours.name),
  model: "opus",
  lastSeenSeq: 0,
  brain: [],
  brainSeq: 0,
};
await Bun.write(STATE_FILE, JSON.stringify(serializeState({ agent: agentSnap as any, lastDecks: { you: 25353034, agent: 25351001 } })));
console.log("reconstructed state written:", STATE_FILE);
console.log("you:", game.players.you.counts ?? "", JSON.stringify(Object.fromEntries(Object.entries(game.players.you.zones).map(([z, l]) => [z, l.length]))));
console.log("agent:", JSON.stringify(Object.fromEntries(Object.entries(game.players.agent.zones).map(([z, l]) => [z, l.length]))));
