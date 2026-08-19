/* MTG Agent Table — frontend. Vanilla JS, full re-render on every update. */

const $ = (s) => document.querySelector(s);
let state = null;
let pendingAttach = null; // card id waiting for an attach target
let brainEntries = [];
let agentBusy = false;

// ---------------------------------------------------------------------------
// Server IO
// ---------------------------------------------------------------------------

async function act(type, params = {}) {
  // a pending "respond here" marker attaches to the next response-capable action
  if (pendingRespondAt && (type === "cast" || type === "stack_push")) {
    params = { ...params, respondAt: pendingRespondAt };
    pendingRespondAt = null;
  }
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
// Sound effects — synthesized (Web Audio), triggered off new log entries
// ---------------------------------------------------------------------------

let audioCtx = null;
document.addEventListener(
  "pointerdown",
  () => {
    // browsers only allow audio after a user gesture
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  },
  { capture: true }
);

// shared convolution reverb (synthesized decaying-noise impulse response);
// layers opt in with verb: 0..1 (wet send amount)
let sfxVerb = null;
function getVerb() {
  if (!sfxVerb) {
    sfxVerb = audioCtx.createConvolver();
    const dur = 1.4;
    const len = Math.ceil(audioCtx.sampleRate * dur);
    const buf = audioCtx.createBuffer(2, len, audioCtx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
    }
    sfxVerb.buffer = buf;
    sfxVerb.connect(audioCtx.destination);
  }
  return sfxVerb;
}

function sfxOut(g, verb) {
  g.connect(audioCtx.destination);
  if (verb > 0) {
    const w = audioCtx.createGain();
    w.gain.value = verb;
    g.connect(w).connect(getVerb());
  }
}

function sfxTone(freq, { t = 0, dur = 0.15, type = "sine", vol = 0.1, slide = null, verb = 0, atk = 0.004 } = {}) {
  if (!audioCtx || audioCtx.state !== "running") return;
  const now = audioCtx.currentTime + t;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, now);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, now + dur);
  // short attack ramp: an instant-on envelope clicks, and on low tones the
  // click is all small speakers reproduce — it reads as a high tick
  g.gain.setValueAtTime(0.0001, now);
  g.gain.linearRampToValueAtTime(vol, now + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(dur, atk + 0.01));
  o.connect(g);
  sfxOut(g, verb);
  o.start(now);
  o.stop(now + dur + 0.05);
}

function sfxNoise({ t = 0, dur = 0.08, vol = 0.15, freq = 1000, q = 1, slide = null, verb = 0, atk = 0 } = {}) {
  if (!audioCtx || audioCtx.state !== "running") return;
  const now = audioCtx.currentTime + t;
  const len = Math.ceil(audioCtx.sampleRate * dur);
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const f = audioCtx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.setValueAtTime(freq, now);
  if (slide) f.frequency.exponentialRampToValueAtTime(slide, now + dur);
  f.Q.value = q;
  const g = audioCtx.createGain();
  if (atk > 0) {
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(vol, now + atk);
  } else {
    g.gain.value = vol;
  }
  src.connect(f).connect(g);
  sfxOut(g, verb);
  src.start(now);
}

const SFX = {
  // magical notification: rising chime sparkle
  stack() {
    sfxTone(880, { dur: 0.12, vol: 0.07 });
    sfxTone(1320, { t: 0.07, dur: 0.18, vol: 0.06 });
    sfxTone(1760, { t: 0.13, dur: 0.28, vol: 0.045 });
  },
  // card lands on the field: a clean THUD — one low tone into the reverb
  // (values tuned by Artem in the sound lab)
  thump() {
    sfxTone(95, { dur: 0.22, vol: 0.32, slide: 48, verb: 0.24 });
  },
  // turn over: airy glimmer arpeggio
  glimmer() {
    [660, 880, 1174, 1568, 2093].forEach((f, i) => sfxTone(f, { t: i * 0.09, dur: 0.5, vol: 0.045 }));
  },
  // creature dies (values tuned by Artem in the sound lab)
  hit() {
    sfxNoise({ freq: 430, dur: 0.84, vol: 0.06, q: 2.5, slide: 1400, verb: 0.13 });
    sfxTone(262, { dur: 0.1, vol: 0.13, slide: 926, verb: 0.32 });
  },
  // tap (values tuned by Artem in the sound lab)
  tap() {
    sfxNoise({ freq: 130, dur: 0.15, vol: 0.095, q: 1.5, slide: 1170, verb: 0.23 });
    sfxTone(84, { dur: 0.15, vol: 0.1 });
  },
};

// first matching rule per log entry decides its sound
const SOUND_RULES = [
  ["glimmer", /^— Round \d+:/],
  ["hit", / from battlefield to .*graveyard/],
  ["hit", / countered .* → .*graveyard/],
  ["thump", / resolved → .*battlefield/],
  ["thump", / played .* — land drop/],
  ["stack", /(→ on the stack$)|( put on the stack: )|( proposed the \d+ items )|(declares (attackers|blockers|the turn pass))/],
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
  cats.slice(0, 4).forEach((c, i) => setTimeout(() => SFX[c](), i * 140));
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
  renderNoBlocks();
  processSounds();
  $("#question").textContent = state.pendingQuestion ? `❓ Agent asks: ${state.pendingQuestion}` : "";
}

