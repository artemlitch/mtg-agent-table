// What a line typed into the composer MEANS: a message to the agent, a table
// action, or a note back to you. The composer does nothing but obey this — so
// everything about which is which is decided here, where it can be read.
import { describe, expect, it } from "vitest";
import { COMMANDS, DICE_PRESETS, parseCommand } from "../client/src/game/commands";
import { parseDice } from "../server/dice";

describe("plain messages", () => {
  it("passes ordinary text through as chat", () => {
    expect(parseCommand("nice roll")).toEqual({ kind: "chat", text: "nice roll" });
  });

  it("is not fooled by a slash in the middle of a sentence", () => {
    expect(parseCommand("do I untap 2/2 first?")).toEqual({ kind: "chat", text: "do I untap 2/2 first?" });
  });

  it("lets a doubled slash say a literal one", () => {
    // otherwise there is no way to type a line that starts with a slash
    expect(parseCommand("//roll is how you roll")).toEqual({ kind: "chat", text: "/roll is how you roll" });
  });
});

describe("/roll", () => {
  it("sends the notation to the table, untouched", () => {
    // the server owns what counts as dice; the composer does not second-guess it
    expect(parseCommand("/roll 2d8")).toEqual({ kind: "action", type: "roll", params: { notation: "2d8" } });
    expect(parseCommand("/roll 1d20+3")).toEqual({ kind: "action", type: "roll", params: { notation: "1d20+3" } });
  });

  it("rolls one d20 when you do not say what to roll", () => {
    expect(parseCommand("/roll")).toEqual({ kind: "action", type: "roll", params: { notation: "1d20" } });
  });

  it("keeps the rest of the line as the reason for the roll", () => {
    expect(parseCommand("/roll 1d20 Ancient Copper Dragon")).toEqual({
      kind: "action",
      type: "roll",
      params: { notation: "1d20", note: "Ancient Copper Dragon" },
    });
  });

  it("answers to /r too, and ignores case", () => {
    expect(parseCommand("/r 1d4")).toEqual({ kind: "action", type: "roll", params: { notation: "1d4" } });
    expect(parseCommand("/ROLL 1d4")).toEqual({ kind: "action", type: "roll", params: { notation: "1d4" } });
  });
});

describe("the other commands", () => {
  it("flips a coin", () => {
    expect(parseCommand("/flip")).toEqual({ kind: "action", type: "flip", params: {} });
  });

  it("answers /help without sending anything", () => {
    const out = parseCommand("/help");
    expect(out.kind).toBe("notice");
    if (out.kind !== "notice") throw new Error("unreachable");
    for (const c of COMMANDS) expect(out.message).toContain(c.usage);
  });

  it("says so when the command is not one, rather than saying it out loud", () => {
    // the failure that matters: "/rol d20" must not reach the agent as chat
    const out = parseCommand("/rol d20");
    expect(out.kind).toBe("notice");
    if (out.kind !== "notice") throw new Error("unreachable");
    expect(out.message).toContain("/rol");
    expect(out.message).toContain("/help");
  });

  it("treats a lone slash as a request for the list", () => {
    expect(parseCommand("/").kind).toBe("notice");
  });
});

describe("the preset menu", () => {
  it("offers the dice a Magic card actually asks for", () => {
    const commands = DICE_PRESETS.map((p) => p.command);
    for (const want of ["/roll 1d4", "/roll 1d6", "/roll 1d20", "/roll 1d100"]) expect(commands).toContain(want);
  });

  it("offers only presets the composer can then run", () => {
    for (const preset of DICE_PRESETS) expect(parseCommand(preset.command).kind).toBe("action");
  });

  it("writes every preset in the notation the table accepts", () => {
    // a preset that prefills something the server then refuses is the worst
    // kind of button — this is what caught the bare "/roll d20" presets
    for (const preset of DICE_PRESETS) {
      const out = parseCommand(preset.command);
      if (out.kind !== "action" || out.type !== "roll") continue;
      expect(typeof parseDice(String(out.params.notation)), preset.command).not.toBe("string");
    }
  });
});
