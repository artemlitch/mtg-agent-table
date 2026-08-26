// The one place a card destination is named. Every menu and every card browser
// builds its rows from here, so a graveyard row is spelled, coloured and aimed
// the same way wherever you meet it.
//
// Three rules are baked in and must stay that way:
//   * exile and the graveyard are always the card's OWNER's. There is no such
//     thing as exiling a card into your own exile, or putting a card you don't
//     own into the agent's graveyard.
//   * "to hand" is never the agent's hand. The agent takes cards itself.
//   * a card ARRIVING on a battlefield is PLAYED unless the row says it is
//     being PUT there by an effect that has already resolved — see isPlay.
import { act, type ActionResult } from "../api";
import { playCard } from "../features/nextaction/steps";
import type { MenuItem } from "../store/ui";
import type { Card, MoveParams, Zone } from "../types";

type Dest = (c: Card) => [label: string, params: MoveParams];

export const DEST: Record<string, Dest> = {
  hand: () => ["To hand", { toZone: "hand", toPlayer: "you" }],
  graveyard: (c) => ["Graveyard", { toZone: "graveyard", toPlayer: c.owner }],
  exile: (c) => ["Exile", { toZone: "exile", toPlayer: c.owner }],
  exileDown: (c) => ["Exile face-down", { toZone: "exile", toPlayer: c.owner, faceDown: true, revealTo: "you" }],
  top: (c) => ["Top of library", { toZone: "library", toPlayer: c.owner, position: "top" }],
  bottom: (c) => ["Bottom of library", { toZone: "library", toPlayer: c.owner, position: "bottom" }],
  command: (c) => ["Command zone", { toZone: "command", toPlayer: c.owner }],
  // this PLAYS the card (see isPlay), and says so. There is deliberately no
  // companion aimed at the owner's side: a card you put into play is yours to
  // play, and handing it over afterwards is what steal/give are for.
  myBattlefield: () => ["Play — to my battlefield", { toZone: "battlefield", toPlayer: "you" }],
  /* The other way onto the battlefield: an effect PUTTING it there, already
     resolved, with nothing to respond to. Reanimation finishing, a fetch, a
     token copy arriving — none of those are a card being cast. */
  putBattlefield: () => ["Put onto battlefield (no stack)", { toZone: "battlefield", toPlayer: "you", put: true }],
  steal: () => ["Steal — to my battlefield", { toZone: "battlefield", toPlayer: "you", note: "control effect" }],
  give: () => ["Give to agent's battlefield", { toZone: "battlefield", toPlayer: "agent", note: "control effect" }],
  giveBack: () => ["Return to agent's battlefield", { toZone: "battlefield", toPlayer: "agent" }],
};

export type DestKey = keyof typeof DEST;

/** The zones a commander can be stranded in.
 *
 *  Command-zone replacement is a choice its owner makes as the card leaves,
 *  and nothing at this table is in a position to ask: a commander that dies,
 *  is exiled, is bounced to hand or shuffled away just lands there like any
 *  other card. So the choice is made afterwards, from wherever it ended up,
 *  and every surface that can show one of these zones offers the row.
 *
 *  The battlefield is not here on purpose — it has its own Command zone row,
 *  up among the other places a permanent can be sent. Neither is the stack: a
 *  commander waiting there has not gone anywhere yet, and taking it back is
 *  what stack_remove is for. */
const STRANDED_IN = new Set<Zone>(["hand", "graveyard", "exile", "library"]);

/** Is this a commander that could be sent home from where it is?
 *
 *  `hidden` is checked because isCommander is a PUBLIC field even on a card
 *  whose face you are not allowed to see (see serializeCard) — offering this
 *  row on a face-down card would point at it and say "that one is the
 *  commander", which is exactly what hiding it was for. */
export const canSendHome = (c: Card) => !!c.isCommander && !c.hidden && STRANDED_IN.has(c.zone);

/** Is this destination a PLAY rather than a filing?
 *
 *  A card ARRIVING on a battlefield is being played, whatever zone it comes
 *  from — hand, graveyard, exile, a library search, the command zone. It goes
 *  on the stack and the agent gets its chance to respond, exactly as it would
 *  from your hand, and a land drops straight in because `cast` makes that
 *  exception for any cast, not just one from hand. There is no such thing as
 *  quietly sliding a permanent onto the table.
 *
 *  The one battlefield arrival that is NOT a play is a card already on a
 *  battlefield changing sides — steal, give, give back. That card is in play
 *  already; who controls it is bookkeeping, so those stay plain moves. */
const isPlay = (c: Card, params: MoveParams) =>
  params.toZone === "battlefield" && c.zone !== "battlefield" && !params.put;

/** Send a card to a destination: cast it if it is arriving in play, move it
 *  otherwise. Every menu row and every browser row goes through here, so the
 *  rule cannot be forgotten at a call site. */
export function runDest(c: Card, params: MoveParams): Promise<ActionResult> {
  // `put` is the caller's intent, not something the table knows about
  const { put: _put, ...move } = params;
  if (!isPlay(c, params)) return act("move", { card: c.id, ...move });
  // toZone/toPlayer stop mattering once this is a cast: the server decides
  // stack vs land drop, and every play lands on your own side. Only the note
  // carries over, to say in the log where the card came from.
  return playCard({ card: c.id, ...(move.note ? { note: move.note } : {}) });
}

/** A menu row that sends the card somewhere. `extra` only ever adds a log note. */
export function destItem(key: DestKey, c: Card, extra?: Partial<MoveParams>): MenuItem {
  const [label, params] = DEST[key](c);
  return { label, fn: () => void runDest(c, { ...params, ...extra }) };
}

/** The same row for a card browser, where the caller runs it and does its own
 *  bookkeeping afterwards — see runDest for what "running it" means. */
export function destButton(
  key: DestKey,
  c: Card,
  run: (params: MoveParams) => void,
  suffix = ""
): [string, () => void] {
  const [label, params] = DEST[key](c);
  return [label + suffix, () => run(params)];
}
