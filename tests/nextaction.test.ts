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
}: { mine?: Card[]; stack?: StackItem[]; log?: LogEntry[]; phase?: string }): GameView {
  return {
    started: true,
    turn: "you",
    turnNumber: 4,
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

describe("the combat prompt, step by step", () => {
  it("asks you to declare as soon as you reach combat", () => {
    const { id, action } = prompt(view({ mine: [creature("bear")], log: [ENTERED()] }));
    expect(id).toBe("finish-attacks");
    expect(action?.label).toBe("Finish declaring attackers");
    expect(action?.sub).toBeUndefined(); // nothing declared yet
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
    // the turn, and the prompt had fallen through to "Begin main phase 2"
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
