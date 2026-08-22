/* MTG Agent Table — frontend. Vanilla JS, full re-render on every update. */

const $ = (s) => document.querySelector(s);
let state = null;
let pendingTuck = null; // card id waiting for a pile target (menu "Tuck under…")
let brainEntries = [];
let agentBusy = false;

// ---------------------------------------------------------------------------
// Server IO
// ---------------------------------------------------------------------------

async function act(type, params = {}) {
  const res = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actor: "you", type, params }),
  });
  const data = await res.json();
  if (!data.ok) alert(`Action failed: ${data.error}`);
  return data;
}

async function refresh() {
  const res = await fetch("/api/state?viewer=you");
  state = await res.json();
  render();
}

async function loadBrain() {
  const res = await fetch("/api/brain");
  const data = await res.json();
  brainEntries = data.entries;
  agentBusy = data.busy;
  renderBrain();
  renderAgentStatus();
}

function connectWS() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "update") refresh();
    if (msg.type === "brain") {
      brainEntries.push(msg.entry);
      agentBusy = msg.busy;
      appendBrainEntry(msg.entry);
      renderAgentStatus();
      updateBrainPeek(msg.entry);
    }
  };
  ws.onclose = () => setTimeout(connectWS, 1500);
}

// ---------------------------------------------------------------------------
// Sound effects — engine and sound definitions live in sfx.js (shared with the
// sound lab); here we only decide WHICH sound a new log entry earns.
// ---------------------------------------------------------------------------

// first matching rule per log entry decides its sound
const SOUND_RULES = [
  ["glimmer", /^— Round \d+:/],
  ["attack", /(declares attackers)|(^Attacks locked in: )/],
  ["hit", / from battlefield to .*graveyard/],
  ["hit", / countered .* → .*graveyard/],
  ["thump", / resolved → .*battlefield/],
  ["thump", / played .* — land drop/],
  ["stack", /(→ on the stack$)|( put on the stack: )|( proposed the \d+ items )|(declares (blockers|the turn pass))/],
  ["tap", / tapped /],
];

let lastSoundSeq = null;

function processSounds() {
  if (!state || !state.log || !state.log.length) return;
  const maxSeq = state.log[state.log.length - 1].seq;
  if (lastSoundSeq === null) {
    lastSoundSeq = maxSeq; // no barrage for history on page load
    return;
  }
  const cats = [];
  for (const e of state.log) {
    if (e.seq <= lastSoundSeq) continue;
    for (const [cat, re] of SOUND_RULES) {
      if (re.test(e.text)) {
        if (!cats.includes(cat)) cats.push(cat);
        break;
      }
    }
  }
  lastSoundSeq = maxSeq;
  cats.slice(0, 4).forEach((c, i) => setTimeout(() => SFX.play(c), i * 140));
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render() {
  if (!state) return;
  if (draggingNow) {
    pendingRender = true;
    return;
  }
  const turnWho = state.turn === "you" ? "Your turn" : "Agent's turn";
  const prio = state.waitingOn === "agent" ? "⏳ agent has priority" : "● you have priority";
  $("#turnbanner").textContent = state.started
    ? `Round ${state.turnNumber} — ${turnWho} — ${state.phase} — ${prio}`
    : "No game — hit New game to load decks";
  if (!state.started && $("#newgame-overlay").classList.contains("hidden") && !newGameAutoOpened) {
    newGameAutoOpened = true;
    openNewGame();
  }
  // card ids restart across games — clear the placement memory on empty boards
  if (!state.players.you.zones.battlefield.length && !state.players.agent.zones.battlefield.length) autoPlaced.clear();
  renderStack();
  renderRail("agent");
  renderRail("you");
  renderHand("agent");
  renderHand("you");
  renderBattlefield("agent");
  renderBattlefield("you");
  renderChat();
  renderLog();
  // combat glow: the whole combat step, either player's turn — the phase is
  // free text, so blockers/damage sub-steps count too
  $("#combatglow").classList.toggle("on", !!state.started && /combat|attack|block|damage/i.test(state.phase || ""));
  renderNextAction();
  processSounds();
  updateKeyUI();
  $("#question").textContent = state.pendingQuestion ? `❓ Agent asks: ${state.pendingQuestion}` : "";
}

// ---------------------------------------------------------------------------
// Anthropic API key: without one, the Chat tab becomes a centered paste
// screen; the Agent tab always carries a header with the delete button.
// ---------------------------------------------------------------------------

function updateKeyUI() {
  const transport = state?.agentTransport ?? "none";
  const needsSetup = transport === "none" && activeTab === "chat";
  $("#keysetup").classList.toggle("hidden", !needsSetup);
  $("#pane-chat").classList.toggle("hidden", needsSetup || activeTab !== "chat");
  $("#composer").classList.toggle("hidden", needsSetup);
  if (needsSetup) {
    $("#cli-status").innerHTML = state?.cliInstalled
      ? "Claude Code is installed. Log in once (run <b>claude</b> in Terminal), then:"
      : "Not installed yet. In Terminal: <b>npm install -g @anthropic-ai/claude-code</b>,<br>then run <b>claude</b> once to log in, then:";
    $("#btn-clitest").textContent = state?.cliInstalled ? "Test Claude Code" : "Check again";
  }
  $("#brain-header").classList.toggle("hidden", activeTab !== "brain");
  $("#brain-header .bh-label").textContent =
    transport === "cli" ? "Opponent: Claude Code (subscription)"
    : transport === "api" ? "Opponent: API key"
    : transport === "custom" ? "Opponent: custom provider"
    : "Opponent: not set up";
  const del = $("#btn-delkey");
  del.disabled = !state?.keyConfigured;
  del.textContent = state?.keyConfigured ? "Delete key" : "No key set";
}

$("#btn-clitest").onclick = async () => {
  const btn = $("#btn-clitest");
  $("#cli-error").textContent = "";
  if (!state?.cliInstalled) {
    // "Check again": just refetch state — the server re-probes the binary
    await refresh();
    if (!state?.cliInstalled) $("#cli-error").textContent = "still not finding the claude binary";
    return;
  }
  btn.disabled = true;
  btn.textContent = "Asking Claude to say ok… (can take a minute)";
  try {
    const res = await fetch("/api/claude/test", { method: "POST" });
    const data = await res.json();
    if (!data.ok) $("#cli-error").textContent = data.error;
  } finally {
    btn.disabled = false;
    btn.textContent = "Test Claude Code";
  }
};

$("#btn-savekey").onclick = async () => {
  const input = $("#key-input");
  const key = input.value.trim();
  if (!key) return;
  const btn = $("#btn-savekey");
  btn.disabled = true;
  btn.textContent = "Checking…";
  $("#key-error").textContent = "";
  try {
    const res = await fetch("/api/key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    const data = await res.json();
    if (!data.ok) {
      $("#key-error").textContent = data.error;
      return;
    }
    input.value = "";
  } finally {
    btn.disabled = false;
    btn.textContent = "Save";
  }
};
$("#key-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#btn-savekey").click();
});

$("#btn-delkey").onclick = async () => {
  if (!confirm("Delete the stored API key? The agent stops until a new one is pasted.")) return;
  await fetch("/api/key", { method: "DELETE" });
};

// declining blocks is per-attack: remembering the signature stops the prompt
// reappearing for an attack you already waved through
let noBlocksDeclaredFor = null;

// ── icons ─────────────────────────────────────────────────────────────────
// Font Awesome Free (solid), vendored under web/vendor — same rule as the
// type: nothing is fetched off the network at runtime. Names here, not
// classes at the call sites, so the icon set can be re-pointed in one place.
// A tapped card's top ends at 3 o'clock, so tap turns clockwise and untap
// turns back the other way.
// game-icons.net, vendored as CSS masks (tools/build-icons.mjs). Add a name
// here, list it in that script, re-run it.
const ICONS = {
  tap: "gi-clockwise-rotation",
  untap: "gi-anticlockwise-rotation",
  undo: "gi-return-arrow",
  answer: "gi-chat-bubble",
  takeTurn: "gi-player-next",
  resolve: "gi-check-mark",
  resolveAll: "gi-checklist",
  damage: "gi-sword-clash",
  noBlocks: "gi-shield-disabled",
  draw: "gi-card-draw",
  main: "gi-play-button",
  combat: "gi-crossed-swords",
  end: "gi-moon",
  passTurn: "gi-hourglass",
  skip: "gi-fast-forward-button",
  mulligan: "gi-recycle",
  cast: "gi-magic-swirl",
  counters: "gi-gems",
  token: "gi-token",
  copy: "gi-gemini",
  pile: "gi-stack",
  steal: "gi-snatch",
  give: "gi-shaking-hands",
  command: "gi-crown",
  ability: "gi-bolt-spell-cast",
  flip: "gi-card-exchange",
  trash: "gi-trash-can",
  bullet: "gi-plain-circle",
  search: "gi-magnifying-glass",
  scry: "gi-spectacles",
  surveil: "gi-binoculars",
  mill: "gi-card-discard",
  exile: "gi-card-burn",
  reveal: "gi-all-seeing-eye",
  shuffle: "gi-card-random",
  // card-menu specifics, so no two rows of one menu share a glyph
  exileDown: "gi-hidden",
  facedown: "gi-invisible",
  toHand: "gi-card-pickup",
  top: "gi-up-card",
  bottom: "gi-plain-arrow gi-rot180",
  library: "gi-book-pile",
  secret: "gi-hood",
  block: "gi-shield",
  setpt: "gi-pencil",
  cancel: "gi-cancel",
  cancelAttack: "gi-sword-break",
  battlefield: "gi-empty-chessboard",
  caret: "gi-plain-arrow gi-rot180",
  caretUp: "gi-plain-arrow",
  // card types, for the search filter
  anyType: "gi-circle",
  creature: "gi-dragon-head",
  land: "gi-mountains",
  artifact: "gi-gears",
  enchantment: "gi-sparkles",
  instant: "gi-arcing-bolt",
  sorcery: "gi-scroll-unfurled",
  planeswalker: "gi-chess-king",
  battle: "gi-castle",
  blank: "", // keeps a row's icon column aligned with nothing in it
};
// "blank" holds a row's icon column open with nothing in it, so it must not
// carry .gi — a masked element with no mask paints a solid square.
const iconClass = (name) => {
  const cls = ICONS[name] ?? name;
  return cls ? `gi ${cls} ico` : "ico";
};
function iconEl(name) {
  const i = document.createElement("i");
  i.className = iconClass(name);
  i.setAttribute("aria-hidden", "true");
  return i;
}
/** Fill any <i data-icon="name"> in the static markup. */
function renderIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    el.className = iconClass(el.dataset.icon);
    el.setAttribute("aria-hidden", "true");
  });
}

// ── keyboard keycaps ──────────────────────────────────────────────────────
// One look for every shortcut hint in the app. Mark a span with
// data-keys="⇧,space" and it becomes outlined caps joined by +. Rendered
// once at load; add a hint by adding the attribute, not by writing markup.
function keyCaps(keys) {
  const wrap = document.createDocumentFragment();
  keys.forEach((k, i) => {
    if (i) {
      const plus = document.createElement("span");
      plus.className = "keyplus";
      plus.textContent = "+";
      wrap.append(plus);
    }
    const cap = document.createElement("kbd");
    cap.className = "keycap";
    cap.textContent = k;
    wrap.append(cap);
  });
  return wrap;
}
function renderKeyCaps(root = document) {
  root.querySelectorAll("[data-keys]").forEach((el) => {
    el.innerHTML = "";
    el.append(keyCaps(el.dataset.keys.split(",")));
  });
}
renderKeyCaps();
renderIcons();

// the space shortcut only works while this window has the keyboard, so the
// hint inside the button appears and disappears with focus
const syncWindowFocus = () => document.body.classList.toggle("unfocused", !document.hasFocus());
window.addEventListener("focus", syncWindowFocus);
window.addEventListener("blur", syncWindowFocus);
syncWindowFocus();

// ── The next-action prompt ────────────────────────────────────────────────
// One always-visible "most obvious next tap" floating over your board. This
// is a PRECEDENCE list, not a linear chain: the agent's stack items outrank
// the turn structure, because the house rule is settle the stack first.
// Each step is one entry — add, remove or reorder freely; the first whose
// when() is true wins. Return either { label, fn } for a real action or
// { hint } for a nudge at something the table can't do in one click.
//   icon: a key into ICONS, drawn before the label.
//   skip: true adds the faded skip-to-pass-turn line underneath.

const passTurnToAgent = async () => {
  await act("set_turn", { player: "agent" });
  await act("done", {});
};

/** Did this happen already during the current round? (log-scan: the turn
 *  structure isn't tracked in state, and the round marker bounds the scan) */
function didThisTurn(re) {
  const log = state.log || [];
  for (let i = log.length - 1; i >= 0; i--) {
    const t = log[i].text || "";
    if (/^—\s*Round \d+/.test(t)) return false;
    if (re.test(t)) return true;
  }
  return false;
}

/** The card a stack item is about: the card itself for a spell, or the
 *  permanent a trigger came from. Only ones we can actually picture. */
function stackItemCard(item) {
  const c = item?.card ?? (item?.source ? cardById(item.source) : null);
  return c && c.image && !c.hidden ? c : null;
}

/** What the item SAYS, minus the card title and mana cost the agent writes in
 *  front of it — the picture beside the text already names the card. Targets
 *  (⟶ …) survive; an item that is nothing but its title comes back empty. */
function stackSubText(item, card) {
  let t = String(item?.text || "").split("\n")[0];
  const name = card?.name || item?.card?.name;
  if (name && t.toLowerCase().startsWith(name.toLowerCase())) t = t.slice(name.length);
  t = t.replace(/^\s*(\{[^}]*\}\s*)+/, "").replace(/^\s*[—–:-]\s*/, "");
  return t.trim();
}

function nextActionContext() {
  const stack = state.stack || [];
  const top = stack.length ? stack[stack.length - 1] : null;
  const theirAttackers = state.players.agent.zones.battlefield.filter((c) => c.attacking);
  return {
    stack,
    top,
    mine: state.turn === "you",
    phase: state.phase || "",
    theirAttackers,
    // one signature per attack, so declining blocks hides the prompt for
    // THAT attack only — the next one asks again
    attackSig: theirAttackers.map((c) => c.id).sort().join(","),
    iAmBlocking: state.players.you.zones.battlefield.some((c) => c.blocking),
    myAttackers: state.players.you.zones.battlefield.filter((c) => c.attacking),
    myTapped: state.players.you.zones.battlefield.some((c) => c.tapped),
  };
}

