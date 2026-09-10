// Dice, for the cards that ask for them — "roll a d20", "roll a d6 and add 2",
// written at this table as 1d20 and 1d6+2: the count is never left out.
//
// The server rolls, never the client and never the agent. A die roll is shared
// information the moment it happens, and a seat that rolls its own dice is a
// seat that can quietly re-roll: the agent asks for a number the same way you
// do, through an action, and reads the result off the log like everybody else.
//
// Pure and dependency-free so the parser can be tested without a game: parse
// text to a spec, roll a spec into a result, format a result into the one line
// the log will carry.

export type DiceSpec = {
  count: number;
  sides: number;
  /** added to the total once, not to each die */
  modifier: number;
};

export type DiceResult = DiceSpec & {
  /** every face, in the order rolled */
  rolls: number[];
  total: number;
};

/** A caps, not an opinion. A hundred dice is already a log line nobody reads,
 *  and a thousand-sided die covers the d100 that percentile cards want. */
export const MAX_DICE = 100;
export const MAX_SIDES = 1000;
const MAX_MODIFIER = 1000;

/** `<count>d<sides>[+|-modifier]`, case- and space-insensitive. Returns the
 *  spec, or a sentence saying why it could not be read — the caller shows that
 *  to whoever typed it, so it is written to be read by a person.
 *
 *  The count is REQUIRED, one included: `1d6`, never `d6`. A bare `d6` names a
 *  die rather than a roll, and leaving half of "how many" optional is what
 *  makes `d6` and `6d6` look alike at a glance in a log full of numbers. */
export function parseDice(input: string): DiceSpec | string {
  const text = String(input ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!text) return "Roll what? Try 1d20, 2d6, or 1d20+3.";

  // matched on its own so the bare form gets the answer it actually needs —
  // the number to add — rather than the generic "that is not dice"
  const bare = /^d(\d+)([+-]\d+)?$/.exec(text);
  if (bare) return `Say how many dice: 1d${bare[1]}${bare[2] ?? ""}, not d${bare[1]}${bare[2] ?? ""}.`;

  const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(text);
  if (!m) return `"${input.trim()}" is not dice. Write it like 1d20, 2d6, or 1d20+3.`;

  const count = Number(m[1]);
  const sides = Number(m[2]);
  const modifier = m[3] ? Number(m[3]) : 0;

  if (count < 1) return "Rolling no dice is not a roll — try 1d6.";
  if (count > MAX_DICE) return `${count} dice is more than the table can hold (max ${MAX_DICE}).`;
  // a one-sided die is not a die, and a zero-sided one is a divide by nothing
  if (sides < 2) return `A d${sides} has nothing to roll — a die needs at least 2 sides.`;
  if (sides > MAX_SIDES) return `A d${sides} is bigger than any card asks for (max d${MAX_SIDES}).`;
  if (Math.abs(modifier) > MAX_MODIFIER) return `A modifier of ${modifier} is out of range.`;

  return { count, sides, modifier };
}

/** The default source of randomness. Split out so a test can hand in a known
 *  sequence — `sides` is passed in for stubs that want to pick a face. */
const uniform = (_sides: number) => Math.random();

export function rollDice(spec: DiceSpec, random: (sides: number) => number = uniform): DiceResult {
  const rolls: number[] = [];
  for (let i = 0; i < spec.count; i++) {
    // floor of a [0,1) fraction across the faces: 0 is a 1, and anything short
    // of 1 is at most the top face
    const face = Math.floor(random(spec.sides) * spec.sides) + 1;
    rolls.push(Math.min(Math.max(face, 1), spec.sides));
  }
  const total = rolls.reduce((a, b) => a + b, 0) + spec.modifier;
  return { ...spec, rolls, total };
}

/** How the roll is written in the notation it was asked for: `2d6+1`.
 *
 *  Always with the count, one included — this has to round-trip back through
 *  parseDice (the action builds notation out of loose numbers that way), and
 *  the bare form no longer parses. */
export function formatSpec(spec: DiceSpec): string {
  const mod = spec.modifier === 0 ? "" : spec.modifier > 0 ? `+${spec.modifier}` : String(spec.modifier);
  return `${spec.count}d${spec.sides}${mod}`;
}

/** The one line the log carries. A single die with no modifier is just its
 *  number — the arithmetic only shows up when there is arithmetic to show. */
export function formatRoll(result: DiceResult): string {
  const faces = result.rolls.join(", ");
  const head = `${formatSpec(result)} → ${faces}`;
  if (result.modifier === 0) return result.rolls.length === 1 ? head : `${head} = ${result.total}`;
  // a real minus sign, because the notation above already spent the hyphen
  const mod = result.modifier > 0 ? `+ ${result.modifier}` : `− ${Math.abs(result.modifier)}`;
  return `${head} ${mod} = ${result.total}`;
}
