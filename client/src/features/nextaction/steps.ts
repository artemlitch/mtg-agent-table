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
import { stackItemCard, stackSubText } from "../../game/rules";
import { gameView, useGame } from "../../store/game";
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
  iAmBlocking: boolean;
  myAttackers: Card[];
  /** my attack declarations sitting on the stack, not yet locked in: the one
   *  open declaration, still unresolved (attack() amends it in place — see
   *  server/game.ts) */
  myAttackDecls: StackItem[];
  /** how many creatures those declarations add up to */
  declared: number;
  /** my block declarations sitting on the stack, not yet locked in — the same
   *  shape as myAttackDecls from the other side of the combat (block() amends
   *  one open declaration in place, so in practice this is 0 or 1) */
  myBlockDecls: StackItem[];
  /** how many blockers those declarations add up to */
  blocking: number;
  /** where combat is, straight off the view — see CombatStep in server/game.ts */
  combat: GameView["combat"];
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

export function nextActionContext(view: GameView): Ctx {
  const stack = view.stack || [];
  const myAttackDecls = stack.filter((it) => it.player === "you" && !!it.attackPairs);
  const myBlockDecls = stack.filter((it) => it.player === "you" && !!it.blockPairs);
  const theirAttackers = view.players.agent.zones.battlefield.filter((c) => c.attacking);
  return {
    view,
    stack,
    top: stack.length ? stack[stack.length - 1] : null,
    mine: view.turn === "you",
    phase: view.phase || "",
    theirAttackers,
    iAmBlocking: view.players.you.zones.battlefield.some((c) => c.blocking),
    myAttackers: view.players.you.zones.battlefield.filter((c) => c.attacking),
    myAttackDecls,
    declared: myAttackDecls.reduce((n, it) => n + (it.attackPairs?.length ?? 0), 0),
    myBlockDecls,
    blocking: myBlockDecls.reduce((n, it) => n + (it.blockPairs?.length ?? 0), 0),
    combat: view.combat ?? null,
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
    // Resolving their ATTACKS item is not the way to damage any more — it opens
    // the blockers step, and the next thing asked of you is whether you block.
    // The old label promised the step after the one this press reaches.
    when: (c) => c.top?.player === "agent" && !!c.top.attackPairs,
    step: (c) => ({ label: "Lock in their attack", icon: "damage", fn: () => void act("stack_resolve", { item: c.top!.id }) }),
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
    // your own item on top — the agent answers it. Except a combat declaration
    // you have not finished: those are on the stack but have not been handed
    // over, and the agent is deliberately not looking at them (see wakePlanFor
    // in server/wake.ts), so saying it is waiting would be a lie. Blocks are
    // the same as attacks here — both are yours to finish, and the step that
    // owns each of them says so.
    when: (c) => !!c.top && !(c.top.player === "you" && (!!c.top.attackPairs || !!c.top.blockPairs)),
    step: (c) => ({ hint: waitingHint(c, "on the stack") }),
  },
  {
    id: "no-blocks",
    // The attack landing sounds like a phase moving along, because that is
    // what locking one in is. Being the seat that has to answer it is a
    // different thing and had no sound of its own — which is exactly the
    // moment that gets missed while you are looking at your own hand.
    sound: "block",
    // only while the blockers step is actually open — the table's own answer,
    // not a phase regex plus a memory of which attacks were waved through
    when: (c) =>
      !c.mine &&
      c.combat === "blockers" &&
      c.theirAttackers.length > 0 &&
      !c.iAmBlocking &&
      // your declaration may still be on the stack, unresolved — the step is
      // answered even though the view has not moved yet
      !c.stack.some((i) => i.player === "you" && !!i.blockPairs),
    step: () => ({
      label: "No blocks — take the damage",
      icon: "noBlocks",
      // a DECLARATION, not a sentence: block with no pairs is "no blocks",
      // the attacker locks it in, and that is what opens the damage step.
      // The old chat message left the table never learning blocks were
      // answered — the step recognised its own English back out of the log.
      //
      // ...and then finish it, because declaring nothing is a whole answer in
      // one press. Blockers stopped waking the agent when they became yours to
      // finish (see wakePlanFor in server/wake.ts), so the declaration on its
      // own now hands nothing over: this button would push an item nobody was
      // going to look at.
      fn: async () => {
        await act("block", { pairs: [] });
        await act("finish_blocks", {});
      },
    }),
  },
  {
    // Declaring blockers is yours to finish, exactly as declaring attackers is.
    // Pressing E on a blocker no longer wakes the agent (see wakePlanFor in
    // server/wake.ts) and every press amends the one declaration, so you can
    // gang three creatures onto one attacker without the agent locking the
    // first of them in while you are still deciding on the second — which is
    // what made a multi-block impossible to declare from the table at all.
    id: "finish-blocks",
    when: (c) => !c.mine && c.combat === "blockers" && c.myBlockDecls.length > 0,
    step: (c) =>
      // handed over already: pressing again cannot help and a second wake
      // preempts the window you are waiting for. The declaration carries
      // whether you finished, the same way the attack side does — and it is
      // the only authority, because declaring one more blocker clears the flag
      // while waitingOn still points at the attacker.
      c.myBlockDecls.every((d) => d.finished)
        ? { hint: waitingHint(c, "blocks declared") }
        : {
            label: "Finish declaring blockers",
            icon: "block",
            sub: c.blocking ? `${c.blocking} blocking` : "no blocks",
            title: "tap [e] a creature to block",
            fn: () => void act("finish_blocks", {}),
          },
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
      // same question the mulligan offer asks, and the server answers both
      c.mine && c.view.turnNumber === 1 && !c.view.players.you.turnDone.acted,
    step: () => null,
  },
  {
    id: "untap",
    when: (c) => c.phase === "untap/upkeep" && c.myTapped && !c.view.players.you.turnDone.untap,
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
    when: (c) => c.phase === "untap/upkeep" && c.view.turnNumber > 1 && !c.view.players.you.turnDone.draw,
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
    // The view says the attackers step is open; nothing of yours is attacking
    // yet. A second combat in the same turn reopens it by itself — the table
    // walks back to "attackers", so there is no turn history to keep.
    when: (c) => c.phase === "combat" && c.combat === "attackers" && c.myAttackers.length === 0,
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
      // stands the step down is YOU having finished, and the declaration
      // itself carries that: finish_attacks marks it, and undoing the
      // hand-over restores the item without the flag.
      //
      // And when there IS a declaration it is the only authority — waitingOn is
      // not a second opinion. Tapping one more creature after finishing amends
      // the declaration and clears the flag, but leaves waitingOn pointing at
      // the defender: reading that as "handed over" left the amendment
      // undeliverable, with a hint where the button should have been.
      (c.myAttackDecls.length ? c.myAttackDecls.every((d) => d.finished) : c.view.waitingOn === "agent")
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
    // Damage is owed from the moment your attackers are locked in until the
    // table says it landed. The view carries which of those it is, so a second
    // combat in the same turn is just the step reopening — no reading back
    // through the turn for the last "Damage applied" line.
    when: (c) => c.phase === "combat" && c.myAttackers.length > 0 && (c.combat === "blockers" || c.combat === "damage"),
    // Announcing damage is the agent's — the player never types a life total —
    // so this press is a hand-over, nothing more. It used to push a sentence
    // onto the stack telling the agent what to do next, from back when the
    // table could not say where combat was: the agent read prose or nothing.
    // game.combat carries the step now and the wake prompt reads it off the
    // state, so the sentence was a stack item nobody needed, arriving as work
    // to resolve on top of the work it was describing.
    step: (c) =>
      // Already handed over — same rule as finishing attackers: a second press
      // while the agent is mid-window preempts it and starts it over, which is
      // exactly what pressing again because nothing seemed to happen does.
      c.view.waitingOn === "agent"
        ? { hint: waitingHint(c, "damage owed") }
        : {
            label: "Go to damage",
            icon: "damage",
            fn: () => void act("done", {}),
          },
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

/** Cast a card. Nothing else: this used to fire a SECOND action behind the
 *  cast to advance the phase marker off the beginning step, and to work out
 *  which zone the card came from. Both are facts about the table rather than
 *  about the prompt, and both now happen inside cast itself (server/game.ts) —
 *  one action, one undo step, and the same behaviour whichever seat plays. */
export async function playCard(params: Record<string, any>): Promise<ActionResult> {
  return act("cast", params);
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
