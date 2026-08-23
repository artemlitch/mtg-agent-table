// Mana written the way Magic writes it, drawn as pips. Only the symbols we
// have art for — a wrong pip is worse than honest braces.
import { describe, expect, it } from "vitest";
import { withMana } from "../client/src/components/Mana";

/** What the renderer produced, flattened: strings stay strings, pips become
 *  their class so a test can say which symbol was drawn. */
const parts = (text: string) => {
  const out = withMana(text);
  const arr = Array.isArray(out) ? out : [out];
  return arr.map((n: any) => (typeof n === "string" ? n : `<${n.props.className}${n.props.children ? ":" + n.props.children : ""}>`));
};

describe("mana symbols in a line of text", () => {
  it("draws the five colours and colorless", () => {
    expect(parts("{W}{U}{B}{R}{G}{C}")).toEqual([
      "<pip pipW>", "<pip pipU>", "<pip pipB>", "<pip pipR>", "<pip pipG>", "<pip pipC>",
    ]);
  });

  it("keeps the words around them", () => {
    expect(parts("Counterspell — {U}{U}")).toEqual(["Counterspell — ", "<pip pipU>", "<pip pipU>"]);
    expect(parts("pay {B} then draw")).toEqual(["pay ", "<pip pipB>", " then draw"]);
  });

  it("puts a generic cost in its own chip", () => {
    expect(parts("{2}{U}")).toEqual(["<pip pipnum:2>", "<pip pipU>"]);
    expect(parts("{10}")).toEqual(["<pip pipnum:10>"]);
  });

  it("leaves alone what it cannot draw", () => {
    // no art for taps, X, or hybrids — braces are honest, a wrong pip is not
    for (const t of ["{T}", "{X}", "{B/R}", "{2/W}", "{Q}"]) expect(withMana(t)).toBe(t);
  });

  it("draws what it can out of a mixed line and leaves the rest", () => {
    expect(parts("{1}{B}, {T}: return it")).toEqual([
      "<pip pipnum:1>", "<pip pipB>", ", {T}: return it",
    ]);
  });

  it("passes ordinary prose straight through", () => {
    expect(withMana("Attacks locked in: Bear")).toBe("Attacks locked in: Bear");
    expect(withMana("")).toBe("");
    // braces that are not mana are still just braces
    expect(withMana("nothing {here} to draw")).toBe("nothing {here} to draw");
  });

  it("is not fooled by a lone brace", () => {
    expect(withMana("{")).toBe("{");
    expect(parts("{G} and {")).toEqual(["<pip pipG>", " and {"]);
  });
});
