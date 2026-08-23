// The next-action prompt: one always-visible "most obvious next tap" floating
// over your board.
//
// This is a PRECEDENCE list, not a linear chain: the agent's stack items
// outrank the turn structure, because the house rule is settle the stack
// first. Each step is one entry — add, remove or reorder freely; the first
// whose when() is true wins. Return either { label, fn } for a real action or
// { hint } for a nudge at something the table can't do in one click.
//   icon: a key into ICONS, drawn before the label.
//   skip: true adds the faded skip-to-pass-turn line underneath.
import { act, type ActionResult } from "../../api";
import { HAS_STARTED_PLAYING, stackItemCard, stackSubText } from "../../game/rules";
import { didThisTurn, gameView, lastLogIndex } from "../../store/game";
import { ui } from "../../store/ui";
import type { Card, GameView, StackItem } from "../../types";

export interface NextAction {
  label?: string;
  icon?: string;
  sub?: string;
  card?: Card | null;
  title?: string;
  skip?: boolean;
  hint?: string;
  fn?: () => void;
}

export interface Ctx {
  view: GameView;
  stack: StackItem[];
  top: StackItem | null;
  mine: boolean;
  phase: string;
  theirAttackers: Card[];
  attackSig: string;
  iAmBlocking: boolean;
  myAttackers: Card[];
  /** my attack declarations sitting on the stack, not yet locked in. Each tap
   *  pushes its OWN item (see attack() in server/game.ts), so declaring three
   *  creatures leaves three of them */
  myAttackDecls: StackItem[];
  /** how many creatures those declarations add up to */
  declared: number;
  /** Where this combat is, as log positions rather than "has it happened yet".
   *  A turn can hold two combats — undoing back past combat and swinging again
   *  is the ordinary way in — so what matters is the ORDER of these, not
   *  whether each occurred. -1 means not this round. */
  enteredCombatAt: number;
  lockedAt: number;
  damageAt: number;
  myTapped: boolean;
}

export const passTurnToAgent = async () => {
  await act("set_turn", { player: "agent" });
  await act("done", {});
};

// declining blocks is per-attack: remembering the signature stops the prompt
// reappearing for an attack you already waved through
export const noBlocks: { declaredFor: string | null } = { declaredFor: null };

export function nextActionContext(view: GameView): Ctx {
  const stack = view.stack || [];
  const log = view.log ?? [];
  const myAttackDecls = stack.filter((it) => it.player === "you" && !!it.attackPairs);
  const theirAttackers = view.players.agent.zones.battlefield.filter((c) => c.attacking);
  return {
    view,
    stack,
    top: stack.length ? stack[stack.length - 1] : null,
    mine: view.turn === "you",
    phase: view.phase || "",
    theirAttackers,
    // one signature per attack, so declining blocks hides the prompt for THAT
    // attack only — the next one asks again
    attackSig: theirAttackers.map((c) => c.id).sort().join(","),
    iAmBlocking: view.players.you.zones.battlefield.some((c) => c.blocking),
    myAttackers: view.players.you.zones.battlefield.filter((c) => c.attacking),
    myAttackDecls,
    declared: myAttackDecls.reduce((n, it) => n + (it.attackPairs?.length ?? 0), 0),
    enteredCombatAt: lastLogIndex(log, /moves to combat/i),
    lockedAt: lastLogIndex(log, /^Attacks locked in:/),
    damageAt: lastLogIndex(log, /combat damage|go to damage/i),
    myTapped: view.players.you.zones.battlefield.some((c) => c.tapped),
  };
}

interface Step {
  id: string;
  when: (c: Ctx) => boolean;
  step: (c: Ctx) => NextAction | null;
}