const NEXT_ACTION_STEPS = [
  // ── either turn: the stack and the agent come first ──
  {
    id: "answer-question",
    when: () => !!state.pendingQuestion,
    step: () => ({ label: "Answer the agent", icon: "answer", fn: () => { switchTab("chat"); $("#chat-input").focus(); } }),
  },
  {
    id: "take-your-turn",
    when: (c) => c.top?.player === "agent" && !!c.top.turnPassTo,
    step: (c) => ({ label: "Take your turn", icon: "takeTurn", fn: () => act("stack_resolve", { item: c.top.id }) }),
  },
  {
    id: "lock-their-attack",
    when: (c) => c.top?.player === "agent" && !!c.top.attackPairs,
    step: (c) => ({ label: "Go to damage", icon: "damage", fn: () => act("stack_resolve", { item: c.top.id }) }),
  },
  {
    id: "resolve-all",
    when: (c) => c.top?.player === "agent" && !!c.top.groupId && c.stack.filter((i) => i.groupId === c.top.groupId && i.player === "agent").length > 1,
    step: (c) => {
      const card = stackItemCard(c.top);
      return {
        label: `Resolve all (${c.stack.filter((i) => i.groupId === c.top.groupId && i.player === "agent").length})`,
        icon: "resolveAll",
        sub: stackSubText(c.top, card),
        card,
        fn: () => act("stack_resolve_all", { group: c.top.groupId }),
      };
    },
  },
  {
    id: "resolve-one",
    when: (c) => c.top?.player === "agent",
    step: (c) => {
      const card = stackItemCard(c.top);
      return {
        // with no card to picture, the item's own words carry the name
        label: card ? "Resolve" : `Resolve: ${String(c.top.text || "").slice(0, 32)}`,
        icon: "resolve",
        sub: card ? stackSubText(c.top, card) : "",
        card,
        fn: () => act("stack_resolve", { item: c.top.id }),
      };
    },
  },
  {
    id: "waiting-on-agent-response",
    when: (c) => !!c.top, // your own item on top — the agent answers it
    step: () => ({ hint: "on the stack — waiting for the agent" }),
  },
  {
    id: "no-blocks",
    when: (c) => c.theirAttackers.length > 0 && !c.iAmBlocking && noBlocksDeclaredFor !== c.attackSig,
    step: (c) => ({
      label: "No blocks — take the damage",
      icon: "noBlocks",
      fn: () => { noBlocksDeclaredFor = c.attackSig; act("chat", { text: "No blocks." }); },
    }),
  },
  {
    id: "waiting-on-agent-turn",
    when: (c) => !c.mine,
    step: () => ({ hint: "the agent's turn — waiting" }),
  },

  // ── your turn, stack settled: the turn structure ──
  {
    // turn 1 before you have done anything: the useful move is playing a
    // land or a spell, which no button can pick for you. Say nothing rather
    // than marching the phase along
    id: "game-start",
    when: (c) =>
      c.mine &&
      state.turnNumber === 1 &&
      !didThisTurn(/^Player (played|cast|tapped|untapped|moved|created|declares|put on the stack|moves to)/),
    step: () => null,
  },
  {
    id: "untap",
    when: (c) => /untap/.test(c.phase) && c.myTapped && !didThisTurn(/^Player untapped all/),
    step: () => ({ label: "Untap all", icon: "untap", skip: true, fn: async () => { await act("untap_all", { player: "you" }); act("set_phase", { phase: "untap/upkeep" }); } }),
  },
  {
    id: "draw",
    when: (c) => /untap/.test(c.phase) && state.turnNumber > 1 && !didThisTurn(/^Player drew\b/),
    step: () => ({ label: "Draw 1", icon: "draw", skip: true, fn: () => act("draw", { n: 1 }) }),
  },
  {
    id: "main-1",
    when: (c) => /untap/.test(c.phase),
    step: () => ({ label: "Main phase 1", icon: "main", skip: true, fn: () => act("set_phase", { phase: "main 1" }) }),
  },
  {
    id: "to-combat",
    when: (c) => c.phase === "main 1",
    step: () => ({ label: "Go to combat", icon: "combat", skip: true, fn: () => act("set_phase", { phase: "combat" }) }),
  },
  {
    id: "combat-damage",
    // the guard has to match what the button actually pushes, or the step
    // never stands down and combat cannot advance
    when: (c) => c.phase === "combat" && c.myAttackers.length > 0 && !didThisTurn(/combat damage|go to damage/i),
    // one click straight onto the stack — the agent works out the numbers,
    // the player never types damage
    step: () => ({
      label: "Go to damage",
      icon: "damage",
      skip: true,
      fn: () => act("stack_push", { text: "go to damage" }),
    }),
  },
  {
    // never a dead end: attacking is a right-click on a creature, so the
    // prompt keeps moving the turn along instead of waiting on one
    id: "past-combat",
    when: (c) => c.phase === "combat",
    step: () => ({
      label: "Main phase 2",
      icon: "main",
      title: "tap [e] a creature to attack instead",
      skip: true,
      fn: () => act("set_phase", { phase: "main 2" }),
    }),
  },
  {
    id: "main-2",
    when: (c) => c.phase === "main 2",
    step: () => ({ label: "End step", icon: "end", skip: true, fn: () => act("set_phase", { phase: "end" }) }),
  },
  {
    id: "pass-turn",
    when: () => true, // end step, or any phase we don't have a step for
    step: () => ({ label: "Pass turn to agent", icon: "passTurn", fn: passTurnToAgent }),
  },
];

function renderNextAction() {
  const wrap = $("#nextaction");
  if (!state.started) {
    wrap.classList.add("hidden");
    return;
  }
  const ctx = nextActionContext();
  const rule = NEXT_ACTION_STEPS.find((r) => r.when(ctx));
  const a = rule ? rule.step(ctx) : null;
  wrap.classList.toggle("hidden", !a);
  if (!a) return;
  const btn = $("#na-primary");
  const hint = $("#na-hint");
  btn.classList.toggle("hidden", !!a.hint);
  hint.classList.toggle("hidden", !a.hint);
  if (a.hint) hint.textContent = a.hint;
  else {
    const labelEl = btn.querySelector(".na-label");
    labelEl.innerHTML = "";
    if (a.icon) labelEl.append(iconEl(a.icon));
    labelEl.append(document.createTextNode(a.label));
    btn.title = a.title || "";
    btn.onclick = a.fn;
    // the stack item's own words, under the action
    const sub = btn.querySelector(".na-sub");
    const subText = a.sub && a.sub !== a.label ? String(a.sub).split("\n")[0] : "";
    sub.textContent = subText;
    sub.classList.toggle("hidden", !subText);
    // the card it is about, inside the button — hover it for the full preview
    const img = $("#na-card");
    img.classList.toggle("hidden", !a.card);
    if (a.card) {
      if (img.src !== a.card.image) img.src = a.card.image;
      img.onmouseenter = (e) => showPreview(a.card, e);
      img.onmousemove = (e) => positionPreview(e);
      img.onmouseleave = hidePreview;
    }
  }
  const skip = $("#na-skip");
  skip.classList.toggle("hidden", !a.skip);
  skip.onclick = passTurnToAgent;
}

let newGameAutoOpened = false;

function renderStack() {
  const bar = $("#pane-stack");
  // notification badge on the Stack tab: count + pulse while anything awaits resolution
  const n = state.stack ? state.stack.length : 0;
  const badge = $("#stack-badge");
  badge.classList.toggle("hidden", !n);
  badge.textContent = n;
  if (!n) {
    bar.innerHTML = `<div class="stackempty">The stack is empty.</div>
      <div class="stackhint">Type below to announce a trigger or ability onto the stack.</div>`;
    return;
  }
  bar.innerHTML = `<span class="stacklabel">THE STACK — top resolves first</span>`;
  // one Resolve-all button when the top is a run of agent items (a proposal or just a pile)
  const agentRun = [];
  for (let i = state.stack.length - 1; i >= 0 && state.stack[i].player === "agent"; i--) agentRun.push(state.stack[i]);
  if (agentRun.length > 1) {
    const all = document.createElement("button");
    all.className = "resolveall";
    all.textContent = `Resolve all ${agentRun.length} (accept)`;
    all.title = "Accept the agent's whole proposal — resolves its items top-down, stops at yours";
    all.onclick = () => act("stack_resolve_all", {});
    bar.appendChild(all);
  }
  for (const item of [...state.stack].reverse()) bar.appendChild(stackItemEl(item));
}

/** One LIVE stack item, buttons included — the same widget in the Stack tab and inline in chat. */
function stackItemEl(item, opts = {}) {
  const top = state.stack.length > 0 && state.stack[state.stack.length - 1].id === item.id;
  const d = document.createElement("div");
  d.className =
    "stackitem" +
    (top ? " top" : "") +
    (item.groupId ? " grouped" : "") +
    (item.countered ? " countered" : "") +
    (opts.inChat ? " inchat " + (item.player === "you" ? "you" : "agent") : "");
  const who = item.player === "you" ? "you" : "agent";
    const img = item.card && !item.card.hidden && item.card.image ? `<img src="${item.card.image}">` : "";
    const planned = item.retractable ? `<span class="siplanned" title="planned follow-up — unwinds if responded below">planned</span>` : "";
    const ctag = item.countered ? `<span class="ctag">COUNTERED</span>` : "";
    // multi-part announcements (combat damage) render as rows: explicit
    // lines[] from the agent, or a fallback split on "(1) … (2) …" numbering
    let bodyHtml;
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    let rows = item.lines;
    let headline = item.text;
    if (!rows) {
      const parts = item.text.split(/\s*\(\d+\)\s+/);
      if (parts.length >= 3) {
        headline = parts[0].trim();
        rows = parts.slice(1);
      }
    }
    if (rows && rows.length) {
      bodyHtml = `<div class="sitext">${esc(headline)}</div><div class="sirows">${rows
        .map((r, i) => `<div class="sirow"><span class="sirownum">${i + 1}</span>${esc(r)}</div>`)
        .join("")}</div>`;
    } else {
      bodyHtml = `<div class="sitext">${esc(item.text)}</div>`;
    }
    d.innerHTML = `<div class="sihead">${img}<div><div class="siwho">${who}${top ? " · TOP" : ""}${planned}${ctag}</div>${bodyHtml}</div></div>`;
    if (item.card && !item.card.hidden) {
      d.onmouseenter = (e) => showPreview(item.card, e);
      d.onmousemove = (e) => positionPreview(e);
      d.onmouseleave = hidePreview;
    }
  const btns = stackItemButtons(item);
  if (btns) d.appendChild(btns);
  return d;
}

/** The action row for a stack item (Resolve/Counter/Take back) — shared
    by the Stack tab, the chat widgets and battlefield ghosts. Null if no actions. */
function stackItemButtons(item) {
  const top = state.stack.length > 0 && state.stack[state.stack.length - 1].id === item.id;
  const btns = document.createElement("div");
  btns.className = "sibtns";
  const mk = (label, fn, title) => {
    const b = document.createElement("button");
    b.textContent = label;
    if (title) b.title = title;
    b.onclick = (e) => {
      e.stopPropagation();
      hidePreview();
      fn();
    };
    btns.appendChild(b);
  };
  // any of the AGENT's items, any position — resolve removes (fizzling if
  // countered), counter marks. Your own items: take back only.
  const idx = state.stack.findIndex((i) => i.id === item.id);
  if (item.player === "agent") {
    mk(
      "Resolve",
      () => act("stack_resolve", { item: item.id }),
      item.countered ? "Fizzle: the countered card goes to its owner's graveyard, no effect" : "Resolve this item"
    );
    mk(item.countered ? "Un-counter" : "Counter", () => act("stack_counter", { item: item.id }),
      item.countered ? "Remove the countered mark" : "Mark as countered — it stays on the stack until resolved (then fizzles)");
    if (idx >= 0 && idx < state.stack.length - 1 && state.stack.slice(idx).every((i) => i.player === "agent")) {
      mk("Resolve ▲", () => act("stack_resolve_all", {}), "Accept the agent's whole run — this item and everything above it resolve in proposal order");
    }
  } else {
    mk("Take back", () => act("stack_remove", { index: idx }), "Withdraw your own item — the card returns to your hand");
  }
  return btns.childNodes.length ? btns : null;
}

/** The pending (unresolved) attack declaration containing this card, if any. */
function pendingAttackOf(cardId) {
  for (const it of state.stack || []) {
    if (it.attackPairs && it.attackPairs.some((pair) => pair.attacker === cardId)) return it;
  }
  return null;
}

/** Pull one attacker out of a pending declaration (re-declaring the rest). */
async function removeAttacker(c, pendingAtk) {
  const idx = state.stack.findIndex((i) => i.id === pendingAtk.id);
  await act("stack_remove", { index: idx });
  const rest = pendingAtk.attackPairs.filter((pair) => pair.attacker !== c.id);
  if (rest.length) await act("attack", { pairs: rest });
}

/** Text-only stack items (triggered/activated abilities) matched to their source
    permanent on p's battlefield by name — the source lifts off the board. */
function battlefieldTriggerGhosts(p) {
  const out = [];
  const bf = state.players[p].zones.battlefield;
  for (const it of state.stack || []) {
    if (it.card || /^(ATTACKS|BLOCKS|STEP|TURN PASS):/.test(it.text)) continue;
    // structured source id (stack_push { source }) is authoritative
    if (it.source) {
      const src = bf.find((c) => c.id === it.source);
      if (src && !src.hidden) out.push({ item: it, source: src });
      continue;
    }
    // fallback for source-less items (composer text): earliest-mentioned
    // battlefield card — ability texts lead with the source, while payment
    // and target mentions come later. Ties go to the longer name.
    const t = it.text.toLowerCase();
    let best = null;
    for (const c of bf) {
      if (c.hidden || !c.name) continue;
      const n = c.name.toLowerCase();
      const idx = t.indexOf(n);
      if (idx < 0) continue;
      if (!best || idx < best.idx || (idx === best.idx && n.length > best.len)) best = { card: c, idx, len: n.length };
    }
    if (best) out.push({ item: it, source: best.card });
  }
  return out;
}

/** Visible cards on the stack that belong to p. */
function stackCardsOf(p) {
  return (state.stack || []).filter((it) => it.card && !it.card.hidden && it.player === p);
}

/** Where a stack item's card lands when it resolves — the client's copy of the
    server's rule: a declared resolveTo wins, else instants and sorceries go to
    the graveyard and everything with a land face to the battlefield. */
function resolveZoneOf(item) {
  const tl = item.card.typeLine || "";
  const isSpell = /\b(instant|sorcery)\b/i.test(tl) && !/\bland\b/i.test(tl);
  return item.resolveTo ?? (isSpell ? "graveyard" : "battlefield");
}

/** THE card, in its on-the-stack presentation — the SAME .card.placed element
    as any board card (same size, same drag geometry); "ghost" is a state
    class, and the stack buttons ride below as a child panel that doesn't
    affect the card's bounding box. */
