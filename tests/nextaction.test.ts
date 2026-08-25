// The next-action prompt is a precedence list: the first step whose when() is
// true wins. It is a state machine over the board, the stack and the log, and
// it had no tests — which is how a chat message from the agent came to stand
// the whole of combat down.
import { describe, expect, it } from "vitest";
import type { Card, GameView, LogEntry, StackItem } from "../client/src/types";

// the UI store reads a saved preference the moment it is imported, and these
// tests run in node — the steps only need it to exist, never to remember
globalThis.localStorage ??= { getItem: () => null, setItem: () => {} } as unknown as Storage;

const { NEXT_ACTION_STEPS, nextActionContext } = await import("../client/src/features/nextaction/steps");
const { canMulligan } = await import("../client/src/game/rules");
const { useGame } = await import("../client/src/store/game");

let seq = 0;
const line = (text: string, actor: LogEntry["actor"] = "you"): LogEntry => ({ seq: ++seq, ts: 0, actor, text });
const said = (text: string) => line(`💬 Agent: ${text}`, "agent");
const creature = (id: string, extra: Partial<Card> = {}): Card =>
  ({ id, name: id, typeLine: "Creature — Bear", controller: "you", owner: "you", zone: "battlefield", ...extra }) as Card;
const declaration = (id: string, ...attackers: string[]): StackItem =>
  ({ id, player: "you", text: `ATTACKS: ${attackers.join("; ")}`, attackPairs: attackers.map((a) => ({ attacker: a, target: "agent" })) }) as StackItem;

/** A board mid-combat on your turn, plus whatever the test needs on top. */
function view({
  mine = [] as Card[],
  stack = [] as StackItem[],
  log = [] as LogEntry[],
  phase = "combat",
  turnNumber = 4,
  combat = null as GameView["combat"],
}: {
  mine?: Card[];
  stack?: StackItem[];
  log?: LogEntry[];
  phase?: string;
  turnNumber?: number;
  combat?: GameView["combat"];
}): GameView {
  return {
    started: true,
    turn: "you",
    turnNumber,
    phase,
    combat,
    stack,
    log: [line("— Round 4: Player's turn —", "you"), ...log],
    players: {
      you: { life: 40, commanderDamage: {}, commanderTax: 0, counts: {}, turnDone: { untap: false, draw: false, lands: 0, acted: false }, zones: { battlefield: mine, hand: [], graveyard: [], exile: [], library: [], command: [] } },
      agent: { life: 40, commanderDamage: {}, commanderTax: 0, counts: {}, turnDone: { untap: false, draw: false, lands: 0, acted: false }, zones: { battlefield: [], hand: [], graveyard: [], exile: [], library: [], command: [] } },
    },
  } as unknown as GameView;
}

/** What the server says this turn has already seen — the facts these steps
 *  used to reconstruct by reading the log back to the round marker. */
const done = (v: GameView, patch: Partial<{ untap: boolean; draw: boolean; lands: number; acted: boolean }>) => {
  (v.players.you as any).turnDone = { untap: false, draw: false, lands: 0, acted: false, ...patch };
  return v;
};

/** What the prompt would show, and what pressing it would do. */
function prompt(v: GameView) {
  useGame.setState({ view: v }); // the steps that scan the log read the store
  const ctx = nextActionContext(v);
  const rule = NEXT_ACTION_STEPS.find((r) => r.when(ctx));
  return { id: rule?.id, action: rule?.step(ctx) ?? null };
}

// A new game opens where every other turn opens, at untap/upkeep — see
// newGameState in server/game.ts, which used to start at main 1 and skip the
// step the turn pass gives every later turn.
describe("the first turn", () => {
  const fresh = (log: LogEntry[] = []) => view({ turnNumber: 1, phase: "untap/upkeep", log });

  it("says nothing while you are still settling in", () => {
    expect(prompt(fresh()).action).toBeNull();
  });

  it("still says nothing after a mulligan — that is the deal, not a play", () => {
    // mulligan never marks acted on the server, so the view arrives unchanged
    expect(prompt(fresh()).action).toBeNull();
  });

  it("opens on the main phase once you have actually played something", () => {
    const { id, action } = prompt(done(fresh(), { acted: true }));
    expect(id).toBe("main-1");
    expect(action?.label).toBe("untap → main phase 1");
  });

  it("never offers the first-turn draw", () => {
    expect(prompt(done(fresh(), { acted: true })).id).not.toBe("draw");
  });
});