// one-click decline when locked-in attackers are pointing at you and you have
// no blocks declared — the standoff killer
let noBlocksDeclaredFor = null;

function renderNoBlocks() {
  const btn = $("#btn-noblocks");
  const attackers = state.players.agent.zones.battlefield.filter((c) => c.attacking);
  const sig = attackers.map((c) => c.id).sort().join(",");
  const blocking = state.players.you.zones.battlefield.some((c) => c.blocking);
  const show = attackers.length > 0 && !blocking && noBlocksDeclaredFor !== sig;
  btn.classList.toggle("hidden", !show);
  if (show) {
    btn.onclick = () => {
      noBlocksDeclaredFor = sig;
      btn.classList.add("hidden");
      act("chat", { text: "No blocks." });
    };
  }
}

let pendingRespondAt = null;
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
  if (pendingRespondAt) {
    const chip = document.createElement("div");
    chip.className = "respondchip";
    chip.innerHTML = `responding inside the sequence — the agent's planned items above unwind. Cast/push now, or `;
    const cancel = document.createElement("a");
    cancel.textContent = "cancel";
    cancel.onclick = () => { pendingRespondAt = null; renderStack(); };
    chip.appendChild(cancel);
    bar.appendChild(chip);
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
    (item.id === pendingRespondAt ? " respondat" : "") +
    (opts.inChat ? " inchat " + (item.player === "you" ? "you" : "agent") : "");
  const who = item.player === "you" ? "you" : "agent";
    const img = item.card && !item.card.hidden && item.card.image ? `<img src="${item.card.image}">` : "";
    const planned = item.retractable ? `<span class="siplanned" title="planned follow-up — unwinds if responded below">planned</span>` : "";
    d.innerHTML = `<div class="sihead">${img}<div><div class="siwho">${who}${top ? " · TOP" : ""}${planned}</div><div class="sitext">${item.text}</div></div></div>`;
    if (item.card && !item.card.hidden) {
      d.onmouseenter = (e) => showPreview(item.card, e);
      d.onmousemove = (e) => positionPreview(e);
      d.onmouseleave = hidePreview;
    }
  const btns = stackItemButtons(item);
  if (btns) d.appendChild(btns);
  return d;
}

/** The action row for a stack item (Resolve/Counter/Take back/Respond here) — shared
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
  if (top && item.player === "agent") {
    mk("Resolve", () => act("stack_resolve", {}), "Resolve: permanents → battlefield, spells → graveyard");
    mk("Counter", () => act("stack_counter", {}));
    mk("Take back", () => act("stack_remove", {}), "Remove an illegal/mistaken item — card returns to owner's hand");
  } else if (top) {
    // your own item: the agent resolves it — you can only take it back
    mk("Take back", () => act("stack_remove", {}), "Withdraw your own item — the card returns to your hand");
  } else if (item.player === "agent") {
    // not the top — but when everything above is also the agent's, accepting
    // from here is legal: resolve the whole run (proposal order for groups)
    const idx = state.stack.findIndex((i) => i.id === item.id);
    if (idx >= 0 && state.stack.slice(idx).every((i) => i.player === "agent")) {
      mk("Resolve ▲", () => act("stack_resolve_all", {}), "Accept the agent's whole run — this item and everything above it resolve in proposal order");
    }
    mk("Counter", () => act("stack_counter", { item: item.id }), "Counter this specific item — the card goes to its owner's graveyard");
    mk("Respond here", () => { pendingRespondAt = item.id; renderStack(); renderChat(); },
      "Respond while THIS item is on the stack — the agent's planned items above it unwind (its committed triggers stay)");
  }
  return btns.childNodes.length ? btns : null;
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

/** Stack items whose card would resolve onto p's battlefield — shown as ghosts
    hovering in the slot they'd land in. */
