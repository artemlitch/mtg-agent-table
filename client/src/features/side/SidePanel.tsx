// The side panel: the stack, the chat, the agent's brain and the raw log,
// with one composer under them that feeds whichever is open.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { act, deleteKey, refresh, saveKey, testClaudeCli } from "../../api";
import { useGame } from "../../store/game";
import { useUI, type TabName } from "../../store/ui";
import type { LogEntry } from "../../types";
import { StackItemEl } from "../stack/StackItem";
import { usePeek } from "./peek";

const TABS: { name: TabName; label: string }[] = [
  { name: "stack", label: "Stack" },
  { name: "chat", label: "Chat" },
  { name: "brain", label: "Agent" },
  { name: "log", label: "Log" },
];

const NEAR_BOTTOM = 90; // px — within this of the bottom counts as "following"

/** Keep a pane pinned to its newest entry while the reader is at the bottom;
 *  hold position when they have scrolled up to read. */
function useStickToBottom(dep: unknown, always = false) {
  const ref = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (always || following.current) el.scrollTop = el.scrollHeight;
  }, [dep, always]);
  const onScroll = () => {
    const el = ref.current;
    if (el) following.current = el.scrollTop + el.clientHeight >= el.scrollHeight - NEAR_BOTTOM;
  };
  return { ref, onScroll };
}

export function SidePanel() {
  const view = useGame((s) => s.view);
  const tab = useUI((s) => s.activeTab);
  const setTab = useUI((s) => s.setTab);
  const transport = view?.agentTransport ?? "none";
  // without a key the Chat tab becomes a centered paste screen
  const needsSetup = transport === "none" && tab === "chat";
  const n = view?.stack?.length ?? 0;

  return (
    <div id="side">
      <div id="tabs">
        {TABS.map((t) => (
          <button key={t.name} className={tab === t.name ? "active" : ""} onClick={() => setTab(t.name)}>
            {t.label}
            {t.name === "stack" && n > 0 && <span className="tabbadge">{n}</span>}
          </button>
        ))}
      </div>

      {tab === "brain" && <BrainHeader />}
      {tab === "stack" && <StackPane />}
      {tab === "chat" && !needsSetup && <ChatPane />}
      {tab === "brain" && <BrainPane />}
      {tab === "log" && <LogPane />}
      {needsSetup && <KeySetup />}

      <div id="question">{view?.pendingQuestion ? `❓ Agent asks: ${view.pendingQuestion}` : ""}</div>
      {!needsSetup && <Composer />}
    </div>
  );
}

// ── stack ─────────────────────────────────────────────────────────────────

function StackPane() {
  const stack = useGame((s) => s.view?.stack) ?? [];
  const { ref, onScroll } = useStickToBottom(stack.length);
  if (!stack.length)
    return (
      <div className="tabpane" id="pane-stack" ref={ref} onScroll={onScroll}>
        <div className="stackempty">The stack is empty.</div>
        <div className="stackhint">Type below to announce a trigger or ability onto the stack.</div>
      </div>
    );
  // one Resolve-all button when the top is a run of agent items
  const agentRun = [];
  for (let i = stack.length - 1; i >= 0 && stack[i].player === "agent"; i--) agentRun.push(stack[i]);
  return (
    <div className="tabpane" id="pane-stack" ref={ref} onScroll={onScroll}>
      <span className="stacklabel">THE STACK — top resolves first</span>
      {agentRun.length > 1 && (
        <button
          className="resolveall"
          title="Accept the agent's whole proposal — resolves its items top-down, stops at yours"
          onClick={() => void act("stack_resolve_all", {})}
        >
          Resolve all {agentRun.length} (accept)
        </button>
      )}
      {[...stack].reverse().map((item) => (
        <StackItemEl key={item.id} item={item} />
      ))}
    </div>
  );
}

// ── chat ──────────────────────────────────────────────────────────────────

