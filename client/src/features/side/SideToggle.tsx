// The chat's handle: an arrow riding on its leading edge, halfway down the
// window. It travels with the panel — pinned to the window and sliding the
// same distance the other way — so it is on the chat's inner corner while the
// chat is out and on the window's edge once it has gone.
//
// Which means it can never be covered by the thing it controls, at any window
// size, without anything having to reserve room for it: it is always just
// outside the panel's edge, wherever that edge currently is.
//
// The arrow points at where the panel is about to go. Left pulls it out, right
// pushes it away.
import { Icon } from "../../components/Icon";
import { useGame } from "../../store/game";
import { useUI } from "../../store/ui";
import type { GameView } from "../../types";
import { STACK_CHAT_RE } from "./SidePanel";

/** The key that also works it, named in the tooltip so it can be found. */
export const SIDE_KEY = "]";

export function SideToggle() {
  const open = useUI((s) => s.sideOpen);
  const setOpen = useUI((s) => s.setSideOpen);
  const seen = useUI((s) => s.sideSeenSeq);
  const waiting = useGame((s) => (open ? null : pending(s.view, seen)));
  return (
    <button
      id="side-arrow"
      className={waiting ? "unread" : ""}
      data-tip={`${open ? "Close" : "Open"} chat`}
      data-tip-keys={SIDE_KEY}
      onClick={() => setOpen(!open)}
    >
      <Icon name={open ? "chevronRight" : "chevronLeft"} />
      {/* The bell carries its own tooltip: the arrow says what pressing it
          does, and WHY it is lit is a different question with a different
          answer. Its data-tip wins on hover because it is the inner element. */}
      {waiting && (
        <span className="side-bell" data-tip={waiting}>
          <Icon name="bell" />
        </span>
      )}
    </button>
  );
}

/** What the shut chat is hiding from you, or null if it is hiding nothing.
 *
 *  Two different things, and they are unread in two different senses.
 *
 *  A LIVE STACK is a standing state, not an event: something is sitting there
 *  waiting for you to resolve or answer it, and it goes on waiting however
 *  long ago it arrived. Marking it read would be a lie — the decision is still
 *  open. So it is read off the stack itself and the seen mark never touches
 *  it. (This is the bug an earlier version had: the item's log line scrolled
 *  past while the panel was up, the mark moved past it, and a stack with an
 *  unanswered item on it showed nothing.)
 *
 *  A MESSAGE is an event, and the seen mark is exactly right for it: the
 *  agent said something while you were not looking. Only the agent's own voice
 *  counts. The play-by-play is the agent's log too, so counting every entry
 *  would light this on each tap and untap, and a notification that is always
 *  on says nothing. */
function pending(view: GameView | null, seen: number): string | null {
  const n = view?.stack?.length ?? 0;
  if (n) return n === 1 ? "1 item on the stack" : `${n} items on the stack`;
  // walks back from the newest and stops at the mark — the log runs to
  // hundreds of lines by the late game and this is read on every view update
  const log = view?.log;
  for (let i = (log?.length ?? 0) - 1; i >= 0; i--) {
    const e = log![i];
    if (e.seq <= seen) return null;
    if (e.actor !== "agent") continue;
    if (e.text.startsWith("💬") || e.text.startsWith("❓") || STACK_CHAT_RE.test(e.text)) return "The agent said something";
  }
  return null;
}
