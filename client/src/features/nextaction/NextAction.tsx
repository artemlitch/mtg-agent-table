import { useLayoutEffect, useRef } from "react";
import { redoLastAction, undoLastAction } from "../../api";
import { artFallback } from "../../components/cardArt";
import { previewProps } from "../../components/CardPreview";
import { Icon } from "../../components/Icon";
import { KeyCaps } from "../../components/KeyCaps";
import { Text } from "../../components/Text";
import { useGame } from "../../store/game";
import { nextActionContext, passTurnToAgent, NEXT_ACTION_STEPS } from "./steps";

/** The centred prompt: the one thing the table is asking you to do, with undo
 *  and redo as satellites that don't shift it, and a faded skip beneath. */
export function NextAction() {
  const view = useGame((s) => s.view);
  const ctx = view?.started ? nextActionContext(view) : null;
  const rule = ctx ? NEXT_ACTION_STEPS.find((r) => r.when(ctx)) : null;
  const a = rule && ctx ? rule.step(ctx) : null;
  // Keyed on what actually changes the box's shape, not on the render. The
  // view updates constantly during a turn and the label rarely moves with it;
  // re-running per render meant re-measuring in the middle of the animation
  // the last change had started. Called above the early return, so the hook
  // count cannot depend on whether there is a prompt to show.
  const size = useSizeTransition(a ? `${a.label ?? ""}|${a.sub ?? ""}|${a.card?.id ?? ""}|${a.icon ?? ""}` : "");
  if (!a) return null;

  return (
    <div id="nextaction">
      <div className="na-row">
        <div className="na-undowrap">
          <button id="na-undo" className="ghost" data-tip="Undo" data-tip-keys="⌘,Z" onClick={() => void undoLastAction()}>
            <Icon name="undo" />
          </button>
        </div>

        {a.hint ? (
          <div id="na-hint">{a.hint}</div>
        ) : (
          <button id="na-primary" ref={size} title={a.title || ""} onClick={a.fn}>
            {a.card && <img id="na-card" src={a.card.image} alt="" {...previewProps(a.card)} {...artFallback(a.card.name)} />}
            <span className="na-text">
              <span className="na-label">
                {a.icon && !isPhaseMove(a.label ?? "") && <Icon name={a.icon} />}
                <PhaseLabel text={a.label ?? ""} />
              </span>
              {/* the sub-line is the stack item's own words, so it carries
                  mana the same way the Stack tab and the chat do */}
              {a.sub && a.sub !== a.label && <Text className="na-sub">{String(a.sub).split("\n")[0]}</Text>}
              <KeyCaps keys={["space"]} />
            </span>
          </button>
        )}

        {/* redo only exists while a rewind is still un-branched */}
        {view?.canRedo && (
          <div className="na-redowrap">
            <button id="na-redo" className="ghost" data-tip="Redo" data-tip-keys="⌘,⇧,Z" onClick={() => void redoLastAction()}>
              <Icon name="redo" />
            </button>
          </div>
        )}
      </div>

      {a.skip && (
        <button id="na-skip" className="ghost quietline" onClick={() => void passTurnToAgent()}>
          <span>
            <Icon name="skip" /> skip to pass turn
          </span>
          <KeyCaps keys={["⇧", "space"]} />
        </button>
      )}
    </div>
  );
}

/** Which glyph each named phase wears. Keyed on the words the label already
 *  uses, so a step names its phases once and the icons follow. */
const PHASE_ICON: Record<string, string> = {
  untap: "untap",
  "main phase": "main",
  "main phase 1": "main",
  "main phase 2": "main",
  combat: "combat",
  "end step": "end",
};

/** Does this label read as a move between two phases? */
export const isPhaseMove = (label: string) => label.includes(" → ");

/** A phase step is two named phases and the move between them, so it is drawn
 *  as two chips rather than one run of words: each phase carries its own glyph
 *  and its own border, and the arrow between them is drawn, not typed. The
 *  label keeps the plain "a → b" string — that is still what the size key and
 *  the tooltip want. Anything without an arrow passes straight through. */
