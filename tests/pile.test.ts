// Cards tuck under one another into piles. A shallow pile draws as a cascade
// of peeking corners; past a few cards that cascade covers the board and none
// of them can be read, so the pile collapses into one chonky stack instead.
import { describe, expect, it } from "vitest";
import { CHONKY_PILE_AT, chonkyPiles } from "../client/src/game/rules";
import type { Card } from "../client/src/types";

/** `under` points at the card ABOVE — the anchor is the one without it. */
const pile = (...ids: string[]): Card[] =>
  ids.map((id, i) => ({ id, under: i === 0 ? null : ids[i - 1] }) as Card);

describe("when a pile becomes a chonky stack", () => {
  it("leaves a shallow pile alone", () => {
    const { size, swallowed } = chonkyPiles(pile("a", "b", "c"));
    expect(size.size).toBe(0);
    expect(swallowed.size).toBe(0);
  });

  it("collapses one card deeper than that", () => {
    const board = pile("a", "b", "c", "d");
    expect(board.length).toBe(CHONKY_PILE_AT + 1);
    const { size, swallowed } = chonkyPiles(board);
    // the top still draws, and it is the one that knows the count
    expect(size.get("a")).toBe(4);
    // everything hanging beneath it is inside the stack now
    expect([...swallowed].sort()).toEqual(["b", "c", "d"]);
  });

  it("counts each pile on the board separately", () => {
    const { size, swallowed } = chonkyPiles([...pile("a", "b", "c", "d", "e"), ...pile("x", "y")]);
    expect(size.get("a")).toBe(5);
    expect(size.has("x")).toBe(false);
    expect(swallowed.has("y")).toBe(false);
  });

  it("never treats a loose card as a pile", () => {
    const { size } = chonkyPiles([{ id: "solo", under: null } as Card]);
    expect(size.size).toBe(0);
  });

  it("does not hang on a cycle", () => {
    // nothing should build one, but a bad `under` must not lock the board up
    const board = [{ id: "a", under: "b" }, { id: "b", under: "a" }] as Card[];
    const { size } = chonkyPiles(board);
    expect(size.size).toBe(0); // no anchor, so no pile — and it returned
  });
});