// The offer that rides over your hand. Every condition it used to check — the
// opening turn, whose turn it is, cards in hand, nothing played yet — is one
// fact on the view now, decided by the same server code that refuses the
// mulligan itself (tests/game.test.ts, "the turn knows what has already
// happened in it").
describe("the mulligan offer is the server's call", () => {
  it("shows exactly what the view says", () => {
    const v = view({});
    (v as any).canMulligan = true;
    expect(canMulligan(v)).toBe(true);
    (v as any).canMulligan = false;
    expect(canMulligan(v)).toBe(false);
    expect(canMulligan(null)).toBe(false);
  });
});

// Untapping and drawing are things the TURN remembers, not sentences to be
// found in the log. "Player untapped all" was one rewording away from an
// untap step that never stood down.
describe("untap and draw are turn facts, not log lines", () => {
  const upkeep = (patch: Parameters<typeof done>[1]) =>
    done(view({ phase: "untap/upkeep", mine: [creature("bear", { tapped: true })] }), patch);

  it("offers the untap until the view says it happened", () => {
    expect(prompt(upkeep({})).id).toBe("untap");
    expect(prompt(upkeep({ untap: true })).id).toBe("draw");
  });

  it("offers the draw until the view says it happened", () => {
    expect(prompt(upkeep({ untap: true, draw: true })).id).toBe("main-1");
  });
});

// During the agent's turn it hands priority back constantly — after a wipe,
// after a spell resolves, whenever it wants a response. The table has to say
// so, or the game sits there with each side waiting for the other.
describe("priority handed back during the agent's turn", () => {
  const theirTurn = (waitingOn: string) => {
    const v = view({ log: [line("Agent passes — Player's window", "agent")] });
    v.turn = "agent";
    (v as any).waitingOn = waitingOn;
    return v;
  };

  it("offers a way to pass back only when nothing else will wake the agent", () => {
    const { id, action } = prompt(theirTurn("you"));
    expect(id).toBe("waiting-on-agent-turn");
    expect(action?.fn).toBeTypeOf("function"); // a button, not a dead hint
    expect(action?.hint).toBeUndefined();
  });

  it("says nothing when a wake is already armed — resolving their item wakes them", () => {
    // stack_resolve is in the reactive set, so acknowledging an item already
    // brings the agent back. Asking to press Pass on top of that is ceremony
    // on almost every turn the agent takes.
    const v = theirTurn("you");
    (v as any).wakeAt = Date.now() + 3000;
    const { action } = prompt(v);
    expect(action?.fn).toBeUndefined();
    expect(action?.hint).toMatch(/waiting/i);
  });

  it("says nothing while the agent is mid-window either", () => {
    // wakeAt goes back to null the moment the countdown fires, and waitingOn
    // stays "you" until the agent passes — so the countdown alone let the
    // button reappear while the agent was thinking, where pressing it
    // preempts the very window being waited on
    const v = theirTurn("you");
    useGame.setState({ agentBusy: true });
    const { action } = prompt(v);
    useGame.setState({ agentBusy: false });
    expect(action?.fn).toBeUndefined();
    expect(action?.hint).toMatch(/thinking/i);
  });

  it("still just says it is waiting while the agent actually has priority", () => {
    const { action } = prompt(theirTurn("agent"));
    expect(action?.hint).toMatch(/waiting/i);
    expect(action?.fn).toBeUndefined();
  });
});

