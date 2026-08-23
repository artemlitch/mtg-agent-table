// Showing the chat and hiding it are two controls, not one, because the one
// place a single control could live is the place the chat covers.
//
// The old version sat in the topbar and stayed there while the drawer was out.
// That works until the window is narrow enough that the drawer takes most of
// the bar with it, and then the only way to dismiss the chat is underneath the
// chat. So: SHOW lives in the bar, where there is nothing in front of it
// because the drawer is away. HIDE lives in the chat, which is the one surface
// guaranteed to be on top when there is something to hide.
import { Icon } from "../../components/Icon";
import { useGame } from "../../store/game";
import { useUI } from "../../store/ui";
import type { GameView } from "../../types";
import { STACK_CHAT_RE } from "./SidePanel";

/** In the topbar, beside undo and redo, and only while the chat is away. */
export function ShowChat() {
  const setOpen = useUI((s) => s.setSideOpen);
  const seen = useUI((s) => s.sideSeenSeq);
  const waiting = useGame((s) => pending(s.view, seen));
  return (
    <button id="btn-panel" className={waiting ? "unread" : ""} data-tip={waiting ?? "Show chat"} onClick={() => setOpen(true)}>
      <Icon name="panel" />
      {waiting && <span className="side-dot" />}
    </button>
  );
}

/** In the chat's own tab row, and out of its flow: the four tabs sit where
 *  they sit whether this is there or not, so nothing shifts as the layout
 *  changes under them. See #btn-hidechat. */
export function HideChat() {
  const setOpen = useUI((s) => s.setSideOpen);
  return (
    <button id="btn-hidechat" data-tip="Hide chat" onClick={() => setOpen(false)}>
      <Icon name="panel" />
    </button>
  );
}

/** What the shut drawer is hiding from you, or null if it is hiding nothing.
 *  The string doubles as the button's tooltip, so the light and the reason for
 *  it can never disagree.
 *
 *  Two different things, and they are unread in two different senses.
 *
 *  A LIVE STACK is a standing state, not an event: something is sitting there
 *  waiting for you to resolve or answer it, and it goes on waiting however
 *  long ago it arrived. Marking it read would be a lie — the decision is still
 *  open. So it is read off the stack itself and the seen mark never touches
 *  it. (This is the bug the first version had: the item's log line scrolled
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
