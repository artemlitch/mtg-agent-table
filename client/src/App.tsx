import { useEffect, useLayoutEffect } from "react";
import { connectWS, loadBrain, redoLastAction, refresh, undoLastAction } from "./api";
import { CardPreviewLayer } from "./components/CardPreview";
import { Icon } from "./components/Icon";
import { watchForRawMana } from "./components/Mana";
import { MenuLayer } from "./components/Menu";
import { ModalLayer } from "./components/Modal";
import { TooltipLayer } from "./components/Tooltip";
import { fieldsOnlyFocus } from "./focus";
import { cardPrimaryAction } from "./game/interaction";
import { processReveals } from "./game/reveals";
import { processSounds } from "./game/sounds";
import { useGame } from "./store/game";
import { hovered, isNarrow, menuOpen, NARROW_AT, ui, useUI } from "./store/ui";
import { NextAction } from "./features/nextaction/NextAction";
import { fireNextAction } from "./features/nextaction/steps";
import { usePeek } from "./features/side/peek";
import { SIDE_KEY } from "./features/side/SideToggle";
import { SidePanel } from "./features/side/SidePanel";
import { Battlefield } from "./features/table/Battlefield";
import { CardLayer } from "./features/table/CardLayer";
import { Hand } from "./features/table/Hand";
import { Rail } from "./features/table/Rail";
import { openTokenModal } from "./features/modals/TokenModal";
import { TopBar } from "./features/topbar/TopBar";

export function App() {
  const view = useGame((s) => s.view);

  useBoot();
  useGlobalKeys();
  useWindowFocus();
  useLayout();

  // every log entry that earns a sound gets one, once — and a reveal puts its
  // cards on screen the same way, off the same array
  useEffect(() => {
    if (!view?.log) return;
    processSounds(view.log);
    processReveals(view.log);
  }, [view?.log]);

  return (
    <div id="app">
      <div id="table">
        <TopBar />
        <div id="felt">
          {/* combat: the whole combat step, either player's turn — the phase is
              free text, so blockers/damage sub-steps count too */}
          <div id="combatglow" className={view?.started && /combat|attack|block|damage/i.test(view.phase || "") ? "on" : ""} />

          {view && (
            <>
              <div className="seat" id="seat-agent">
                <Rail p="agent" />
                <div className="boardwrap" id="boardwrap-agent">
                  <Hand p="agent" />
                  <Battlefield p="agent" />
                </div>
              </div>

              <div id="midline">
                <NextAction />
              </div>

              <div className="seat" id="seat-you">
                <Rail p="you" />
                <div className="boardwrap" id="boardwrap-you">
                  <Battlefield p="you" />
                  <Hand p="you" />
                  <button id="btn-token" title="Create a token" onClick={openTokenModal}>
                    <Icon name="token" className="tstar" />
                    <span>Token</span>
                  </button>
                </div>
              </div>

              {/* every card on the table draws here, over both seats — the
                  seats above only reserve the space */}
              <CardLayer />
            </>
          )}
        </div>
      </div>

      <SidePanel />

      <MenuLayer />
      <ModalLayer />
      <CardPreviewLayer />
      <TooltipLayer />
    </div>
  );
}

function useBoot() {
  // the one rule <Text> exists to keep, watched rather than trusted
  useEffect(watchForRawMana, []);
  // only fields take focus — a focused button would silently own Enter and
  // Space, which belong to the table
  useEffect(fieldsOnlyFocus, []);

  useEffect(() => {
    void refresh();
    void loadBrain();
    connectWS((entry) => {
      if (useGame.getState().agentBusy) usePeek.getState().push(entry);
    });
    // feel like an app, not a website: the browser context menu never opens.
    // Cards and chips install their own handlers first; this catches the rest.
    const noMenu = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", noMenu);
    return () => document.removeEventListener("contextmenu", noMenu);
  }, []);
}