function ghostEl(card, item, left, top, opts = {}) {
  const el = cardEl(card);
  el.classList.add("placed", "ghost");
  if (item.countered) el.classList.add("countered");
  if (opts.cls) el.classList.add(opts.cls);
  el.style.left = left.toFixed(0) + "px";
  el.style.top = top.toFixed(0) + "px";
  el.onclick = (e) => {
    e.stopPropagation();
    // a drag's release fires a click — swallow it
    if (el.dataset.dragged) {
      delete el.dataset.dragged;
      return;
    }
    hidePreview();
    switchTab("stack");
  };
  const btns = stackItemButtons(item);
  if (btns) {
    const panel = document.createElement("div");
    panel.className = "liftpanel";
    panel.appendChild(btns);
    el.appendChild(panel);
  }
  return el;
}

/** Stack items whose card would resolve onto p's battlefield — shown as ghosts
    hovering in the slot they'd land in. */
function battlefieldGhosts(p) {
  return stackCardsOf(p).filter((it) => resolveZoneOf(it) === "battlefield");
}

// The agent's thoughts run as a ticker beside the typing dots: lines queue up
// as they stream in and the display advances every 0.5s, holding on the last.
let peekQueue = [];
let peekIndex = -1;
let peekTimer = null;

function renderAgentStatus() {
  const pane = $("#pane-chat");
  const existing = pane.querySelector(".typing-bubble");
  if (agentBusy && !existing) {
    const follow = nearBottom(pane);
    const d = document.createElement("div");
    d.className = "msg agent typing-bubble";
    d.innerHTML = `<span class="tdot"></span><span class="tdot"></span><span class="tdot"></span><span class="peek-line"></span>`;
    pane.appendChild(d);
    if (follow) pane.scrollTop = pane.scrollHeight;
  } else if (!agentBusy && existing) {
    existing.remove();
    peekQueue = [];
    peekIndex = -1;
    if (peekTimer) {
      clearInterval(peekTimer);
      peekTimer = null;
    }
  }
  if (agentBusy) applyPeekLine();
}

function applyPeekLine() {
  const el = $("#pane-chat .typing-bubble .peek-line");
  if (!el) return;
  const cur = peekQueue[peekIndex];
  el.textContent = cur ? cur.text : "";
  if (cur) {
    el.title = "Open in the Agent tab";
    el.onclick = () => openBrainAt(cur.seq);
  }
}

function advancePeek() {
  if (peekIndex < peekQueue.length - 1) {
    peekIndex++;
    applyPeekLine();
  }
}

function openBrainAt(seq) {
  switchTab("brain");
  const target = document.getElementById("brain-" + seq);
  if (target) {
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.classList.add("highlight");
    setTimeout(() => target.classList.remove("highlight"), 2000);
  }
}

function updateBrainPeek(entry) {
  if (!agentBusy) return;
  // narration and thinking only — tool calls are noise here
  if (!["text", "thinking"].includes(entry.kind)) return;
  // split multi-line thoughts so the ticker reveals them line by line
  for (const line of entry.text.split(/\n+/)) {
    const t = line.trim();
    if (!t) continue;
    peekQueue.push({ text: t.length > 140 ? t.slice(0, 140) + "…" : t, seq: entry.seq });
  }
  if (!peekTimer) {
    advancePeek();
    peekTimer = setInterval(advancePeek, 500);
  }
}

// The library drawn as a face-down pile of cards, count on top; your deck
// carries a Draw 1 button on its bottom edge. Click opens the library menu.
function deckEl(p) {
  const wrap = document.createElement("div");
  wrap.className = "deckpile";
  wrap.title = "Library — click for options";
  wrap.innerHTML = `<div class="deckstack">
    <img class="cardback" src="card-back.jpg" alt="library">
    <div class="deckcount">${state.players[p].counts.library}</div>
  </div>`;
  wrap.onclick = (e) => {
    e.stopPropagation();
    // clicking again with the panel up closes it
    if (menuOpen()) return closeMenu();
    libraryMenu(p, e);
  };
  if (p === "you") {
    const b = document.createElement("button");
    b.className = "drawbtn";
    b.textContent = "🂠 Draw 1";
    b.onclick = (e) => {
      e.stopPropagation();
      act("draw", { n: 1 });
    };
    wrap.querySelector(".deckstack").appendChild(b);
  }
  return wrap;
}

function pile(label, count, cards, onClick) {
  const d = document.createElement("div");
  d.className = "pile";
  d.innerHTML = `<div class="phead"><span class="pname">${label}</span><span class="pcount">${count}</span></div>`;
  // the last few cards, newest first, fanned tiny and face up — newest on top
  const recent = cards.slice(-5).reverse();
  if (recent.length) {
    const strip = document.createElement("div");
    strip.className = "pstrip";
    recent.forEach((c, i) => {
      let mini;
      if (c.hidden || c.faceDown) {
        mini = document.createElement("img");
        mini.src = "card-back.jpg";
      } else if (c.image) {
        mini = document.createElement("img");
        mini.src = c.image;
      } else {
        mini = document.createElement("div");
        mini.className = "minitext";
        mini.textContent = c.name?.[0] ?? "?";
      }
      mini.classList.add("mini");
      mini.style.zIndex = recent.length - i;
      if (!c.hidden) {
        mini.onmouseenter = (e) => showPreview(c, e);
        mini.onmousemove = (e) => positionPreview(e);
        mini.onmouseleave = hidePreview;
      }
      strip.appendChild(mini);
    });
    d.appendChild(strip);
  }
  d.onclick = (e) => {
    e.stopPropagation();
    hidePreview();
    onClick(e);
  };
  return d;
}

function renderRail(p) {
  const rail = $(`#rail-${p}`);
  rail.innerHTML = "";
  const ps = state.players[p];
  const name = p === "you" ? "You" : "Agent";

  // both rails share one order — the agent's is mirrored via column-reverse,
  // so each element sits at the same distance from the midline on both sides
  rail.appendChild(lifeBox(p));
  rail.appendChild(deckEl(p));
  rail.appendChild(pile("Graveyard", ps.counts.graveyard, ps.zones.graveyard, () => showZoneModal(p, "graveyard")));
  rail.appendChild(pile("Exile", ps.counts.exile, ps.zones.exile, () => showZoneModal(p, "exile")));

  for (const c of ps.zones.command) {
    const el = cardEl(c, { small: true });
    rail.appendChild(el);
  }
}

// Life box in the rail: yours at the top of your rail, the agent's pinned
// to the bottom of its rail — both hugging the midline.
// Rapid −/+ clicks accumulate into a running delta shown on the box
// (−5, −6, −7…); it resets after 2s without touching.
const lifeDelta = { you: { sum: 0, timer: null }, agent: { sum: 0, timer: null } };

function bumpLifeDelta(p, d) {
  const ld = lifeDelta[p];
  ld.sum += d;
  clearTimeout(ld.timer);
  ld.timer = setTimeout(() => {
    ld.sum = 0;
    renderRail(p);
  }, 2000);
}

function lifeBox(p) {
  const ps = state.players[p];
  const d = document.createElement("div");
  d.className = "lifebox";
  const cmdmg = Object.entries(ps.commanderDamage || {})
    .map(([c, n]) => `${n} from ${c}`)
    .join("<br>");
  const ld = lifeDelta[p].sum;
  const deltaTag = ld !== 0 ? `<div class="lifedelta ${ld < 0 ? "neg" : "pos"}">${ld > 0 ? "+" : ""}${ld}</div>` : "";
  d.innerHTML = `${deltaTag}<div class="lname" title="${ps.deckName || ""}">${p === "you" ? "You" : "Agent"}</div>
    <div class="liferow"><button data-d="-1">−</button><div class="life">${ps.life}</div><button data-d="1">+</button></div>
    ${cmdmg ? `<div class="cmdmg">${cmdmg}</div>` : ""}`;
  d.querySelectorAll("button").forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    bumpLifeDelta(p, Number(b.dataset.d));
    act("life", { player: p, delta: Number(b.dataset.d) });
  }));
  return d;
}

function renderHand(p) {
  const row = $(`#hand-${p}`);
  row.innerHTML = "";
  const cards = state.players[p].zones.hand;
  // built but NOT yet in the DOM: the fan values below are applied first, so
  // the cards render already fanned. Appending first and styling after made
  // every re-render animate the fan out from flat.
  const els = cards.map((c) => cardEl(c));
  // both hands fan from the center like held cards, poking over the board
  // (the agent's mirrors downward from the top edge). The fan flattens as the
  // hand grows: the end card never tilts past 10° or sinks more than ~24px,
  // and wide hands tighten their overlap instead of bleeding past the edges.
  row.classList.add("fan");
  const n = cards.length;
  const mid = (n - 1) / 2;
  const rotStep = mid > 0 ? Math.min(4, 10 / mid) : 0;
  const dipK = mid > 0 ? Math.min(2.4, 24 / (mid * mid)) : 0;
  // the whole arc rides up so the dipped end cards stay inside the window
  // (the bottom hand row only has ~4px of slack past its padding)
  const yShift = Math.max(0, mid * mid * dipK - 4);
  const CARD_W = 76;
  let overlap = 22;
  const avail = row.clientWidth - 16;
  if (n > 1 && CARD_W + (n - 1) * (CARD_W - overlap) > avail) {
    overlap = Math.min(CARD_W * 0.8, CARD_W - (avail - CARD_W) / (n - 1));
  }
  els.forEach((el, i) => {
    el.classList.add("fanned");
    if (p === "you" && !cards[i].hidden) makeHandDraggable(el, cards[i]);
    el.style.setProperty("--fan-rot", `${(i - mid) * rotStep}deg`);
    el.style.setProperty("--fan-y", `${(i - mid) * (i - mid) * dipK - yShift}px`);
    el.style.marginLeft = el.style.marginRight = `${-overlap / 2}px`;
    el.style.zIndex = i + 1;
    row.appendChild(el);
  });
}

function typeCat(c) {
  const t = (c.typeLine || "").toLowerCase();
  if (t.includes("creature")) return "creature";
  if (t.includes("land")) return "land";
  return "other"; // artifacts, enchantments, planeswalkers → side column
}

// Free-placement board. Cards without an explicit pos auto-arrange by
// convention: your lands bottom, creatures mid-field (near the midline),
// artifacts/enchantments in a right-side column. Agent's half mirrors that.
function renderBattlefield(p) {
  const bf = $(`#bf-${p}`);
  bf.innerHTML = "";
  bf.classList.add("freeboard");
  const cards = state.players[p].zones.battlefield;
  const buried = cards.filter((c) => c.under);
  const free = cards.filter((c) => !c.under);
  // every free card claims a slot in its category — dragged cards keep theirs
  // as a HOLE, so moving one card never reflows its neighbors
  const autos = { creature: [], land: [], other: [] };
  for (const c of free) autos[typeCat(c)].push(c);
  // stack cards headed for this battlefield claim the NEXT auto-layout slot
  // in their row — that's where the ghost hovers
  const ghosts = battlefieldGhosts(p);
  for (const g of ghosts) autos[typeCat(g.card)].push(g.card);
  const regions =
    p === "you"
      ? { creature: 0.12, land: 0.72, other: 0.05 }
      : { creature: 0.6, land: 0.02, other: 0.05 };

  // pixel-based layout: cards never overlap unless piled or dragged there
  const W = Math.max(bf.clientWidth, 400);
  const H = Math.max(bf.clientHeight, 200);
  const GAP = 14;
  const perRow = Math.max(1, Math.floor((W * 0.8) / (CW + GAP)));

  // your lands hug the bottom edge, clearing the hand fan that pokes up over
  // the board (~32px); further rows stack UPWARD so they can never slide
  // under the hand. The agent's sit at its own top edge, rows going down.
  const HAND_CLEAR = 36;
  const yourLandTop = H - CH - HAND_CLEAR;

  const posMap = {}; // id -> {left, top} px
  const slotFor = (cat, i) => {
    if (cat === "other") {
      const col = Math.floor(i / 3);
      return { left: W - CW - 10 - col * (CW + 10), top: regions.other * (H - CH) + (i % 3) * (CH * 0.45) };
    }
    const left = 8 + (i % perRow) * (CW + GAP);
    const row = Math.floor(i / perRow);
    if (cat === "land" && p === "you") return { left, top: Math.max(0, yourLandTop - row * (CH * 0.55)) };
    return { left, top: regions[cat] * (H - CH) + row * (CH * 0.55) };
  };
  const collides = (s) =>
    Object.values(posMap).some((p) => Math.abs(p.left - s.left) < CW * 0.55 && Math.abs(p.top - s.top) < CH * 0.55);
  // saved positions first — they own their spots
  const unplaced = [];
  for (const c of [...free, ...ghosts.map((g) => g.card)]) {
    if (c.pos) posMap[c.id] = { left: c.pos.x * (W - CW), top: c.pos.y * (H - CH) };
    else unplaced.push(c);
  }
  // newcomers take the first FREE slot in their category's region
  for (const c of unplaced) {
    const cat = typeCat(c);
    let i = autos[cat].indexOf(c);
    let s = slotFor(cat, i);
    let guard = 0;
    while (collides(s) && guard++ < 80) s = slotFor(cat, ++i);
    posMap[c.id] = s;
  }
  // a card's first spot is SAVED (cosmetic place, no log/wake): from then on
  // it owns its position exactly like a dragged card — nothing ever reflows
  const toSave = [];
  for (const c of free) {
    if (c.pos || autoPlaced.has(c.id)) continue;
    const s = posMap[c.id];
    const x = Math.max(0, Math.min(1, s.left / Math.max(1, W - CW)));
    const y = s.top / Math.max(1, H - CH);
    c.pos = { x, y };
    autoPlaced.add(c.id);
    toSave.push({ card: c.id, x, y });
  }
  if (toSave.length && state.started) act("place", { positions: toSave });
  // buried pile members cascade beneath their pile's top card, one visible
  // strip per rung — the strip is the grab handle for pulling a card out
  const PILE_DX = 15, PILE_DY = 26;
  for (const c of buried) {
    let top = c, depth = 0, guard = 0;
    while (top.under && guard++ < 50) {
      const t = cardById(top.under);
      if (!t) break;
      top = t;
      depth++;
    }
    let base = posMap[top.id];
    // pile top on the other battlefield: anchor via its pos + container offset
    if (!base && top.controller !== p && top.pos) {
      const myRect = bf.getBoundingClientRect();
      const otherBf = $(`#bf-${top.controller}`);
      const oRect = otherBf.getBoundingClientRect();
      const oW = Math.max(otherBf.clientWidth, 400);
      const oH = Math.max(otherBf.clientHeight, 200);
      base = {
        left: top.pos.x * (oW - CW) + (oRect.left - myRect.left),
        top: top.pos.y * (oH - CH) + (oRect.top - myRect.top),
      };
    }
    posMap[c.id] = base
      ? { left: base.left + PILE_DX * depth, top: base.top + PILE_DY * depth, under: true, depth }
      : { left: W / 2, top: H / 2 };
  }

  // a trigger on the stack LIFTS its real source card — a state on the card,
  // not a copy (the card stays draggable, one element per card)
  const lifts = new Map();
  for (const { item, source } of battlefieldTriggerGhosts(p)) {
    if (!lifts.has(source.id)) lifts.set(source.id, item);
  }

  for (const c of cards) {
    const el = cardEl(c);
    el.classList.add("placed");
    el.dataset.cardId = c.id;
    const pos = posMap[c.id];
    // explicitly dragged positions may cross the midline into the other
    // half — only auto-laid cards are clamped to their own field
    if (c.pos) {
      el.style.left = pos.left.toFixed(0) + "px";
      el.style.top = pos.top.toFixed(0) + "px";
    } else {
      el.style.left = Math.max(0, Math.min(W - CW, pos.left)).toFixed(0) + "px";
      el.style.top = Math.max(0, Math.min(H - CH, pos.top)).toFixed(0) + "px";
    }
    // pile stacking order: top card highest, each rung below it one step lower
    if (pos.under) {
      el.classList.add("tucked");
      el.style.zIndex = Math.max(1, 24 - pos.depth); // .dragging (30) still wins
    } else if (cardBeneathOf(c.id)) {
      el.style.zIndex = 25;
    }
    const lift = lifts.get(c.id);
    if (lift) {
      el.classList.add("lifted");
      const panel = document.createElement("div");
      panel.className = "liftpanel";
      const chip = document.createElement("div");
      chip.className = "trigchip";
      chip.textContent = lift.text.length > 110 ? lift.text.slice(0, 110) + "…" : lift.text;
      chip.title = lift.text;
      chip.onclick = (e) => {
        e.stopPropagation();
        switchTab("stack");
      };
      panel.appendChild(chip);
      const btns = stackItemButtons(lift);
      if (btns) panel.appendChild(btns);
      el.appendChild(panel);
    }
    // declared-but-unresolved attacker: slight lift + red glow
    if (pendingAttackOf(c.id)) el.classList.add("declaring");
    if (c.controller === "you") makeDraggable(el, c, bf);
    bf.appendChild(el);
  }

  const clampX = (x) => Math.max(0, Math.min(W - CW, x));
  const clampY = (y) => Math.max(0, Math.min(H - CH, y));

  // ghosts: translucent card bobbing in its would-be slot, stack buttons under
  // it. Draggable (your own): dragging pre-places where the card will land —
  // pos set on the stack card survives resolution onto the battlefield.
  for (const g of ghosts) {
    const pos = posMap[g.card.id];
    const wrap = g.card.pos
      ? ghostEl(g.card, g, pos.left, pos.top)
      : ghostEl(g.card, g, clampX(pos.left), clampY(pos.top));
    if (g.player === "you") makeDraggable(wrap, g.card, bf, { tuck: false });
    bf.appendChild(wrap);
  }

  // spells that DON'T resolve to the battlefield (sorceries, instants,
  // gy-to-hand returns) hover at a casting spot: center of the caster's
  // half, hugging the midline, fanning out if several are up
  const spells = stackCardsOf(p).filter((it) => resolveZoneOf(it) !== "battlefield");
  spells.forEach((g, i) => {
    let left = W / 2 - CW / 2 + (i - (spells.length - 1) / 2) * (CW * 0.65);
    let top = p === "you" ? 10 : H - CH - 16;
    if (g.card.pos) {
      left = g.card.pos.x * (W - CW);
      top = g.card.pos.y * (H - CH);
    } else {
      left = clampX(left);
      top = Math.max(0, top);
    }
    const wrap = ghostEl(g.card, g, left, top, { cls: "spell" });
    if (g.player === "you") makeDraggable(wrap, g.card, bf, { tuck: false });
    bf.appendChild(wrap);
  });
}
window.addEventListener("resize", () => render());

