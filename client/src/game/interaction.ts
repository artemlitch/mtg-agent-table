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
 *  shift = announce onto the stack instead; the modal works out the rest from
 *  the card (tap vs no-tap, ability vs arrival trigger). */
export function cardPrimaryAction(card: Card, shift: boolean) {
  // fresh lookup: state may have re-rendered under the cursor since mouseenter
  const cur = cardById(card.id) ?? card;
  const phase = gameView()?.phase || "";
  // Your hand and your command zone are the two places a card of yours waits
  // to be played, so E means the same thing in both. playCard works out which
  // one it came out of on its own.
  const mineToPlay = (cur.zone === "hand" || cur.zone === "command") && cur.controller === "you";
  // Shift is one gesture wherever the card is: say what it does, and put that
  // on the stack. The box reads the rest off the card — an ability from the
  // battlefield, an arrival trigger from the two zones above, which it plays
  // on submit.
  if (shift && (mineToPlay || cur.zone === "battlefield")) {
    openAbilityModal(cur);
    return;
  }
  // plays it: lands are a land drop, spells go onto the stack, a commander
  // pays its tax, and a DFC plays whichever face it is showing
  if (mineToPlay) {
    void playCard({ card: cur.id });
    return;
  }
  if (cur.zone !== "battlefield") return;
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
