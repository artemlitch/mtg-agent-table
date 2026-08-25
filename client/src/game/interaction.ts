// The small pieces of state that make pointer gestures on cards behave: which
// card is under the cursor, and what the E key does.
import { act } from "../api";
import { cardById, gameView } from "../store/game";
import { hovered } from "../store/ui";
import type { Card } from "../types";
import { openAbilityModal } from "../features/modals/AbilityModal";
import { playCard } from "../features/nextaction/steps";
import { pendingAttackOf, removeAttacker, typeCat } from "./rules";

/** What E — and a left-click on a battlefield card — does to a card.
 *  shift = announce an ability instead (the modal decides tap vs no-tap). */
export function cardPrimaryAction(card: Card, shift: boolean) {
  // fresh lookup: state may have re-rendered under the cursor since mouseenter
  const cur = cardById(card.id) ?? card;
  const phase = gameView()?.phase || "";
  // on a hand card this plays it (lands = land drop, spells = onto the stack;
  // a DFC plays whichever face it's showing), and shift plays it with its
  // arrival trigger — the same "say what it does" gesture shift means on the
  // battlefield, asked at the moment the card is entering rather than sitting
  if (cur.zone === "hand" && cur.controller === "you") {
    if (shift) void playWithEtb(cur);
    else void playCard({ card: cur.id });
    return;
  }
  if (cur.zone !== "battlefield") return;
  if (shift) {
    openAbilityModal(cur);
    return;
  }
  // E is a TOGGLE on the battlefield:
  if (cur.controller === "you") {
    // 1. pending attack declaration → undo it
    const pa = pendingAttackOf(cur.id);
    if (pa) {
      void removeAttacker(cur, pa);
      return;
    }
    // 2. the card's own pending stack item (shift+E ability) → undo it, untapping
    const stack = gameView()?.stack ?? [];
    const mine = stack.filter((it) => it.source === cur.id && it.player === "you");
    if (mine.length) {
      const it = mine[mine.length - 1];
      void act("stack_remove", { index: stack.findIndex((i) => i.id === it.id) });
      if (cur.tapped) void act("tap", { cards: [cur.id], tapped: false });
      return;
    }
    // 3. in COMBAT, tapping your untapped creature declares the attack — that
    // is what tapping a creature means at this point in the turn. Outside
    // combat E stays a plain tap, for mana and everything else
    if (typeCat(cur) === "creature" && !cur.attacking && !cur.tapped && /combat|attack/i.test(phase)) {
      void act("attack", { pairs: [{ attacker: cur.id, target: "agent" }] });
      return;
    }
  }
  // 4. anything else taps/untaps
  void act("tap", { cards: [cur.id], tapped: !cur.tapped });
}

/** Play a card and announce what it does on the way in. Two steps because
 *  they are two things: the card goes down exactly the way it always does,
 *  and the trigger is a separate item on the stack that the agent can answer.
 *  The box only opens if the play landed — a refused cast has nothing to
 *  trigger off. */
export async function playWithEtb(c: Card) {
  const res = await playCard({ card: c.id });
  if (res.ok) openAbilityModal(c, "etb");
}

/** Remember the card the pointer is over, for the E keybind. */
export const trackHover = (c: Card) => ({
  onMouseEnter: () => {
    hovered.card = c;
  },
  onMouseLeave: () => {
    if (hovered.card?.id === c.id) hovered.card = null;
  },
});

/** A held card is smaller than one on the board. The hand's fan math needs the
 *  number, so it comes from the same variable the sheet lays out with. */
export const HAND_W = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hand-card-w")) || 76;