// feel like an app, not a website: the browser context menu never opens.
// Cards/chips install their own contextmenu handlers first; this catches
// everything else (empty field, panels, inputs).
document.addEventListener("contextmenu", (e) => e.preventDefault());

// battlefield card layout-box size — CSS is the source of truth (--card-w/-h).
// All battlefield positioning math uses these, NEVER a card's bounding rect:
// transforms (tap rotate, lift bob) change the rect but not the layout box.
const rootCS = getComputedStyle(document.documentElement);
const CW = parseFloat(rootCS.getPropertyValue("--card-w")) || 92;
const CH = parseFloat(rootCS.getPropertyValue("--card-h")) || 128;

let draggingNow = false;
let pendingRender = false;
// cards whose first battlefield spot we've already persisted this game
const autoPlaced = new Set();

function makeDraggable(el, c, bf, opts = {}) {
  el.addEventListener("pointerdown", (down) => {
    if (down.button !== 0) return;
    // ONE coordinate system: battlefield-local layout px, the numbers that
    // live in style.left/top. The dragged element's own bounding rect is
    // never read — it's the post-transform box, and a tapped (rotated) or
    // bobbing card's rect disagrees with its layout box, which snaps.
    const bfRect = bf.getBoundingClientRect();
    // the table is one continuous surface: drag bounds span BOTH battlefields
    const otherRect = $(bf.id === "bf-you" ? "#bf-agent" : "#bf-you").getBoundingClientRect();
    const minY = Math.min(bfRect.top, otherRect.top) - bfRect.top;
    const maxY = Math.max(bfRect.bottom, otherRect.bottom) - bfRect.top - CH;
    const maxX = bfRect.width - CW;
    const startLeft = parseFloat(el.style.left) || 0;
    const startTop = parseFloat(el.style.top) || 0;
    let left = startLeft;
    let top = startTop;
    // dragging a pile's TOP card carries the whole pile (same delta, live);
    // dragging a buried card pulls just that card out — no riders
    const kids = [];
    if (opts.tuck !== false && !c.under) {
      for (const k of pileChainBelow(c.id)) {
        const kel = document.querySelector(`.card.placed[data-card-id="${k.id}"]`);
        if (kel) kids.push({ el: kel, left: parseFloat(kel.style.left) || 0, top: parseFloat(kel.style.top) || 0 });
      }
    }
    const kidEls = new Set(kids.map((k) => k.el));
    let moved = false;
    const onMove = (mv) => {
      if (!moved && Math.hypot(mv.clientX - down.clientX, mv.clientY - down.clientY) < 6) return;
      if (!moved) {
        moved = true;
        draggingNow = true;
        el.classList.add("dragging");
        // riders track per-frame: the placed-card left/top glide transition
        // would make them trail the handle by 180ms
        for (const k of kids) k.el.style.transition = "none";
        el.setPointerCapture?.(down.pointerId);
        // your own cards can go back to hand — offer the strip while dragging
        if (c.controller === "you") showHandZone(false);
      }
      if (c.controller === "you") showHandZone(overHandZone(mv.clientX, mv.clientY));
      // pure delta on the layout box: start position + pointer travel.
      // No transform can offset this — tapped cards drag identically.
      left = Math.max(0, Math.min(maxX, startLeft + (mv.clientX - down.clientX)));
      top = Math.max(minY, Math.min(maxY, startTop + (mv.clientY - down.clientY)));
      el.style.left = left + "px";
      el.style.top = top + "px";
      // the carried pile follows with the same delta
      const dx = left - startLeft;
      const dy = top - startTop;
      for (const k of kids) {
        k.el.style.left = k.left + dx + "px";
        k.el.style.top = k.top + dy + "px";
      }
    };
    const onUp = async (up) => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      if (moved) {
        el.classList.remove("dragging");
        for (const k of kids) k.el.style.transition = "";
        el.dataset.dragged = "1";
        guardClicks();
        noHoverCardId = c.id;
        draggingNow = false;
        hideHandZone();
        // dropped on the strip over your hand → the card goes back to hand
        if (c.controller === "you" && up && overHandZone(up.clientX, up.clientY)) {
          await act("move", { card: c.id, toZone: "hand", toPlayer: "you" });
          return;
        }
        // drop onto another card = tuck into its pile (equip, auras, board
        // tidying — one gesture). Center from the layout box (rotation about
        // the center can't move it); target rects are fine to read — they're
        // only hit-tested, never written back into anyone's position.
        const center = { x: bfRect.left + left + CW / 2, y: bfRect.top + top + CH / 2 };
        // pile-drop works across the whole table, either battlefield
        // (disabled for stack ghosts — they only pre-place their landing spot)
        const targetEl = opts.tuck === false ? null : [...document.querySelectorAll(".battlefield .card.placed")].find((o) => {
          // never tuck a pile under its own members (cycle)
          if (o === el || kidEls.has(o) || !o.dataset.cardId) return false;
          const r = o.getBoundingClientRect();
          return center.x >= r.left && center.x <= r.right && center.y >= r.top && center.y <= r.bottom;
        });
        // optimistic pile edits mirror the server splice — no flash at ack
        const spliceLocal = () => {
          const b = cardBeneathOf(c.id);
          if (b) b.under = c.under;
          c.under = null;
        };
        if (targetEl) {
          if (c.under) spliceLocal();
          c.under = targetEl.dataset.cardId; // server re-anchors to the pile's top
          await act("tuck", { card: c.id, under: targetEl.dataset.cardId });
        } else {
          if (c.under) {
            spliceLocal();
            await act("tuck", { card: c.id, under: "" });
          }
          // normalize with the exact W/H/CW/CH formula render() lays out
          // with, so the round-trip pos -> px -> pos is bit-exact and the
          // server ack can't snap
          const W = Math.max(bf.clientWidth, 400);
          const H = Math.max(bf.clientHeight, 200);
          const x = Math.max(0, Math.min(1, left / Math.max(1, W - CW)));
          // y stays relative to the own field but may cross the midline
          const y = top / Math.max(1, H - CH);
          // optimistic: renders between drop and the server ack must not
          // snap the card back to its pre-drag spot
          c.pos = { x, y };
          await act("place", { positions: [{ card: c.id, x, y }] });
        }
        if (pendingRender) {
          pendingRender = false;
          render();
        }
      }
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  });
}

function cardById(id) {
  for (const p of ["you", "agent"])
    for (const z of Object.values(state.players[p].zones))
      for (const c of z) if (c.id === id) return c;
  return null;
}

// board piles: the card tucked directly beneath `id`, searching both fields
// (piles may span controllers — your aura under the agent's creature)
function cardBeneathOf(id) {
  for (const p of ["you", "agent"])
    for (const k of state.players[p].zones.battlefield)
      if (k.under === id) return k;
  return null;
}

// the chain hanging beneath `id`, top-down
function pileChainBelow(id) {
  const out = [];
  let cur = cardBeneathOf(id);
  let guard = 0;
  while (cur && guard++ < 50) {
    out.push(cur);
    cur = cardBeneathOf(cur.id);
  }
  return out;
}

// A release always fires a click. The element the drag started on carries a
// data-dragged flag, but after a hand drop that element is gone and the click
// can land on the freshly rendered board card — which would tap the card you
// just played. So drags also close this short window, and any card click
// inside it is swallowed.
let clickGuardUntil = 0;
const guardClicks = () => { clickGuardUntil = Date.now() + 350; };

// The card you just dropped sits under a stationary cursor, so it would come
// up already hovered — preview open, chips showing. It stays inert until the
// pointer actually leaves it once. Held by id, since every render rebuilds
// the element.
let noHoverCardId = null;

// ── dragging a card out of your hand ──────────────────────────────────────
// Hand cards sit in a flex row, so there is no left/top to move: the drag
// carries a fixed-position clone under the cursor and the original dims in
// place. Dropping on your own half plays the card there; anywhere else is a
// cancel. Lands land, spells go to the stack — same `cast` either way — and
// the drop point becomes the card's board position.
function makeHandDraggable(el, c) {
  el.addEventListener("pointerdown", (down) => {
    if (down.button !== 0 || c.controller !== "you") return;
    let ghost = null;
    const onMove = (mv) => {
      if (!ghost) {
        if (Math.hypot(mv.clientX - down.clientX, mv.clientY - down.clientY) < 8) return;
        hidePreview();
        draggingNow = true;
        ghost = el.cloneNode(true);
        ghost.className = "card handghost";
        ghost.style.width = CW + "px";
        ghost.style.height = CH + "px";
        document.body.appendChild(ghost);
        el.classList.add("beingdragged");
        el.setPointerCapture?.(down.pointerId);
        showHandZone(false);
      }
      ghost.style.left = mv.clientX - CW / 2 + "px";
      ghost.style.top = mv.clientY - CH / 2 + "px";
      const bf = $("#bf-you").getBoundingClientRect();
      const over = mv.clientX >= bf.left && mv.clientX <= bf.right && mv.clientY >= bf.top && mv.clientY <= bf.bottom;
      ghost.classList.toggle("overboard", over);
    };
    const onUp = async (up) => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      if (!ghost) return;
      ghost.remove();
      el.classList.remove("beingdragged");
      el.dataset.dragged = "1";
      guardClicks();
      noHoverCardId = c.id;
      draggingNow = false;
      hideHandZone();
      const bfEl = $("#bf-you");
      const bf = bfEl.getBoundingClientRect();
      const inside = up.clientX >= bf.left && up.clientX <= bf.right && up.clientY >= bf.top && up.clientY <= bf.bottom;
      if (!inside) {
        render(); // dropped nowhere — put the fan back the way it was
        return;
      }
      const W = Math.max(bfEl.clientWidth, 400);
      const H = Math.max(bfEl.clientHeight, 200);
      const x = Math.max(0, Math.min(1, (up.clientX - bf.left - CW / 2) / Math.max(1, W - CW)));
      const y = (up.clientY - bf.top - CH / 2) / Math.max(1, H - CH);
      c.pos = { x, y }; // optimistic, so the ack can't snap it elsewhere
      await act("cast", { card: c.id });
      await act("place", { positions: [{ card: c.id, x, y }] });
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  });
}

/** The strip over your hand that a battlefield card can be dropped onto to
 *  go back to hand. `armed` = the pointer is currently over it. */
function showHandZone(armed) {
  const z = $("#handzone");
  z.classList.remove("hidden");
  z.classList.toggle("armed", !!armed);
}
function hideHandZone() {
  $("#handzone").classList.add("hidden");
}
function overHandZone(x, y) {
  const r = $("#hand-you").getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top - 12 && y <= r.bottom;
}

