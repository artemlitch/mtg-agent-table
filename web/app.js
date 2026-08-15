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
    }
  };
  ws.onclose = () => setTimeout(connectWS, 1500);
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
    : "No game — load decks and hit New game";
  renderStack();
  renderRail("agent");
  renderRail("you");
  renderHand("agent");
  renderHand("you");
  renderBattlefield("agent");
  renderBattlefield("you");
  renderChat();
  renderLog();
  $("#question").textContent = state.pendingQuestion ? `❓ Agent asks: ${state.pendingQuestion}` : "";
}

function renderStack() {
  const bar = $("#stackbar");
  if (!state.stack || !state.stack.length) {
    bar.classList.add("hidden");
    bar.innerHTML = "";
    return;
  }
  bar.classList.remove("hidden");
  bar.innerHTML = `<span class="stacklabel">THE STACK — top resolves first</span>`;
  [...state.stack].reverse().forEach((item, ri) => {
    const top = ri === 0;
    const d = document.createElement("div");
    d.className = "stackitem" + (top ? " top" : "");
    const who = item.player === "you" ? "you" : "agent";
    const img = item.card && !item.card.hidden && item.card.image ? `<img src="${item.card.image}">` : "";
    d.innerHTML = `${img}<div><div class="siwho">${who}${top ? " · TOP" : ""}</div><div class="sitext">${item.text}</div></div>`;
    if (item.card && !item.card.hidden) {
      d.onmouseenter = (e) => showPreview(item.card, e);
      d.onmousemove = (e) => positionPreview(e);
      d.onmouseleave = hidePreview;
    }
    if (top) {
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
      mk("Resolve", () => act("stack_resolve", {}), "Resolve: permanents → battlefield, spells → graveyard");
      mk("Counter", () => act("stack_counter", {}));
      mk("Take back", () => act("stack_remove", {}), "Remove an illegal/mistaken item — card returns to owner's hand");
      d.appendChild(btns);
    }
    bar.appendChild(d);
  });
}

function renderAgentStatus() {
  const pane = $("#pane-chat");
  const existing = pane.querySelector(".typing-bubble");
  if (agentBusy && !existing) {
    const d = document.createElement("div");
    d.className = "msg agent typing-bubble";
    d.innerHTML = `<span class="tdot"></span><span class="tdot"></span><span class="tdot"></span>`;
    pane.appendChild(d);
    pane.scrollTop = pane.scrollHeight;
  } else if (!agentBusy && existing) {
    existing.remove();
  }
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

  const lb = document.createElement("div");
  lb.className = "lifebox";
  const cmdmg = Object.entries(ps.commanderDamage || {})
    .map(([c, n]) => `${n} from ${c}`)
    .join("<br>");
  lb.innerHTML = `<div class="lname">${name}</div><div class="life">${ps.life}</div>
    <div class="lbtns"><button data-d="-1">−</button><button data-d="1">+</button></div>
    ${cmdmg ? `<div class="cmdmg">${cmdmg}</div>` : ""}
    <div class="deckname" title="${ps.deckName || ""}">${ps.deckName || ""}</div>`;
  lb.querySelectorAll("button").forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    act("life", { player: p, delta: Number(b.dataset.d) });
  }));
  rail.appendChild(lb);

  const lib = pile("Library", ps.counts.library, (e) => libraryMenu(p, e));
  if (p === "you") {
    const drawBtn = document.createElement("button");
    drawBtn.textContent = "🂠 Draw 1";
    drawBtn.style.cssText = "width:100%;margin-top:4px;font-size:11px";
    drawBtn.title = "Draw a card (more options: click the Library count)";
    drawBtn.onclick = (e) => {
      e.stopPropagation();
      act("draw", { n: 1 });
    };
    lib.appendChild(drawBtn);
  }
  rail.appendChild(lib);
  rail.appendChild(pile("Graveyard", ps.counts.graveyard, () => showZoneModal(p, "graveyard")));
  rail.appendChild(pile("Exile", ps.counts.exile, () => showZoneModal(p, "exile")));

  for (const c of ps.zones.command) {
    const el = cardEl(c, { small: true });
    rail.appendChild(el);
  }
}

