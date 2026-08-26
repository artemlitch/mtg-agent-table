// Everything on screen that isn't the game: the one menu, the one modal, the
// one hover preview, which side tab is open. All singletons — there is never a
// second menu or a second preview, which is what makes Esc, click-away and the
// z-order answerable in one place.
import type React from "react";
import type { ReactNode } from "react";
import { create } from "zustand";
import { previewable } from "./game";
import type { Card } from "../types";

export interface MenuItem {
  label: string;
  fn?: () => void;
  /** a heading row: no icon, no click */
  title?: boolean;
  /** hairline above this row */
  sep?: boolean;
  /** override the icon MENU_LOOK would pick from the label */
  icon?: string;
  /** marked as the current choice (dropdowns) */
  on?: boolean;
  keys?: string[];
}

export type MenuState = { x: number; y: number } & (
  | { kind: "list"; items: MenuItem[]; plain?: boolean }
  | { kind: "panel"; render: () => ReactNode }
);

export interface ModalState {
  /** the whole inside of the box. Wrap it in <ModalFrame> for the standard
   *  fixed heading + scrolling body; a browser that needs a live title or a
   *  filter bar owns both from inside that one component. */
  body: ReactNode;
  /** size to content instead of the fixed card-browser box */
  compact?: boolean;
  /** sit in the middle of the playmat rather than hanging from the top of the
   *  window — for one-question boxes, which have no reason to be anywhere else */
  centred?: boolean;
  /** floats outside the box, beside it (the ability modal's target palette) */
  side?: ReactNode;
  onClose?: () => void;
}

/** An anchor for a menu: a mouse event, or any rect-bearing element. */
export interface Anchor {
  clientX: number;
  clientY: number;
}

interface UIStore {
  menu: MenuState | null;
  modal: ModalState | null;
  preview: { card: Card; x: number; y: number } | null;
  activeTab: TabName;
  /** card id waiting for a pile target (menu "Tuck under…") */
  pendingTuck: string | null;
  cardsPerRow: number;
  /** the window is too small for two rails and a column of chat — see NARROW_AT */
  narrow: boolean;
  /** narrow only: is the drawer out? Remembered, so dismissing it sticks. */
  sideOpen: boolean;
  /** the newest log entry the panel was showing when it was last visible.
   *  Anything past it while the drawer is shut is what the tab's dot means. */
  sideSeenSeq: number;

  openMenu(items: MenuItem[], at: Anchor, opts?: { plain?: boolean }): void;
  openPanel(render: () => ReactNode, at: Anchor): void;
  closeMenu(): void;
  openModal(m: ModalState): void;
  closeModal(): void;
  showPreview(card: Card, at: Anchor, el?: Element | null): void;
  movePreview(at: Anchor): void;
  hidePreview(): void;
  setTab(t: TabName): void;
  setPendingTuck(id: string | null): void;
  setCardsPerRow(n: number): void;
  setNarrow(n: boolean): void;
  setSideOpen(open: boolean): void;
  setSideSeen(seq: number): void;
}

/** The card the pointer is over, for the E keybind. A plain ref, not store
 *  state: it changes on every hover and nothing renders from it. */
export const hovered: { card: Card | null } = { card: null };

export type TabName = "stack" | "chat" | "brain" | "log";

/** Below this the table changes shape: the rails collapse to a 68px strip of
 *  icons and counters, and the side panel stops taking a column and becomes a
 *  drawer over the felt.
 *
 *  The breakpoint is a number here rather than a media query, because the swap
 *  is not only cosmetic — Rail hands life to a different widget, and the panel
 *  grows a control that does not exist in the wide layout. JS and CSS have to
 *  agree on which layout is on, and two copies of 1180 would eventually not.
 *  So this is the only copy: App watches it and puts `narrow` on <body>, and
 *  every rule in the sheets hangs off that class. */
export const NARROW_AT = 1180;
/** Read at module load, to give the store its first answer before anything
 *  renders. The guard is for the test runner, which is a plain node
 *  environment: the next-action tests reach this store through steps.ts and
 *  there is no matchMedia there to ask. */
export const isNarrow = () => typeof window !== "undefined" && window.matchMedia(`(max-width: ${NARROW_AT}px)`).matches;

const SIDE_OPEN_KEY = "sideOpen";

// everything that hangs off the cursor — the hover preview, both menus —
// sits the same distance from it
export const CURSOR_GAP = { x: 18, y: 12 };

/** The element the hover preview is hanging off — the thing the pointer
 *  entered. A DOM node, so it lives beside the store rather than in it:
 *  nothing renders from it, it is only ever asked a question. */
let previewEl: Element | null = null;

/** Has the previewed card left from under a cursor that never moved? A hotkey
 *  moves it, the agent exiles it, a pile swallows it — the element stops
 *  existing, and an element that stops existing never fires mouseleave. So
 *  ask the page instead: is that thing still the thing under the cursor? */
