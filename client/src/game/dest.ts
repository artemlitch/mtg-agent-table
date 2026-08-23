// The one place a card destination is named. Every menu and every card browser
// builds its rows from here, so a graveyard row is spelled, coloured and aimed
// the same way wherever you meet it.
//
// Three rules are baked in and must stay that way:
//   * exile and the graveyard are always the card's OWNER's. There is no such
//     thing as exiling a card into your own exile, or putting a card you don't
//     own into the agent's graveyard.
//   * "to hand" is never the agent's hand. The agent takes cards itself.
//   * a card ARRIVING on a battlefield is PLAYED, never filed — see isPlay.
import { act, type ActionResult } from "../api";
import { playCard } from "../features/nextaction/steps";
import type { MenuItem } from "../store/ui";
import type { Card, MoveParams } from "../types";

type Dest = (c: Card) => [label: string, params: MoveParams];

export const DEST: Record<string, Dest> = {
  hand: () => ["To hand", { toZone: "hand", toPlayer: "you" }],
  graveyard: (c) => ["Graveyard", { toZone: "graveyard", toPlayer: c.owner }],
  exile: (c) => ["Exile", { toZone: "exile", toPlayer: c.owner }],
  exileDown: (c) => ["Exile face-down", { toZone: "exile", toPlayer: c.owner, faceDown: true, revealTo: "you" }],
  top: (c) => ["Top of library", { toZone: "library", toPlayer: c.owner, position: "top" }],
  bottom: (c) => ["Bottom of library", { toZone: "library", toPlayer: c.owner, position: "bottom" }],
  command: (c) => ["Command zone", { toZone: "command", toPlayer: c.owner }],
  // both of these PLAY the card — the label says play because that is what
  // clicking it does, wherever the card is coming from
  myBattlefield: () => ["Play ⚡ — to my battlefield", { toZone: "battlefield", toPlayer: "you" }],
  ownerBattlefield: (c) => ["Play ⚡ — to owner's battlefield", { toZone: "battlefield", toPlayer: c.owner }],
  steal: () => ["😈 Steal — to my battlefield", { toZone: "battlefield", toPlayer: "you", note: "control effect" }],
  give: () => ["🎁 Give to agent's battlefield", { toZone: "battlefield", toPlayer: "agent", note: "control effect" }],
  giveBack: () => ["Return to agent's battlefield", { toZone: "battlefield", toPlayer: "agent" }],
};

export type DestKey = keyof typeof DEST;

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
const isPlay = (c: Card, params: MoveParams) => params.toZone === "battlefield" && c.zone !== "battlefield";

/** Send a card to a destination: cast it if it is arriving in play, move it
 *  otherwise. Every menu row and every browser row goes through here, so the
 *  rule cannot be forgotten at a call site. */
export function runDest(c: Card, params: MoveParams): Promise<ActionResult> {
  if (!isPlay(c, params)) return act("move", { card: c.id, ...params });
  // toZone/toPlayer are the server's business once this is a cast: it decides
  // stack vs land drop. Only the note carries over. Handing a card to the
  // OWNER's side is an effect rather than your own play, so that one resolves
  // where it was aimed — and, being an effect, uses the stack even for a land.
  const toOwner = params.toPlayer && params.toPlayer !== "you" ? { resolveTo: "battlefield", resolveToPlayer: params.toPlayer } : {};
  return playCard({ card: c.id, ...(params.note ? { note: params.note } : {}), ...toOwner });
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
