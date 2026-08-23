// Shows and hides the side panel. It belongs to the panel, but it lives in
// the topbar beside undo and redo — a control that is only reachable while the
// thing it controls is on screen is not a control, and in the narrow layout
// the panel is a drawer that leaves.
import { Icon } from "../../components/Icon";
import { useGame } from "../../store/game";
import { useUI } from "../../store/ui";
import type { LogEntry } from "../../types";

export function SideToggle() {
  const open = useUI((s) => s.sideOpen);
  const setOpen = useUI((s) => s.setSideOpen);
  const seen = useUI((s) => s.sideSeenSeq);
  // The dot is the price of a dismissible chat: put the panel away and the
  // agent goes on talking behind it. Only its own voice counts — a dot for
  // every tap and untap in the play-by-play would be a light that is always
  // on, which says nothing.
  const unread = useGame((s) => !open && agentSpokeSince(s.view?.log, seen));
  return (
    <button
      id="btn-panel"
      className={open ? "on" : ""}
      data-tip={open ? "Hide the panel" : "Show the panel"}
      onClick={() => setOpen(!open)}
    >
      <Icon name="panel" />
      {unread && <span className="side-dot" />}
    </button>
  );
}

/** Walks back from the newest entry and stops at the mark — the log runs to
 *  hundreds of lines by the late game and this is read on every view update. */
function agentSpokeSince(log: LogEntry[] | undefined, seen: number): boolean {
  for (let i = (log?.length ?? 0) - 1; i >= 0; i--) {
    const e = log![i];
    if (e.seq <= seen) return false;
    if (e.actor === "agent") return true;
  }
  return false;
}