describe("the combat prompt, step by step", () => {
  it("asks you to declare as soon as you reach combat", () => {
    const { id, action } = prompt(view({ mine: [creature("bear")], combat: "attackers" }));
    expect(id).toBe("finish-attacks");
    expect(action?.label).toBe("Finish declaring attackers");
    expect(action?.sub).toBeUndefined(); // nothing declared yet
  });

  it("says the agent is thinking while it is, not just that we are waiting", () => {
    // the press DID land and the agent DID wake — it just took a minute, and
    // an unchanged prompt through a sixty-second window reads as a dead press
    const v = view({ mine: [creature("bear")], stack: [{ ...declaration("d1", "bear"), finished: true }], combat: "attackers" });
    (v as any).waitingOn = "agent";
    useGame.setState({ agentBusy: true });
    expect(prompt(v).action?.hint).toMatch(/thinking/i);
    useGame.setState({ agentBusy: false });
    expect(prompt(v).action?.hint).toMatch(/waiting/i);
  });

  it("stops offering the button once you have handed over", () => {
    // pressing it again cannot help — you have already passed — and each press
    // preempted the agent mid-thought and restarted it. Four presses meant
    // four interrupted windows and no progress.
    const v = view({
      mine: [creature("bear"), creature("wolf")],
      stack: [{ ...declaration("d1", "bear"), finished: true }, { ...declaration("d2", "wolf"), finished: true }],
      combat: "attackers",
    });
    (v as any).waitingOn = "agent";
    const { id, action } = prompt(v);
    expect(id).toBe("finish-attacks");
    expect(action?.fn).toBeUndefined();
    expect(action?.hint).toMatch(/waiting/i);
  });

  it("gives the button back when you amend a declaration you had already finished", () => {
    // Tapping one more creature after finishing reopens the declaration —
    // attack() deletes the finished flag — but nothing moves waitingOn back, so
    // it still points at the defender. Reading either fact as "handed over"
    // left the table hintlocked: the amendment was never sent, and there was no
    // button to send it with. What was DECLARED is the authority here.
    const v = view({
      mine: [creature("bear"), creature("wolf")],
      stack: [declaration("d1", "bear", "wolf")],
      combat: "attackers",
    });
    (v as any).waitingOn = "agent";
    const { id, action } = prompt(v);
    expect(id).toBe("finish-attacks");
    expect(action?.label).toBe("Finish declaring attackers");
    expect(action?.fn).toBeDefined();
  });

  it("stays down after you finish, even when the agent hands the window back", () => {
    // What actually happened: the agent never resolved the declaration. It
    // declared blocks on top of it, announced damage, and passed — so the
    // ATTACKS item was still on the stack, nothing of ours was marked
    // attacking, and waitingOn came back to "you" mid-combat. The button
    // returned and a second press re-declared an attack that had already
    // dealt its damage. The declaration's own `finished` flag is what stands
    // the step down now — no reading the log for who said what.
    const v = view({
      mine: [creature("bear")],
      stack: [{ ...declaration("d1", "bear"), finished: true }],
      combat: "attackers",
    });
    (v as any).waitingOn = "you";
    const { id, action } = prompt(v);
    expect(id).toBe("finish-attacks");
    expect(action?.fn).toBeUndefined(); // no button to press twice
    expect(action?.hint).toMatch(/waiting/i);
  });

  it("gives the button back when you undo the hand-over", () => {
    // undo restores the snapshot, and the snapshot's declaration has no
    // finished flag — no log-quoting regex required to know you took it back
    const v = view({ mine: [creature("bear")], stack: [declaration("d1", "bear")], combat: "attackers" });
    (v as any).waitingOn = "you";
    const { id, action } = prompt(v);
    expect(id).toBe("finish-attacks");
    expect(action?.label).toBe("Finish declaring attackers");
    expect(action?.fn).toBeDefined();
  });

  it("counts every attacker in the declaration, because tapping a second one amends it", () => {
    // attack() amends the open declaration rather than pushing a second item,
    // so two attackers are two pairs on ONE stack item — and the count has to
    // come from the pairs, not from how many items are sitting there
    const { id, action } = prompt(
      view({
        mine: [creature("bear"), creature("wolf")],
        stack: [declaration("d1", "bear", "wolf")],
        combat: "attackers",
      })
    );
    expect(id).toBe("finish-attacks");
    expect(action?.sub).toBe("2 attacking");
  });

  it("hands over to the agent once you finish, and waits while it holds an item", () => {
    const other = { id: "s1", player: "agent", text: "some agent item" } as StackItem;
    expect(prompt(view({ stack: [other], combat: "attackers" })).id).toBe("resolve-one");
  });

  it("names what locking in their attack actually reaches: the blockers step", () => {
    // it used to say "Go to damage", which was true when locking an attack in
    // was the last thing before damage. It opens the blockers step now, and the
    // next question is whether you block.
    const theirs = { ...declaration("a1", "Rat"), player: "agent" } as StackItem;
    const v = view({ mine: [creature("bear")], stack: [theirs], combat: "blockers" });
    (v as any).turn = "agent";
    const { id, action } = prompt(v);
    expect(id).toBe("lock-their-attack");
    expect(action?.label).toBe("Lock in their attack");
  });

  it("asks for damage once the attackers are locked in", () => {
    const { id, action } = prompt(view({ mine: [creature("bear", { attacking: "agent" })], combat: "blockers" }));
    expect(id).toBe("combat-damage");
    expect(action?.label).toBe("Go to damage");
  });

  it("keeps asking while the ask is all that has happened", () => {
    // Asking used to stand the step down, so one press moved the table to main
    // 2 whether or not damage ever landed. It did not land the turn the agent
    // read the combat procedure as "the attacker announces damage": three
    // damage and three commander damage were simply lost. Pushing the ask
    // moves nothing at the table, so the view still says the damage is owed.
    const v = view({ mine: [creature("bear", { attacking: "agent" })], combat: "blockers" });
    expect(prompt(v).id).toBe("combat-damage");
  });

  it("and keeps asking once the table is actually at the damage step", () => {
    const v = view({ mine: [creature("bear", { attacking: "agent" })], combat: "damage" });
    expect(prompt(v).id).toBe("combat-damage");
  });

  it("moves on once damage has actually landed", () => {
    const v = view({ mine: [creature("bear", { attacking: "agent" })], combat: "done" });
    expect(prompt(v).id).toBe("past-combat");
  });
});

