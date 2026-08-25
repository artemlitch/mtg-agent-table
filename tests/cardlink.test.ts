// Which cards a line of game text is talking about. The names come from the
// cards in the GAME — the server builds every log line out of
// publicDesc(getCard(id)), so the live view is a superset of what can appear
// in one.
import { describe, expect, it } from "vitest";
import { cardSegments } from "../client/src/game/cardnames";
import { useGame } from "../client/src/store/game";
import type { Card, GameView, Zone } from "../client/src/types";

// never reset: the index is cached against view.seq, so two tables that
// happened to share a seq would hand the second test the first one's cards
let seq = 0;
const card = (name: string, zone: Zone = "battlefield", extra: Partial<Card> = {}): Card =>
  ({
    id: `c${++seq}`, zone, owner: "you", controller: "you",
    tapped: false, faceDown: false, counters: {}, under: null,
    isToken: false, isCommander: false, attacking: null, blocking: null,
    name, ...extra,
  }) as Card;

/** The table holding exactly these cards, seen from Player's seat. */
function table(cards: Card[]) {
  const zones = (p: "you" | "agent") => {
    const z: Record<string, Card[]> = { library: [], hand: [], battlefield: [], graveyard: [], exile: [], command: [], stack: [] };
    for (const c of cards) if (c.controller === p) z[c.zone].push(c);
    return z;
  };
  useGame.setState({
    view: {
      seq: ++seq, viewer: "you", started: true, turn: "you", turnNumber: 1, phase: "main",
      players: { you: { zones: zones("you") }, agent: { zones: zones("agent") } },
      stack: [], log: [],
    } as unknown as GameView,
  });
}

/** The line split up: a plain stretch stays a string, a named card comes back
 *  as <Name> so a test can say what got linked. */
const parts = (text: string) =>
  (cardSegments(text, (n) => `art:${n}`) ?? [text]).map((s) => (typeof s === "string" ? s : `<${s.name}>`));

describe("card names in a line of game text", () => {
  it("links every card a combat line names", () => {
    table([card("Marchesa, the Black Rose"), card("Tergrid, God of Fright"), card("Carrion Feeder")]);
    expect(parts("Player declares attackers: Marchesa, the Black Rose → Agent; Carrion Feeder → Agent")).toEqual([
      "Player declares attackers: ",
      "<Marchesa, the Black Rose>",
      " → Agent; ",
      "<Carrion Feeder>",
      " → Agent",
    ]);
  });

  it("prefers the whole name over the shorthand inside it", () => {
    table([card("Marchesa, the Black Rose")]);
    expect(parts("Marchesa, the Black Rose attacks")).toEqual(["<Marchesa, the Black Rose>", " attacks"]);
  });

  it("takes the shorthand too — nobody writes a legend's full name twice", () => {
    table([card("Marchesa, the Black Rose"), card("Carrion Feeder")]);
    expect(parts("Marchesa swings")).toEqual(["<Marchesa>", " swings"]);
    expect(parts("I block with Carrion")).toEqual(["I block with ", "<Carrion>"]);
  });

  it("never swallows the legendary comma into the link", () => {
    // the first-word cut is made by whitespace, so "Tergrid," — comma and
    // all — became an alias, outsorted the clean "Tergrid", and the damage
    // lines rendered "to [Tergrid,] survives" with the comma inside the link
    table([card("Tergrid, God of Fright")]);
    expect(parts("Rat → Tergrid, God of Fright: 1 — to Tergrid, survives")).toEqual([
      "Rat → ",
      "<Tergrid, God of Fright>",
      ": 1 — to ",
      "<Tergrid>",
      ", survives",
    ]);
  });

  it("does not match inside a longer word, or in lower case", () => {
    table([card("Plant"), card("Plains")]);
    expect(parts("Plants are not Plant")).toEqual(["Plants are not ", "<Plant>"]);
    expect(parts("out on the plains")).toEqual(["out on the plains"]);
  });

  it("points a repeated name at the copy on the table", () => {
    const inHand = card("Llanowar Elves", "hand");
    const onBoard = card("Llanowar Elves", "battlefield");
    table([inHand, onBoard]);
    const seg = cardSegments("Llanowar Elves taps for {G}", (n) => n)![0];
    expect(typeof seg === "string" ? null : seg.card.id).toBe(onBoard.id);
  });

  it("never links a card the viewer is not allowed to see", () => {
    table([card("Secret Card", "hand", { hidden: true, controller: "agent" })]);
    expect(parts("Secret Card is in there")).toEqual(["Secret Card is in there"]);
  });

  it("links a card that is not in the game when it is written [[like this]]", () => {
    table([card("Carrion Feeder")]);
    expect(parts("I would want [[Swords to Plowshares]] here")).toEqual([
      "I would want ",
      "<Swords to Plowshares>",
      " here",
    ]);
  });

  it("links the face names of a double-faced card", () => {
    table([
      card("Delver of Secrets // Insectile Aberration", "battlefield", {
        faces: [{ name: "Delver of Secrets" }, { name: "Insectile Aberration" }],
      }),
    ]);
    expect(parts("Delver of Secrets flips")).toEqual(["<Delver of Secrets>", " flips"]);
    expect(parts("into Insectile Aberration")).toEqual(["into ", "<Insectile Aberration>"]);
  });

  it("leaves the line alone when there is no table yet", () => {
    useGame.setState({ view: null });
    expect(cardSegments("Marchesa, the Black Rose", (n) => n)).toBeNull();
  });
});