function cardEl(c, opts = {}) {
  const d = document.createElement("div");
  d.className = "card";
  if (c.tapped) d.classList.add("tapped");
  if (c.attacking) d.classList.add("attacking");
  if (c.blocking) d.classList.add("blocking");
  if (pendingTuck === c.id) d.classList.add("tuck-source");
  if (opts.small) d.style.cssText = "width:100%;height:auto;aspect-ratio:0.72;";

  if (c.hidden) {
    d.innerHTML = `<img class="cardback" src="card-back.jpg" alt="face-down card" draggable="false">`;
  } else {
    const img = c.image
      ? `<img src="${c.image}" alt="${c.name}" draggable="false">`
      : `<div class="textcard"><b>${c.name}</b><br>${c.mana || ""}<br>${c.typeLine || ""}<br>${(c.oracle || "").slice(0, 120)}${c.power !== undefined && c.power !== null ? `<div class="textpt">${c.power}/${c.toughness}</div>` : ""}</div>`;
    d.innerHTML = c.faceDown ? `<div class="facedown-known">${img}</div>` : img;
    const badgeWrap = document.createElement("div");
    badgeWrap.className = "badges";
    // P/T counters have their own on-card chip; other kinds are live badges —
    // click adds one, right-click removes one
    for (const [k, v] of Object.entries(c.counters || {})) {
      if (k === "+1/+1" || k === "-1/-1" || !v) continue;
      const b = document.createElement("span");
      b.className = "badge ctr";
      b.textContent = `${v} ${k}`;
      b.title = `${k} counters — click +1, right-click −1`;
      b.onclick = (e) => {
        e.stopPropagation();
        act("counters", { card: c.id, kind: k, delta: 1 });
      };
      b.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        act("counters", { card: c.id, kind: k, delta: -1 });
      };
      badgeWrap.appendChild(b);
    }
    const statics = [];
    if (c.attacking) statics.push(`<span class="badge att">⚔ ${c.attacking === "you" ? "You" : c.attacking === "agent" ? "Agent" : "→"}</span>`);
    if (c.blocking) statics.push(`<span class="badge blk">🛡</span>`);
    if (c.under) {
      const t = cardById(c.under);
      statics.push(`<span class="badge eq">↳ ${t && !t.hidden ? t.name.split(",")[0] : "?"}</span>`);
    }
    if (c.isCommander) statics.push(`<span class="badge">CMDR</span>`);
    if (statics.length) badgeWrap.insertAdjacentHTML("beforeend", statics.join(""));
    if (badgeWrap.childElementCount) d.appendChild(badgeWrap);
    // insertAdjacentHTML from here on — `innerHTML +=` would re-parse the card
    // and silently strip the click handlers installed above
    if (c.isToken) d.insertAdjacentHTML("beforeend", `<span class="tokentag">token</span>`);
    // +1/+1 counter chip on the card: click +1, right-click −1 (negatives ok)
    if (c.zone === "battlefield") {
      const n = ((c.counters || {})["+1/+1"] || 0) - ((c.counters || {})["-1/-1"] || 0);
      const ctr = document.createElement("button");
      ctr.className = "ctrbtn" + (n > 0 ? " has" : n < 0 ? " has neg" : "");
      ctr.textContent = n > 0 ? `+${n}/+${n}` : n < 0 ? `${n}/${n}` : "0/0";
      ctr.title = "+1/+1 counters — click to add, right-click to remove";
      ctr.onclick = (e) => {
        e.stopPropagation();
        act("counters", { card: c.id, kind: "+1/+1", delta: 1 });
      };
      ctr.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        act("counters", { card: c.id, kind: "+1/+1", delta: -1 });
      };
      d.appendChild(ctr);
    }
    // explicit P/T override: drawn over the card's own P/T corner
    if (c.basePower !== undefined && c.zone === "battlefield") {
      d.insertAdjacentHTML("beforeend", `<div class="ptbadge" title="printed ${c.basePower}/${c.baseToughness}">${c.power}/${c.toughness}</div>`);
    }
    if ((c.faceCount ?? 1) > 1) {
      const flip = document.createElement("button");
      flip.className = "flipbtn";
      flip.textContent = "⟳";
      flip.title = `Flip to ${c.faces[((c.face ?? 0) + 1) % c.faceCount].name}`;
      flip.onclick = (e) => {
        e.stopPropagation();
        hidePreview();
        act("set_face", { card: c.id, face: ((c.face ?? 0) + 1) % c.faceCount });
      };
      d.appendChild(flip);
    }
    d.onmouseenter = (e) => { if (!d.classList.contains("nohover")) showPreview(c, e); };
    d.onmousemove = (e) => { if (!d.classList.contains("nohover")) positionPreview(e); };
    d.onmouseleave = hidePreview;
  }
  d.onclick = (e) => {
    e.stopPropagation();
    // a drag's release fires a click — swallow it, so moving or playing a
    // card never also taps it or opens its menu
    if (d.dataset.dragged || Date.now() < clickGuardUntil) {
      delete d.dataset.dragged;
      return;
    }
    // a menu is up: this click dismisses it rather than acting on the card
    if (menuOpen()) return closeMenu();
    hidePreview();
    if (pendingTuck && pendingTuck !== c.id) {
      act("tuck", { card: pendingTuck, under: c.id });
      pendingTuck = null;
      render();
      return;
    }
    // either button shows the menu — tapping by accident was too easy, so
    // the keyboard (E / shift+E) owns the quick gestures instead
    cardMenu(c, e);
  };
  // right-click = the same card menu (the browser menu is useless mid-game)
  d.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    hidePreview();
    cardMenu(c, e);
  });
  // hover target for keybinds (E = tap)
  d.addEventListener("mouseenter", () => { hoveredCard = c; });
  d.addEventListener("mouseleave", () => { if (hoveredCard && hoveredCard.id === c.id) hoveredCard = null; });
  // just dropped under the cursor: inert until the pointer leaves it once
  if (c.id === noHoverCardId) {
    d.classList.add("nohover");
    d.addEventListener("mouseleave", () => {
      if (noHoverCardId === c.id) noHoverCardId = null;
      d.classList.remove("nohover");
    }, { once: true });
  }
  return d;
}

// ---------------------------------------------------------------------------
// Card preview on hover
// ---------------------------------------------------------------------------

/** With a menu open, hovering cards behind it must not raise previews. */
const menuOpen = () => !$("#menu").classList.contains("hidden");

function showPreview(c, e) {
  if (menuOpen()) return;
  const pv = $("#cardpreview");
  if ((c.faceCount ?? 1) > 1 && c.faces) {
    // active face first (leftmost) with a gold frame; every face fully opaque
    const active = c.face ?? 0;
    const order = [...c.faces.keys()].sort((a, b) => (a === active ? -1 : b === active ? 1 : a - b));
    pv.innerHTML =
      `<div class="pv-faces">` +
      order
        .map((i) => {
          const f = c.faces[i];
          const cls = i === active ? "pv-active" : "";
          return f.image
            ? `<img class="${cls}" src="${f.image}">`
            : `<div class="pv-text ${cls}"><b>${f.name}</b>\n${f.typeLine || ""}\n\n${f.oracle || ""}</div>`;
        })
        .join("") +
      `</div>`;
  } else {
    pv.innerHTML = c.image
      ? `<img src="${c.image}">`
      : `<div class="pv-text"><b>${c.name}</b> ${c.mana || ""}\n${c.typeLine || ""}\n\n${c.oracle || ""}</div>`;
  }
  pv.classList.remove("hidden");
  positionPreview(e);
}
// everything that hangs off the cursor — the hover preview, both menus —
// sits the same distance from it
const CURSOR_GAP = { x: 18, y: 12 };

