// The side panel: the stack, the chat, the agent's brain and the raw log,
// with one composer under them that feeds whichever is open.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { act, deleteKey, refresh, saveKey, testClaudeCli } from "../../api";
import { openRevealBrowser } from "../browsers/Browsers";
import { revealedCards } from "../../game/reveals";
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
 *  hold position when they have scrolled up to read.
 *
 *  Pinning is driven by the pane HAVING RENDERED, not by an entry count. A
 *  count misses every way a pane can grow without gaining a row — a live
 *  stack widget collapsing into a line of text, a card image arriving late,
 *  the wake bar taking its 2px off the top of the composer — and, worst of
 *  all, arithmetic on a count can land on the SAME number across exactly the
 *  change that matters: `log.length + busy` is unchanged at the moment the
 *  agent's message replaces the agent's own typing bubble, so the effect
 *  never re-ran and the reply it was waiting for arrived below the fold.
 *  Re-pinning after every render costs one scrollTop write, and the panes
 *  only render when the view changes. */
function useStickToBottom() {
  const ref = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  const pin = () => {
    const el = ref.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  };

  // after the DOM is updated and before it is painted, so the pane is never
  // seen in the un-pinned position
  useLayoutEffect(pin);

  // the pane's own box changing — the wake bar and the question strip mount
  // and unmount underneath it, and the window resizes — moves the bottom
  // without re-rendering anything inside the pane
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(pin);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = ref.current;
    if (el) following.current = el.scrollTop + el.clientHeight >= el.scrollHeight - NEAR_BOTTOM;
  };
  // late-loading card images grow the pane after we've pinned to the bottom —
  // re-pin as each one lands (capture: load events don't bubble)
  const onLoadCapture = (e: React.SyntheticEvent) => {
    if ((e.target as HTMLElement).tagName === "IMG") pin();
  };
  return { ref, onScroll, onLoadCapture };
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
      <WakeBar />
      {!needsSetup && <Composer />}
    </div>
  );
}

// ── stack ─────────────────────────────────────────────────────────────────

