// Dice notation, the way a Magic card asks for it: "roll a d20", "roll two
// six-sided dice", "roll a d6 and add 2". The parser is the only thing that
// decides what a typed /roll means, and the server is the only thing that
// rolls — so both live on the server side of the wire and both are tested
// here, with a stubbed source of randomness so the results are checkable.
import { describe, expect, it } from "vitest";
import { formatRoll, parseDice, rollDice } from "../server/dice";

/** A random source that walks a fixed list, so a roll is a known number.
 *  Values are the die faces wanted, converted back to the [0,1) that
 *  rollDice consumes. */
const faces = (...wanted: number[]) => {
  let i = 0;
  return (sides: number) => {
    const face = wanted[i++ % wanted.length];
    return (face - 1) / sides;
  };
};

describe("reading dice notation", () => {
  it("reads the plain forms a card asks for", () => {
    expect(parseDice("1d20")).toEqual({ count: 1, sides: 20, modifier: 0 });
    expect(parseDice("1d4")).toEqual({ count: 1, sides: 4, modifier: 0 });
    expect(parseDice("2d8")).toEqual({ count: 2, sides: 8, modifier: 0 });
    expect(parseDice("10d10")).toEqual({ count: 10, sides: 10, modifier: 0 });
  });

  it("requires the number of dice, even when it is one", () => {
    // the bare form reads as a die rather than as a roll, and half of "how
    // many" being optional is how "d6" and "6d6" end up looking alike
    const out = parseDice("d6");
    expect(typeof out).toBe("string");
    expect(out).toContain("1d6");
  });

  it("reads a modifier, either sign", () => {
    // "roll a d20 and add the number of creature cards in your graveyard"
    expect(parseDice("1d20+3")).toEqual({ count: 1, sides: 20, modifier: 3 });
    expect(parseDice("2d6-1")).toEqual({ count: 2, sides: 6, modifier: -1 });
  });

  it("does not care about case or the spaces around the parts", () => {
    expect(parseDice("  2D6 + 1 ")).toEqual({ count: 2, sides: 6, modifier: 1 });
    expect(parseDice("1D100")).toEqual({ count: 1, sides: 100, modifier: 0 });
  });

  it("refuses what it cannot roll, with a reason", () => {
    for (const bad of ["", "d", "20", "2d", "d6", "d20+3", "1d0", "1d1", "0d6", "two d6", "d6d6", "2x6"]) {
      const out = parseDice(bad);
      expect(typeof out, `${JSON.stringify(bad)} should be rejected`).toBe("string");
    }
  });

  it("refuses a roll too big to be a real table action", () => {
    // a cap, not an opinion: 100 dice of 1000 sides is someone's typo, and an
    // unbounded count is a log line nobody can read
    expect(typeof parseDice("101d6")).toBe("string");
    expect(typeof parseDice("1d1001")).toBe("string");
    expect(parseDice("100d1000")).toEqual({ count: 100, sides: 1000, modifier: 0 });
  });
});

describe("rolling", () => {
  it("rolls each die and totals them", () => {
    const r = rollDice({ count: 3, sides: 6, modifier: 0 }, faces(4, 1, 6));
    expect(r.rolls).toEqual([4, 1, 6]);
    expect(r.total).toBe(11);
  });

  it("adds the modifier to the total once, not to each die", () => {
    const r = rollDice({ count: 2, sides: 6, modifier: 5 }, faces(3, 3));
    expect(r.rolls).toEqual([3, 3]);
    expect(r.total).toBe(11);
  });

  it("stays inside the faces of the die at both ends", () => {
    // the two edges of the [0,1) source, which is where an off-by-one lives
    const low = rollDice({ count: 1, sides: 20, modifier: 0 }, () => 0);
    const high = rollDice({ count: 1, sides: 20, modifier: 0 }, () => 0.999999);
    expect(low.rolls).toEqual([1]);
    expect(high.rolls).toEqual([20]);
  });

  it("never leaves the range over many real rolls", () => {
    for (let i = 0; i < 2000; i++) {
      const [face] = rollDice({ count: 1, sides: 6, modifier: 0 }).rolls;
      expect(Number.isInteger(face)).toBe(true);
      expect(face).toBeGreaterThanOrEqual(1);
      expect(face).toBeLessThanOrEqual(6);
    }
  });
});

describe("saying what was rolled", () => {
  it("says just the number for a single die, and still names the one die", () => {
    expect(formatRoll({ count: 1, sides: 20, modifier: 0, rolls: [17], total: 17 })).toBe("1d20 → 17");
  });

  it("shows every die when there is more than one, and the total", () => {
    expect(formatRoll({ count: 3, sides: 6, modifier: 0, rolls: [4, 1, 6], total: 11 })).toBe("3d6 → 4, 1, 6 = 11");
  });

  it("shows the modifier as the arithmetic it is", () => {
    expect(formatRoll({ count: 1, sides: 20, modifier: 3, rolls: [9], total: 12 })).toBe("1d20+3 → 9 + 3 = 12");
    expect(formatRoll({ count: 2, sides: 6, modifier: -1, rolls: [5, 2], total: 6 })).toBe("2d6-1 → 5, 2 − 1 = 6");
  });
});
