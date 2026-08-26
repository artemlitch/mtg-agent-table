// Sound used to be fourteen regexes run over the log's English, which made
// every log sentence in server/game.ts a frozen string: reword one and the
// table silently changes what it sounds like, with nothing to fail. The server
// names the event now and the client maps the name to a sound, so these tests
// guard the two joints that replaced the guessing — the vocabulary matching on
// both sides, and every name in it having been given a sound.
import { describe, expect, it, vi } from "vitest";
import SOUNDS from "../client/public/sounds.json";
import { GAME_EVENTS as SERVER_EVENTS } from "../server/game";
import type { Card, GameView, LogEntry, StackItem } from "../client/src/types";

globalThis.localStorage ??= { getItem: () => null, setItem: () => {} } as unknown as Storage;

const { GAME_EVENTS: CLIENT_EVENTS } = await import("../client/src/types");
const { EVENT_SOUND, processSounds, soundFor } = await import("../client/src/game/sounds");
const { NEXT_ACTION_STEPS } = await import("../client/src/features/nextaction/steps");
const { useGame } = await import("../client/src/store/game");

const SOUND_IDS = Object.keys(SOUNDS);

describe("the event vocabulary", () => {
  // The server writes these names and the client reads them; nothing at
  // runtime checks that they are the same words. A name only one side knows is
  // a sound that quietly stops happening, which is the failure the regexes had
  // and the whole reason for the tags.
  it("is the same list on both sides", () => {
    expect([...CLIENT_EVENTS]).toEqual([...SERVER_EVENTS]);
  });

  it("gives every event a sound that sfx.js can actually make", () => {
    for (const event of CLIENT_EVENTS) {
      expect(SOUND_IDS, `${event} has no sound`).toContain(EVENT_SOUND[event]);
    }
  });

  // Only lines the client acts on are named, so an event nobody maps is dead
  // vocabulary — and one that maps to a sound the lab has never heard of is a
  // silent no-op at the speaker.
  it("has no sounds mapped for names outside the vocabulary", () => {
    expect(Object.keys(EVENT_SOUND).sort()).toEqual([...CLIENT_EVENTS].sort());
  });

  it("only sounds the turn pass for your own seat", () => {
    const pass = (actor: LogEntry["actor"]): LogEntry => ({ seq: 1, ts: 0, actor, text: "…", event: "turn_pass_declared" });
    expect(soundFor(pass("you"))).toBe("passturn");
    // the round line that follows the agent's pass already glimmers
    expect(soundFor(pass("agent"))).toBeNull();
  });

  // The old rules matched inside an undo notice, because a notice QUOTES the
  // line it took back — undoing a land drop thumped, undoing an attack drummed.
  // It took a rule of its own to mute. Notices carry no event, so nothing here
  // has to know they exist.
  it("says nothing for a line with no event, an undo notice included", () => {
    expect(soundFor({ seq: 1, ts: 0, actor: "system", text: "↩ Player undid: Player played Swamp — land drop" })).toBeNull();
    expect(soundFor({ seq: 2, ts: 0, actor: "you", text: "Player's life is now 37" })).toBeNull();
  });
});

describe("step sounds", () => {
  it("name a sound sfx.js can make", () => {
    for (const step of NEXT_ACTION_STEPS) {
      if (step.sound) expect(SOUND_IDS, `${step.id} has no such sound`).toContain(step.sound);
    }
  });
});