function positionPreview(e) {
  if (menuOpen()) return;
  const pv = $("#cardpreview");
  const wide = pv.querySelector(".pv-faces");
  pv.style.width = wide ? "440px" : "260px";
  const x = Math.min(e.clientX + CURSOR_GAP.x, window.innerWidth - (wide ? 460 : 280));
  const y = Math.min(e.clientY + CURSOR_GAP.y, window.innerHeight - 380);
  pv.style.left = x + "px";
  pv.style.top = Math.max(6, y) + "px";
}
function hidePreview() {
  $("#cardpreview").classList.add("hidden");
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

// Menu rows speak the library panel's language: a coloured icon, and the
// plate and rim arriving on hover. Icon and tone are matched from the label
// — presentation only, first match wins, anything unmatched stays neutral.
// Order is specific → general, and the rules are deliberately fine-grained:
// no two rows of the same menu may land on the same glyph. Pairs that used
// to collide: the two exiles, the two reveals, top vs bottom of library,
// set-P/T vs other-counter, delete vs cancel.
const MENU_LOOK = [
  [/exile face.?down/i, "exileDown", "surveil"],
  [/turn face-(down|up)/i, "facedown", "surveil"],
  [/^show /i, "flip", "surveil"],
  [/delete/i, "trash", "mill"],
  [/cancel attack/i, "cancelAttack", "mill"],
  [/remove|cancel|clear/i, "cancel", "mill"],
  [/ability/i, "ability", "scry"],
  [/copy/i, "copy", "surveil"],
  [/create/i, "token", "draw"],
  [/set p\/t/i, "setpt", "scry"],
  [/counter/i, "counters", "scry"],
  [/attack|combat/i, "combat", "exile"],
  [/block/i, "block", "scry"],
  [/untap/i, "untap", "mulligan"],
  [/^tap\b/i, "tap", "mulligan"],
  [/play |cast|→ stack/i, "cast", "surveil"],
  // owner/steal/give before the plain battlefield rule, or "to my battlefield"
  // and "to owner's battlefield" would collapse onto one glyph
  [/steal|take/i, "steal", "exile"],
  [/give|return|owner's battlefield/i, "give", "draw"],
  [/battlefield/i, "battlefield", "draw"],
  [/graveyard|discard|mill/i, "mill", "mill"],
  [/exile/i, "exile", "exile"],
  [/token/i, "token", "draw"],
  [/command/i, "command", "reveal"],
  [/hand/i, "toHand", "draw"],
  [/top/i, "top", "scry"],
  [/bottom/i, "bottom", "scry"],
  [/library/i, "library", "scry"],
  [/reveal to agent/i, "secret", "reveal"],
  [/reveal/i, "reveal", "reveal"],
  [/pile/i, "pile", "mill"],
];
/** Labels used to carry their own emoji; the icon says it now. */
const stripGlyph = (s) => String(s).replace(/^[^\p{L}\p{N}(]+/u, "").trim();

function openMenu(items, e, opts = {}) {
  const m = $("#menu");
  m.className = ""; // the library panel restyles this container — reset it
  m.innerHTML = "";
  for (const it of items) {
    if (it.title) {
      const d = document.createElement("div");
      d.className = "mi title";
      d.textContent = stripGlyph(it.label);
      m.appendChild(d);
      continue;
    }
    const [, icon, tone] = MENU_LOOK.find(([re]) => re.test(it.label)) ?? [];
    const b = document.createElement("button");
    // the first action is the one you almost always came for — give it size.
    // A dropdown's list is a list of equals, so it opts out.
    const first = !opts.plain && !m.querySelector(".mi:not(.title)");
    b.className =
      `mi a-${tone ?? "neutral"}` + (it.sep ? " sep" : "") + (first ? " primary" : "") + (it.on ? " on" : "");
    const label = document.createElement("span");
    label.className = "mi-label";
    label.textContent = stripGlyph(it.label);
    b.append(iconEl(it.icon ?? icon ?? "bullet"), label);
    if (it.keys) {
      const keys = document.createElement("span");
      keys.className = "na-key mi-keys";
      keys.append(keyCaps(it.keys));
      b.append(keys);
    }
    b.onclick = () => {
      closeMenu();
      it.fn();
    };
    m.appendChild(b);
  }
  m.classList.remove("hidden");
  const x = Math.min(e.clientX + CURSOR_GAP.x, window.innerWidth - 200);
  const y = Math.min(e.clientY + CURSOR_GAP.y, window.innerHeight - m.offsetHeight - 10);
  m.style.left = x + "px";
  m.style.top = Math.max(4, y) + "px";
}
function closeMenu() {
  $("#menu").classList.add("hidden");
}
document.addEventListener("click", closeMenu);

// A native <select> can't wear the plate-and-rim look, so ours is a plate that
// drops the card menu underneath it. `.value` and `.options` behave like a
// select's, so callers read it the same way.
function dropdown(options, value, onPick = () => {}) {
  const b = document.createElement("button");
  b.className = "dropdown";
  const label = document.createElement("span");
  label.className = "dd-label";
  let v = value;
  const paint = () => (label.textContent = options.find((o) => o.value === v)?.label ?? "");
  Object.defineProperty(b, "value", { get: () => v, set: (nv) => { v = nv; paint(); } });
  b.options = options;
  b.append(label, iconEl("caret"));
  paint();
  b.onclick = (e) => {
    e.stopPropagation();
    if (menuOpen()) return closeMenu();
    const r = b.getBoundingClientRect();
    openMenu(
      options.map((o) => ({
        label: o.label,
        // options that carry their own glyph keep it; the rest borrow the
        // icon column to mark which one is current
        icon: o.icon ?? (o.value === v ? "resolve" : "blank"),
        on: o.value === v,
        fn: () => { b.value = o.value; onPick(o.value); },
      })),
      { clientX: r.left - CURSOR_GAP.x, clientY: r.bottom - CURSOR_GAP.y + 3 },
      { plain: true }
    );
  };
  return b;
}

// The one place a card destination is named. Every menu and every card browser
// builds its rows from here, so a graveyard row is spelled, coloured and aimed
// the same way wherever you meet it. Entries are [label, move params]; the
// caller decides who runs the move — the board moves a card outright, the
// graveyard browser puts it on the stack first.
const DEST = {
  hand: (c) => ["To hand", { toZone: "hand", toPlayer: c.owner }],
  myHand: () => ["To my hand", { toZone: "hand", toPlayer: "you" }],
  graveyard: (c) => ["Graveyard", { toZone: "graveyard", toPlayer: c.owner }],
  exile: (c) => ["Exile", { toZone: "exile", toPlayer: c.owner }],
  exileDown: (c) => ["Exile face-down", { toZone: "exile", toPlayer: c.owner, faceDown: true, revealTo: "you" }],
  top: (c) => ["Top of library", { toZone: "library", toPlayer: c.owner, position: "top" }],
  bottom: (c) => ["Bottom of library", { toZone: "library", toPlayer: c.owner, position: "bottom" }],
  command: (c) => ["Command zone", { toZone: "command", toPlayer: c.owner }],
  myBattlefield: () => ["To my battlefield", { toZone: "battlefield", toPlayer: "you" }],
  ownerBattlefield: (c) => ["To owner's battlefield", { toZone: "battlefield", toPlayer: c.owner }],
  play: (c) => ["Straight to battlefield", { toZone: "battlefield", toPlayer: c.controller }],
  steal: () => ["😈 Steal — to my battlefield", { toZone: "battlefield", toPlayer: "you", note: "control effect" }],
  give: () => ["🎁 Give to agent's battlefield", { toZone: "battlefield", toPlayer: "agent", note: "control effect" }],
  giveBack: () => ["Return to agent's battlefield", { toZone: "battlefield", toPlayer: "agent" }],
};
/** A menu row that moves the card. `extra` only ever adds a log note. */
const destItem = (key, c, extra) => {
  const [label, params] = DEST[key](c);
  return { label, fn: () => act("move", { card: c.id, ...params, ...extra }) };
};
/** The same row for a card browser, where the caller runs the move. */
const destButton = (key, c, run, suffix = "") => {
  const [label, params] = DEST[key](c);
  return [label + suffix, () => run(params)];
};

function cardMenu(c, e) {
  const items = [{ label: c.hidden ? "(hidden card)" : c.name, title: true }];

  if (c.zone === "hand" && c.controller === "you") {
    if ((c.faceCount ?? 1) > 1 && c.faces) {
      // one Play per face — the chosen face decides land-drop vs stack
      c.faces.forEach((f, i) =>
        items.push({ label: `🌀 Play ${f.name}`, fn: () => act("cast", { card: c.id, face: i }) })
      );
    } else {
      items.push({ label: "🌀 Play → stack", fn: () => act("cast", { card: c.id }) });
    }
    items.push(destItem("graveyard", c, { note: "discard" }));
    items.push(destItem("exile", c));
    items.push({ label: "Reveal to agent", fn: () => act("reveal", { cards: [c.id], to: "agent" }) });
    items.push({ label: "Reveal to all", fn: () => act("reveal", { cards: [c.id], to: "all" }) });
    items.push(destItem("top", c), destItem("bottom", c));
  }

  if (c.zone === "battlefield") {
    const pendingAtk = pendingAttackOf(c.id);
    const canAttack = c.controller === "you" && !c.attacking && !pendingAtk;
    // in combat E declares the attack rather than tapping, so the menu leads
    // with attack there and the [E] hint follows the gesture
    const eAttacks =
      canAttack && typeCat(c) === "creature" && !c.tapped && /combat|attack/i.test(state.phase || "");
    const attackItem = {
      label: "⚔ Attack agent",
      ...(eAttacks ? { keys: ["E"] } : {}),
      fn: () => act("attack", { pairs: [{ attacker: c.id, target: "agent" }] }),
    };
    const tapItem = {
      label: c.tapped ? "Untap" : "Tap",
      ...(eAttacks ? {} : { keys: ["E"] }),
      fn: () => act("tap", { cards: [c.id], tapped: !c.tapped }),
    };
    if (eAttacks) items.push(attackItem, tapItem);
    else {
      items.push(tapItem);
      if (canAttack) items.push(attackItem);
    }
    if (c.controller === "you" && pendingAtk) {
      items.push({ label: "✖ Remove attacker", fn: () => removeAttacker(c, pendingAtk) });
    }
    if (c.attacking) items.push({ label: "Cancel attack", fn: () => act("clear_combat", {}) });
    const attackers = state.players.agent.zones.battlefield.filter((x) => x.attacking);
    if (c.controller === "you" && attackers.length) {
      for (const a of attackers)
        items.push({ label: `🛡 Block ${a.hidden ? "?" : a.name}`, fn: () => act("block", { pairs: [{ blocker: c.id, attacker: a.id }] }) });
    }
    if (c.power !== undefined && c.power !== null) {
      items.push({
        label: `⚔ Set P/T… (now ${c.power}/${c.toughness})`,
        fn: async () => {
          const v = await askText(`P/T for ${c.name} (e.g. 4/4 — empty resets to printed)`, `${c.power}/${c.toughness}`);
          if (v === null) return;
          const m = v.match(/^\s*([^/\s]+)\s*\/\s*([^/\s]+)\s*$/);
          if (!v.trim()) act("set_pt", { card: c.id });
          else if (m) act("set_pt", { card: c.id, power: m[1], toughness: m[2] });
          else alert("Use the form P/T, e.g. 4/4 (or leave empty to reset)");
        },
      });
    }
    items.push({
      label: "Other counter…",
      fn: async () => {
        const kind = await askText("Counter kind (e.g. loyalty, charge)");
        if (!kind) return;
        const delta = Number((await askText("Delta", "1")) || 1);
        act("counters", { card: c.id, kind, delta });
      },
    });
    if (c.under) items.push({ label: "Pull out of pile", fn: () => act("tuck", { card: c.id, under: "" }) });
    if (c.isToken) items.push({ ...destItem("graveyard", c, { note: "token removed" }), label: "🗑 Delete token", sep: true });
    items.push({ ...destItem("graveyard", c), sep: !c.isToken });
    items.push(destItem("exile", c), destItem("exileDown", c), destItem("hand", c), destItem("top", c));
    if (c.isCommander) items.push(destItem("command", c));
    if (c.controller === "agent") items.push(destItem("steal", c));
    if (c.controller === "you" && c.owner === "agent") items.push(destItem("giveBack", c));
    if (c.controller === "you" && c.owner === "you") items.push(destItem("give", c));
  }

  if (c.zone === "command") {
    items.push({ label: "🌀 Cast → stack", fn: () => act("cast", { card: c.id, note: "from command zone" }) });
    items.push(destItem("play", c));
  }

  if (!c.hidden) {
    // token copy of any visible card (clone effects, Scarab God eternalize, …)
    items.push({
      label: "🪞 Copy as token",
      fn: async () => {
        const n = Number((await askText(`Token copies of ${c.name}`, "1")) || 0);
        if (n <= 0) return;
        const face = c.faces?.[c.face ?? 0] ?? {};
        const pick = (k) => face[k] ?? c[k];
        act("create_token", {
          name: pick("name") ?? c.name,
          n,
          player: "you",
          ...(pick("image") ? { image: pick("image") } : {}),
          ...(pick("oracle") ? { oracle: pick("oracle") } : {}),
          ...(pick("typeLine") ? { typeLine: pick("typeLine") } : {}),
          ...(pick("power") !== undefined && pick("power") !== null
            ? { power: pick("power"), toughness: pick("toughness") }
            : {}),
        });
      },
    });
  }

  items.push({
    label: c.faceDown ? "🔍 Turn face-up" : "🙈 Turn face-down",
    fn: () => act("flip_card", { card: c.id, faceDown: !c.faceDown }),
  });

  if ((c.faceCount ?? 1) > 1) {
    items.push({
      label: `⟳ Show ${c.faces[((c.face ?? 0) + 1) % c.faceCount].name}`,
      fn: () => act("set_face", { card: c.id, face: ((c.face ?? 0) + 1) % c.faceCount }),
    });
  }

  if (c.zone === "battlefield") {
    items.push({ label: "⚡ Ability → stack…", keys: ["⇧", "E"], fn: () => abilityModal(c) });
  }

  if (c.zone === "exile" && !c.hidden) {
    items.push(destItem("myBattlefield", c, { note: "cast from exile" }), destItem("graveyard", c), destItem("hand", c));
  }

  openMenu(items, e);
}

// Right-clicking a library opens a laid-out panel, not a text menu:
//
//   [ mulligan ]          yours, turn 1 only
//   [ search   ]
//   [scry n][mill n]      counter tiles, 2 x 2
//   [exile n][surveil n]
//   [ draw n  ]           yours only
//   [ reveal top ] [ shuffle ]
//
// The tile body runs the action with the number shown. The number is also
// the stepper: hovering its top half arms a + above, the bottom half a −
// below, and clicking there changes the count instead of firing.
function libraryMenu(p, e) {
  const mine = p === "you";
  const m = $("#menu");
  m.innerHTML = "";
  m.className = "libpanel";

  const run = (fn) => async () => {
    closeMenu();
    await fn();
  };
  const topRef = `top:${p}`;
  const millOne = () => act("move", { card: topRef, toZone: "graveyard", toPlayer: p, note: "mill" });
  // taking cards off the agent's library is a theft effect: face-down, yours to see
  const exileOne = () =>
    mine
      ? act("move", { card: topRef, toZone: "exile", toPlayer: p, note: "exiled from library" })
      : act("move", { card: topRef, toZone: "exile", toPlayer: "agent", faceDown: true, revealTo: "you", note: "theft effect" });
  const peekN = async (n) => {
    const r = await act("peek", { player: p, n });
    if (r.ok) peekModal(p, r.cards);
  };
  const repeat = async (n, once) => {
    for (let i = 0; i < n; i++) await once();
  };

  const title = document.createElement("div");
  title.className = "lp-title";
  title.textContent = mine ? "Your library" : "Agent's library";
  m.appendChild(title);

  /** A button with an icon, a label, and optionally an inline counter that
   *  doubles as a +/- stepper. `icon` doubles as the colour class. */
  const button = (cls, label, icon, onRun, counted) => {
    const b = document.createElement("button");
    b.className = `${cls} a-${icon}`;
    const text = document.createElement("span");
    text.className = "lp-label";
    text.textContent = label;
    // icon and label always share a line; the dial sits beside them on wide
    // buttons and beneath them on tiles
    const head = document.createElement("span");
    head.className = "lp-head";
    head.append(iconEl(icon), text);
    b.append(head);
    let n = 1;
    if (counted) {
      const count = document.createElement("span");
      count.className = "lp-count";
      count.textContent = n;
      const up = document.createElement("span");
      up.className = "lp-step up";
      up.textContent = "+";
      const down = document.createElement("span");
      down.className = "lp-step down";
      down.textContent = "−";
      const stepper = document.createElement("span");
      stepper.className = "lp-stepper";
      stepper.append(up, count, down);
      const topHalf = (ev) => {
        const r = stepper.getBoundingClientRect();
        return ev.clientY < r.top + r.height / 2;
      };
      stepper.onclick = (ev) => {
        ev.stopPropagation(); // adjust, never fire
        n = Math.max(1, topHalf(ev) ? n + 1 : n - 1);
        count.textContent = n;
      };
      stepper.onmousemove = (ev) => {
        const top = topHalf(ev);
        up.classList.toggle("armed", top);
        down.classList.toggle("armed", !top);
        // shade the half of the dial the click will act on
        stepper.classList.toggle("step-up", top);
        stepper.classList.toggle("step-down", !top);
      };
      // on the dial the click won't run the action, so the button stops
      // pretending it is hovered
      stepper.onmouseenter = () => b.classList.add("on-dial");
      stepper.onmouseleave = () => {
        up.classList.remove("armed");
        down.classList.remove("armed");
        stepper.classList.remove("step-up", "step-down");
        b.classList.remove("on-dial");
      };
      b.append(stepper);
    }
    b.onclick = run(() => onRun(n));
    return b;
  };

  if (mine && state.turnNumber === 1) {
    m.append(
      button("lp-wide", "Mulligan", "mulligan", async () => {
        const hand = state.players.you.zones.hand;
        if (!hand.length) return;
        await act("move", { cards: hand.map((c) => c.id), toZone: "library", note: "mulligan" });
        await act("shuffle", { player: "you" });
        await act("draw", { n: 7 });
      })
    );
  }
  m.append(
    button("lp-wide", "Search", "search", async () => {
      const r = await act("view_zone", { player: p, zone: "library" });
      if (r.ok) searchModal(p, r.cards);
    })
  );

  // draw leads the tiles, paired with reveal — counters and all
  const pair = document.createElement("div");
  pair.className = "lp-grid";
  if (mine) pair.append(button("lp-tile", "Draw", "draw", (n) => act("draw", { n }), true));
  pair.append(
    button(
      "lp-tile",
      "Reveal",
      "reveal",
      async (n) => {
        const r = await act("peek", { player: p, n });
        if (r.ok && r.cards.length) await act("reveal", { cards: r.cards.map((c) => c.id), to: "all" });
      },
      true
    )
  );
  m.append(pair);

  const grid = document.createElement("div");
  grid.className = "lp-grid";
  grid.append(
    button("lp-tile", "Scry", "scry", peekN, true),
    button("lp-tile", "Mill", "mill", (n) => repeat(n, millOne), true),
    button("lp-tile", "Exile", "exile", (n) => repeat(n, exileOne), true),
    button("lp-tile", "Surveil", "surveil", peekN, true)
  );
  m.append(grid, button("lp-wide", "Shuffle", "shuffle", () => act("shuffle", { player: p })));

  m.classList.remove("hidden");
  const x = Math.min(e.clientX + CURSOR_GAP.x, window.innerWidth - 250);
  const y = Math.min(e.clientY + CURSOR_GAP.y, window.innerHeight - m.offsetHeight - 10);
  m.style.left = x + "px";
  m.style.top = Math.max(4, y) + "px";
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

// The card-size slider picks a row density, not a pixel width: the cards then
// divide the browser evenly, so a row never ends in a ragged half-gap.
const PER_ROW = [10, 9, 8, 7, 6, 5, 4, 3];
const GRID_GAP = 8; // must match .modalcards gap
const GRID_PAD = 4; // and its padding, which the row width has to give back
const perRow = () => Number(localStorage.getItem("cardsPerRow")) || 5;
function applyCardSize(n = perRow()) {
  const box = $("#modal-box");
  const w = (box.querySelector(".modalscroll") ?? box).clientWidth - 2 * GRID_PAD;
  if (w > 0) box.style.setProperty("--cardsize", Math.floor((w - GRID_GAP * (n - 1)) / n) - 1 + "px");
}
window.addEventListener("resize", () => applyCardSize());

function openModal(title, bodyEl, opts = {}) {
  const box = $("#modal-box");
  $("#modal .targetpanel")?.remove(); // stale palette from a previous modal
  // card browsers are fixed-size (hard rule); compact modals size to content
  box.classList.toggle("compact", !!opts.compact);
  box.innerHTML = "";
  const x = document.createElement("button");
  x.className = "modalx";
  x.textContent = "✕";
  x.title = "Close (Esc)";
  x.onclick = closeModal;
  box.appendChild(x);
  // title and any filter bar stay put; only the cards under them scroll
  const head = document.createElement("div");
  head.className = "modalhead";
  head.innerHTML = `<h3>${title}</h3>`;
  if (opts.header) head.appendChild(opts.header);
  box.appendChild(head);
  const scroll = document.createElement("div");
  scroll.className = "modalscroll";
  scroll.appendChild(bodyEl);
  box.appendChild(scroll);
  $("#modal").classList.remove("hidden");
  applyCardSize(); // needs the box laid out, so after it is shown
}
function closeModal() {
  $("#modal").classList.add("hidden");
  $("#modal .targetpanel")?.remove();
  hidePreview();
  if (askResolve) {
    askResolve(null);
    askResolve = null;
  }
}

// In-app replacement for window.prompt — Electron doesn't support prompt(),
// so every "how many? / which kind?" question goes through this tiny modal.
// Resolves the entered string, or null on cancel/Esc/✕.
let askResolve = null;
function askText(title, def = "") {
  return new Promise((resolve) => {
    askResolve = resolve;
    const body = document.createElement("div");
    body.className = "askbox";
    const input = document.createElement("input");
    input.value = def ?? "";
    const ok = document.createElement("button");
    ok.textContent = "OK";
    ok.onclick = () => {
      askResolve = null;
      resolve(input.value);
      closeModal();
    };
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.onclick = closeModal;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") ok.click();
    });
    const row = document.createElement("div");
    row.className = "askrow";
    row.append(ok, cancel);
    body.append(input, row);
    openModal(title, body, { compact: true });
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  });
}

/** Floating target palette beside the ability modal: every legal target,
    click to insert [Card Name] into the input at the cursor. */
function targetPanel(input) {
  const P = state.players;
  const cols = [
    ["My field", P.you.zones.battlefield, false, []],
    ["Agent field", P.agent.zones.battlefield, false, []],
    ["My hand", P.you.zones.hand, false, []],
    ["My graveyard", [...P.you.zones.graveyard].reverse(), true, [...P.you.zones.exile].reverse()],
    ["Agent graveyard", [...P.agent.zones.graveyard].reverse(), true, [...P.agent.zones.exile].reverse()],
  ];
  const panel = document.createElement("div");
  panel.className = "targetpanel";
  for (const [title, cards, collapsed, exileCards] of cols) {
    const col = document.createElement("div");
    col.className = "tcol" + (collapsed ? " collapsed" : "");
    const head = document.createElement("div");
    head.className = "tcolhead";
    head.textContent = title;
    head.title = "Toggle";
    head.onclick = () => col.classList.toggle("collapsed");
    const list = document.createElement("div");
    list.className = "tlist";
    // lands sink below everything else — they're rarely the target
    const isLand = (c) => /\bland\b/i.test(c.typeLine || "") && !/\b(creature|instant|sorcery)\b/i.test(c.typeLine || "");
    const sortLandsLast = (arr) => [...arr].sort((a, b) => Number(isLand(a)) - Number(isLand(b)));
    const add = (c) => {
      if (c.hidden || !c.name) return;
      const el = document.createElement("div");
      el.className = "titem";
      el.innerHTML = c.image ? `<img src="${c.image}" alt="">` : `<span>${c.name}</span>`;
      el.onmouseenter = (e) => showPreview(c, e);
      el.onmousemove = (e) => positionPreview(e);
      el.onmouseleave = hidePreview;
      el.onclick = () => {
        const s = input.selectionStart ?? input.value.length;
        const e2 = input.selectionEnd ?? s;
        input.setRangeText(`[${c.name}]`, s, e2, "end");
        input.focus();
      };
      list.appendChild(el);
    };
    sortLandsLast(cards).forEach(add);
    if (exileCards.some((c) => !c.hidden)) {
      const sub = document.createElement("div");
      sub.className = "tsub";
      sub.textContent = "Exile";
      list.appendChild(sub);
      sortLandsLast(exileCards).forEach(add);
    }
    col.append(head, list);
    panel.appendChild(col);
  }
  return panel;
}
$("#modal").addEventListener("click", (e) => {
  if (e.target.id === "modal") closeModal();
});

function modalCardEl(info, buttons) {
  const d = document.createElement("div");
  d.className = "modalcard";
  d.innerHTML = info.image
    ? `<img src="${info.image}" title="${info.name}">`
    : `<div class="textcard" style="height:auto;min-height:60px"><b>${info.name}</b><br>${info.typeLine || ""}</div>`;
  d.onmouseenter = (e) => showPreview(info, e);
  d.onmousemove = (e) => positionPreview(e);
  d.onmouseleave = hidePreview;
  // no button strip under the art: clicking the card opens the same menu the
  // battlefield uses. A card with a single action just runs it.
  const open = (e) => {
    e.stopPropagation();
    if (menuOpen()) return closeMenu(); // second click dismisses, same as the board
    hidePreview();
    if (buttons.length === 1) return buttons[0][1]();
    openMenu([{ label: info.name, title: true }, ...buttons.map(([label, fn]) => ({ label, fn }))], e);
  };
  d.onclick = open;
  d.oncontextmenu = (e) => {
    e.preventDefault();
    open(e);
  };
  return d;
}

// ---------------------------------------------------------------------------
// Card filtering (zone modals + library search)
// ---------------------------------------------------------------------------

function manaValue(mana) {
  if (!mana) return 0;
  let mv = 0;
  for (const sym of mana.match(/\{[^}]+\}/g) ?? []) {
    const s = sym.slice(1, -1);
    if (/^\d+$/.test(s)) mv += Number(s);
    else if (s.toUpperCase() !== "X") mv += 1; // colored/hybrid/phyrexian = 1, X = 0
  }
  return mv;
}

function cardColors(c) {
  const set = new Set();
  for (const ch of (c.mana || "").toUpperCase()) if ("WUBRG".includes(ch)) set.add(ch);
  return set;
}

// value is what the type line is matched against; the glyph is what you see
const CARD_TYPES = [
  { value: "", label: "Any type", icon: "anyType" },
  { value: "creature", label: "Creature", icon: "creature" },
  { value: "land", label: "Land", icon: "land" },
  { value: "artifact", label: "Artifact", icon: "artifact" },
  { value: "enchantment", label: "Enchantment", icon: "enchantment" },
  { value: "instant", label: "Instant", icon: "instant" },
  { value: "sorcery", label: "Sorcery", icon: "sorcery" },
  { value: "planeswalker", label: "Planeswalker", icon: "planeswalker" },
  { value: "battle", label: "Battle", icon: "battle" },
];

/** Shared filter bar: name, type, P/T (≥/≤), mana value (≥/≤), colors. */
function filterBar(onChange) {
  const f = { q: "", type: "", powOp: ">=", pow: "", touOp: ">=", tou: "", mvOp: "<=", mv: "", colors: new Set() };
  const el = document.createElement("div");
  el.className = "filterbar";

  // search bar on its own line above the filters
  const q = document.createElement("input");
  q.className = "namein";
  q.placeholder = "Search name, type, or card text…";
  q.oninput = () => { f.q = q.value.toLowerCase(); onChange(); };
  el.appendChild(q);
  // focus once the modal is actually in the DOM
  setTimeout(() => q.focus(), 0);

  const row = document.createElement("div");
  row.className = "frow";
  row.append(dropdown(CARD_TYPES, "", (v) => { f.type = v; onChange(); }));
  const numFilter = (label, opKey, valKey) => {
    const span = document.createElement("span");
    span.className = "numf";
    const name = document.createElement("span");
    name.className = "numlabel";
    name.textContent = label;
    span.appendChild(name);
    // two states don't deserve a popup — the plate flips between them
    const op = document.createElement("button");
    op.className = "opbtn";
    op.textContent = f[opKey] === ">=" ? "≥" : "≤";
    op.title = "At least / at most";
    op.onclick = () => {
      f[opKey] = f[opKey] === ">=" ? "<=" : ">=";
      op.textContent = f[opKey] === ">=" ? "≥" : "≤";
      onChange();
    };
    const n = document.createElement("input");
    n.type = "number";
    n.className = "numin";
    n.oninput = () => { f[valKey] = n.value; onChange(); };
    // the native spinner can't be styled, so it is hidden and this pair of
    // plates does the stepping
    const spin = document.createElement("span");
    spin.className = "spin";
    for (const [icon, d] of [["caretUp", 1], ["caret", -1]]) {
      const s = document.createElement("button");
      s.className = "spinb";
      s.append(iconEl(icon));
      s.onclick = () => {
        n.value = Math.max(0, Number(n.value || 0) + d);
        f[valKey] = n.value;
        onChange();
      };
      spin.appendChild(s);
    }
    span.append(op, n, spin);
    return span;
  };
  row.append(numFilter("power", "powOp", "pow"), numFilter("toughness", "touOp", "tou"), numFilter("mana cost", "mvOp", "mv"));

  // pips ride as one tight cluster right after the mana-cost input
  const PIP_NAMES = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", C: "No color" };
  const pips = document.createElement("span");
  pips.className = "pips";
  for (const col of ["W", "U", "B", "R", "G", "C"]) {
    const b = document.createElement("button");
    b.className = "colbtn col" + col;
    b.title = PIP_NAMES[col];
    b.onclick = () => {
      if (f.colors.has(col)) { f.colors.delete(col); b.classList.remove("on"); }
      else { f.colors.add(col); b.classList.add("on"); }
      onChange();
    };
    pips.appendChild(b);
  }
  row.appendChild(pips);

  // card-size slider — one notch per row density, persisted, and pinned to the
  // far right by margin-left:auto
  const size = document.createElement("input");
  size.type = "range";
  size.min = 0;
  size.max = PER_ROW.length - 1;
  size.step = 1;
  size.value = Math.max(0, PER_ROW.indexOf(perRow()));
  size.className = "sizeslider";
  const describe = () => (size.title = `${PER_ROW[size.value]} cards per row`);
  describe();
  size.oninput = () => {
    localStorage.setItem("cardsPerRow", PER_ROW[size.value]);
    describe();
    applyCardSize();
  };
  row.appendChild(size);
  el.append(row);

  const active = () =>
    !!(f.q || f.type || f.pow !== "" || f.tou !== "" || f.mv !== "" || f.colors.size);
  const cmp = (val, op, target) => (op === ">=" ? val >= target : val <= target);
  const predicate = (c) => {
    if (c.hidden) return !active(); // hidden cards can't match filters
    // free text matches EVERYTHING: name, type line, oracle text —
    // "mountain" finds duals, "token" finds token-makers
    if (f.q) {
      const hay = `${c.name || ""} ${c.typeLine || ""} ${c.oracle || ""}`.toLowerCase();
      if (!hay.includes(f.q)) return false;
    }
    if (f.type && !(c.typeLine || "").toLowerCase().includes(f.type)) return false;
    if (f.pow !== "") {
      const v = Number(c.power);
      if (isNaN(v) || !cmp(v, f.powOp, Number(f.pow))) return false;
    }
    if (f.tou !== "") {
      const v = Number(c.toughness);
      if (isNaN(v) || !cmp(v, f.touOp, Number(f.tou))) return false;
    }
    if (f.mv !== "" && !cmp(manaValue(c.mana), f.mvOp, Number(f.mv))) return false;
    const cols = cardColors(c);
    for (const col of f.colors) {
      if (col === "C") {
        if (cols.size > 0) return false; // "no color" = zero colored pips
      } else if (!cols.has(col)) return false;
    }
    return true;
  };
  return { el, predicate };
}

/** Announce an ability of a battlefield card onto the stack — our own modal:
    the card and its oracle text for reference, one input, Enter submits. */
function abilityModal(c) {
  const wrap = document.createElement("div");
  wrap.className = "abilitymodal";
  const esc = (s) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
  wrap.innerHTML = c.image
    ? `<img src="${c.image}" alt="">`
    : `<div class="amoracle">${esc(c.oracle) || "<i>(no rules text)</i>"}</div>`;
  const col = document.createElement("div");
  col.className = "amcol";
  const input = document.createElement("textarea");
  input.placeholder = "What does the ability do? (targets, numbers…)";
  // not everything taps to activate: [Tap + Stack] (⇧⏎) vs [Stack] (⏎)
  const submit = (tapToo) => {
    const t = input.value.trim();
    if (!t) return;
    if (tapToo && !c.tapped) act("tap", { cards: [c.id], tapped: true });
    act("stack_push", { text: `${c.hidden ? "?" : c.name}: ${t}`, source: c.id });
    closeModal();
  };
  const mkBtn = (label, sub, tapToo, accent) => {
    const b = document.createElement("button");
    if (accent) b.className = "accent";
    b.classList.add("ambtn");
    b.innerHTML = `<span>${label}</span><small>${sub}</small>`;
    b.onclick = () => submit(tapToo);
    return b;
  };
  const btnRow = document.createElement("div");
  btnRow.className = "ambtns";
  btnRow.append(mkBtn("⚡ Tap + Stack", "⇧⏎", true, false), mkBtn("⚡ Stack", "⏎", false, true));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit(e.shiftKey);
    }
  });
  col.append(input, btnRow);
  wrap.appendChild(col);
  openModal(`⚡ ${c.hidden ? "Hidden card" : c.name}`, wrap, { compact: true });
  // target palette floats beside the modal, outside the box
  $("#modal").appendChild(targetPanel(input));
  setTimeout(() => input.focus(), 0);
}

