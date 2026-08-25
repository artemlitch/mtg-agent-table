// Which sound a thing that happened earns. The engine and the sound
// definitions live in public/sfx.js, shared with the sound lab; this file only
// picks the category.
//
// Two things make a noise, and they are different in kind:
//
//   the LOG — something happened at the table, to either seat. The server
//   names the event when it writes the line (GAME_EVENTS in server/game.ts)
//   and this file says what that event sounds like.
//
//   the PROMPT — the next-action machine moving to a new step, which is not an
//   event in the game at all. It is the table starting to ask you for
//   something, and some of those moments have nothing in the log to hear.
//
// It used to be fourteen regexes over the log's English. That made every log
// sentence a frozen string — reword one and the table silently changes what it
// sounds like — and it needed rules to survive its own side effects: an undo
// notice QUOTES the line it took back, so undoing a land drop thumped and
// undoing an attack drummed until a rule was added to mute anything starting
// with ↩. An undo notice carries no event, so that whole class is gone.
import { currentStep } from "../features/nextaction/steps";
import type { GameEvent, GameView, LogEntry, SoundId } from "../types";

/** Every event, and what it sounds like. Total on purpose: a new name in
 *  GAME_EVENTS does not compile until someone has decided what it does here. */
export const EVENT_SOUND: Record<GameEvent, SoundId> = {
  round_start: "glimmer",
  phase_change: "phase",
  // Falling when you hand the table over, rising when a turn begins. The
  // agent's own turn pass takes neither: the round line that follows it
  // already glimmers, and hearing both is one moment announced twice.
  turn_pass_declared: "passturn",
  cast: "stack",
  ability_stacked: "stack",
  sequence_proposed: "stack",
  land_played: "thump",
  permanent_resolved: "thump",
  // ...which leaves `spell` for the cards that resolve into a graveyard. They
  // were silent for a year while a COUNTERED spell made a noise: the fizzle
  // was audible and the spell doing its work was not.
  spell_resolved: "spell",
  countered: "hit",
  permanent_died: "hit",
  // Two moments, seconds apart: you tap creatures to declare, then you commit
  // the swing. The blades belong to the commit — the dramatic beat of a combat
  // and the one you perform. Locking in is the defender acknowledging it, a
  // second later off a press that is not yours, so it takes the phase sound
  // like any other step of the turn moving along.
  attackers_declared: "attack",
  attacks_finished: "lockin",
  attacks_locked: "phase",
  blockers_declared: "block",
  // the same two beats from the other side of the table: blockers go down one
  // at a time, then you commit the whole answer
  blocks_finished: "lockin",
  drew: "draw",
  tapped: "tap",
};

/** Events only YOUR seat sounds for. Which seat did it is on the entry, so
 *  this is a rule about the table's audio and stays out of the server. */
const MINE_ONLY: Partial<Record<GameEvent, true>> = { turn_pass_declared: true };

/** The sound a log line earns, or null. */
export function soundFor(e: LogEntry): SoundId | null {
  if (!e.event) return null;
  if (MINE_ONLY[e.event] && e.actor !== "you") return null;
  return EVENT_SOUND[e.event] ?? null;
}

// Where we had got to last time. Both start unset: the first view after a page
// load only marks the position, or the whole history sounds off at once.
let lastSoundSeq: number | null = null;
let lastStepId: string | null | undefined;

export function processSounds(view: GameView) {
  const log = view.log;
  if (!log?.length || typeof SFX === "undefined") return;
  const maxSeq = log[log.length - 1].seq;
  const step = currentStep(view);

  if (lastSoundSeq === null) {
    lastSoundSeq = maxSeq;
    lastStepId = step?.rule.id ?? null;
    return;
  }

  const cats: SoundId[] = [];
  const add = (c: SoundId | null | undefined) => {
    if (c && !cats.includes(c)) cats.push(c);
  };
  for (const e of log) if (e.seq > lastSoundSeq) add(soundFor(e));
  // the prompt asking for something it was not asking for a moment ago
  if ((step?.rule.id ?? null) !== lastStepId) add(step?.rule.sound);

  lastSoundSeq = maxSeq;
  lastStepId = step?.rule.id ?? null;
  // a busy moment is a handful of entries at once — play the distinct sounds
  // in order rather than all of them on the same millisecond, and stop at four
  cats.slice(0, 4).forEach((c, i) => setTimeout(() => SFX.play(c), i * 140));
}
