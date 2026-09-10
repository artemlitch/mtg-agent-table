// Slash commands: the things you type into the composer that are not a message
// to the agent.
//
// One rule decides all of it, in one place, because the failure mode is
// specific and bad — a mistyped "/rol d20" that gets SAID to the opponent
// instead of rolled. So a line beginning with a slash is never chat: it either
// runs, or it comes back to you as a notice. Nothing in between reaches the
// table.
//
// What a command may not do is judge its own arguments. The server owns what
// counts as dice (server/dice.ts) and it is the only thing that rolls them; the
// notation goes across untouched and a bad one comes back as its error.

export type CommandOutcome =
  /** not a command — say it to the agent */
  | { kind: "chat"; text: string }
  /** run a table action */
  | { kind: "action"; type: string; params: Record<string, unknown> }
  /** show this to whoever typed it, and send nothing */
  | { kind: "notice"; message: string };

export interface CommandDef {
  /** the word after the slash, plus any aliases */
  names: string[];
  /** how it is written, for /help */
  usage: string;
  what: string;
  run(rest: string): CommandOutcome;
}

/** `/roll 2d6 Ancient Copper Dragon` — the dice first, the reason after. The
 *  split is on the first space, so the note is free text and the notation is
 *  never guessed at. */
function roll(rest: string): CommandOutcome {
  const [dice = "", ...words] = rest.split(/\s+/).filter(Boolean);
  const note = words.join(" ");
  return {
    kind: "action",
    type: "roll",
    // a bare /roll is the roll a card asks for most often
    params: { notation: dice || "1d20", ...(note ? { note } : {}) },
  };
}

export const COMMANDS: CommandDef[] = [
  {
    names: ["roll", "r"],
    usage: "/roll 2d6",
    what: "roll dice — 1d20, 2d6, 1d20+3; always say how many; add a note for what",
    run: roll,
  },
  {
    names: ["flip"],
    usage: "/flip",
    what: "flip a coin",
    run: () => ({ kind: "action", type: "flip", params: {} }),
  },
  {
    names: ["help"],
    usage: "/help",
    what: "this list",
    run: () => ({ kind: "notice", message: helpText() }),
  },
];

function helpText(): string {
  return COMMANDS.map((c) => `${c.usage} — ${c.what}`).join("\n");
}

/** The preset rolls the dice menu offers. Every one of them is a line the
 *  composer could have had typed into it, so the menu can only ever prefill
 *  something that works — the test holds that. */
export const DICE_PRESETS: { label: string; command: string }[] = [
  { label: "1d20", command: "/roll 1d20" },
  { label: "1d12", command: "/roll 1d12" },
  { label: "1d10", command: "/roll 1d10" },
  { label: "1d8", command: "/roll 1d8" },
  { label: "1d6", command: "/roll 1d6" },
  { label: "1d4", command: "/roll 1d4" },
  { label: "1d100", command: "/roll 1d100" },
  { label: "2d6", command: "/roll 2d6" },
  { label: "Coin flip", command: "/flip" },
];

export function parseCommand(input: string): CommandOutcome {
  const line = input.trim();
  if (!line.startsWith("/")) return { kind: "chat", text: line };
  // the escape: a doubled slash is how you say a line that begins with one
  if (line.startsWith("//")) return { kind: "chat", text: line.slice(1) };

  const space = line.search(/\s/);
  const word = (space === -1 ? line.slice(1) : line.slice(1, space)).toLowerCase();
  const rest = space === -1 ? "" : line.slice(space + 1).trim();

  const def = COMMANDS.find((c) => c.names.includes(word));
  if (def) return def.run(rest);
  if (!word) return { kind: "notice", message: helpText() };
  return { kind: "notice", message: `There is no /${word} command.\n${helpText()}\nType /help for this list.` };
}
