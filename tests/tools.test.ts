// Tool-boundary strictness: arguments that don't fit a tool's schema fail
// loudly — no soft assumptions. Born from the charge-counter incident, where
// {type: "charge"} silently became a +1/+1 bump.
import { describe, test, expect } from "bun:test";
import { validateArgs, TOOLS } from "../server/mcp-tools";

describe("tool argument validation", () => {
  test("unknown parameter is rejected with the valid list", () => {
    const err = validateArgs("counters", { card: "c1", type: "charge", delta: 1 });
    expect(err).toContain('"type"');
    expect(err).toContain("kind");
  });

  test("missing required parameter is rejected", () => {
    expect(validateArgs("counters", { card: "c1", delta: 1 })).toContain("kind");
    expect(validateArgs("say", {})).toContain("text");
    expect(validateArgs("cast", { note: "no card" })).toContain("card");
  });

  test("legit calls pass, including the schema params the audit added", () => {
    expect(validateArgs("counters", { card: "c1", kind: "charge", delta: 1 })).toBeNull();
    expect(validateArgs("counters", { card: "c1", kind: "loyalty", set: 3 })).toBeNull();
    expect(validateArgs("cast", { card: "c1", face: 1, note: "land side" })).toBeNull();
    expect(validateArgs("cast", { card: "c1", resolveTo: "exile", resolveToPlayer: "you" })).toBeNull();
    expect(validateArgs("create_token", { name: "Treasure", n: 2, tapped: true })).toBeNull();
    expect(validateArgs("get_state", {})).toBeNull();
    expect(validateArgs("done", undefined)).toBeNull();
  });

  test("non-object arguments are rejected", () => {
    expect(validateArgs("say", "hello")).toContain("JSON object");
    expect(validateArgs("tap", ["c1"])).toContain("JSON object");
  });

  test("attach is its own tool and maps target → under for the tuck action", () => {
    expect(validateArgs("attach", { card: "c1", target: "c2" })).toBeNull();
    expect(validateArgs("attach", { card: "c1", under: "c2" })).toContain('"under"');
    expect(TOOLS.attach.action).toBe("tuck");
    expect(TOOLS.attach.argMap).toEqual({ target: "under" });
  });

  test("every tool description's own advertised params exist in its schema (cast face regression)", () => {
    // cast's description tells the model to pass `face`; the schema must agree
    expect(Object.keys(TOOLS.cast.schema.properties)).toContain("face");
  });
});
