import { useLayoutEffect, useRef } from "react";
import { redoLastAction, undoLastAction } from "../../api";
import { previewProps } from "../../components/CardPreview";
import { Icon } from "../../components/Icon";
import { KeyCaps } from "../../components/KeyCaps";
import { useGame } from "../../store/game";
import { nextActionContext, passTurnToAgent, NEXT_ACTION_STEPS } from "./steps";

/** The centred prompt: the one thing the table is asking you to do, with undo
 *  and redo as satellites that don't shift it, and a faded skip beneath. */
export function NextAction() {
  const view = useGame((s) => s.view);
  if (!view?.started) return null;
  const ctx = nextActionContext(view);
  const rule = NEXT_ACTION_STEPS.find((r) => r.when(ctx));
  const a = rule ? rule.step(ctx) : null;
  const size = useSizeTransition();
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
            {a.card && <img id="na-card" src={a.card.image} alt="" {...previewProps(a.card)} />}
            <span className="na-text">
              <span className="na-label">
                {a.icon && <Icon name={a.icon} />}
                {a.label}
              </span>
              {a.sub && a.sub !== a.label && <span className="na-sub">{String(a.sub).split("\n")[0]}</span>}
              <KeyCaps keys={["space"]} />
            </span>
          </button>
        )}

        {/* redo only exists while a rewind is still un-branched */}
        {view.canRedo && (
          <div className="na-redowrap">
            <button id="na-redo" className="ghost" data-tip="Redo" data-tip-keys="⌘,⇧,Z" onClick={() => void redoLastAction()}>
              <Icon name="redo" />
            </button>
          </div>
        )}
      </div>

      {a.skip && (
        <button id="na-skip" className="ghost" onClick={() => void passTurnToAgent()}>
          <span>
            <Icon name="skip" /> skip to pass turn
          </span>
          <KeyCaps keys={["⇧", "space"]} />
        </button>
      )}
    </div>
  );
}

/** The prompt's label changes length constantly — "Draw 1" one tap, "Resolve
 *  all (3)" the next — and an auto-sized box just snaps to the new width.
 *  CSS cannot transition that on its own: the computed width is `auto` before
 *  and after, so no transition ever fires. So pin the old size, force a
 *  reflow, then animate to the new one and hand the box back to `auto`. All of
 *  it before paint, so the pinned frame is never shown.
 */
function useSizeTransition() {
  const ref = useRef<HTMLButtonElement>(null);
  const prev = useRef<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      prev.current = null;
      return;
    }
    const to = { w: el.offsetWidth, h: el.offsetHeight };
    const from = prev.current;
    prev.current = to;
    if (!from || (from.w === to.w && from.h === to.h)) return;
    el.style.transition = "none";
    el.style.width = `${from.w}px`;
    el.style.height = `${from.h}px`;
    void el.offsetWidth; // flush, or the browser coalesces both sizes into one
    // the timing lives in CSS (#na-primary.sizing) so this shares one set of
    // variables with every other transition in the app
    el.style.transition = "";
    el.classList.add("sizing");
    el.style.width = `${to.w}px`;
    el.style.height = `${to.h}px`;
    const release = () => {
      el.classList.remove("sizing");
      el.style.width = "";
      el.style.height = "";
    };
    const t = window.setTimeout(release, 260);
    return () => window.clearTimeout(t);
  });
  return ref;
}
