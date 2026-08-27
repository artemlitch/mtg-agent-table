// Reveals, as cards rather than as a sentence. The server tags a reveal's log
// entry with the ids it is about (only ones this seat may look up), so the
// moment one lands we can put the actual cards on screen instead of leaving
// "Agent revealed: Krosan Grip, Stump Stomp, …" to be read.
//
// Same shape as processSounds next door, and for the same reason: the log
// arrives as a whole array every refresh, so "what is new" is a high-water
// mark on seq, and the first array after a page load only sets that mark —
// nobody wants every reveal of the game reopening at once.
import { openRevealBrowser } from "../features/browsers/Browsers";
import { cardById } from "../store/game";
import { ui } from "../store/ui";
import type { Card, LogEntry } from "../types";

let lastRevealSeq: number | null = null;

/** The cards a reveal entry is about, as they stand right now. Ids the view
 *  cannot resolve are dropped rather than drawn as blanks — a card that has
 *  moved on since is simply no longer part of the reveal. */
export function revealedCards(e: LogEntry): Card[] {
  return (e.cards ?? []).map(cardById).filter((c): c is Card => !!c);
}

export function processReveals(log: LogEntry[]) {
  if (!log.length) return;
  const maxSeq = log[log.length - 1].seq;
  if (lastRevealSeq === null) {
    lastRevealSeq = maxSeq; // no barrage of history on page load
    return;
  }
  // the event says "this is a reveal"; ids alone stopped meaning that when
  // named() began registering them on every line that speaks a card's name —
  // a plain tap carried ids and popped this browser mid-game
  const fresh = log.filter((e) => e.seq > lastRevealSeq! && e.event === "revealed" && e.cards?.length);
  lastRevealSeq = maxSeq;
  // Only the newest, and only into an empty screen. openModal is single-slot
  // and replaces without asking, so auto-opening over a search you are in the
  // middle of would throw it away. The chat line stays clickable either way,
  // which is how a reveal that arrived at a busy moment is got back.
  const newest = fresh.at(-1);
  if (!newest || ui().modal) return;
  const cards = revealedCards(newest);
  if (cards.length) openRevealBrowser(cards);
}
