// What the hover preview draws.
//
// Hovering snapshots a Card object and the preview then prefers the LIVE copy
// off the table, so a card that changes while you are looking at it redraws.
// That was right for every card you can hover on the board and wrong for the
// one window where the snapshot is the only copy with a face on it: a library
// search. Every zone is serialized into the view, libraries included, and a
// library card is always hidden — so the "live" copy the preview reached for
// had an id and nothing else, and the search window drew an empty box.
import { describe, test, expect, beforeEach } from "vitest";
import type { Card, GameView } from "../client/src/types";

globalThis.localStorage ??= { getItem: () => null, setItem: () => {} } as unknown as Storage;

const { previewCard, previewable, useGame } = await import("../client/src/store/game");
const { useUI } = await import("../client/src/store/ui");

const ZONES = ["library", "hand", "battlefield", "graveyard", "exile", "command", "stack"] as const;

/** A view holding exactly these cards, each filed in its own zone. */
function tableOf(...cards: Card[]) {
  const side = () => ({
    life: 40,
    commanderDamage: {},
    commanderTax: 0,
    turnDone: {},
    counts: Object.fromEntries(ZONES.map((z) => [z, 0])),
    zones: Object.fromEntries(ZONES.map((z) => [z, [] as Card[]])),
  });
  const v = { players: { you: side(), agent: side() }, stack: [] } as unknown as GameView;
  for (const c of cards) v.players[c.owner].zones[c.zone].push(c);
  useGame.setState({ view: v, dragging: false, parked: null });
}

const card = (extra: Partial<Card> = {}): Card =>
  ({ id: "c1", owner: "you", controller: "you", zone: "battlefield", name: "Sylvan Library", ...extra }) as Card;

beforeEach(() => {
  useGame.setState({ view: null, dragging: false, parked: null });
});

describe("which copy of the card the preview draws", () => {
  test("the live one, when the table has a face for it", () => {
    // the whole point of the lookup: flip a card, add a counter, tap it, and
    // the preview under a still cursor keeps up
    tableOf(card({ name: "Sylvan Library", tapped: true }));
    expect(previewCard(card({ tapped: false })).tapped).toBe(true);
  });

  test("the snapshot, when the table's copy is a faceless stub", () => {
    // a library card as the view carries it: id, zone, owner — no name
    tableOf(card({ zone: "library", hidden: true, name: undefined }));
    const found = card({ zone: "library", name: "Sylvan Library", image: "art.jpg" });
    expect(previewCard(found).name).toBe("Sylvan Library");
    expect(previewCard(found).image).toBe("art.jpg");
  });

  test("the snapshot, for something not on the table at all", () => {
    tableOf();
    expect(previewCard(card({ name: "Sylvan Library" })).name).toBe("Sylvan Library");
  });

  test("the snapshot, before any view has arrived", () => {
    expect(previewCard(card()).name).toBe("Sylvan Library");
  });
});

describe("when there is nothing to draw, nothing is drawn", () => {
  // an empty preview is worse than no preview: the layer is a fixed-width box,
  // so a card with no face left one hanging over the table under the cursor
  test("a card whose face you were never given has no preview", () => {
    expect(previewable(card({ hidden: true, name: undefined }))).toBe(false);
  });

  test("nor does a stripped card that was never even marked hidden", () => {
    expect(previewable(card({ name: undefined, image: undefined }))).toBe(false);
  });

  test("a printed card previews", () => {
    expect(previewable(card({ name: "Sylvan Library", image: "art.jpg" }))).toBe(true);
  });

  test("so does a token we drew ourselves, which has a name and no art", () => {
    // TokenFace draws it, so the test is a face of any kind, not an image
    expect(previewable(card({ name: "Beast", isToken: true, image: undefined }))).toBe(true);
  });

  test("and a card known only by its faces", () => {
    expect(previewable(card({ name: undefined, faces: [{ name: "Delver of Secrets" }] as any }))).toBe(true);
  });
});

describe("a menu naming a card previews that card", () => {
  // The rows a menu is built from go through <Text> like every other line of
  // game text, so "Block Servo" comes out with Servo as a link. The guard that
  // stops the BOARD raising previews from behind an open menu was written as
  // "a menu is up: raise nothing", which swallowed the menu's own links too —
  // a link that refuses to preview is worse than no link.
  const el = (inside: boolean) =>
    ({ closest: (sel: string) => (inside && sel === "#menu" ? ({} as Element) : null) }) as unknown as Element;
  const at = { clientX: 10, clientY: 20 } as MouseEvent;
  const servo = card({ id: "t1", name: "Servo", isToken: true });

  beforeEach(() => {
    useUI.setState({ menu: null, preview: null });
  });

  test("with no menu up, any hover raises one", () => {
    useUI.getState().showPreview(servo, at, el(false));
    expect(useUI.getState().preview?.card.name).toBe("Servo");
  });

  test("a menu row's own card name raises one", () => {
    useUI.setState({ menu: { kind: "list", items: [], x: 0, y: 0 } as never });
    useUI.getState().showPreview(servo, at, el(true));
    expect(useUI.getState().preview?.card.name).toBe("Servo");
  });

  test("the board behind the menu still raises nothing", () => {
    useUI.setState({ menu: { kind: "list", items: [], x: 0, y: 0 } as never });
    useUI.getState().showPreview(servo, at, el(false));
    expect(useUI.getState().preview).toBe(null);
  });

  test("and it follows the cursor along the row", () => {
    useUI.setState({ menu: { kind: "list", items: [], x: 0, y: 0 } as never });
    useUI.getState().showPreview(servo, at, el(true));
    useUI.getState().movePreview({ clientX: 44, clientY: 55 } as MouseEvent);
    expect(useUI.getState().preview?.x).toBe(44);
  });

  test("closing the menu takes the preview with it", () => {
    // the row is about to stop existing, and an element that stops existing
    // never fires mouseleave
    useUI.setState({ menu: { kind: "list", items: [], x: 0, y: 0 } as never });
    useUI.getState().showPreview(servo, at, el(true));
    useUI.getState().closeMenu();
    expect(useUI.getState().preview).toBe(null);
  });

  test("but a preview raised elsewhere survives a menu closing", () => {
    useUI.getState().showPreview(servo, at, el(false));
    useUI.setState({ menu: { kind: "list", items: [], x: 0, y: 0 } as never });
    useUI.getState().closeMenu();
    expect(useUI.getState().preview?.card.name).toBe("Servo");
  });
});