function battlefieldGhosts(p) {
  return (state.stack || []).filter((it) => {
    if (!it.card || it.card.hidden || it.player !== p) return false;
    const tl = it.card.typeLine || "";
    const isSpell = /\b(instant|sorcery)\b/i.test(tl) && !/\bland\b/i.test(tl);
    return (it.resolveTo ?? (isSpell ? "graveyard" : "battlefield")) === "battlefield";
  });
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

function pile(label, count, onClick) {
  const d = document.createElement("div");
  d.className = "pile";
  d.innerHTML = `<div class="pname">${label}</div><div class="pcount">${count}</div>`;
  d.onclick = (e) => {
    e.stopPropagation();
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
  rail.appendChild(pile("Graveyard", ps.counts.graveyard, () => showZoneModal(p, "graveyard")));
  rail.appendChild(pile("Exile", ps.counts.exile, () => showZoneModal(p, "exile")));

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
  for (const c of cards) row.appendChild(cardEl(c));
  // your hand fans out from the center like held cards, poking over the board
  if (p === "you") {
    row.classList.add("fan");
    const mid = (cards.length - 1) / 2;
    [...row.children].forEach((el, i) => {
      el.classList.add("fanned");
      el.style.setProperty("--fan-rot", `${(i - mid) * 4}deg`);
      el.style.setProperty("--fan-y", `${(i - mid) * (i - mid) * 2.4}px`);
      el.style.zIndex = i + 1;
    });
  }
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
  const attached = cards.filter((c) => c.attachedTo);
  const free = cards.filter((c) => !c.attachedTo);
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

  // pixel-based layout: cards never overlap unless attached or dragged there
  const W = Math.max(bf.clientWidth, 400);
  const H = Math.max(bf.clientHeight, 200);
  const CW = 92, CH = 128, GAP = 14;
  const perRow = Math.max(1, Math.floor((W * 0.8) / (CW + GAP)));

  const posMap = {}; // id -> {left, top} px
  const slotFor = (cat, i) => {
    if (cat === "other") {
      const col = Math.floor(i / 3);
      return { left: W - CW - 10 - col * (CW + 10), top: regions.other * (H - CH) + (i % 3) * (CH * 0.45) };
    }
    return {
      left: 8 + (i % perRow) * (CW + GAP),
      top: regions[cat] * (H - CH) + Math.floor(i / perRow) * (CH * 0.55),
    };
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
  // attached cards tuck under their target (chains collapse onto the root)
  const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
  for (const c of attached) {
    let target = byId[c.attachedTo];
    let depth = 1;
    while (target && target.attachedTo && byId[target.attachedTo] && depth < 5) {
      target = byId[target.attachedTo];
      depth++;
    }
    const base = target && posMap[target.id];
    const siblings = attached.filter((a) => a.attachedTo === c.attachedTo);
    const idx = siblings.indexOf(c);
    posMap[c.id] = base
      ? { left: base.left + 16 * (idx + 1), top: base.top + 24 * (idx + 1), under: true }
      : { left: W / 2, top: H / 2 };
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
    if (pos.under) el.classList.add("tucked");
    if (c.controller === "you") makeDraggable(el, c, bf);
    bf.appendChild(el);
  }

  // ghosts: translucent card bobbing in its would-be slot, stack buttons under it
  for (const g of ghosts) {
    const wrap = document.createElement("div");
    wrap.className = "ghostwrap";
    const pos = posMap[g.card.id];
    wrap.style.left = Math.max(0, Math.min(W - CW, pos.left)).toFixed(0) + "px";
    wrap.style.top = Math.max(0, Math.min(H - CH, pos.top)).toFixed(0) + "px";
    const el = cardEl(g.card);
    el.classList.add("ghost");
    el.onclick = (e) => {
      e.stopPropagation();
      hidePreview();
      switchTab("stack");
    };
    wrap.appendChild(el);
    const btns = stackItemButtons(g);
    if (btns) wrap.appendChild(btns);
    bf.appendChild(wrap);
  }

  // spells that DON'T resolve to the battlefield (sorceries, instants,
  // gy-to-hand returns) hover at a casting spot: center of the caster's
  // half, hugging the midline, fanning out if several are up
  const spells = (state.stack || []).filter((it) => {
    if (!it.card || it.card.hidden || it.player !== p) return false;
    const tl = it.card.typeLine || "";
    const isSpell = /\b(instant|sorcery)\b/i.test(tl) && !/\bland\b/i.test(tl);
    return (it.resolveTo ?? (isSpell ? "graveyard" : "battlefield")) !== "battlefield";
  });
  spells.forEach((g, i) => {
    const wrap = document.createElement("div");
    wrap.className = "ghostwrap";
    const left = W / 2 - CW / 2 + (i - (spells.length - 1) / 2) * (CW * 0.65);
    const top = p === "you" ? 10 : H - CH - 16;
    wrap.style.left = Math.max(0, Math.min(W - CW, left)).toFixed(0) + "px";
    wrap.style.top = Math.max(0, top).toFixed(0) + "px";
    const el = cardEl(g.card);
    el.classList.add("ghost", "spell");
    el.onclick = (e) => {
      e.stopPropagation();
      hidePreview();
      switchTab("stack");
    };
    wrap.appendChild(el);
    const btns = stackItemButtons(g);
    if (btns) wrap.appendChild(btns);
    bf.appendChild(wrap);
  });

  // triggered abilities: the source permanent lifts off the board (full color —
  // it's already in play), trigger text + stack buttons underneath
  battlefieldTriggerGhosts(p).forEach(({ item, source }, i) => {
    const pos = posMap[source.id];
    if (!pos) return;
    const wrap = document.createElement("div");
    wrap.className = "ghostwrap";
    wrap.style.left = Math.max(0, Math.min(W - CW, pos.left + 10 + i * 10)).toFixed(0) + "px";
    wrap.style.top = Math.max(0, Math.min(H - CH, pos.top - 14 - i * 10)).toFixed(0) + "px";
    const el = cardEl({ ...source, tapped: false });
    el.classList.add("ghost", "trigger");
    el.onclick = (e) => {
      e.stopPropagation();
      hidePreview();
      switchTab("stack");
    };
    wrap.appendChild(el);
    const chip = document.createElement("div");
    chip.className = "trigchip";
    chip.textContent = item.text.length > 110 ? item.text.slice(0, 110) + "…" : item.text;
    chip.title = item.text;
    wrap.appendChild(chip);
    const btns = stackItemButtons(item);
    if (btns) wrap.appendChild(btns);
    bf.appendChild(wrap);
  });
}
window.addEventListener("resize", () => render());

let draggingNow = false;
let pendingRender = false;
// cards whose first battlefield spot we've already persisted this game
const autoPlaced = new Set();

function makeDraggable(el, c, bf) {
  el.addEventListener("pointerdown", (down) => {
    if (down.button !== 0) return;
    const rect = el.getBoundingClientRect();
    const bfRect = bf.getBoundingClientRect();
    // the table is one continuous surface: drag bounds span BOTH battlefields
    const otherRect = $(bf.id === "bf-you" ? "#bf-agent" : "#bf-you").getBoundingClientRect();
    const minY = Math.min(bfRect.top, otherRect.top) - bfRect.top;
    const maxY = Math.max(bfRect.bottom, otherRect.bottom) - bfRect.top - rect.height;
    const offX = down.clientX - rect.left;
    const offY = down.clientY - rect.top;
    let moved = false;
    const onMove = (mv) => {
      if (!moved && Math.hypot(mv.clientX - down.clientX, mv.clientY - down.clientY) < 6) return;
      if (!moved) {
        moved = true;
        draggingNow = true;
        el.classList.add("dragging");
        el.setPointerCapture?.(down.pointerId);
      }
      el.style.left = Math.max(0, Math.min(bfRect.width - rect.width, mv.clientX - bfRect.left - offX)) + "px";
      el.style.top = Math.max(minY, Math.min(maxY, mv.clientY - bfRect.top - offY)) + "px";
    };
    const onUp = async () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      if (moved) {
        el.classList.remove("dragging");
        el.dataset.dragged = "1";
        draggingNow = false;
        // drop onto another card = attach (that's how equip works)
        const myRect = el.getBoundingClientRect();
        const center = { x: myRect.left + myRect.width / 2, y: myRect.top + myRect.height / 2 };
        // attach-drop works across the whole table, either battlefield
        const targetEl = [...document.querySelectorAll(".battlefield .card.placed")].find((o) => {
          if (o === el || !o.dataset.cardId) return false;
          const r = o.getBoundingClientRect();
          return center.x >= r.left && center.x <= r.right && center.y >= r.top && center.y <= r.bottom;
        });
        if (targetEl) {
          c.attachedTo = targetEl.dataset.cardId; // optimistic — no flash back
          await act("attach", { card: c.id, target: targetEl.dataset.cardId });
        } else {
          if (c.attachedTo) {
            c.attachedTo = null;
            await act("attach", { card: c.id, target: "" });
          }
          const x = Math.max(0, Math.min(1, parseFloat(el.style.left) / Math.max(1, bfRect.width - rect.width)));
          // y stays relative to the own field but may cross the midline
          const y = parseFloat(el.style.top) / Math.max(1, bfRect.height - rect.height);
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

function cardEl(c, opts = {}) {
  const d = document.createElement("div");
  d.className = "card";
  if (c.tapped) d.classList.add("tapped");
  if (c.attacking) d.classList.add("attacking");
  if (c.blocking) d.classList.add("blocking");
  if (pendingAttach === c.id) d.classList.add("attach-source");
  if (opts.small) d.style.cssText = "width:100%;height:auto;aspect-ratio:0.72;";

  if (c.hidden) {
    d.innerHTML = `<img class="cardback" src="card-back.jpg" alt="face-down card" draggable="false">`;
  } else {
    const img = c.image
      ? `<img src="${c.image}" alt="${c.name}" draggable="false">`
      : `<div class="textcard"><b>${c.name}</b><br>${c.mana || ""}<br>${c.typeLine || ""}<br>${(c.oracle || "").slice(0, 120)}${c.power !== undefined && c.power !== null ? `<div class="textpt">${c.power}/${c.toughness}</div>` : ""}</div>`;
    d.innerHTML = c.faceDown ? `<div class="facedown-known">${img}</div>` : img;
    const badges = [];
    for (const [k, v] of Object.entries(c.counters || {})) badges.push(`<span class="badge">${v} ${k}</span>`);
    if (c.attacking) badges.push(`<span class="badge att">⚔ ${c.attacking === "you" ? "You" : c.attacking === "agent" ? "Agent" : "→"}</span>`);
    if (c.blocking) badges.push(`<span class="badge blk">🛡</span>`);
    if (c.attachedTo) {
      const t = cardById(c.attachedTo);
      badges.push(`<span class="badge eq">→ ${t && !t.hidden ? t.name.split(",")[0] : "?"}</span>`);
    }
    if (c.isCommander) badges.push(`<span class="badge">CMDR</span>`);
    if (badges.length) d.innerHTML += `<div class="badges">${badges.join("")}</div>`;
    if (c.isToken) d.innerHTML += `<span class="tokentag">token</span>`;
    // explicit P/T override: drawn over the card's own P/T corner
    if (c.basePower !== undefined && c.zone === "battlefield") {
      d.innerHTML += `<div class="ptbadge" title="printed ${c.basePower}/${c.baseToughness}">${c.power}/${c.toughness}</div>`;
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
    d.onmouseenter = (e) => showPreview(c, e);
    d.onmousemove = (e) => positionPreview(e);
    d.onmouseleave = hidePreview;
  }
  d.onclick = (e) => {
    e.stopPropagation();
    // a drag's release fires a click — swallow it, no menu
    if (d.dataset.dragged) {
      delete d.dataset.dragged;
      return;
    }
    hidePreview();
    if (pendingAttach && pendingAttach !== c.id) {
      act("attach", { card: pendingAttach, target: c.id });
      pendingAttach = null;
      render();
      return;
    }
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
  return d;
}

// ---------------------------------------------------------------------------
// Card preview on hover
// ---------------------------------------------------------------------------

function showPreview(c, e) {
  const pv = $("#cardpreview");
  if ((c.faceCount ?? 1) > 1 && c.faces) {
    // show every face side by side, active one highlighted
    pv.innerHTML =
      `<div class="pv-faces">` +
      c.faces
        .map((f, i) =>
          f.image
            ? `<img src="${f.image}" style="${i === (c.face ?? 0) ? "" : "opacity:0.55"}">`
            : `<div class="pv-text"><b>${f.name}</b>\n${f.typeLine || ""}\n\n${f.oracle || ""}</div>`
        )
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
function positionPreview(e) {
  const pv = $("#cardpreview");
  const wide = pv.querySelector(".pv-faces");
  pv.style.width = wide ? "440px" : "260px";
  const x = Math.min(e.clientX + 18, window.innerWidth - (wide ? 460 : 280));
  const y = Math.min(e.clientY + 12, window.innerHeight - 380);
  pv.style.left = x + "px";
  pv.style.top = Math.max(6, y) + "px";
}
function hidePreview() {
  $("#cardpreview").classList.add("hidden");
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

function openMenu(items, e) {
  const m = $("#menu");
  m.innerHTML = "";
  for (const it of items) {
    const d = document.createElement("div");
    d.className = "mi" + (it.sep ? " sep" : "") + (it.title ? " title" : "");
    d.textContent = it.label;
    if (!it.title)
      d.onclick = () => {
        closeMenu();
        it.fn();
      };
    m.appendChild(d);
  }
  m.classList.remove("hidden");
  const x = Math.min(e.clientX, window.innerWidth - 200);
  const y = Math.min(e.clientY, window.innerHeight - m.offsetHeight - 10);
  m.style.left = x + "px";
  m.style.top = Math.max(4, y) + "px";
}
function closeMenu() {
  $("#menu").classList.add("hidden");
}
document.addEventListener("click", closeMenu);

function moveItem(label, c, params) {
  return { label, fn: () => act("move", { card: c.id, ...params }) };
}

function cardMenu(c, e) {
  const items = [{ label: c.hidden ? "(hidden card)" : c.name, title: true }];
  const owner = c.owner;

  if (c.zone === "hand" && c.controller === "you") {
    if ((c.faceCount ?? 1) > 1 && c.faces) {
      // one Play per face — the chosen face decides land-drop vs stack
      c.faces.forEach((f, i) =>
        items.push({ label: `🌀 Play ${f.name}`, fn: () => act("cast", { card: c.id, face: i }) })
      );
    } else {
      items.push({ label: "🌀 Play → stack", fn: () => act("cast", { card: c.id }) });
    }
    items.push(moveItem("Discard", c, { toZone: "graveyard", toPlayer: owner, note: "discard" }));
    items.push(moveItem("Exile", c, { toZone: "exile", toPlayer: owner }));
    items.push({ label: "Reveal to agent", fn: () => act("reveal", { cards: [c.id], to: "agent" }) });
    items.push({ label: "Reveal to all", fn: () => act("reveal", { cards: [c.id], to: "all" }) });
    items.push(moveItem("Top of library", c, { toZone: "library", toPlayer: owner, position: "top" }));
    items.push(moveItem("Bottom of library", c, { toZone: "library", toPlayer: owner, position: "bottom" }));
  }

  if (c.zone === "battlefield") {
    items.push({ label: c.tapped ? "Untap" : "Tap", fn: () => act("tap", { cards: [c.id], tapped: !c.tapped }) });
    if (c.controller === "you" && !c.attacking) {
      items.push({ label: "⚔ Attack agent", fn: () => act("attack", { pairs: [{ attacker: c.id, target: "agent" }] }) });
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
        fn: () => {
          const v = prompt(`P/T for ${c.name} (e.g. 4/4 — empty resets to printed):`, `${c.power}/${c.toughness}`);
          if (v === null) return;
          const m = v.match(/^\s*([^/\s]+)\s*\/\s*([^/\s]+)\s*$/);
          if (!v.trim()) act("set_pt", { card: c.id });
          else if (m) act("set_pt", { card: c.id, power: m[1], toughness: m[2] });
          else alert("Use the form P/T, e.g. 4/4 (or leave empty to reset)");
        },
      });
    }
    items.push({ label: "+1/+1 counter +", fn: () => act("counters", { card: c.id, kind: "+1/+1", delta: 1 }) });
    items.push({ label: "+1/+1 counter −", fn: () => act("counters", { card: c.id, kind: "+1/+1", delta: -1 }) });
    items.push({
      label: "Other counter…",
      fn: () => {
        const kind = prompt("Counter kind (e.g. loyalty, charge):");
        if (!kind) return;
        const delta = Number(prompt("Delta:", "1") || 1);
        act("counters", { card: c.id, kind, delta });
      },
    });
    items.push({
      label: "Attach to…",
      fn: () => {
        pendingAttach = c.id;
        render();
      },
    });
    if (c.attachedTo) items.push({ label: "Unattach", fn: () => act("attach", { card: c.id, target: "" }) });
    if (c.isToken) {
      items.push({
        label: "🗑 Delete token",
        sep: true,
        fn: () => act("move", { card: c.id, toZone: "graveyard", toPlayer: owner, note: "token removed" }),
      });
    }
    items.push({ label: "To graveyard", sep: !c.isToken, fn: () => act("move", { card: c.id, toZone: "graveyard", toPlayer: owner }) });
    items.push(moveItem("Exile", c, { toZone: "exile", toPlayer: owner }));
    items.push(moveItem("Exile face-down (I may look)", c, { toZone: "exile", toPlayer: owner, faceDown: true, revealTo: "you" }));
    items.push(moveItem("To owner's hand", c, { toZone: "hand", toPlayer: owner }));
    items.push(moveItem("Top of owner's library", c, { toZone: "library", toPlayer: owner, position: "top" }));
    if (c.isCommander) items.push(moveItem("To command zone", c, { toZone: "command", toPlayer: owner }));
    if (c.controller === "agent") items.push(moveItem("😈 Steal — to MY battlefield", c, { toZone: "battlefield", toPlayer: "you", note: "control effect" }));
    if (c.controller === "you" && c.owner === "agent") items.push(moveItem("Return to agent's battlefield", c, { toZone: "battlefield", toPlayer: "agent" }));
  }

  if (c.zone === "command") {
    items.push({ label: "🌀 Cast → stack", fn: () => act("cast", { card: c.id, note: "from command zone" }) });
    items.push(moveItem("▶ Straight to battlefield", c, { toZone: "battlefield", toPlayer: c.controller }));
  }

  if (!c.hidden) {
    // token copy of any visible card (clone effects, Scarab God eternalize, …)
    items.push({
      label: "🪞 Copy as token",
      fn: () => {
        const n = Number(prompt(`Token copies of ${c.name}:`, "1") || 0);
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
    items.push({
      label: "⚡ Ability → stack…",
      fn: () => {
        const text = prompt(`Ability of ${c.hidden ? "this card" : c.name}:`);
        if (text) act("stack_push", { text: `${c.hidden ? "?" : c.name}: ${text}`, source: c.id });
      },
    });
  }

  if (c.zone === "exile" && !c.hidden) {
    items.push(moveItem("▶ Play to MY battlefield", c, { toZone: "battlefield", toPlayer: "you", note: "cast from exile" }));
    items.push(moveItem("To owner's graveyard", c, { toZone: "graveyard", toPlayer: owner }));
    items.push(moveItem("To owner's hand", c, { toZone: "hand", toPlayer: owner }));
  }

  openMenu(items, e);
}

function libraryMenu(p, e) {
  const mine = p === "you";
  const items = [{ label: `${mine ? "Your" : "Agent's"} library`, title: true }];
  if (mine) {
    items.push({ label: "Draw 1", fn: () => act("draw", { n: 1 }) });
    items.push({
      label: "♻ Mulligan (hand → library, draw 7)",
      fn: async () => {
        const hand = state.players.you.zones.hand;
        if (!hand.length) return;
        if (!confirm(`Mulligan: shuffle ${hand.length} cards back and draw 7?`)) return;
        await act("move", { cards: hand.map((c) => c.id), toZone: "library", note: "mulligan" });
        await act("shuffle", { player: "you" });
        await act("draw", { n: 7 });
      },
    });
    items.push({
      label: "Draw N…",
      fn: () => {
        const n = Number(prompt("Draw how many?", "1") || 0);
        if (n > 0) act("draw", { n });
      },
    });
    items.push({
      label: "Scry / peek N…",
      fn: async () => {
        const n = Number(prompt("Look at how many?", "3") || 0);
        if (n > 0) {
          const r = await act("peek", { player: p, n });
          if (r.ok) peekModal(p, r.cards);
        }
      },
    });
    items.push({
      label: "Search library…",
      fn: async () => {
        const r = await act("view_zone", { player: p, zone: "library" });
        if (r.ok) searchModal(p, r.cards);
      },
    });
  } else {
    // interacting with the agent's library = your theft effects
    items.push(moveItem("😈 Exile top face-down (theft)", { id: "top:agent" }, { toZone: "exile", toPlayer: "agent", faceDown: true, revealTo: "you", note: "theft effect" }));
    items.push({ label: "😈 Reveal top card", fn: async () => {
      const r = await act("peek", { player: "agent", n: 1 });
      if (r.ok && r.cards[0]) act("reveal", { cards: [r.cards[0].id], to: "all" });
    }});
    items.push({
      label: "😈 Look at top N…",
      fn: async () => {
        const n = Number(prompt("Look at how many?", "1") || 0);
        if (n > 0) {
          const r = await act("peek", { player: p, n });
          if (r.ok) peekModal(p, r.cards);
        }
      },
    });
    items.push({
      label: "😈 Search agent's library…",
      fn: async () => {
        const r = await act("view_zone", { player: p, zone: "library" });
        if (r.ok) searchModal(p, r.cards);
      },
    });
  }
  items.push({ label: "Reveal top card to all", fn: async () => {
    const r = await act("peek", { player: p, n: 1 });
    if (r.ok && r.cards[0]) act("reveal", { cards: [r.cards[0].id], to: "all" });
  }});
  items.push({ label: "Mill / discard top", fn: () => act("move", { card: `top:${p}`, toZone: "graveyard", toPlayer: p, note: "mill" }) });
  items.push({
    label: "Mill N…",
    fn: async () => {
      const n = Number(prompt("Mill how many?", "3") || 0);
      for (let i = 0; i < n; i++) await act("move", { card: `top:${p}`, toZone: "graveyard", toPlayer: p, note: "mill" });
    },
  });
  items.push({ label: "Shuffle", fn: () => act("shuffle", { player: p }) });
  openMenu(items, e);
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

function openModal(title, bodyEl) {
  const box = $("#modal-box");
  box.innerHTML = `<h3>${title}</h3>`;
  box.appendChild(bodyEl);
  const close = document.createElement("button");
  close.className = "modalclose";
  close.textContent = "Close";
  close.onclick = closeModal;
  box.appendChild(close);
  $("#modal").classList.remove("hidden");
}
function closeModal() {
  $("#modal").classList.add("hidden");
  hidePreview();
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
  const btns = document.createElement("div");
  btns.className = "mcbtns";
  for (const [label, fn] of buttons) {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = fn;
    btns.appendChild(b);
  }
  d.appendChild(btns);
  return d;
}

function showZoneModal(p, zone) {
  const cards = state.players[p].zones[zone];
  const wrap = document.createElement("div");
  wrap.className = "modalcards";
  if (!cards.length) wrap.textContent = "(empty)";
  for (const c of cards) {
    if (c.hidden) {
      const d = document.createElement("div");
      d.className = "modalcard";
      d.innerHTML = `<img class="cardback" src="card-back.jpg" alt="face-down card">`;
      wrap.appendChild(d);
      continue;
    }
    // leaving a graveyard/exile is a game action — it goes ON THE STACK
    // (cast with a declared destination; the agent resolves or responds)
    const viaStack = (label, resolveTo, toPlayer) => [
      `${label} ⚡`,
      () =>
        act("cast", {
          card: c.id,
          resolveTo,
          ...(toPlayer !== "you" ? { resolveToPlayer: toPlayer } : {}),
          note: `from ${zone} → ${toPlayer === "you" ? "your" : "owner's"} ${resolveTo}`,
        }).then(closeModal),
    ];
    wrap.appendChild(
      modalCardEl(c, [
        viaStack("to hand", "hand", c.owner),
        viaStack("to my bf", "battlefield", "you"),
        viaStack("to owner bf", "battlefield", c.owner),
        viaStack(zone === "exile" ? "gy" : "exile", zone === "exile" ? "graveyard" : "exile", c.owner),
      ])
    );
  }
  openModal(`${p === "you" ? "Your" : "Agent's"} ${zone} (${cards.length})`, wrap);
}

function peekModal(p, cards) {
  const wrap = document.createElement("div");
  const grid = document.createElement("div");
  grid.className = "modalcards";
  for (const c of cards) {
    // every button acts immediately; "move to bottom" dims the card,
    // "keep on top" brings it back to the top of the library
    let el;
    el = modalCardEl(c, [
      ["keep on top", () => { act("reorder_top", { player: p, top: [c.id] }); el.classList.remove("bottomed"); }],
      ["move to bottom", () => { act("reorder_top", { player: p, toBottom: [c.id] }); el.classList.add("bottomed"); }],
      ["draw→hand", () => act("move", { card: c.id, toZone: "hand", toPlayer: p }).then(closeModal)],
      ["gy", () => act("move", { card: c.id, toZone: "graveyard", toPlayer: p }).then(closeModal)],
    ]);
    grid.appendChild(el);
  }
  wrap.appendChild(grid);
  openModal(`Top of ${p === "you" ? "your" : "agent's"} library`, wrap);
}

function searchModal(p, cards) {
  const wrap = document.createElement("div");
  const input = document.createElement("input");
  input.placeholder = "filter…";
  input.style.cssText = "width:100%;margin-bottom:8px";
  const grid = document.createElement("div");
  grid.className = "modalcards";
  const renderGrid = () => {
    grid.innerHTML = "";
    const q = input.value.toLowerCase();
    for (const c of cards.filter((c) => c.name.toLowerCase().includes(q))) {
      grid.appendChild(
        modalCardEl(c, [
          ["to hand", () => act("move", { card: c.id, toZone: "hand", toPlayer: p === "you" ? "you" : "you" }).then(closeModal)],
          ["to my bf", () => act("move", { card: c.id, toZone: "battlefield", toPlayer: "you" }).then(closeModal)],
          ["gy", () => act("move", { card: c.id, toZone: "graveyard", toPlayer: p, note: "from library search" }).then(closeModal)],
          ["exile ⬇ (theft)", () => act("move", { card: c.id, toZone: "exile", toPlayer: p, faceDown: true, revealTo: "you", note: "search theft" }).then(closeModal)],
          ["top", () => act("move", { card: c.id, toZone: "library", toPlayer: p, position: "top" }).then(closeModal)],
        ])
      );
    }
  };
  input.oninput = renderGrid;
  renderGrid();
  wrap.appendChild(input);
  wrap.appendChild(grid);
  const sh = document.createElement("button");
  sh.textContent = "Shuffle when done";
  sh.style.marginTop = "10px";
  sh.onclick = () => act("shuffle", { player: p }).then(closeModal);
  wrap.appendChild(sh);
  openModal(`Searching ${p === "you" ? "your" : "agent's"} library`, wrap);
}

// ---------------------------------------------------------------------------
// Side panel: chat / brain / log
// ---------------------------------------------------------------------------

// log lines describing stack traffic — surfaced in chat as inline bubbles.
// "\(on the stack" catches attack/block declarations, phase moves and turn
// passes; the "locked in"/Phase/Round lines are those items resolving.
const STACK_CHAT_RE =
  /(→ on the stack$)|( put on the stack: )|( proposed the \d+ items )|(\(on the stack)|(^Attacks locked in: )|(^Blocks locked in: )|(^Phase: )|(^— Round )|(^Resolved: )|( resolved → )|( countered )|(countered\/removed: )|( back off the stack → )|( removed from the stack: )/;

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
      d.appendChild(document.createTextNode(e.text.replace(/^💬 (Artem|Agent): /, "").replace(/^❓ Agent asks: /, "❓ ")));
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
  const create = (params) => {
    const n = Number(prompt("How many?", "1") || 0);
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

// New-game overlay: fields start EMPTY; links to the currently loaded decks
// are shown for reference. The overlay disappears once the decks load.
function openNewGame() {
  for (const side of ["you", "agent"]) {
    $(`#deck-${side}`).value = "";
    const a = $(`#decklink-${side}`);
    const id = state?.lastDecks?.[side];
    a.textContent = id ? `current: archidekt.com/decks/${id}` : "";
    a.href = id ? `https://archidekt.com/decks/${id}` : "#";
  }
  $("#newgame-overlay").classList.remove("hidden");
  $("#deck-agent").focus();
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
      body: JSON.stringify({ youDeck, agentDeck }),
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


$("#btn-undo").onclick = async () => {
  const res = await fetch("/api/undo", { method: "POST" });
  const data = await res.json();
  if (!data.ok) alert(data.error);
};

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
}
document.querySelectorAll("#tabs button").forEach((b) => {
  b.onclick = () => switchTab(b.dataset.tab);
});

let hoveredCard = null;

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    pendingAttach = null;
    closeMenu();
    closeModal();
    render();
    return;
  }
  // keybinds are inert while typing
  const t = document.activeElement;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
  if ((e.key === "e" || e.key === "E") && hoveredCard) {
    // E taps/untaps the hovered battlefield card (fresh lookup — state may
    // have re-rendered under the cursor since mouseenter)
    const cur = cardById(hoveredCard.id) ?? hoveredCard;
    if (cur.zone === "battlefield") act("tap", { cards: [cur.id], tapped: !cur.tapped });
  }
});

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