/** Which layout is on, written once onto <body> for every stylesheet to read.
 *
 *  Two classes, not one: `narrow` is the window's size and `side-open` is a
 *  choice, and the drawer's transform needs both — it only slides in the
 *  narrow layout, and only when it has not been dismissed. Keeping the choice
 *  on the body rather than on #side is what lets the toggle tab, which is not
 *  inside the panel, travel with it.
 *
 *  A layout effect, so the classes are on before the first paint rather than
 *  one frame into it. The store already holds the right answer by then — it
 *  reads the media query in its initialiser — so React has laid out the
 *  correct widgets and this is only the stylesheet catching up. */
function useLayout() {
  const setNarrow = useUI((s) => s.setNarrow);
  const narrow = useUI((s) => s.narrow);
  const sideOpen = useUI((s) => s.sideOpen);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${NARROW_AT}px)`);
    const sync = () => setNarrow(isNarrow());
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [setNarrow]);

  useLayoutEffect(() => {
    document.body.classList.toggle("narrow", narrow);
    document.body.classList.toggle("side-open", sideOpen);
  }, [narrow, sideOpen]);
}

/** The space shortcut only works while this window has the keyboard, so every
 *  keycap hint appears and disappears with focus. */
function useWindowFocus() {
  useEffect(() => {
    const sync = () => document.body.classList.toggle("unfocused", !document.hasFocus());
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    sync();
    return () => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
    };
  }, []);
}

/** The composer, which Enter reaches for and Esc backs out of. */
const CHAT_INPUT = "chat-input";

function useGlobalKeys() {
  const closeModal = useUI((s) => s.closeModal);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = document.activeElement as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");

      if (e.key === "Escape") {
        ui().setPendingTuck(null);
        // Esc peels one layer at a time: an open menu first, the modal under
        // it next, and the caret last. The caret is a layer too — it is the
        // one thing on screen that swallows every other key while it has you,
        // so there has to be a way out of it that is not the mouse.
        if (menuOpen()) ui().closeMenu();
        else if (ui().modal) closeModal();
        else if (typing) {
          t!.blur();
          // and out of the composer is out of the chat: Enter opened the panel
          // and put the caret in it, so one Esc undoes the whole gesture
          const s = ui();
          if (s.narrow && t!.id === CHAT_INPUT) s.setSideOpen(false);
        }
        return;
      }

      // Enter reaches for the composer, and brings the chat out to do it. The
      // opposite of Esc, and below no guard of its own because the typing
      // guard already covers the case that matters: inside the field, Enter
      // still sends. A menu or a modal owns the key while it is up.
      if (e.key === "Enter" && !typing && !menuOpen() && !ui().modal) {
        const input = document.getElementById(CHAT_INPUT) as HTMLInputElement | null;
        if (!input) return;
        // Enter on a focused BUTTON is a click, and the button most likely to
        // have focus here is the arrow you just pressed to shut the chat — so
        // this would open the panel and the click would toggle it straight
        // back. preventDefault should stop that on its own; dropping focus as
        // well means it cannot come back through some other route.
        e.preventDefault();
        t?.blur();
        const s = ui();
        if (s.narrow && !s.sideOpen) s.setSideOpen(true);
        // Next frame, and never scrolling: while the panel is still shut the
        // composer is translated off-screen, and focusing something off-screen
        // has the browser haul the layout over to reveal it.
        requestAnimationFrame(() => input.focus({ preventScroll: true }));
        return;
      }

      // keybinds are inert while typing
      if (typing) return;
      // CMD/CTRL+Z undoes the last table action, +SHIFT walks back forward.
      // Below the typing guard on purpose: inside a text field it stays the
      // browser's text undo.
      if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        void (e.shiftKey ? redoLastAction() : undoLastAction());
        return;
      }
      // SPACE takes the floating next action, SHIFT+SPACE skips to the turn
      // pass. preventDefault stops both the page scroll and the native button
      // activation, so a focused button fires once.
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        fireNextAction(e.shiftKey);
        return;
      }
      // the chat, in and out. Only where it can go anywhere: at full width it
      // is a column of the layout and the key would have nothing to do.
      if (e.key === SIDE_KEY) {
        e.preventDefault();
        const s = ui();
        if (s.narrow) s.setSideOpen(!s.sideOpen);
        return;
      }
      if ((e.key === "e" || e.key === "E") && hovered.card) cardPrimaryAction(hovered.card, e.shiftKey);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeModal]);
}
