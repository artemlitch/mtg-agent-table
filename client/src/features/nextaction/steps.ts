// The next-action prompt: one always-visible "most obvious next tap" floating
// over your board.
//
// This is a PRECEDENCE list, not a linear chain: the agent's stack items
// outrank the turn structure, because the house rule is settle the stack
// first. Each step is one entry — add, remove or reorder freely; the first
// whose when() is true wins. Return either { label, fn } for a real action or
// { hint } for a nudge at something the table can't do in one click.
//   icon: a key into ICONS, drawn before the label.
import { act, type ActionResult } from "../../api";
import { HAS_STARTED_PLAYING, stackItemCard, stackSubText } from "../../game/rules";
import { cardById, didThisTurn, gameView, lastLogIndex, useGame } from "../../store/game";
import { ui } from "../../store/ui";
import type { Card, GameView, SoundId, StackItem } from "../../types";

export interface NextAction {
  label?: string;
  icon?: string;
  sub?: string;
  card?: Card | null;
  title?: string;
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
  finishedAt: number;
  lockedAt: number;
  damageAt: number;
  myTapped: boolean;
  /** the agent is mid-window right now — a window can run a minute on a big
   *  context, and without saying so the table looks identical to a table that
   *  has stopped */
  agentBusy: boolean;
}

/** What to say while it is the agent's move. "Waiting" alone is what made a
 *  working table look like a stuck one: the prompt sat unchanged with its
 *  SPACE hint through a sixty-second window, so the natural read was that the
 *  press had not landed. */
export const waitingHint = (c: Ctx, what: string) =>
  c.agentBusy ? `${what} — the agent is thinking…` : `${what} — waiting for the agent`;

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
    // You saying you are finished — which is the thing the finish-attacks step
    // exists to get, and so the thing that stands it down. It cannot use
    // lockedAt for that: that is the DEFENDER's answer, and an agent that
    // never gives one leaves the step asking forever.
    //
    // ANCHORED, so an undo cannot keep it true. "↩ Player undid: Player
    // finishes declaring attackers" quotes the line, and lastLogIndex reads
    // undo notices like any other entry — unanchored, taking the hand-over
    // back would leave the step believing you had made it, with no button to
    // make it again. Same trick as damageAt and lockedAt above.
    finishedAt: lastLogIndex(log, /^(Player|Agent) finishes declaring attackers/),
    // Damage is done when it LANDS, not when it was asked for. Asking used to
    // count — the pattern matched the "go to damage" push itself, whose text
    // contains the words — so the step stood down the moment you pressed it and
    // the table walked on to main 2 with the damage never applied. That is
    // exactly what happened the turn the agent decided announcing was Player's
    // job. Both patterns now match a log line only an ANSWER can write: the
    // damage tool resolving, or the older hand-written announcement reaching
    // the stack, which a game in flight may still be using.
    damageAt: lastLogIndex(log, /^Damage applied:|put on the stack: COMBAT DAMAGE/i),
    myTapped: view.players.you.zones.battlefield.some((c) => c.tapped),
    agentBusy: useGame.getState().agentBusy,
  };
}

export interface Step {
  id: string;
  when: (c: Ctx) => boolean;
  step: (c: Ctx) => NextAction | null;
  /** Played when the prompt ARRIVES at this step — see processSounds in
   *  game/sounds.ts. Most steps have none and should: the log already sounds
   *  for everything that happens at the table, and a second noise for the
   *  prompt catching up is the same moment announced twice. A step earns one
   *  only when it starts asking you for something no log line makes a sound
   *  for, which in practice means during the agent's turn. */
  sound?: SoundId;
}

