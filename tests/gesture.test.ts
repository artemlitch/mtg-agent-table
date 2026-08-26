// One gesture, one action.
//
// SHIFT+E on a card in hand — say what it does, put it on the stack — used to
// be three server actions: the cast, a phase advance fired behind the cast,
// and the trigger pushed after both. Three actions is three undo steps, three
// broadcasts and three sounds for one keystroke. A live game hit it: the
// player took the card back and cmd+Z had to be pressed five times to get
// where they started, hearing their own gesture replayed on the way.
import { describe, expect, it, beforeEach } from "vitest";
import type { Card } from "../client/src/types";

globalThis.localStorage ??= { getItem: () => null, setItem: () => {} } as unknown as Storage;

const { announceOnStack, announcementText } = await import("../client/src/game/announce");

/** Every action the gesture sent, in order. */
const sent: { type: string; params: any }[] = [];
globalThis.fetch = (async (_url: string, init: any) => {
  sent.push(JSON.parse(init.body));
  return { json: async () => ({ ok: true }) };
}) as unknown as typeof fetch;

const card = (extra: Partial<Card> = {}): Card =>
  ({ id: "c1", name: "Meltstrider's Resolve", owner: "you", controller: "you", zone: "hand", typeLine: "Enchantment — Aura", ...extra }) as Card;

beforeEach(() => {
  sent.length = 0;
});

describe("announcing a card from hand", () => {
  it("is a single action — the card and its trigger in one batch", async () => {
    await announceOnStack(card(), "enchant Bear, it gets +2/+0");
    expect(sent.length).toBe(1);
    expect(sent[0].type).toBe("stack_batch");
    expect(sent[0].params.items).toEqual([
      { card: "c1" },
      { text: "Meltstrider's Resolve enters the battlefield: enchant Bear, it gets +2/+0", source: "c1" },
    ]);
  });

  it("does not send a phase advance of its own", async () => {
    // playCard used to watch the next-action prompt and fire set_phase behind
    // the cast. Moving on is the server's to record, inside the same action.
    await announceOnStack(card(), "draw a card");
    expect(sent.map((a) => a.type)).not.toContain("set_phase");
  });

  it("does not say a spell enters the battlefield — it resolves", async () => {
    await announceOnStack(card({ typeLine: "Instant" }), "destroy target creature");
    expect(sent[0].params.items[1].text).toBe("Meltstrider's Resolve: destroy target creature");
  });

  it("says the same thing for a commander waiting in the command zone", async () => {
    // and never names the zone itself: where a card is cast from is the
    // server's to write into the log (see cast in server/game.ts)
    await announceOnStack(card({ zone: "command", typeLine: "Legendary Creature — Vampire" }), "each opponent loses 2 life");
    expect(sent.length).toBe(1);
    expect(sent[0].params.items[0]).toEqual({ card: "c1" });
  });

  it("keeps a hidden card hidden in the line it writes", () => {
    expect(announcementText(card({ hidden: true } as Partial<Card>), "something")).toBe("? enters the battlefield: something");
  });
});

describe("announcing an ability from the battlefield", () => {
  const onTable = () => card({ zone: "battlefield", typeLine: "Creature — Bear" });

  it("is one push, and never claims the card is entering", async () => {
    await announceOnStack(onTable(), "deal 2 damage to any target");
    expect(sent.length).toBe(1);
    expect(sent[0].type).toBe("stack_push");
    expect(sent[0].params).toEqual({ text: "Meltstrider's Resolve: deal 2 damage to any target", source: "c1" });
  });

  it("taps first when the ability pays with the card itself", async () => {
    // deliberately its own action: tapping for a cost is a move at this table
    // — it is how the agent does it, and E on the card is what undoes it —
    // and a batch is a proposal about the stack, not about the board
    await announceOnStack(onTable(), "add {G}", { tapToo: true });
    expect(sent.map((a) => a.type)).toEqual(["tap", "stack_push"]);
    expect(sent[0].params).toEqual({ cards: ["c1"], tapped: true });
  });

  it("does not tap one that is already tapped", async () => {
    await announceOnStack(onTable(), "add {G}", { tapToo: true });
    sent.length = 0;
    await announceOnStack(card({ zone: "battlefield", tapped: true }), "add {G}", { tapToo: true });
    expect(sent.map((a) => a.type)).toEqual(["stack_push"]);
  });

  it("nothing arriving ever taps, however the box was submitted", async () => {
    await announceOnStack(card(), "enters with a counter", { tapToo: true });
    expect(sent.map((a) => a.type)).toEqual(["stack_batch"]);
  });
});