/** Is this element part of the menu that is up?
 *
 *  A menu up means the table behind it raises no previews — you are reading
 *  the menu, not the board. But the menu NAMES cards itself: the row it was
 *  raised on is a card name, and so is "Block Servo". Those go through <Text>
 *  like every other line of game text and come out as links, and a link that
 *  refuses to preview is worse than no link. They are the menu's own content,
 *  not the board showing through, so the rule is about where the pointer IS
 *  rather than whether a menu exists at all. */
const inMenu = (el: Element | null) => !!el?.closest("#menu");

export function previewLost(): boolean {
  const p = useUI.getState().preview;
  if (!p) return false;
  if (!previewEl?.isConnected) return true;
  // the preview itself is pointer-events: none, so it can never be the answer
  const under = document.elementFromPoint(p.x, p.y);
  return !under || !previewEl.contains(under);
}

const PER_ROW_KEY = "cardsPerRow";

export const useUI = create<UIStore>((set, get) => ({
  menu: null,
  modal: null,
  preview: null,
  activeTab: "chat",
  pendingTuck: null,
  cardsPerRow: Number(localStorage.getItem(PER_ROW_KEY)) || 5,
  narrow: isNarrow(),
  // open unless it was dismissed: the drawer's whole point is that it can be
  // put away, but starting it away would hide the agent talking from someone
  // who never asked for that
  sideOpen: localStorage.getItem(SIDE_OPEN_KEY) !== "0",
  sideSeenSeq: 0,

  openMenu(items, at, opts) {
    set({ menu: { kind: "list", items, x: at.clientX, y: at.clientY, plain: opts?.plain }, preview: null });
  },
  openPanel(render, at) {
    set({ menu: { kind: "panel", render, x: at.clientX, y: at.clientY }, preview: null });
  },
  closeMenu() {
    if (!get().menu) return;
    // a preview raised from a menu row goes with the row: the element is about
    // to stop existing, and one that stops existing never fires mouseleave
    const fromMenu = inMenu(previewEl);
    if (fromMenu) previewEl = null;
    set(fromMenu ? { menu: null, preview: null } : { menu: null });
  },
  openModal(m) {
    set({ modal: m, menu: null });
  },
  closeModal() {
    const m = get().modal;
    if (!m) return;
    set({ modal: null, preview: null });
    m.onClose?.();
  },
  showPreview(card, at, el) {
    if (get().menu && !inMenu(el ?? null)) return; // hovering BEHIND a menu raises nothing
    previewEl = el ?? null;
    set({ preview: { card, x: at.clientX, y: at.clientY } });
  },
  movePreview(at) {
    const p = get().preview;
    if (!p || (get().menu && !inMenu(previewEl))) return;
    set({ preview: { ...p, x: at.clientX, y: at.clientY } });
  },
  hidePreview() {
    previewEl = null;
    if (get().preview) set({ preview: null });
  },
  setTab(activeTab) {
    set({ activeTab });
  },
  setPendingTuck(pendingTuck) {
    set({ pendingTuck });
  },
  setCardsPerRow(n) {
    localStorage.setItem(PER_ROW_KEY, String(n));
    set({ cardsPerRow: n });
  },
  setNarrow(narrow) {
    if (get().narrow !== narrow) set({ narrow });
  },
  setSideOpen(sideOpen) {
    localStorage.setItem(SIDE_OPEN_KEY, sideOpen ? "1" : "0");
    set({ sideOpen });
  },
  setSideSeen(sideSeenSeq) {
    if (get().sideSeenSeq !== sideSeenSeq) set({ sideSeenSeq });
  },
}));

// Non-hook accessors, for the plain-function menu builders that run outside a
// component. The store is a singleton either way.
export const ui = () => useUI.getState();
export const menuOpen = () => !!useUI.getState().menu;

/** Hover handlers every previewable thing spreads onto itself — a board card,
 *  a rail thumbnail, a stack item, the next-action card, a card name in a
 *  sentence. Nothing hand-rolls these three: the one that did got the element
 *  argument wrong, which is what tells previewLost() whether the thing being
 *  previewed is still under the cursor.
 *
 *  It lives in the store rather than beside CardPreview because half the app
 *  needs it and CardPreview renders <Text>, which draws card names, which are
 *  previewable — importing the handlers from there made those two modules each
 *  other's dependency. */
export function previewProps(card: Card) {
  return {
    // a card with no face never opens one — see previewable. The layer checks
    // again at draw time, because a card can lose its face while you hover it
    onMouseEnter: (e: React.MouseEvent) =>
      previewable(card) && useUI.getState().showPreview(card, e, e.currentTarget),
    onMouseMove: (e: React.MouseEvent) => useUI.getState().movePreview(e),
    onMouseLeave: () => useUI.getState().hidePreview(),
  };
}