export const NEXT_ACTION_STEPS: Step[] = [
  // ── either turn: the stack and the agent come first ──
  {
    id: "answer-question",
    when: (c) => !!c.view.pendingQuestion,
    // A question is something SAID, and talk writes no event — so the one
    // moment the agent stops and waits on an answer from you was the quietest
    // thing at the table. The rising chime, because it is the table opening
    // something rather than closing it.
    sound: "glimmer",
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
    step: (c) => ({ hint: waitingHint(c, "on the stack") }),
  },
  {
    id: "no-blocks",
    // The attack landing sounds like a phase moving along, because that is
    // what locking one in is. Being the seat that has to answer it is a
    // different thing and had no sound of its own — which is exactly the
    // moment that gets missed while you are looking at your own hand.
    sound: "block",
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
    // The agent hands priority back all through its own turn — after a wipe,
    // after a spell resolves, any time it wants a response. Saying "waiting"
    // then is backwards: it is waiting on YOU, and with no button to press the
    // table sits there with each side expecting the other to move.
    //
    // But only when nothing else is going to wake it. Acknowledging an item
    // wakes the agent by itself (stack_resolve is in the reactive set in
    // server/wake.ts), so after the usual Resolve there is already a countdown
    // running — asking for a second press then is ceremony on almost every
    // turn the agent takes. wakeAt is that countdown.
    id: "waiting-on-agent-turn",
    when: (c) => !c.mine,
    step: (c) =>
      // Nothing else coming: no countdown armed AND not already mid-window.
      // wakeAt goes back to null the moment the countdown FIRES, and waitingOn
      // stays "you" until the agent passes, so checking the countdown alone
      // brought the button back while the agent was actively thinking — where
      // pressing it preempts and restarts the very window you are waiting for.
      c.view.waitingOn === "you" && !c.view.wakeAt && !c.agentBusy
        ? { label: "Pass — nothing to add", icon: "skip", fn: () => void act("done", {}) }
        : { hint: waitingHint(c, "the agent's turn") },
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
      fn: async () => {
        await act("untap_all", { player: "you" });
        void act("set_phase", { phase: "untap/upkeep" });
      },
    }),
  },
  {
    id: "draw",
    when: (c) => /untap/.test(c.phase) && c.view.turnNumber > 1 && !didThisTurn(/^Player drew\b/),
    step: () => ({ label: "Draw 1", icon: "draw", fn: () => void act("draw", { n: 1 }) }),
  },
  {
    id: "main-1",
    when: (c) => /untap/.test(c.phase),
    step: () => ({ label: "untap → main phase 1", icon: "main", fn: () => void act("set_phase", { phase: "main 1" }) }),
  },
  {
    id: "to-combat",
    when: (c) => c.phase === "main 1",
    step: () => ({ label: "main phase → combat", icon: "combat", fn: () => void act("set_phase", { phase: "combat" }) }),
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
    step: (c) =>
      // Already handed over: pressing again cannot help, and it does harm —
      // a pass while the agent is mid-thought preempts it and starts it over,
      // so pressing four times because nothing seemed to happen is exactly
      // what stops anything from happening. Say who we are waiting on instead.
      //
      // waitingOn alone was not enough. The agent can hand the window straight
      // back — declare blocks, announce damage, pass — while never resolving
      // the declaration, and then waitingOn is "you" again with the ATTACKS
      // item still sitting there. The button came back mid-combat and a second
      // press re-declared attacks that had already dealt their damage. What
      // stands the step down is YOU having finished, which is what it asked.
      c.view.waitingOn === "agent" || c.finishedAt > c.enteredCombatAt
        ? { hint: waitingHint(c, "declared") }
        : {
            label: "Finish declaring attackers",
            icon: "combat",
            sub: c.declared ? `${c.declared} attacking` : undefined,
            title: "tap [e] a creature to attack",
            // finish_attacks, not done: closing a declaration is the last move
            // of a play, and a pass is not a play. It is undoable, it says in
            // the log what is being handed over, and the defender is told what
            // it is being asked for. Nothing declared means you are not
            // attacking, so that branch is the way out of combat instead.
            fn: () => void (c.declared ? act("finish_attacks", {}) : act("set_phase", { phase: "main 2" })),
          },
  },
  {
    id: "combat-damage",
    // Damage is owed while the last one asked for came BEFORE these attackers
    // were locked in. "Not yet this turn" was wrong twice over: it stood the
    // step down for a second combat in the same turn, and the pattern has to
    // match what the button pushes or the step never stands down at all.
    when: (c) => c.phase === "combat" && c.myAttackers.length > 0 && c.damageAt < c.lockedAt,
    // one click straight onto the stack — the agent works out the numbers, the
    // player never types damage. The text spells out what is being asked and
    // NAMES the tool: a bare "go to damage" left the agent resolving the item
    // and stopping, and even the longer wording lost to its own system prompt,
    // which described combat only from the side where the agent attacks.
    step: () => ({
      label: "Go to damage",
      icon: "damage",
      fn: () => void act("stack_push", { text: "go to damage — declare any blocks, then announce it with the damage tool (yours to announce, my attack or yours)" }),
    }),
  },
  {
    // what is left of combat once damage is done — declaring and damage are
    // handled above, so this is only the way out
    id: "past-combat",
    when: (c) => c.phase === "combat",
    step: () => ({
      label: "combat → main phase 2",
      icon: "main",
      fn: () => void act("set_phase", { phase: "main 2" }),
    }),
  },
  {
    id: "main-2",
    when: (c) => c.phase === "main 2",
    step: () => ({ label: "main phase 2 → end step", icon: "end", fn: () => void act("set_phase", { phase: "end" }) }),
  },
  {
    id: "pass-turn",
    when: () => true, // end step, or any phase we don't have a step for
    step: () => ({ label: "Pass turn to agent", icon: "passTurn", fn: passTurnToAgent }),
  },
];

