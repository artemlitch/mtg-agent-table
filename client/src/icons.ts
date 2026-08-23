// game-icons.net, vendored as CSS masks (tools/build-icons.mjs). A mask takes
// its colour from `background-color: currentColor`, so every icon inherits the
// per-action --c tint and the existing font-size rules keep sizing it.
// Add a name here, list it in that script, re-run it.
//
// Tapping turns a card down; untapping brings it back. One arc glyph and the
// same arc mirrored across the x axis says exactly that — the pair reads as a
// motion and its reverse, which two rotation arrows never quite did.
export const ICONS: Record<string, string> = {
  tap: "gi-arrow-dunk",
  untap: "gi-arrow-dunk gi-flipy",
  undo: "gi-return-arrow",
  redo: "gi-return-arrow gi-flipx",
  answer: "gi-chat-bubble",
  takeTurn: "gi-player-next",
  resolve: "gi-check-mark",
  resolveAll: "gi-checklist",
  damage: "gi-sword-clash",
  noBlocks: "gi-shield-disabled",
  draw: "gi-card-draw",
  main: "gi-play-button",
  combat: "gi-crossed-swords",
  end: "gi-moon",
  passTurn: "gi-hourglass",
  skip: "gi-fast-forward-button",
  mulligan: "gi-recycle",
  cast: "gi-magic-swirl",
  counters: "gi-gems",
  token: "gi-token",
  copy: "gi-gemini",
  pile: "gi-stack",
  steal: "gi-snatch",
  give: "gi-shaking-hands",
  command: "gi-crown",
  ability: "gi-bolt-spell-cast",
  flip: "gi-card-exchange",
  trash: "gi-trash-can",
  bullet: "gi-plain-circle",
  search: "gi-magnifying-glass",
  scry: "gi-spectacles",
  surveil: "gi-binoculars",
  mill: "gi-card-discard",
  exile: "gi-card-burn",
  reveal: "gi-all-seeing-eye",
  shuffle: "gi-card-random",
  // card-menu specifics, so no two rows of one menu share a glyph
  exileDown: "gi-hidden",
  // hiding a card and revealing it are opposite actions, so they take one
  // visual idea and its negation: the same eye, struck through or open.
  facedown: "gi-sight-disabled",
  faceup: "gi-semi-closed-eye",
  toHand: "gi-card-pickup",
  // top and bottom of a library are one gesture and its opposite, so they are
  // one glyph and its opposite: a card leaving the deck, turned over. The set
  // has no down-card to pair with up-card, and the bare plain-arrow that used
  // to sit here matched nothing — a different subject, and much heavier on the
  // page at the same font size.
  top: "gi-up-card",
  bottom: "gi-up-card gi-rot180",
  library: "gi-book-pile",
  secret: "gi-hood",
  block: "gi-shield",
  setpt: "gi-pencil",
  cancel: "gi-cancel",
  cancelAttack: "gi-sword-break",
  battlefield: "gi-empty-chessboard",
  /* the agent reaching for one of its tools, in the brain feed. Shares gears
     with the artifact type below — they never appear in the same list, and
     gears is the only machinery in the vendored set. */
  tool: "gi-gears",
  /* the arrow inside a phase-transition label ("main phase -> combat").
     plain-arrow points down by default, so a quarter turn aims it along the
     line of text. */
  phaseArrow: "gi-plain-arrow gi-rot270",
  caret: "gi-plain-arrow",
  caretUp: "gi-plain-arrow gi-rot180",
  /* The chat's handle, riding on its leading edge: the arrow points at where
     the panel is about to go — left to pull it out, right to push it away.
     plain-arrow points down by default, so each is a quarter turn. */
  chevronLeft: "gi-plain-arrow gi-rot90",
  chevronRight: "gi-plain-arrow gi-rot270",
  /* something happened behind a shut chat — see SideToggle */
  bell: "gi-ringing-bell",
  /* The compact rail's two piles, and the reason they are not `mill` and
     `exile` above: those two are ACTIONS — a card being discarded, a card
     being burned — and a rail names PLACES. A menu row says "exile this"; the
     rail says "the exile zone", and drawing the same glyph for both would say
     the pile is a verb. So the graveyard is a headstone and exile is a gate. */
  graveyard: "gi-tombstone",
  exileZone: "gi-magic-portal",
  // card types, for the search filter
  anyType: "gi-circle",
  creature: "gi-dragon-head",
  land: "gi-mountains",
  artifact: "gi-gears",
  enchantment: "gi-sparkles",
  instant: "gi-arcing-bolt",
  sorcery: "gi-scroll-unfurled",
  planeswalker: "gi-chess-king",
  battle: "gi-castle",
  blank: "", // keeps a row's icon column aligned with nothing in it
};

