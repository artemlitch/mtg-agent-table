// The small pieces of state that make pointer gestures on cards behave: what
// counts as a click after a drag, which card is still under a stationary
// cursor, and what the E key does.
import { act } from "../api";
import { cardById, gameView } from "../store/game";
import { hovered, ui } from "../store/ui";
import type { Card } from "../types";
import { openAbilityModal } from "../features/modals/AbilityModal";
import { pendingAttackOf, removeAttacker, typeCat } from "./rules";

// A release always fires a click. The card the drag started on is flagged, but
// after a hand drop that card has moved zones and the click can land on the
// freshly rendered board card — which would tap the card you just played. So
// drags also close a short window, and any card click inside it is swallowed.
let clickGuardUntil = 0;
export const guardClicks = () => {
  clickGuardUntil = Date.now() + 350;
};
const justDragged = new Set<string>();
export const markDragged = (id: string) => justDragged.add(id);

/** True if this click is the tail of a drag and should do nothing. */
export function swallowClick(id: string): boolean {
  if (justDragged.has(id)) {
    justDragged.delete(id);
    return true;
  }
  return Date.now() < clickGuardUntil;
}

// The card you just dropped sits under a stationary cursor, so it would come
// up already hovered — preview open, chips showing. It stays inert until the
// pointer actually leaves it once.
export const noHover: { id: string | null } = { id: null };

/** What E — and a left-click on a battlefield card — does to a card.
 *  shift = announce an ability instead (the modal decides tap vs no-tap). */
export function cardPrimaryAction(card: Card, shift: boolean) {
  // fresh lookup: state may have re-rendered under the cursor since mouseenter
  const cur = cardById(card.id) ?? card;
  const phase = gameView()?.phase || "";
  // on a hand card this plays it (lands = land drop, spells = onto the stack;
  // a DFC plays whichever face it's showing)
  if (cur.zone === "hand" && cur.controller === "you") {
    void act("cast", { card: cur.id });
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

/** Remember the card the pointer is over, for the E keybind. */
export const trackHover = (c: Card) => ({
  onMouseEnter: () => {
    hovered.card = c;
  },
  onMouseLeave: () => {
    if (hovered.card?.id === c.id) hovered.card = null;
  },
});

/** Board card layout-box size — CSS is the source of truth (--card-w/-h).
 *  All battlefield positioning math uses these, NEVER a card's bounding rect:
 *  transforms (tap rotate, lift bob) change the rect but not the layout box. */
const rootCS = getComputedStyle(document.documentElement);
export const CW = parseFloat(rootCS.getPropertyValue("--card-w")) || 92;
export const CH = parseFloat(rootCS.getPropertyValue("--card-h")) || 128;

/** The strip over your hand that a board card can be dropped onto to go back
 *  to hand. Driven imperatively — it only exists mid-drag, and re-rendering
 *  the whole table on every pointermove is not on. */
export const handZone = {
  show(armed: boolean) {
    const z = document.getElementById("handzone");
    if (!z) return;
    z.classList.remove("hidden");
    z.classList.toggle("armed", armed);
  },
  hide() {
    document.getElementById("handzone")?.classList.add("hidden");
  },
  over(x: number, y: number) {
    const r = document.getElementById("hand-you")?.getBoundingClientRect();
    return !!r && x >= r.left && x <= r.right && y >= r.top - 12 && y <= r.bottom;
  },
};

/** Keep the pointer on the element for the rest of the gesture. Throws if the
 *  pointer is already gone — a release between the press and the first move —
 *  and that must not abort the drag that is already under way. */
export function capturePointer(el: Element, pointerId: number) {
  try {
    el.setPointerCapture?.(pointerId);
  } catch {
    /* no active pointer to capture; the move/up listeners still fire */
  }
}

/** The command zone socket on your half of the board — the other place a card
 *  being dragged off the battlefield can land. Same imperative treatment as
 *  the hand strip, and for the same reason. */
export const commandZone = {
  arm(on: boolean) {
    document.getElementById("cmdzone-you")?.classList.toggle("armed", on);
  },
  over(x: number, y: number) {
    const r = document.getElementById("cmdzone-you")?.getBoundingClientRect();
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  },
};

/** Close any menu and preview before a gesture takes over. */
export const clearOverlays = () => {
  ui().hidePreview();
};
