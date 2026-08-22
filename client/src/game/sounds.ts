// Which sound a new log entry earns. The engine and the sound definitions live
// in public/sfx.js, shared with the sound lab; here we only pick the category.
import type { LogEntry } from "../types";

// first matching rule per log entry decides its sound
const SOUND_RULES: [string, RegExp][] = [
  ["glimmer", /^— Round \d+:/],
  ["attack", /(declares attackers)|(^Attacks locked in: )/],
  ["hit", / from battlefield to .*graveyard/],
  ["hit", / countered .* → .*graveyard/],
  ["thump", / resolved → .*battlefield/],
  ["thump", / played .* — land drop/],
  ["stack", /(→ on the stack$)|( put on the stack: )|( proposed the \d+ items )|(declares (blockers|the turn pass))/],
  ["tap", / tapped /],
];

let lastSoundSeq: number | null = null;

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
