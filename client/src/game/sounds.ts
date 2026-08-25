// Which sound a new log entry earns. The engine and the sound definitions live
// in public/sfx.js, shared with the sound lab; here we only pick the category.
import type { LogEntry } from "../types";

// first matching rule per log entry decides its sound
const SOUND_RULES: [string, RegExp][] = [
  ["glimmer", /^— Round \d+:/],
  // Two moments, seconds apart and two entries: you tap creatures to declare,
  // then the declaration resolves and the attack is locked. One rule matched
  // both lines and played the drum twice for what looked like one event.
  ["attack", /declares attackers/],
  ["lockin", /^Attacks locked in: /],
  ["block", /declares blockers/],
  ["hit", / from battlefield to .*graveyard/],
  ["hit", / countered .* → .*graveyard/],
  ["thump", / resolved → .*battlefield/],
  ["thump", / played .* — land drop/],
  // YOU handing the table over — the moment you press End turn, and nothing
  // else. Anchored at the start of the line, because the phrase turns up in
  // sentences that are not a turn ending: the agent talking about one in chat,
  // and an undo naming the action it just took back. Matching mid-sentence
  // played the end-turn chime for a turn that had just been un-ended.
  //
  // The agent's own pass is deliberately not here. The round line that follows
  // it already glimmers, and that pair — falling when you hand over, rising
  // when a turn begins — is what the two sounds are for.
  //
  // Above the stack rule on purpose: the pass is a stack item, and the generic
  // stack chime would otherwise swallow the one moment worth its own sound.
  ["passturn", /^Player declares (the turn pass|an extra turn)/],
  ["stack", /(→ on the stack$)|( put on the stack: )|( proposed the \d+ items )/],
  // "Player moves to combat", "Agent moves to cleanup" — see set_phase in
  // server/game.ts. The trailing untap count rides on the same line, so this
  // is deliberately not anchored at the end.
  ["phase", / moves to /],
  // your own draw reads "Player drew: Island" — the line the server writes for
  // your eyes only — and everyone else's is a count
  ["draw", /(^Player drew: )|( drew \d+ cards?$)/],
  ["tap", / tapped /],
];

let lastSoundSeq: number | null = null;

/** An undo QUOTES the action it took back — "↩ Player undid: Player played
 *  Swamp — land drop" — so every rule below matches inside it and the table
 *  plays the sound of the thing that just stopped having happened. Undoing a
 *  land drop thumped, undoing an attack drummed, undoing a turn pass chimed
 *  the turn away again.
 *
 *  A redo (↪) is left alone on purpose: it quotes the action too, but that
 *  action IS happening again, and it writes no other line to sound off. */
const UNDONE = /^↩/;

export function processSounds(log: LogEntry[]) {
  if (!log.length || typeof SFX === "undefined") return;
  const maxSeq = log[log.length - 1].seq;
  if (lastSoundSeq === null) {
    lastSoundSeq = maxSeq; // no barrage for history on page load
    return;
  }
  const cats: string[] = [];
  for (const e of log) {
    if (e.seq <= lastSoundSeq) continue;
    if (UNDONE.test(e.text)) continue;
    for (const [cat, re] of SOUND_RULES) {
      if (re.test(e.text)) {
        if (!cats.includes(cat)) cats.push(cat);
        break;
      }
    }
  }
  lastSoundSeq = maxSeq;
  cats.slice(0, 4).forEach((c, i) => setTimeout(() => SFX.play(c), i * 140));
}
