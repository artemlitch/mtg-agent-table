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
}: { mine?: Card[]; stack?: StackItem[]; log?: LogEntry[]; phase?: string; turnNumber?: number }): GameView {
  return {
    started: true,
    turn: "you",
    turnNumber,
    phase,
    stack,
    log: [line("— Round 4: Player's turn —", "you"), ...log],
    players: {
      you: { life: 40, commanderDamage: {}, commanderTax: 0, counts: {}, zones: { battlefield: mine, hand: [], graveyard: [], exile: [], library: [], command: [] } },
      agent: { life: 40, commanderDamage: {}, commanderTax: 0, counts: {}, zones: { battlefield: [], hand: [], graveyard: [], exile: [], library: [], command: [] } },
    },
  } as unknown as GameView;
}

/** What the prompt would show, and what pressing it would do. */
function prompt(v: GameView) {
  useGame.setState({ view: v }); // the steps that scan the log read the store
  const ctx = nextActionContext(v);
  const rule = NEXT_ACTION_STEPS.find((r) => r.when(ctx));
  return { id: rule?.id, action: rule?.step(ctx) ?? null };
}

const ENTERED = () => line("Player moves to combat");
const LOCKED = () => line("Attacks locked in: Bear → Agent (attackers tapped)");
const DAMAGE = () => line("Player put on the stack: go to damage — declare blockers if you have any, then announce combat damage");

// A new game opens where every other turn opens, at untap/upkeep — see
// newGameState in server/game.ts, which used to start at main 1 and skip the
// step the turn pass gives every later turn.
describe("the first turn", () => {
  const fresh = (log: LogEntry[] = []) => view({ turnNumber: 1, phase: "untap/upkeep", log });

  it("says nothing while you are still settling in", () => {
    expect(prompt(fresh()).action).toBeNull();
  });

  it("still says nothing after a mulligan — that is the deal, not a play", () => {
    // one action leaving one line (mulligan() in server/game.ts). It used to
    // be move + shuffle + draw, and the "Player moved…" line read as the
    // player having started, so mulliganing jumped the prompt into the turn
    expect(prompt(fresh([line("Player mulliganed to 7")])).action).toBeNull();
    expect(prompt(fresh([line("Player mulliganed to 7"), line("Player mulliganed to 6")])).action).toBeNull();
  });

  it("opens on the main phase once you have actually played something", () => {
    const { id, action } = prompt(fresh([line("Player mulliganed to 7"), line("Player played Island — land drop")]));
    expect(id).toBe("main-1");
    expect(action?.label).toBe("untap → main phase 1");
  });

  it("never offers the first-turn draw", () => {
    expect(prompt(fresh([line("Player played Island — land drop")])).id).not.toBe("draw");
  });
});