function showZoneModal(p, zone) {
  // piles read newest-first: the last card added is the top of the pile
  const cards = [...state.players[p].zones[zone]].reverse();
  const grid = document.createElement("div");
  grid.className = "modalcards";
  const renderGrid = () => {
    grid.innerHTML = "";
    const shown = cards.filter(fb.predicate);
    if (!shown.length) grid.textContent = cards.length ? "(no matches)" : "(empty)";
    for (const c of shown) {
      if (c.hidden) {
        const d = document.createElement("div");
        d.className = "modalcard";
        d.innerHTML = `<img class="cardback" src="card-back.jpg" alt="face-down card">`;
        grid.appendChild(d);
        continue;
      }
      // leaving a graveyard/exile is a game action — it goes ON THE STACK
      // (cast with a declared destination; the agent resolves or responds)
      const viaStack = (key) =>
        destButton(
          key,
          c,
          ({ toZone, toPlayer }) =>
            act("cast", {
              card: c.id,
              resolveTo: toZone,
              ...(toPlayer !== "you" ? { resolveToPlayer: toPlayer } : {}),
              note: `from ${zone} → ${toPlayer === "you" ? "your" : "owner's"} ${toZone}`,
            }).then(closeModal),
          " ⚡"
        );
      grid.appendChild(
        modalCardEl(c, [
          viaStack("hand"),
          viaStack("myBattlefield"),
          viaStack("ownerBattlefield"),
          viaStack(zone === "exile" ? "graveyard" : "exile"),
        ])
      );
    }
  };
  const fb = filterBar(() => renderGrid());
  renderGrid();
  openModal(`${p === "you" ? "Your" : "Agent's"} ${zone} (${cards.length})`, grid, { header: fb.el });
}

function peekModal(p, cards) {
  const grid = document.createElement("div");
  grid.className = "modalcards";
  for (const c of cards) {
    // every action fires immediately and the window stays open (esc or ✕
    // closes it); a card that has left the top dims in place
    let el;
    const leave = (params) => {
      act("move", { card: c.id, ...params });
      el.classList.add("bottomed");
    };
    el = modalCardEl(c, [
      ["Keep on top", () => { act("reorder_top", { player: p, top: [c.id] }); el.classList.remove("bottomed"); }],
      ["Bottom of library", () => { act("reorder_top", { player: p, toBottom: [c.id] }); el.classList.add("bottomed"); }],
      destButton("myHand", c, leave),
      destButton("graveyard", c, leave),
      destButton("exile", c, leave),
    ]);
    grid.appendChild(el);
  }
  openModal(`Top of ${p === "you" ? "your" : "agent's"} library`, grid);
}