function PhaseLabel({ text }: { text: string }) {
  const at = text.indexOf(" → ");
  // a plain label can be the stack item's own sentence — see the resolve step
  // in steps.ts, which slices c.top.text straight into it
  if (at < 0) return <Text>{text}</Text>;
  const [from, to] = [text.slice(0, at), text.slice(at + 3)];
  const chip = (name: string, which: "from" | "to") => (
    <span className={`na-phase na-${which}`}>
      {PHASE_ICON[name] && <Icon name={PHASE_ICON[name]} />}
      <Text>{name}</Text>
    </span>
  );
  return (
    <>
      {chip(from, "from")}
      <Icon name="phaseArrow" className="na-arrow" />
      {chip(to, "to")}
    </>
  );
}

/** The prompt's label changes length constantly — "Draw 1" one tap, "Resolve
 *  all (3)" the next — and an auto-sized box just snaps to the new width.
 *  CSS cannot transition that on its own: the computed width is `auto` before
 *  and after, so no transition ever fires. So pin the old size, force a
 *  reflow, then animate to the new one and hand the box back to `auto`. All of
 *  it before paint, so the pinned frame is never shown.
 *
 *  The whole thing rests on offsetWidth being the NATURAL width, which is only
 *  true when nothing is animating: while a change is in flight there is an
 *  inline width holding the box mid-transition, and measuring that reads the
 *  interpolated number instead. Getting it wrong is what made the box jitter —
 *  it would take a mid-flight value for a new target and animate towards it,
 *  then snap when the inline size finally came off. So the inline size comes
 *  off BEFORE measuring, every time.
 */
function useSizeTransition(key: string) {
  const ref = useRef<HTMLButtonElement>(null);
  // The last natural size. Layout effects run after React has already written
  // the new label into the DOM, so by the time we look, the element measures
  // the NEW size — the old one has to have been remembered from last time.
  const natural = useRef<{ w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      natural.current = null;
      return;
    }

    // Where the box sits on screen right now. An inline width means an earlier
    // change is still animating, and that is where the eye last saw it — so an
    // interrupted change carries on from there rather than jumping back to a
    // start frame that is already out of date.
    const from = el.style.width ? { w: el.offsetWidth, h: el.offsetHeight } : natural.current;

    // Strip the animation before measuring, or `to` is the interpolated value.
    el.classList.remove("sizing");
    el.style.transition = "none";
    el.style.width = "";
    el.style.height = "";
    const to = { w: el.offsetWidth, h: el.offsetHeight };
    natural.current = to;

    if (!from || (from.w === to.w && from.h === to.h)) {
      el.style.transition = ""; // back to the stylesheet's hover timing
      return;
    }

    el.style.width = `${from.w}px`;
    el.style.height = `${from.h}px`;
    void el.offsetWidth; // flush, or the browser coalesces both sizes into one
    // the timing lives in CSS (#na-primary.sizing) so this shares one set of
    // variables with every other transition in the app
    el.style.transition = "";
    el.classList.add("sizing");
    el.style.width = `${to.w}px`;
    el.style.height = `${to.h}px`;

    // Hand the box back to `auto` when the animation actually ends, rather
    // than at a hand-set delay that has to be kept in step with --size-dur.
    // The fallback still matters: transitionend never fires for a motion the
    // browser decides not to run (a hidden tab, a zeroed duration), and a
    // release that never happens leaves a fixed pixel width on a box that is
    // overflow: hidden — so the next longer label would be clipped instead of
    // resizing. Generous, because it is a backstop and not the timing.
    const release = () => {
      el.classList.remove("sizing");
      el.style.width = "";
      el.style.height = "";
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.target === el && (e.propertyName === "width" || e.propertyName === "height")) release();
    };
    el.addEventListener("transitionend", onEnd);
    const t = window.setTimeout(release, 600);
    return () => {
      el.removeEventListener("transitionend", onEnd);
      window.clearTimeout(t);
    };
  }, [key]);

  return ref;
}