function renderHand(p) {
  const row = $(`#hand-${p}`);
  row.innerHTML = "";
  for (const c of state.players[p].zones.hand) row.appendChild(cardEl(c));
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
  const autos = { creature: [], land: [], other: [] };
  for (const c of free) if (!c.pos) autos[typeCat(c)].push(c);
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
  for (const c of free) {
    let left, top;
    if (c.pos) {
      left = c.pos.x * (W - CW);
      top = c.pos.y * (H - CH);
    } else {
      const cat = typeCat(c);
      const i = autos[cat].indexOf(c);
      if (cat === "other") {
        const col = Math.floor(i / 3);
        left = W - CW - 10 - col * (CW + 10);
        top = regions.other * (H - CH) + (i % 3) * (CH * 0.45);
      } else {
        left = 8 + (i % perRow) * (CW + GAP) + (c.tapped ? 14 : 0);
        top = regions[cat] * (H - CH) + Math.floor(i / perRow) * (CH * 0.55);
      }
    }
    posMap[c.id] = { left, top };
  }
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
    el.style.left = Math.max(0, Math.min(W - CW, pos.left)).toFixed(0) + "px";
    el.style.top = Math.max(0, Math.min(H - CH, pos.top)).toFixed(0) + "px";
    if (pos.under) el.classList.add("tucked");
    if (c.controller === "you") makeDraggable(el, c, bf);
    bf.appendChild(el);
  }
}
window.addEventListener("resize", () => render());

let draggingNow = false;
let pendingRender = false;