function searchModal(p, cards) {
  const grid = document.createElement("div");
  grid.className = "modalcards";
  const renderGrid = () => {
    grid.innerHTML = "";
    const shown = cards.filter(fb.predicate);
    if (!shown.length) grid.textContent = "(no matches)";
    for (const c of shown) {
      // the window stays open through every action (esc or ✕ closes it) —
      // searches usually take several cards. Each action re-renders in place.
      const move = (params) => act("move", { card: c.id, ...params }).then(() => {
        cards = cards.filter((x) => x.id !== c.id);
        renderGrid();
      });
      // a found card always comes to YOUR hand — searching the agent's library
      // is a theft effect, and taking the card is the point
      const found = (params) => move({ ...params, note: "from library search" });
      grid.appendChild(
        modalCardEl(c, [
          destButton("myHand", c, move),
          destButton("myBattlefield", c, move),
          destButton("graveyard", c, found),
          destButton("exile", c, found),
          destButton("exileDown", c, found),
          destButton("top", c, move),
        ])
      );
    }
  };
  const fb = filterBar(() => renderGrid());
  renderGrid();
  openModal(`${p === "you" ? "Your" : "Agent's"} library`, grid, { header: fb.el });
}

// ---------------------------------------------------------------------------
// Side panel: chat / brain / log
// ---------------------------------------------------------------------------

// log lines describing stack traffic — surfaced in chat as inline bubbles.
// "\(on the stack" catches attack/block declarations, phase moves and turn
// passes; the "locked in"/Phase/Round lines are those items resolving.
const STACK_CHAT_RE =
  /(→ on the stack$)|( put on the stack: )|( proposed the \d+ items )|(\(on the stack)|(^Attacks locked in: )|(^Blocks locked in: )|(^Phase: )|(^— Round )|(^Resolved: )|( resolved → )|( countered[ :])|( un-countered: )|( fizzles)|(countered\/removed: )|( back off the stack → )|( removed from the stack: )/;

// starts true so the first render after page load opens at the latest messages
let scrollChatToBottom = true;

const NEAR_BOTTOM = 90; // px — within this of the bottom counts as "following"

function nearBottom(pane) {
  return pane.scrollTop + pane.clientHeight >= pane.scrollHeight - NEAR_BOTTOM;
}

function renderChat() {
  const pane = $("#pane-chat");
  const prevScroll = pane.scrollTop;
  const follow = nearBottom(pane);
  pane.innerHTML = "";
  for (const e of state.log) {
    if ((e.actor === "you" || e.actor === "agent") && !e.text.startsWith("💬") && !e.text.startsWith("❓") && STACK_CHAT_RE.test(e.text)) {
      // a push's stack item id is "s" + the seq of its own log line — if that
      // item is still LIVE, embed the actual widget (same text, same buttons)
      const live = state.stack && state.stack.find((i) => i.id === "s" + e.seq);
      if (live) {
        pane.appendChild(stackItemEl(live, { inChat: true }));
        continue;
      }
      const d = document.createElement("div");
      d.className = "msg stackmsg " + (e.actor === "you" ? "you" : "agent");
      d.innerHTML = `<div class="mwho">${e.actor === "you" ? "You" : "Agent"} · ⚡ stack</div>`;
      // the header names the actor — strip the redundant prefix and stack boilerplate
      // (actor prefix only before a known verb, so card names like "Agent of Treachery" survive)
      const text = e.text
        .replace(/^(?:You|Agent) put on the stack: /, "")
        .replace(/^(?:You|Agent) (cast|played|proposed|moves|declares|countered|took|removed)\b/, "$1")
        .replace(/ → on the stack$/, "")
        .replace(/ \(on the stack(?: — respond or resolve)?\)/, "");
      d.appendChild(document.createTextNode(text));
      d.title = "Open the Stack tab";
      d.onclick = () => switchTab("stack");
      pane.appendChild(d);
    } else if (e.text.startsWith("💬") || e.text.startsWith("❓")) {
      const d = document.createElement("div");
      d.className = "msg " + (e.actor === "you" ? "you" : "agent");
      d.innerHTML = `<div class="mwho">${e.actor === "you" ? "You" : "Agent"}</div>`;
      d.appendChild(document.createTextNode(e.text.replace(/^💬 (Player|Agent): /, "").replace(/^❓ Agent asks: /, "❓ ")));
      pane.appendChild(d);
    } else if (e.actor === "system") {
      const d = document.createElement("div");
      d.className = "msg sys";
      d.textContent = e.text;
      pane.appendChild(d);
    } else {
      // every other action (draws, taps, scries, moves…) shows as a dim line —
      // the chat is the full play-by-play, nothing happens invisibly
      const d = document.createElement("div");
      d.className = "msg actline";
      d.textContent = e.text;
      pane.appendChild(d);
    }
  }
  // follow along when you were at (or near) the bottom; hold position when
  // you've scrolled up to read. Your own send always jumps down.
  if (scrollChatToBottom || follow) {
    scrollChatToBottom = false;
    pane.scrollTop = pane.scrollHeight;
  } else {
    pane.scrollTop = prevScroll;
  }
  renderAgentStatus();
}

function renderLog() {
  const pane = $("#pane-log");
  const stick = pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 40;
  pane.innerHTML = "";
  for (const e of state.log) {
    const d = document.createElement("div");
    d.className = "logline";
    d.innerHTML = `<b>${e.seq}</b> ${e.text}`;
    pane.appendChild(d);
  }
  if (stick) pane.scrollTop = pane.scrollHeight;
}

function appendBrainEntry(e) {
  const pane = $("#pane-brain");
  const stick = pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 40;
  const d = document.createElement("div");
  d.className = "brain " + e.kind;
  d.id = "brain-" + e.seq;
  d.textContent = e.kind === "tool" ? `🔧 ${e.text}` : e.text;
  pane.appendChild(d);
  if (stick) pane.scrollTop = pane.scrollHeight;
}

function renderBrain() {
  $("#pane-brain").innerHTML = "";
  for (const e of brainEntries) appendBrainEntry(e);
}

// ---------------------------------------------------------------------------
// Token creation
// ---------------------------------------------------------------------------

// Tokens harvested from both imported decks (Scryfall all_parts) show as
// clickable cards; anything else can be typed in as a custom token.
function tokenModal() {
  const wrap = document.createElement("div");
  const cat = Object.values(state.tokenCatalog || {});
  const grid = document.createElement("div");
  grid.className = "modalcards";
  if (!cat.length) grid.textContent = "(no tokens came with the decks — make a custom one below)";
  const create = async (params) => {
    const n = Number((await askText("How many?", "1")) || 0);
    if (n > 0) act("create_token", { ...params, n, player: "you" }).then(closeModal);
  };
  for (const t of cat) {
    grid.appendChild(modalCardEl(t, [["create…", () => create({ name: t.name })]]));
  }
  wrap.appendChild(grid);

  const custom = document.createElement("div");
  custom.className = "tokencustom";
  custom.innerHTML = `<div class="tclabel">Custom token</div>`;
  const name = document.createElement("input");
  name.placeholder = "name (e.g. Treasure, Soldier)";
  const type = document.createElement("input");
  type.placeholder = "type line (optional)";
  const pt = document.createElement("input");
  pt.placeholder = "P/T (optional, e.g. 1/1)";
  const go = document.createElement("button");
  go.textContent = "Create custom";
  go.onclick = () => {
    if (!name.value.trim()) return alert("Token needs a name");
    const m = pt.value.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
    create({
      name: name.value.trim(),
      ...(type.value.trim() ? { typeLine: type.value.trim() } : {}),
      ...(m ? { power: m[1], toughness: m[2] } : {}),
    });
  };
  custom.append(name, type, pt, go);
  wrap.appendChild(custom);
  openModal("Create a token", wrap);
}
$("#btn-token").onclick = tokenModal;

// ---------------------------------------------------------------------------
// Top-level controls
// ---------------------------------------------------------------------------

// Accepts a bare id or any archidekt.com URL ("…/decks/25319832/slug").
function parseDeckRef(v) {
  const m = String(v).match(/(\d{4,})/);
  return m ? m[1] : "";
}

const MODELS = [
  { value: "opus", label: "Opus — strongest" },
  { value: "sonnet", label: "Sonnet — strong" },
  { value: "haiku", label: "Haiku — casual" },
];
{
  const d = dropdown(MODELS, "opus");
  d.id = "ng-model";
  $("#ng-model-slot").appendChild(d);
}

// New-game overlay: fields come prefilled with the currently loaded decks so
// a straight re-match is one click; type over them to switch decks.
function openNewGame() {
  for (const side of ["you", "agent"]) {
    const a = $(`#decklink-${side}`);
    const id = state?.lastDecks?.[side];
    $(`#deck-${side}`).value = id ? `https://archidekt.com/decks/${id}` : "";
    a.textContent = id ? `current: archidekt.com/decks/${id}` : "";
    a.href = id ? `https://archidekt.com/decks/${id}` : "#";
  }
  const sel = $("#ng-model");
  if ([...sel.options].some((o) => o.value === state?.agentModel)) sel.value = state.agentModel;
  $("#newgame-overlay").classList.remove("hidden");
  $("#deck-agent").focus();
  $("#deck-agent").select();
}

function closeNewGame() {
  $("#newgame-overlay").classList.add("hidden");
}

$("#btn-newgame").onclick = openNewGame;
$("#btn-ngcancel").onclick = closeNewGame;

$("#btn-loaddecks").onclick = async () => {
  const youDeck = parseDeckRef($("#deck-you").value);
  const agentDeck = parseDeckRef($("#deck-agent").value);
  if (!youDeck || !agentDeck) {
    alert("Enter a deck for each side — an Archidekt URL or deck id.");
    return;
  }
  $("#btn-loaddecks").textContent = "Loading…";
  $("#btn-loaddecks").disabled = true;
  try {
    const res = await fetch("/api/new_game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ youDeck, agentDeck, model: $("#ng-model").value }),
    });
    const data = await res.json();
    if (!data.ok) alert("New game failed: " + data.error);
    else closeNewGame();
  } finally {
    $("#btn-loaddecks").textContent = "Load decks";
    $("#btn-loaddecks").disabled = false;
  }
};

document.querySelectorAll(".phasebtns button[data-phase]").forEach((b) => {
  b.onclick = async () => {
    if (b.dataset.phase === "untap/upkeep") await act("untap_all", { player: "you" });
    act("set_phase", { phase: b.dataset.phase });
  };
});

$("#btn-endturn").onclick = async () => {
  await act("set_turn", { player: "agent" });
  await act("done", {});
};


const undoLastAction = async () => {
  const res = await fetch("/api/undo", { method: "POST" });
  const data = await res.json();
  if (!data.ok) alert(data.error);
};
$("#btn-undo").onclick = undoLastAction;
$("#na-undo").onclick = undoLastAction;

function sendChat() {
  const input = $("#chat-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  // on the Stack tab the composer feeds the stack instead of the chat —
  // that's how you announce a random trigger/ability as a text item
  if (activeTab === "stack") act("stack_push", { text });
  else {
    scrollChatToBottom = true;
    act("chat", { text });
  }
}
$("#btn-send").onclick = sendChat;
$("#chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendChat();
});

let activeTab = "chat";

function switchTab(name) {
  activeTab = name;
  document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("active", x.dataset.tab === name));
  document.querySelectorAll(".tabpane").forEach((x) => x.classList.add("hidden"));
  $(`#pane-${name}`).classList.remove("hidden");
  const stackMode = name === "stack";
  $("#chat-input").placeholder = stackMode ? "Announce a trigger/ability onto the stack…" : "Say something to the agent…";
  $("#btn-send").textContent = stackMode ? "⚡ Stack" : "Send";
  // a pane hidden with display:none can't hold a scroll position — always
  // land at the newest entry when it opens
  const pane = $(`#pane-${name}`);
  pane.scrollTop = pane.scrollHeight;
  updateKeyUI();
}
document.querySelectorAll("#tabs button").forEach((b) => {
  b.onclick = () => switchTab(b.dataset.tab);
});

let hoveredCard = null;

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    pendingTuck = null;
    // esc peels one layer: an open menu first, the modal under it next
    if (menuOpen()) closeMenu();
    else closeModal();
    render();
    return;
  }
  // keybinds are inert while typing
  const t = document.activeElement;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
  // CMD/CTRL+Z undoes the last table action. Below the typing guard on
  // purpose: inside a text field it stays the browser's text undo.
  if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
    e.preventDefault();
    undoLastAction();
    return;
  }
  // SPACE takes the floating next action, SHIFT+SPACE skips to the turn pass.
  // preventDefault stops both the page scroll and the native button
  // activation, so a focused button fires once.
  if (e.key === " " || e.code === "Space") {
    e.preventDefault();
    if ($("#nextaction").classList.contains("hidden")) return;
    const btn = e.shiftKey ? $("#na-skip") : $("#na-primary");
    if (!btn.classList.contains("hidden")) btn.click();
    return;
  }
  if ((e.key === "e" || e.key === "E") && hoveredCard) {
    cardPrimaryAction(hoveredCard, e.shiftKey);
  }
});

/** What E — and a left-click on a battlefield card — does to a card.
 *  shift = announce an ability instead (the modal decides tap vs no-tap). */
function cardPrimaryAction(card, shift) {
  {
    // fresh lookup: state may have re-rendered under the cursor since mouseenter
    const cur = cardById(card.id) ?? card;
    // on a hand card this plays it (lands = land drop, spells = onto the
    // stack; a DFC plays whichever face it's showing)
    if (cur.zone === "hand" && cur.controller === "you") {
      act("cast", { card: cur.id });
      return;
    }
    if (cur.zone !== "battlefield") return;
    if (shift) {
      abilityModal(cur);
      return;
    }
    // E is a TOGGLE on the battlefield:
    // 1. pending attack declaration → undo it
    if (cur.controller === "you") {
      const pa = pendingAttackOf(cur.id);
      if (pa) {
        removeAttacker(cur, pa);
        return;
      }
      // 2. the card's own pending stack item (shift+E ability) → undo it, untapping
      const mine = (state.stack || []).filter((it) => it.source === cur.id && it.player === "you");
      if (mine.length) {
        const it = mine[mine.length - 1];
        act("stack_remove", { index: state.stack.findIndex((i) => i.id === it.id) });
        if (cur.tapped) act("tap", { cards: [cur.id], tapped: false });
        return;
      }
      // 3. in COMBAT, tapping your untapped creature declares the attack —
      // that is what tapping a creature means at this point in the turn.
      // Outside combat E stays a plain tap, for mana and everything else
      if (
        typeCat(cur) === "creature" &&
        !cur.attacking &&
        !cur.tapped &&
        /combat|attack/i.test(state.phase || "")
      ) {
        act("attack", { pairs: [{ attacker: cur.id, target: "agent" }] });
        return;
      }
    }
    // 4. anything else taps/untaps
    act("tap", { cards: [cur.id], tapped: !cur.tapped });
  }
}

// late-loading images grow the pane after we've pinned to the bottom —
// re-pin as each one lands if the reader is still following (capture:
// load events don't bubble)
$("#pane-chat").addEventListener(
  "load",
  (e) => {
    const pane = $("#pane-chat");
    if (e.target.tagName === "IMG" && nearBottom(pane)) pane.scrollTop = pane.scrollHeight;
  },
  true
);

// boot
refresh();
loadBrain();
connectWS();