describe("what used to break it", () => {
  it("ignores the agent TALKING about combat damage", () => {
    // the agent narrates constantly; "please announce combat damage" is not
    // combat damage, and reading it as such stood combat down for the turn.
    // The guard no longer looks at the log at all — this is the bug class the
    // view field exists to close.
    const v = view({
      mine: [creature("bear", { attacking: "agent" })],
      combat: "blockers",
      log: [said("Please announce combat damage on the stack and I will resolve it.")],
    });
    expect(prompt(v).id).toBe("combat-damage");
  });

  it("gives a second combat in the same turn its own declare window", () => {
    // undo back past combat and swing again: the first combat's damage is
    // still in the log, and "did damage happen this turn" says yes forever.
    // The view walks back to "attackers", which is the whole answer.
    const v = view({ mine: [creature("bear")], combat: "attackers" });
    expect(prompt(v).id).toBe("finish-attacks");
  });

  it("and its own damage step", () => {
    const v = view({ mine: [creature("bear", { attacking: "agent" })], combat: "blockers" });
    expect(prompt(v).id).toBe("combat-damage");
  });

  it("still shows the declare prompt with attackers declared after an earlier combat", () => {
    // the case actually hit in play: two declarations live, damage earlier in
    // the turn, and the prompt had fallen through to "combat → main phase 2"
    const v = view({
      mine: [creature("bear"), creature("wolf")],
      stack: [declaration("d1", "bear"), declaration("d2", "wolf")],
      combat: "attackers",
    });
    const { id, action } = prompt(v);
    expect(id).toBe("finish-attacks");
    expect(action?.sub).toBe("2 attacking");
  });
});

/** What pressing a prompt actually SENDS. act() posts to /api/action and
 *  nothing else, so a stubbed fetch is the whole recording. The body is built
 *  before the first await, so there is nothing to wait for. */
function pressed(fn: (() => void) | undefined) {
  const sent: { type: string; params: Record<string, unknown> }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = ((_url: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body));
    return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
  }) as unknown as typeof fetch;
  try {
    fn?.();
  } finally {
    globalThis.fetch = real;
  }
  return sent;
}

// Every fact this prompt knows about combat, it used to read back out of the
// log with a regex: entered, locked, finished, damaged. Those four are the
// combat STEPS, and the view carries the step itself now — so the prompt asks
// the table where combat is instead of reading what was said about it.
describe("combat comes from the view, not from the words in the log", () => {
  /** their attack, locked in, mid-combat — and NOTHING in the log about it */
  const theirAttack = (combat: string) => {
    const v = view({ phase: "combat", mine: [creature("blocker")] });
    (v as any).turn = "agent";
    (v as any).combat = combat;
    v.players.agent.zones.battlefield = [creature("Rat", { controller: "agent", owner: "agent", attacking: "you" })];
    return v;
  };

  it("asks for damage on a silent log, because the view says the damage step", () => {
    const v = view({ mine: [creature("bear", { attacking: "agent", tapped: true })], phase: "combat" });
    (v as any).combat = "damage";
    expect(prompt(v).id).toBe("combat-damage");
  });

  it("asks you to finish declaring on a silent log, because the view says so", () => {
    const v = view({ mine: [creature("bear")], stack: [declaration("d1", "bear")], phase: "combat" });
    (v as any).combat = "attackers";
    (v as any).waitingOn = "you";
    expect(prompt(v).id).toBe("finish-attacks");
  });

  it("stops asking for damage once the view says damage is done", () => {
    const v = view({ mine: [creature("bear", { attacking: "agent", tapped: true })], phase: "combat" });
    (v as any).combat = "done";
    expect(prompt(v).id).toBe("past-combat");
  });

  // seq 458: you are the one being attacked and the step is yours to answer
  it("offers the blocks answer while the view says the blockers step", () => {
    expect(prompt(theirAttack("blockers")).id).toBe("no-blocks");
  });

  // The bug this is really about. The button sends a SENTENCE — act("chat",
  // { text: "No blocks." }) — and the step then stands itself down by
  // recognising its own English back out of the log. Declining to block is a
  // declaration; it has to make one, or the table never learns that the
  // blockers step is over and damage stays illegal.
  it("declines blocks by declaring it, not by saying it", () => {
    const { action } = prompt(theirAttack("blockers"));
    const sent = pressed(action?.fn);
    expect(sent.map((s) => s.type)).toEqual(["block"]);
    expect(sent[0].params).toEqual({ pairs: [] });
  });

  it("stops offering it once the view says the step has moved on", () => {
    expect(prompt(theirAttack("damage")).id).not.toBe("no-blocks");
  });
});