// The offer that rides over your hand. Same question the prompt's opening
// silence asks, so it shares the pattern.
describe("when the mulligan offer is on the table", () => {
  const opening = (over: Partial<Parameters<typeof view>[0]> = {}) =>
    view({ turnNumber: 1, phase: "untap/upkeep", mine: [], ...over });
  const withHand = (log: LogEntry[] = []) => {
    const v = opening({ log });
    v.players.you.zones.hand = [{ id: "h1" } as Card];
    return v;
  };

  it("is offered on your opening turn with cards in hand", () => {
    expect(canMulligan(withHand())).toBe(true);
  });

  it("stays offered however many times you take it — the table counts nothing", () => {
    expect(canMulligan(withHand([line("Player mulliganed to 7")]))).toBe(true);
    expect(canMulligan(withHand([line("Player mulliganed to 7"), line("Player mulliganed to 7")]))).toBe(true);
  });

  it("is gone the moment you play something", () => {
    expect(canMulligan(withHand([line("Player played Island — land drop")]))).toBe(false);
  });

  it("is gone past the opening turn, and on the agent's turn", () => {
    const later = withHand();
    later.turnNumber = 2;
    expect(canMulligan(later)).toBe(false);
    const theirs = withHand();
    theirs.turn = "agent";
    expect(canMulligan(theirs)).toBe(false);
  });

  it("is not offered with an empty hand, or before the game is dealt", () => {
    expect(canMulligan(opening())).toBe(false);
    const undealt = withHand();
    undealt.started = false;
    expect(canMulligan(undealt)).toBe(false);
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

  it("still just says it is waiting while the agent actually has priority", () => {
    const { action } = prompt(theirTurn("agent"));
    expect(action?.hint).toMatch(/waiting/i);
    expect(action?.fn).toBeUndefined();
  });
});

describe("the combat prompt, step by step", () => {
  it("asks you to declare as soon as you reach combat", () => {
    const { id, action } = prompt(view({ mine: [creature("bear")], log: [ENTERED()] }));
    expect(id).toBe("finish-attacks");
    expect(action?.label).toBe("Finish declaring attackers");
    expect(action?.sub).toBeUndefined(); // nothing declared yet
  });

  it("says the agent is thinking while it is, not just that we are waiting", () => {
    // the press DID land and the agent DID wake — it just took a minute, and
    // an unchanged prompt through a sixty-second window reads as a dead press
    const v = view({ mine: [creature("bear")], stack: [declaration("d1", "bear")], log: [ENTERED()] });
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
      stack: [declaration("d1", "bear"), declaration("d2", "wolf")],
      log: [ENTERED()],
    });
    (v as any).waitingOn = "agent";
    const { id, action } = prompt(v);
    expect(id).toBe("finish-attacks");
    expect(action?.fn).toBeUndefined();
    expect(action?.hint).toMatch(/waiting/i);
  });

  it("counts every declaration, because each tap pushes its own", () => {
    const { id, action } = prompt(
      view({
        mine: [creature("bear"), creature("wolf")],
        stack: [declaration("d1", "bear"), declaration("d2", "wolf")],
        log: [ENTERED()],
      })
    );
    // the bug this replaces: the second declaration made the top item differ
    // from the first, and "waiting for the agent" took over
    expect(id).toBe("finish-attacks");
    expect(action?.sub).toBe("2 attacking");
  });

  it("hands over to the agent once you finish, and waits while it holds an item", () => {
    const other = { id: "s1", player: "agent", text: "some agent item" } as StackItem;
    expect(prompt(view({ stack: [other], log: [ENTERED()] })).id).toBe("resolve-one");
  });

  it("asks for damage once the attackers are locked in", () => {
    const { id, action } = prompt(view({ mine: [creature("bear", { attacking: "agent" })], log: [ENTERED(), LOCKED()] }));
    expect(id).toBe("combat-damage");
    expect(action?.label).toBe("Go to damage");
  });

  it("moves on once damage has been asked for", () => {
    const v = view({ mine: [creature("bear", { attacking: "agent" })], log: [ENTERED(), LOCKED(), DAMAGE()] });
    expect(prompt(v).id).toBe("past-combat");
  });
});

describe("what used to break it", () => {
  it("ignores the agent TALKING about combat damage", () => {
    // the agent narrates constantly; "please announce combat damage" is not
    // combat damage, and reading it as such stood combat down for the turn
    const v = view({
      mine: [creature("bear", { attacking: "agent" })],
      log: [ENTERED(), LOCKED(), said("Please announce combat damage on the stack and I will resolve it.")],
    });
    expect(prompt(v).id).toBe("combat-damage");
  });

  it("gives a second combat in the same turn its own declare window", () => {
    // undo back past combat and swing again: the first combat's damage is
    // still in the log, and "did damage happen this turn" says yes forever
    const v = view({
      mine: [creature("bear")],
      log: [ENTERED(), LOCKED(), DAMAGE(), line("↩ Player undid: Player moves to combat"), ENTERED()],
    });
    expect(prompt(v).id).toBe("finish-attacks");
  });

  it("and its own damage step", () => {
    const v = view({
      mine: [creature("bear", { attacking: "agent" })],
      log: [ENTERED(), LOCKED(), DAMAGE(), ENTERED(), LOCKED()],
    });
    expect(prompt(v).id).toBe("combat-damage");
  });

  it("still shows the declare prompt with attackers declared after an earlier combat", () => {
    // the case actually hit in play: two declarations live, damage earlier in
    // the turn, and the prompt had fallen through to "combat → main phase 2"
    const v = view({
      mine: [creature("bear"), creature("wolf")],
      stack: [declaration("d1", "bear"), declaration("d2", "wolf")],
      log: [ENTERED(), LOCKED(), DAMAGE(), ENTERED()],
    });
    const { id, action } = prompt(v);
    expect(id).toBe("finish-attacks");
    expect(action?.sub).toBe("2 attacking");
  });
});
