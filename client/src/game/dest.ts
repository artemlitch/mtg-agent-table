// The one place a card destination is named. Every menu and every card browser
// builds its rows from here, so a graveyard row is spelled, coloured and aimed
// the same way wherever you meet it.
//
// Two rules are baked in and must stay that way:
//   * exile and the graveyard are always the card's OWNER's. There is no such
//     thing as exiling a card into your own exile, or putting a card you don't
//     own into the agent's graveyard.
//   * "to hand" is never the agent's hand. The agent takes cards itself.
import { act } from "../api";
import type { MenuItem } from "../store/ui";
import type { Card, MoveParams } from "../types";

type Dest = (c: Card) => [label: string, params: MoveParams];

export const DEST: Record<string, Dest> = {
  hand: () => ["To hand", { toZone: "hand", toPlayer: "you" }],
  graveyard: (c) => ["Graveyard", { toZone: "graveyard", toPlayer: c.owner }],
  exile: (c) => ["Exile", { toZone: "exile", toPlayer: c.owner }],
  exileDown: (c) => ["Exile face-down", { toZone: "exile", toPlayer: c.owner, faceDown: true, revealTo: "you" }],
  top: (c) => ["Top of library", { toZone: "library", toPlayer: c.owner, position: "top" }],
  bottom: (c) => ["Bottom of library", { toZone: "library", toPlayer: c.owner, position: "bottom" }],
  command: (c) => ["Command zone", { toZone: "command", toPlayer: c.owner }],
  myBattlefield: () => ["To my battlefield", { toZone: "battlefield", toPlayer: "you" }],
  ownerBattlefield: (c) => ["To owner's battlefield", { toZone: "battlefield", toPlayer: c.owner }],
  play: (c) => ["Straight to battlefield", { toZone: "battlefield", toPlayer: c.controller }],
  steal: () => ["😈 Steal — to my battlefield", { toZone: "battlefield", toPlayer: "you", note: "control effect" }],
  give: () => ["🎁 Give to agent's battlefield", { toZone: "battlefield", toPlayer: "agent", note: "control effect" }],
  giveBack: () => ["Return to agent's battlefield", { toZone: "battlefield", toPlayer: "agent" }],
};

export type DestKey = keyof typeof DEST;

/** A menu row that moves the card. `extra` only ever adds a log note. */
export function destItem(key: DestKey, c: Card, extra?: Partial<MoveParams>): MenuItem {
  const [label, params] = DEST[key](c);
  return { label, fn: () => void act("move", { card: c.id, ...params, ...extra }) };
}

/** The same row for a card browser, where the caller runs the move. */
export function destButton(
  key: DestKey,
  c: Card,
  run: (params: MoveParams) => void,
  suffix = ""
): [string, () => void] {
  const [label, params] = DEST[key](c);
  return [label + suffix, () => run(params)];
}