export const NEXT_ACTION_STEPS: Step[] = [
  // ── either turn: the stack and the agent come first ──
  {
    id: "answer-question",
    when: (c) => !!c.view.pendingQuestion,
    step: () => ({
      label: "Answer the agent",
      icon: "answer",
      fn: () => {
        ui().setTab("chat");
        document.querySelector<HTMLInputElement>("#chat-input")?.focus();
      },
    }),
  },
  {
    id: "take-your-turn",
    when: (c) => c.top?.player === "agent" && !!c.top.turnPassTo,
    step: (c) => ({ label: "Take your turn", icon: "takeTurn", fn: () => void act("stack_resolve", { item: c.top!.id }) }),
  },
  {
    id: "lock-their-attack",
    when: (c) => c.top?.player === "agent" && !!c.top.attackPairs,
    step: (c) => ({ label: "Go to damage", icon: "damage", fn: () => void act("stack_resolve", { item: c.top!.id }) }),
  },
  {
    id: "resolve-all",
    when: (c) =>
      c.top?.player === "agent" &&
      !!c.top.groupId &&
      c.stack.filter((i) => i.groupId === c.top!.groupId && i.player === "agent").length > 1,
    step: (c) => {
      const card = stackItemCard(c.top);
      return {
        label: `Resolve all (${c.stack.filter((i) => i.groupId === c.top!.groupId && i.player === "agent").length})`,
        icon: "resolveAll",
        sub: stackSubText(c.top, card),
        card,
        fn: () => void act("stack_resolve_all", { group: c.top!.groupId }),
      };
    },
  },
  {
    id: "resolve-one",
    when: (c) => c.top?.player === "agent",
    step: (c) => {
      const card = stackItemCard(c.top);
      return {
        // with no card to picture, the item's own words carry the name
        label: card ? "Resolve" : `Resolve: ${String(c.top!.text || "").slice(0, 32)}`,
        icon: "resolve",
        sub: card ? stackSubText(c.top, card) : "",
        card,
        fn: () => void act("stack_resolve", { item: c.top!.id }),
      };
    },
  },
  {
    id: "waiting-on-agent-response",
    // your own item on top — the agent answers it. Except an attack
    // declaration you have not finished: that one is on the stack but has not
    // been handed over, and the agent is deliberately not looking at it (see
    // wakePlanFor in server/wake.ts), so saying it is waiting would be a lie.
    // Tested by the type of the top item, not its identity: every creature you
    // tap pushes its own declaration, so the top one is not the first one.
    when: (c) => !!c.top && !(c.top.player === "you" && !!c.top.attackPairs),
    step: () => ({ hint: "on the stack — waiting for the agent" }),
  },
  {
    id: "no-blocks",
    // only while their attack is still live: their turn, still in combat, and
    // damage not dealt yet. Attackers keep the `attacking` flag after damage
    // until combat is cleared, and a dying attacker changes the signature —
    // between them the prompt used to come back and sit there.
    when: (c) =>
      !c.mine &&
      /combat|attack|block|damage/i.test(c.phase) &&
      !didThisTurn(/combat damage|no blocks/i) &&
      c.theirAttackers.length > 0 &&
      !c.iAmBlocking &&
      noBlocks.declaredFor !== c.attackSig,
    step: (c) => ({
      label: "No blocks — take the damage",
      icon: "noBlocks",
      fn: () => {
        noBlocks.declaredFor = c.attackSig;
        void act("chat", { text: "No blocks." });
      },
    }),
  },
  {
    id: "waiting-on-agent-turn",
    when: (c) => !c.mine,
    step: () => ({ hint: "the agent's turn — waiting" }),
  },

  // ── your turn, stack settled: the turn structure ──
  {
    // turn 1 before you have done anything: the useful move is playing a land
    // or a spell, which no button can pick for you. Say nothing rather than
    // marching the phase along
    id: "game-start",
    when: (c) =>
      // same question the mulligan offer asks, so it is the same pattern
      c.mine && c.view.turnNumber === 1 && !didThisTurn(HAS_STARTED_PLAYING),
    step: () => null,
  },
  {
    id: "untap",
    when: (c) => /untap/.test(c.phase) && c.myTapped && !didThisTurn(/^Player untapped all/),
    step: () => ({
      label: "Untap all",
      icon: "untap",
      skip: true,
      fn: async () => {
        await act("untap_all", { player: "you" });
        void act("set_phase", { phase: "untap/upkeep" });
      },
    }),
  },
  {
    id: "draw",
    when: (c) => /untap/.test(c.phase) && c.view.turnNumber > 1 && !didThisTurn(/^Player drew\b/),
    step: () => ({ label: "Draw 1", icon: "draw", skip: true, fn: () => void act("draw", { n: 1 }) }),
  },
  {
    id: "main-1",
    when: (c) => /untap/.test(c.phase),
    step: () => ({ label: "Begin main phase 1", icon: "main", skip: true, fn: () => void act("set_phase", { phase: "main 1" }) }),
  },
  {
    id: "to-combat",
    when: (c) => c.phase === "main 1",
    step: () => ({ label: "Go to combat", icon: "combat", skip: true, fn: () => void act("set_phase", { phase: "combat" }) }),
  },
  {
    // Declaring attackers is yours to finish. Tapping creatures no longer
    // wakes the agent (see wakePlanFor in server/wake.ts), so nothing looks at
    // the board until you press this — you get as long as you want to work out
    // the attack, and the agent cannot lock in a declaration you are still
    // adding to. Pressing it with nothing declared means you are not attacking.
    id: "finish-attacks",
    // Declarations on the stack always mean you are still declaring, whatever
    // happened earlier in the turn. With none, this is the entry state, which
    // lasts until damage — and it is damage since you ENTERED combat, so a
    // second swing after an undo gets its own declare window.
    when: (c) =>
      c.phase === "combat" && c.myAttackers.length === 0 && (c.declared > 0 || c.damageAt < c.enteredCombatAt),
    step: (c) => ({
      label: "Finish declaring attackers",
      icon: "combat",
      sub: c.declared ? `${c.declared} attacking` : undefined,
      title: "tap [e] a creature to attack",
      skip: true,
      // nothing declared means you are not attacking, so the button is the way
      // out of combat rather than a hand-over
      fn: () => void (c.declared ? act("done", {}) : act("set_phase", { phase: "main 2" })),
    }),
  },
  {
    id: "combat-damage",
    // Damage is owed while the last one asked for came BEFORE these attackers
    // were locked in. "Not yet this turn" was wrong twice over: it stood the
    // step down for a second combat in the same turn, and the pattern has to
    // match what the button pushes or the step never stands down at all.
    when: (c) => c.phase === "combat" && c.myAttackers.length > 0 && c.damageAt < c.lockedAt,
    // one click straight onto the stack — the agent works out the numbers, the
    // player never types damage. The text spells out what is being asked:
    // a bare "go to damage" left the agent resolving the item and stopping,
    // and combat never finished.
    step: () => ({
      label: "Go to damage",
      icon: "damage",
      skip: true,
      fn: () => void act("stack_push", { text: "go to damage — declare blockers if you have any, then announce combat damage" }),
    }),
  },
  {
    // what is left of combat once damage is done — declaring and damage are
    // handled above, so this is only the way out
    id: "past-combat",
    when: (c) => c.phase === "combat",
    step: () => ({
      label: "Begin main phase 2",
      icon: "main",
      skip: true,
      fn: () => void act("set_phase", { phase: "main 2" }),
    }),
  },
  {
    id: "main-2",
    when: (c) => c.phase === "main 2",
    step: () => ({ label: "Go to end step", icon: "end", skip: true, fn: () => void act("set_phase", { phase: "end" }) }),
  },
  {
    id: "pass-turn",
    when: () => true, // end step, or any phase we don't have a step for
    step: () => ({ label: "Pass turn to agent", icon: "passTurn", fn: passTurnToAgent }),
  },
];