function StackPane() {
  const stack = useGame((s) => s.view?.stack) ?? [];
  const { ref, onScroll, onLoadCapture } = useStickToBottom();
  if (!stack.length)
    return (
      <div className="tabpane" id="pane-stack" ref={ref} onScroll={onScroll} onLoadCapture={onLoadCapture}>
        <div className="stackempty">The stack is empty.</div>
        <div className="stackhint">Type below to announce a trigger or ability onto the stack.</div>
      </div>
    );
  // one Resolve-all button when the top is a run of agent items
  const agentRun = [];
  for (let i = stack.length - 1; i >= 0 && stack[i].player === "agent"; i--) agentRun.push(stack[i]);
  return (
    <div className="tabpane" id="pane-stack" ref={ref} onScroll={onScroll} onLoadCapture={onLoadCapture}>
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

// The countdown to the agent's next window. It waits for you to stop moving
// (server/wake.ts) because every wake resends the whole conversation, and a
// run of three taps used to buy three of them. Without the bar the wait just
// looks like the agent being asleep.
//
// The fill is a CSS animation keyed on the deadline, not a per-frame render:
// a new deadline means a new element, which starts the animation over from
// zero. The server nulls the deadline when it fires, so the bar clears itself.
function WakeBar() {
  const wakeAt = useGame((s) => s.view?.wakeAt) ?? null;
  const busy = useGame((s) => s.agentBusy);
  if (!wakeAt || busy) return null;
  const left = wakeAt - Date.now();
  if (left <= 0) return null;
  return (
    <div id="wakebar" title="the agent thinks when you stop — anything you do resets this">
      <div key={wakeAt} className="wakefill" style={{ animationDuration: `${left}ms` }} />
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
  const { ref, onScroll, onLoadCapture } = useStickToBottom();

  return (
    <div className="tabpane" id="pane-chat" ref={ref} onScroll={onScroll} onLoadCapture={onLoadCapture}>
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
  // a reveal names its cards in the line and CARRIES them on the entry — the
  // line is the way back into them, for one that arrived while something else
  // was open, or one you have scrolled back to
  if (e.cards?.length) return <RevealLine e={e} />;
  // every other action (draws, taps, scries, moves…) shows as a dim line —
  // the chat is the full play-by-play, nothing happens invisibly
  return <div className="msg actline">{e.text}</div>;
}

/** A reveal, with its cards one click away. Dead once every card it named has
 *  moved on: the ids stop resolving, and it goes back to being a plain line. */
function RevealLine({ e }: { e: LogEntry }) {
  useGame((s) => s.view); // re-resolve as cards move
  const cards = revealedCards(e);
  if (!cards.length) return <div className="msg actline">{e.text}</div>;
  return (
    <div className="msg actline revealline" title="Open the revealed cards" onClick={() => openRevealBrowser(cards)}>
      {e.text}
      <span className="revealopen">👁 {cards.length}</span>
    </div>
  );
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
  // the key on the button is the one the agent is actually thinking with
  const current = view?.models?.find((m) => m.value === view?.agentModel);
  const provider = current?.provider ?? "anthropic";
  const hasKey = !!view?.keys?.[provider];
  const label =
    transport === "cli"
      ? "Opponent: Claude Code (subscription)"
      : transport === "api"
        ? `Opponent: ${current?.name ?? view?.agentModel ?? "API key"}`
        : transport === "custom"
          ? "Opponent: custom provider"
          : "Opponent: not set up";
  return (
    <div id="brain-header">
      <span className="bh-label">{label}</span>
      <button
        id="btn-delkey"
        disabled={!hasKey}
        onClick={() => {
          if (confirm("Delete the stored API key? The agent stops until a new one is pasted.")) void deleteKey(provider);
        }}
      >
        {hasKey ? "Delete key" : "No key set"}
      </button>
    </div>
  );
}

function BrainPane() {
  const brain = useGame((s) => s.brain);
  const { ref, onScroll, onLoadCapture } = useStickToBottom();
  return (
    <div className="tabpane" id="pane-brain" ref={ref} onScroll={onScroll} onLoadCapture={onLoadCapture}>
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
  const { ref, onScroll, onLoadCapture } = useStickToBottom();
  return (
    <div className="tabpane" id="pane-log" ref={ref} onScroll={onScroll} onLoadCapture={onLoadCapture}>
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
  const [cliErr, setCliErr] = useState("");
  const [busy, setBusy] = useState(false);

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
        <PasteKey provider="anthropic" name="Anthropic" hint="sk-ant-…" />
        <div className="keydivider">— or —</div>
        <PasteKey provider="deepseek" name="DeepSeek" hint="sk-…" />
        <div className="keyhint">
          An API key bills that account per token; a DeepSeek game costs cents.
          <br />
          Pick the brain in New game. Every key stays on this machine.
        </div>
      </div>
    </div>
  );
}

/** One provider's key box. The server validates the key against that
 *  provider before it stores it, so a typo is caught here rather than on the
 *  agent's first window. */
function PasteKey({ provider, name, hint }: { provider: string; name: string; hint: string }) {
  const stored = useGame((s) => !!s.view?.keys?.[provider]);
  const [key, setKey] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const k = key.trim();
    if (!k) return;
    setSaving(true);
    setErr("");
    try {
      const data = await saveKey(k, provider);
      if (!data.ok) setErr(data.error ?? "");
      else setKey("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="keysub">{name} API key{stored ? " — saved" : ""}</div>
      <input
        type="password"
        placeholder={hint}
        autoComplete="off"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void save()}
      />
      <button disabled={saving} onClick={() => void save()}>
        {saving ? "Checking…" : stored ? "Replace" : "Save"}
      </button>
      <div className="keyerror">{err}</div>
    </>
  );
}