describe("what actually reaches the speaker", () => {
  const played: string[] = [];
  (globalThis as any).SFX = { play: (n: string) => played.push(n), SOUNDS: {}, tone: () => {}, noise: () => {} };

  let seq = 0;
  const line = (text: string, event?: LogEntry["event"], actor: LogEntry["actor"] = "you"): LogEntry =>
    ({ seq: ++seq, ts: 0, actor, text, ...(event ? { event } : {}) });

  function view(log: LogEntry[], extra: Partial<GameView> = {}): GameView {
    return {
      started: true,
      turn: "you",
      turnNumber: 4,
      phase: "main 1",
      stack: [] as StackItem[],
      log,
      players: {
        you: { life: 40, commanderDamage: {}, commanderTax: 0, counts: {}, zones: { battlefield: [] as Card[], hand: [], graveyard: [], exile: [], library: [], command: [] } },
        agent: { life: 40, commanderDamage: {}, commanderTax: 0, counts: {}, zones: { battlefield: [] as Card[], hand: [], graveyard: [], exile: [], library: [], command: [] } },
      },
      ...extra,
    } as unknown as GameView;
  }

  /** Run one view through and collect what it played. The queue staggers by
   *  140ms so a busy moment does not arrive as one chord. */
  function run(v: GameView): string[] {
    played.length = 0;
    useGame.setState({ view: v }); // the steps that scan the log read the store
    processSounds(v);
    vi.advanceTimersByTime(1000);
    return [...played];
  }

  it("plays the events, once each, and never the history", () => {
    vi.useFakeTimers();
    const history = [line("— Round 4: Player's turn —", "round_start")];
    // the first view after a page load only marks where we are, or every
    // sound of the game so far arrives at once
    expect(run(view(history))).toEqual([]);

    const cast = line("Player cast Bear → on the stack", "cast");
    const resolve = line("Bear resolved → Player's battlefield", "permanent_resolved");
    expect(run(view([...history, cast, resolve]))).toEqual(["stack", "thump"]);

    // and the same array again is not the same events again
    expect(run(view([...history, cast, resolve]))).toEqual([]);
    vi.useRealTimers();
  });

  it("plays one sound for a run of the same event", () => {
    vi.useFakeTimers();
    const base = [line("— Round 5: Player's turn —", "round_start")];
    run(view(base));
    const casts = [line("Player cast A → on the stack", "cast"), line("Player cast B → on the stack", "cast")];
    expect(run(view([...base, ...casts]))).toEqual(["stack"]);
    vi.useRealTimers();
  });

  // The prompt is the other thing that makes a noise, and it is not an event
  // in the game: a question is something SAID, and talk writes no log entry to
  // hang a sound off. Nothing else at the table tells you the agent has
  // stopped and is waiting on you.
  it("sounds the prompt arriving at a step that asks something new", () => {
    vi.useFakeTimers();
    const base = [line("— Round 6: Player's turn —", "round_start")];
    run(view(base));
    // same log, so the only thing that changed is what the table is asking
    expect(run(view(base, { pendingQuestion: "Do you have a response?" }))).toEqual(["glimmer"]);
    // and it does not ask twice
    expect(run(view(base, { pendingQuestion: "Do you have a response?" }))).toEqual([]);
    vi.useRealTimers();
  });

  // A rewind takes log entries away and a redo puts them back, and "where we
  // got to" was being read off the log's own last entry — so the entries came
  // back looking new and sounded a second time. Undoing and redoing a card
  // played from hand replayed its whole gesture into the room.
  //
  // The server keeps game.seq monotonic across a restore for exactly this kind
  // of reason (see restore() in server/history.ts): a seq is never handed out
  // twice, so a seq already heard is already heard, whatever the log currently
  // holds. The marker is a high-water mark, not a cursor.
  it("does not replay a sound when a rewind hands the same entries back", () => {
    vi.useFakeTimers();
    const base = [line("— Round 7: Player's turn —", "round_start")];
    run(view(base));

    const cast = line("Player cast Meltstrider's Resolve → on the stack", "cast");
    const phase = line("Player moves to main 1", "phase_change");
    expect(run(view([...base, cast, phase]))).toEqual(["stack", "phase"]);

    // ↩ — the two entries are gone and a notice stands where they were. A
    // notice carries no event, so it makes no sound of its own.
    const notice = line("↩ Player undid: Player cast Meltstrider's Resolve → on the stack", undefined, "system");
    expect(run(view([...base, notice]))).toEqual([]);

    // ↪ — and back they come, with the seqs they already had
    expect(run(view([...base, cast, phase, notice, line("↪ Player redid: …", undefined, "system")]))).toEqual([]);
    vi.useRealTimers();
  });

  it("still sounds a genuinely new action after a rewind", () => {
    vi.useFakeTimers();
    const base = [line("— Round 8: Player's turn —", "round_start")];
    run(view(base));
    const drew = line("Player drew 1 card", "drew");
    expect(run(view([...base, drew]))).toEqual(["draw"]);

    const notice = line("↩ Player undid: Player drew 1 card", undefined, "system");
    expect(run(view([...base, notice]))).toEqual([]);
    // the server never re-issues a seq, so a real new play always outranks the
    // high-water mark
    expect(run(view([...base, notice, line("Player played Swamp — land drop", "land_played")]))).toEqual(["thump"]);
    vi.useRealTimers();
  });
});