// log lines describing stack traffic — surfaced in chat as inline bubbles.
// "\(on the stack" catches attack/block declarations, phase moves and turn
// passes; the "locked in"/Phase/Round lines are those items resolving.
const STACK_CHAT_RE =
  /(→ on the stack$)|( put on the stack: )|( proposed the \d+ items )|(\(on the stack)|(^Attacks locked in: )|(^Blocks locked in: )|(^Phase: )|(^— Round )|(^Resolved: )|( resolved → )|( countered[ :])|( un-countered: )|( fizzles)|(countered\/removed: )|( back off the stack → )|( removed from the stack: )/;

function ChatPane() {
  const view = useGame((s) => s.view);
  const busy = useGame((s) => s.agentBusy);
  const setTab = useUI((s) => s.setTab);
  const log = view?.log ?? [];
  const { ref, onScroll } = useStickToBottom(log.length + (busy ? 1 : 0));

  return (
    <div
      className="tabpane"
      id="pane-chat"
      ref={ref}
      onScroll={onScroll}
      // late-loading images grow the pane after we've pinned to the bottom —
      // re-pin as each one lands (capture: load events don't bubble)
      onLoadCapture={(e) => {
        const pane = ref.current;
        if (!pane || (e.target as HTMLElement).tagName !== "IMG") return;
        if (pane.scrollTop + pane.clientHeight >= pane.scrollHeight - NEAR_BOTTOM) pane.scrollTop = pane.scrollHeight;
      }}
    >
      {log.map((e) => (
        <ChatLine key={e.seq} e={e} onOpenStack={() => setTab("stack")} />
      ))}
      {busy && <TypingBubble />}
    </div>
  );
}

function ChatLine({ e, onOpenStack }: { e: LogEntry; onOpenStack: () => void }) {
  const stack = useGame((s) => s.view?.stack) ?? [];
  const isChat = e.text.startsWith("💬") || e.text.startsWith("❓");
  if ((e.actor === "you" || e.actor === "agent") && !isChat && STACK_CHAT_RE.test(e.text)) {
    // a push's stack item id is "s" + the seq of its own log line — if that
    // item is still LIVE, embed the actual widget (same text, same buttons)
    const live = stack.find((i) => i.id === "s" + e.seq);
    if (live) return <StackItemEl item={live} inChat />;
    // the header names the actor — strip the redundant prefix and stack
    // boilerplate (actor prefix only before a known verb, so card names like
    // "Agent of Treachery" survive)
    const text = e.text
      .replace(/^(?:You|Agent) put on the stack: /, "")
      .replace(/^(?:You|Agent) (cast|played|proposed|moves|declares|countered|took|removed)\b/, "$1")
      .replace(/ → on the stack$/, "")
      .replace(/ \(on the stack(?: — respond or resolve)?\)/, "");
    return (
      <div className={`msg stackmsg ${e.actor === "you" ? "you" : "agent"}`} title="Open the Stack tab" onClick={onOpenStack}>
        <div className="mwho">{e.actor === "you" ? "You" : "Agent"} · ⚡ stack</div>
        {text}
      </div>
    );
  }
  if (isChat)
    return (
      <div className={`msg ${e.actor === "you" ? "you" : "agent"}`}>
        <div className="mwho">{e.actor === "you" ? "You" : "Agent"}</div>
        {e.text.replace(/^💬 (Player|Agent): /, "").replace(/^❓ Agent asks: /, "❓ ")}
      </div>
    );
  if (e.actor === "system") return <div className="msg sys">{e.text}</div>;
  // every other action (draws, taps, scries, moves…) shows as a dim line —
  // the chat is the full play-by-play, nothing happens invisibly
  return <div className="msg actline">{e.text}</div>;
}

function TypingBubble() {
  const { queue, index, advance, clear } = usePeek();
  const setTab = useUI((s) => s.setTab);
  useEffect(() => {
    const t = setInterval(advance, 500);
    return () => {
      clearInterval(t);
      clear();
    };
  }, [advance, clear]);
  const cur = queue[index];
  return (
    <div className="msg agent typing-bubble">
      <span className="tdot" />
      <span className="tdot" />
      <span className="tdot" />
      <span
        className="peek-line"
        title={cur ? "Open in the Agent tab" : undefined}
        onClick={() => cur && openBrainAt(cur.seq, setTab)}
      >
        {cur?.text ?? ""}
      </span>
    </div>
  );
}

function openBrainAt(seq: number, setTab: (t: TabName) => void) {
  setTab("brain");
  requestAnimationFrame(() => {
    const target = document.getElementById("brain-" + seq);
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.classList.add("highlight");
    setTimeout(() => target.classList.remove("highlight"), 2000);
  });
}

// ── the agent's brain, and the raw log ────────────────────────────────────

function BrainHeader() {
  const view = useGame((s) => s.view);
  const transport = view?.agentTransport ?? "none";
  const label =
    transport === "cli"
      ? "Opponent: Claude Code (subscription)"
      : transport === "api"
        ? "Opponent: API key"
        : transport === "custom"
          ? "Opponent: custom provider"
          : "Opponent: not set up";
  return (
    <div id="brain-header">
      <span className="bh-label">{label}</span>
      <button
        id="btn-delkey"
        disabled={!view?.keyConfigured}
        onClick={() => {
          if (confirm("Delete the stored API key? The agent stops until a new one is pasted.")) void deleteKey();
        }}
      >
        {view?.keyConfigured ? "Delete key" : "No key set"}
      </button>
    </div>
  );
}

function BrainPane() {
  const brain = useGame((s) => s.brain);
  const { ref, onScroll } = useStickToBottom(brain.length);
  return (
    <div className="tabpane" id="pane-brain" ref={ref} onScroll={onScroll}>
      {brain.map((e) => (
        <div key={e.seq} className={`brain ${e.kind}`} id={`brain-${e.seq}`}>
          {e.kind === "tool" ? `🔧 ${e.text}` : e.text}
        </div>
      ))}
    </div>
  );
}

function LogPane() {
  const log = useGame((s) => s.view?.log) ?? [];
  const { ref, onScroll } = useStickToBottom(log.length);
  return (
    <div className="tabpane" id="pane-log" ref={ref} onScroll={onScroll}>
      {log.map((e) => (
        <div className="logline" key={e.seq}>
          <b>{e.seq}</b> {e.text}
        </div>
      ))}
    </div>
  );
}

// ── composer ──────────────────────────────────────────────────────────────

function Composer() {
  const tab = useUI((s) => s.activeTab);
  const [text, setText] = useState("");
  // on the Stack tab the composer feeds the stack instead of the chat — that's
  // how you announce a random trigger/ability as a text item
  const stackMode = tab === "stack";
  const send = () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    void act(stackMode ? "stack_push" : "chat", { text: t });
  };
  return (
    <div id="composer">
      <input
        id="chat-input"
        placeholder={stackMode ? "Announce a trigger/ability onto the stack…" : "Say something to the agent…"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && send()}
      />
      <button id="btn-send" onClick={send}>
        {stackMode ? "⚡ Stack" : "Send"}
      </button>
    </div>
  );
}