/** Cast a card, and if that was the thing the next-action prompt was waiting
 *  on — "untap → main phase 1", still parked in the beginning step — skip the
 *  click and go straight there. Playing a card already says you're moving
 *  on; no reason to make the player advance the phase by hand first. */
export async function playCard(params: Record<string, any>): Promise<ActionResult> {
  const view = gameView();
  const ctx = view ? nextActionContext(view) : null;
  const shouldAdvance = !!ctx && NEXT_ACTION_STEPS.find((r) => r.when(ctx))?.id === "main-1";
  // Where a card is cast FROM is a fact about the card, not something every
  // caller has to remember to mention. The menu row, the E key and the ability
  // box all send the same commander out of the same zone, and the log should
  // say so whichever one you reached for.
  const note = params.note ?? (cardById(params.card)?.zone === "command" ? "from command zone" : undefined);
  const res = await act("cast", { ...params, ...(note ? { note } : {}) });
  if (res.ok && shouldAdvance) void act("set_phase", { phase: "main 1" });
  return res;
}

/** Which step the table is on, and the context it was chosen with. The one
 *  place the precedence list is walked — the component, the SPACE key and the
 *  sound queue all want the same answer, and three copies of the find() is
 *  three chances for them to disagree about what the table is asking. */
export function currentStep(view: GameView | null = gameView()): { rule: Step; ctx: Ctx } | null {
  if (!view?.started) return null;
  const ctx = nextActionContext(view);
  const rule = NEXT_ACTION_STEPS.find((r) => r.when(ctx));
  return rule ? { rule, ctx } : null;
}

/** The action the table is asking for right now, or null. */
export function currentNextAction(): NextAction | null {
  const cur = currentStep();
  return cur ? cur.rule.step(cur.ctx) : null;
}

/** SPACE takes the floating next action, SHIFT+SPACE passes the turn.
 *  Lives here, not beside the component: a non-component export from a .tsx
 *  file costs that file its Fast Refresh. */
export function fireNextAction(shift: boolean) {
  const a = currentNextAction();
  if (!a) return;
  // SHIFT+SPACE is "I am done, take it" and means that from anywhere. It used
  // to be offered only by steps that opted in, which made a shortcut you had
  // to check the prompt before trusting — the whole value of one is that it
  // works without looking.
  if (shift) return void passTurnToAgent();
  a.fn?.();
}