/** Cast a card, and if that was the thing the next-action prompt was waiting
 *  on — "Begin main phase 1", still parked in the beginning step — skip the
 *  click and go straight there. Playing a card already says you're moving
 *  on; no reason to make the player advance the phase by hand first. */
export async function playCard(params: Record<string, any>): Promise<ActionResult> {
  const view = gameView();
  const ctx = view ? nextActionContext(view) : null;
  const shouldAdvance = !!ctx && NEXT_ACTION_STEPS.find((r) => r.when(ctx))?.id === "main-1";
  const res = await act("cast", params);
  if (res.ok && shouldAdvance) void act("set_phase", { phase: "main 1" });
  return res;
}

/** The action the table is asking for right now, or null. */
export function currentNextAction(): NextAction | null {
  const view = gameView();
  if (!view?.started) return null;
  const ctx = nextActionContext(view);
  const rule = NEXT_ACTION_STEPS.find((r) => r.when(ctx));
  return rule ? rule.step(ctx) : null;
}

/** SPACE takes the floating next action, SHIFT+SPACE skips to the turn pass.
 *  Lives here, not beside the component: a non-component export from a .tsx
 *  file costs that file its Fast Refresh. */
export function fireNextAction(shift: boolean) {
  const a = currentNextAction();
  if (!a) return;
  if (shift) {
    if (a.skip) void passTurnToAgent();
    return;
  }
  a.fn?.();
}