// ── first-run key setup ───────────────────────────────────────────────────

function KeySetup() {
  const view = useGame((s) => s.view);
  const [key, setKey] = useState("");
  const [keyErr, setKeyErr] = useState("");
  const [cliErr, setCliErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const testCli = async () => {
    setCliErr("");
    if (!view?.cliInstalled) {
      // "Check again": just refetch state — the server re-probes the binary
      await refresh();
      if (!useGame.getState().view?.cliInstalled) setCliErr("still not finding the claude binary");
      return;
    }
    setBusy(true);
    try {
      const data = await testClaudeCli();
      if (!data.ok) setCliErr(data.error ?? "");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const k = key.trim();
    if (!k) return;
    setSaving(true);
    setKeyErr("");
    try {
      const data = await saveKey(k);
      if (!data.ok) setKeyErr(data.error ?? "");
      else setKey("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div id="keysetup">
      <div className="keybox">
        <div className="keytitle">Bring your opponent to life</div>
        <div className="keysub">Use Claude Code — your Claude subscription, nothing per game</div>
        <div className="keyhint">
          {view?.cliInstalled ? (
            <>
              Claude Code is installed. Log in once (run <b>claude</b> in Terminal), then:
            </>
          ) : (
            <>
              Not installed yet. In Terminal: <b>npm install -g @anthropic-ai/claude-code</b>,
              <br />
              then run <b>claude</b> once to log in, then:
            </>
          )}
        </div>
        <button disabled={busy} onClick={() => void testCli()}>
          {busy ? "Asking Claude to say ok… (can take a minute)" : view?.cliInstalled ? "Test Claude Code" : "Check again"}
        </button>
        <div id="cli-error">{cliErr}</div>
        <div className="keydivider">— or —</div>
        <div className="keysub">Paste an Anthropic API key</div>
        <input
          type="password"
          placeholder="sk-ant-…"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void save()}
        />
        <button disabled={saving} onClick={() => void save()}>
          {saving ? "Checking…" : "Save"}
        </button>
        <div id="key-error">{keyErr}</div>
        <div className="keyhint">
          An API key bills your Anthropic Console account per token.
          <br />
          Either choice stays on this machine only.
        </div>
      </div>
    </div>
  );
}
