// Saying what a card does, and putting that on the stack, as ONE action.
//
// This used to be three: the ability box played the card, the play fired a
// phase advance behind it, and the box then pushed the trigger. Three actions
// is three undo steps, three broadcasts and three sounds for one keystroke —
// a card announced from hand took five presses of cmd+Z to take back, and the
// player who pressed it heard their own gesture replayed at them on the way.
//
// It is also the shape the agent is REQUIRED to use (see the casting procedure
// in server/agent.ts: "ONE stack_batch containing [the card, then each of its
// cast/ETB triggers as text items]"), and the human path was the one that
// could not. A trigger in the same batch as its card is one proposal the
// opponent accepts or responds inside; two loose items are two things to
// resolve, in an order nobody declared.
import { act, type ActionResult } from "../api";
import { isSpellCard } from "./rules";
import type { Card } from "../types";

/** How the trigger line reads for a card in this zone. A card arriving from
 *  hand or the command zone is entering the battlefield and its box is that
 *  arrival; an instant or sorcery is played the same way but resolves instead,
 *  so it never "enters"; anything already on the battlefield is activating. */
export function announcementText(card: Card, what: string): string {
  const arriving = isArriving(card);
  const name = card.hidden ? "?" : card.name;
  return `${name}${arriving && !isSpellCard(card) ? " enters the battlefield" : ""}: ${what}`;
}

/** The two zones a card of yours waits in to be played. */
export const isArriving = (c: Card) => c.zone === "hand" || c.zone === "command";

/**
 * Announce `what` onto the stack for `card`, playing the card in the same
 * breath if it is still waiting to be played.
 *
 * `tapToo` taps a permanent that is paying with itself. It stays a second
 * action, deliberately: tapping for a cost is its own move at this table —
 * it is how the agent does it, and it is what E on the card undoes — and a
 * batch is a proposal about the STACK. Nothing arriving pays that way, so the
 * gesture this exists for is one action either way.
 */
export async function announceOnStack(card: Card, what: string, opts: { tapToo?: boolean } = {}): Promise<ActionResult> {
  const text = announcementText(card, what);
  if (isArriving(card)) {
    // the card, then its trigger, bottom-first — one proposal, one undo step.
    // Where it is cast from is the server's to say (see cast in game.ts), so
    // a commander out of the command zone reads the same here as anywhere.
    return act("stack_batch", { items: [{ card: card.id }, { text, source: card.id }] });
  }
  if (opts.tapToo && !card.tapped) await act("tap", { cards: [card.id], tapped: true });
  return act("stack_push", { text, source: card.id });
}
