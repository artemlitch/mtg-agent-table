// Shows and hides the side panel. It belongs to the panel, but it lives in
// the topbar beside undo and redo — a control that is only reachable while the
// thing it controls is on screen is not a control, and in the narrow layout
// the panel is a drawer that leaves.
import { Icon } from "../../components/Icon";
import { useGame } from "../../store/game";
import { useUI } from "../../store/ui";
import type { LogEntry } from "../../types";
import { STACK_CHAT_RE } from "./SidePanel";

export function SideToggle() {
  const open = useUI((s) => s.sideOpen);
  const setOpen = useUI((s) => s.setSideOpen);
  const seen = useUI((s) => s.sideSeenSeq);
  const unread = useGame((s) => !open && missedSince(s.view?.log, seen));
  return (
    <button
      id="btn-panel"
      className={`${open ? "on" : ""}${unread ? " unread" : ""}`}
      data-tip={open ? "Hide the panel" : unread ? "The agent said something" : "Show the panel"}
      onClick={() => setOpen(!open)}
    >
      <Icon name="panel" />
      {unread && <span className="side-dot" />}
    </button>
  );
}

/** Has the agent said or stacked anything you have not seen?
 *
 *  The price of a dismissible chat: put the panel away and the agent goes on
 *  talking behind it. Two kinds of entry count — the agent's own voice, and
 *  anything it put on the stack — and nothing else does. The play-by-play is
 *  the agent's log too, so counting every entry would light this on each tap
 *  and untap, and a notification that is always on says nothing.
 *
 *  Walks back from the newest entry and stops at the mark: the log runs to
 *  hundreds of lines by the late game and this is read on every view update. */
function missedSince(log: LogEntry[] | undefined, seen: number): boolean {
  for (let i = (log?.length ?? 0) - 1; i >= 0; i--) {
    const e = log![i];
    if (e.seq <= seen) return false;
    if (e.actor !== "agent") continue;
    if (e.text.startsWith("💬") || e.text.startsWith("❓") || STACK_CHAT_RE.test(e.text)) return true;
  }
  return false;
}