/** "blank" holds a row's icon column open with nothing in it, so it must not
 *  carry .gi — a masked element with no mask paints a solid square. */
export function iconClass(name: string): string {
  const cls = ICONS[name] ?? name;
  return cls ? `gi ${cls} ico` : "ico";
}

// Menu rows speak the library panel's language: a coloured icon, and the
// plate and rim arriving on hover. Icon and tone are matched from the label
// — presentation only, first match wins, anything unmatched stays neutral.
// Order is specific → general, and the rules are deliberately fine-grained:
// no two rows of the same menu may land on the same glyph. Pairs that used
// to collide: the two exiles, the two reveals, top vs bottom of library,
// set-P/T vs other-counter, delete vs cancel.
export const MENU_LOOK: [RegExp, string, string][] = [
  [/browse/i, "search", "scry"],
  [/exile face.?down/i, "exileDown", "surveil"],
  // split, because they are two different actions — one hides the card, the
  // other shows it, and only one of the two is ever offered at a time
  [/turn face-up/i, "faceup", "reveal"],
  [/turn face-down/i, "facedown", "surveil"],
  [/^show /i, "flip", "surveil"],
  [/delete/i, "trash", "mill"],
  [/cancel attack/i, "cancelAttack", "mill"],
  [/remove|cancel|clear/i, "cancel", "mill"],
  [/ability/i, "ability", "scry"],
  [/copy/i, "copy", "surveil"],
  [/create/i, "token", "draw"],
  [/set p\/t/i, "setpt", "scry"],
  [/counter/i, "counters", "scry"],
  [/attack|combat/i, "combat", "exile"],
  [/block/i, "block", "scry"],
  [/untap/i, "untap", "mulligan"],
  [/^tap\b/i, "tap", "mulligan"],
  [/play |cast|→ stack/i, "cast", "surveil"],
  // steal and give before the plain battlefield rule: all of these name a
  // battlefield, and the specific ones must not collapse onto its glyph
  [/steal|take/i, "steal", "exile"],
  [/give|return/i, "give", "draw"],
  [/battlefield/i, "battlefield", "draw"],
  [/graveyard|discard|mill/i, "mill", "mill"],
  [/exile/i, "exile", "exile"],
  [/token/i, "token", "draw"],
  [/command/i, "command", "reveal"],
  [/hand/i, "toHand", "draw"],
  [/top/i, "top", "scry"],
  [/bottom/i, "bottom", "scry"],
  [/library/i, "library", "scry"],
  [/reveal to agent/i, "secret", "reveal"],
  [/reveal/i, "reveal", "reveal"],
  [/pile/i, "pile", "mill"],
];

/** The icon and tone a menu row's label earns. */
export function menuLook(label: string): { icon: string; tone: string } {
  const hit = MENU_LOOK.find(([re]) => re.test(label));
  return { icon: hit?.[1] ?? "bullet", tone: hit?.[2] ?? "neutral" };
}

/** Labels used to carry their own emoji; the icon says it now. */
export const stripGlyph = (s: string) => String(s).replace(/^[^\p{L}\p{N}(]+/u, "").trim();
