// Everything on screen that isn't the game: the one menu, the one modal, the
// one hover preview, which side tab is open. All singletons — there is never a
// second menu or a second preview, which is what makes Esc, click-away and the
// z-order answerable in one place.
import type { ReactNode } from "react";
import { create } from "zustand";
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
  showPreview(card: Card, at: Anchor): void;
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
export const isNarrow = () => window.matchMedia(`(max-width: ${NARROW_AT}px)`).matches;

const SIDE_OPEN_KEY = "sideOpen";

// everything that hangs off the cursor — the hover preview, both menus —
// sits the same distance from it
export const CURSOR_GAP = { x: 18, y: 12 };

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
    if (get().menu) set({ menu: null });
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
  showPreview(card, at) {
    if (get().menu) return; // a menu is up: hovering behind it raises nothing
    set({ preview: { card, x: at.clientX, y: at.clientY } });
  },
  movePreview(at) {
    const p = get().preview;
    if (!p || get().menu) return;
    set({ preview: { ...p, x: at.clientX, y: at.clientY } });
  },
  hidePreview() {
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