function makeDraggable(el, c, bf) {
  el.addEventListener("pointerdown", (down) => {
    if (down.button !== 0) return;
    const rect = el.getBoundingClientRect();
    const bfRect = bf.getBoundingClientRect();
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
      el.style.top = Math.max(0, Math.min(bfRect.height - rect.height, mv.clientY - bfRect.top - offY)) + "px";
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
        const targetEl = [...bf.querySelectorAll(".card.placed")].find((o) => {
          if (o === el || !o.dataset.cardId) return false;
          const r = o.getBoundingClientRect();
          return center.x >= r.left && center.x <= r.right && center.y >= r.top && center.y <= r.bottom;
        });
        if (targetEl) {
          await act("attach", { card: c.id, target: targetEl.dataset.cardId });
        } else {
          if (c.attachedTo) await act("attach", { card: c.id, target: "" });
          const x = Math.max(0, Math.min(1, parseFloat(el.style.left) / Math.max(1, bfRect.width - rect.width)));
          const y = Math.max(0, Math.min(1, parseFloat(el.style.top) / Math.max(1, bfRect.height - rect.height)));
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
    d.innerHTML = `<div class="cardback">🂠</div>`;
  } else {
    const img = c.image
      ? `<img src="${c.image}" alt="${c.name}" draggable="false">`
      : `<div class="textcard"><b>${c.name}</b><br>${c.mana || ""}<br>${c.typeLine || ""}<br>${(c.oracle || "").slice(0, 120)}</div>`;
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
    d.onmouseenter = (e) => showPreview(c, e);
    d.onmousemove = (e) => positionPreview(e);
    d.onmouseleave = hidePreview;
  }
  d.onclick = (e) => {
    e.stopPropagation();
    hidePreview();
    if (pendingAttach && pendingAttach !== c.id) {
      act("attach", { card: pendingAttach, target: c.id });
      pendingAttach = null;
      render();
      return;
    }
    cardMenu(c, e);
  };
  return d;
}

// ---------------------------------------------------------------------------
// Card preview on hover
// ---------------------------------------------------------------------------

function showPreview(c, e) {
  const pv = $("#cardpreview");
  pv.innerHTML = c.image
    ? `<img src="${c.image}">`
    : `<div class="pv-text"><b>${c.name}</b> ${c.mana || ""}\n${c.typeLine || ""}\n\n${c.oracle || ""}</div>`;
  pv.classList.remove("hidden");
  positionPreview(e);
}
function positionPreview(e) {
  const pv = $("#cardpreview");
  const x = Math.min(e.clientX + 18, window.innerWidth - 280);
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
    items.push({ label: "🌀 Play → stack", fn: () => act("cast", { card: c.id }) });
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
    items.push({ label: "To graveyard", sep: true, fn: () => act("move", { card: c.id, toZone: "graveyard", toPlayer: owner }) });
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

  if (c.zone === "battlefield") {
    items.push({
      label: "⚡ Ability → stack…",
      fn: () => {
        const text = prompt(`Ability of ${c.hidden ? "this card" : c.name}:`);
        if (text) act("stack_push", { text: `${c.hidden ? "?" : c.name}: ${text}` });
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
      d.innerHTML = `<div class="cardback" style="height:120px">🂠</div>`;
      wrap.appendChild(d);
      continue;
    }
    wrap.appendChild(
      modalCardEl(c, [
        ["to hand", () => act("move", { card: c.id, toZone: "hand", toPlayer: c.owner }).then(closeModal)],
        ["to my bf", () => act("move", { card: c.id, toZone: "battlefield", toPlayer: "you" }).then(closeModal)],
        ["to owner bf", () => act("move", { card: c.id, toZone: "battlefield", toPlayer: c.owner }).then(closeModal)],
        ["exile", () => act("move", { card: c.id, toZone: "exile", toPlayer: c.owner }).then(closeModal)],
        ["gy", () => act("move", { card: c.id, toZone: "graveyard", toPlayer: c.owner }).then(closeModal)],
      ])
    );
  }
  openModal(`${p === "you" ? "Your" : "Agent's"} ${zone} (${cards.length})`, wrap);
}

function peekModal(p, cards) {
  const wrap = document.createElement("div");
  const grid = document.createElement("div");
  grid.className = "modalcards";
  const toBottom = new Set();
  for (const c of cards) {
    const el = modalCardEl(c, [
      [
        "bottom: no",
        function () {
          if (toBottom.has(c.id)) {
            toBottom.delete(c.id);
            this.textContent = "bottom: no";
          } else {
            toBottom.add(c.id);
            this.textContent = "BOTTOM";
          }
        },
      ],
      ["draw→hand", () => act("move", { card: c.id, toZone: "hand", toPlayer: p }).then(closeModal)],
      ["gy", () => act("move", { card: c.id, toZone: "graveyard", toPlayer: p }).then(closeModal)],
    ]);
    grid.appendChild(el);
  }
  wrap.appendChild(grid);
  const submit = document.createElement("button");
  submit.textContent = "Apply order (left = top)";
  submit.style.marginTop = "10px";
  submit.onclick = () => {
    const top = cards.map((c) => c.id).filter((id) => !toBottom.has(id));
    act("reorder_top", { player: p, top, toBottom: [...toBottom] }).then(closeModal);
  };
  wrap.appendChild(submit);
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

function renderChat() {
  const pane = $("#pane-chat");
  const stick = pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 40;
  pane.innerHTML = "";
  for (const e of state.log) {
    if (e.text.startsWith("💬") || e.text.startsWith("❓")) {
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
    }
  }
  if (stick) pane.scrollTop = pane.scrollHeight;
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
  d.textContent = e.kind === "tool" ? `🔧 ${e.text}` : e.text;
  pane.appendChild(d);
  if (stick) pane.scrollTop = pane.scrollHeight;
}

function renderBrain() {
  $("#pane-brain").innerHTML = "";
  for (const e of brainEntries) appendBrainEntry(e);
}

// ---------------------------------------------------------------------------
// Top-level controls
// ---------------------------------------------------------------------------

$("#btn-newgame").onclick = async () => {
  const youDeck = $("#deck-you").value.trim();
  const agentDeck = $("#deck-agent").value.trim();
  $("#btn-newgame").textContent = "Loading…";
  $("#btn-newgame").disabled = true;
  try {
    const res = await fetch("/api/new_game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ youDeck, agentDeck }),
    });
    const data = await res.json();
    if (!data.ok) alert("New game failed: " + data.error);
  } finally {
    $("#btn-newgame").textContent = "New game";
    $("#btn-newgame").disabled = false;
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

$("#btn-done").onclick = () => act("done", {});

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
  act("chat", { text });
}
$("#btn-send").onclick = sendChat;
$("#chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendChat();
});

document.querySelectorAll("#tabs button").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll("#tabs button").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    document.querySelectorAll(".tabpane").forEach((x) => x.classList.add("hidden"));
    $(`#pane-${b.dataset.tab}`).classList.remove("hidden");
  };
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    pendingAttach = null;
    closeMenu();
    closeModal();
    render();
  }
});

// boot
refresh();
loadBrain();
connectWS();
