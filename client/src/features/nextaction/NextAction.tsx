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
  if (!a) return null;

  return (
    <div id="nextaction">
      <div className="na-row">
        <div className="na-undowrap">
          <button id="na-undo" data-tip="Undo" data-tip-keys="⌘,Z" onClick={() => void undoLastAction()}>
            <Icon name="undo" />
          </button>
        </div>

        {a.hint ? (
          <div id="na-hint">{a.hint}</div>
        ) : (
          <button id="na-primary" title={a.title || ""} onClick={a.fn}>
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
            <button id="na-redo" data-tip="Redo" data-tip-keys="⌘,⇧,Z" onClick={() => void redoLastAction()}>
              <Icon name="redo" />
            </button>
          </div>
        )}
      </div>

      {a.skip && (
        <button id="na-skip" onClick={() => void passTurnToAgent()}>
          <span>
            <Icon name="skip" /> skip to pass turn
          </span>
          <KeyCaps keys={["⇧", "space"]} />
        </button>
      )}
    </div>
  );
}
