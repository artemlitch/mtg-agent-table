// Deck Studio page: the selected Archidekt deck, its live metadata, and the
// swap proposals an agent files through MCP. Confirm here = write to Archidekt.

const $ = (s) => document.querySelector(s);
let view = null;
let decks = [];
const selected = {}; // proposalId -> option name the human is looking at
let busyId = null;

async function api(op, body = {}) {
  const res = await fetch(`/api/studio/${op}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function refresh() {
  view = await (await fetch("/api/studio")).json();
  render();
}

async function loadDecks() {
  const sel = $("#deck-select");
  try {
    decks = (await api("decks")).decks;
    sel.innerHTML = `<option value="">— choose a deck —</option>` + decks.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join("");
    if (view?.deckId) sel.value = String(view.deckId);
  } catch (e) {
    sel.innerHTML = `<option value="">decks unavailable: ${esc(e.message)}</option>`;
  }
}

function connectWS() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  ws.onopen = () => $("#conn").classList.add("on");
  ws.onclose = () => {
    $("#conn").classList.remove("on");
    setTimeout(connectWS, 1500);
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "studio") refresh();
  };
}

// ─── rendering ──────────────────────────────────────────────────────────────

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const CURVE_LABELS = ["0", "1", "2", "3", "4", "5", "6", "7+"];

function curveEl(m, before) {
  const max = Math.max(1, ...m.curve, ...(before ? before.curve : []));
  return `<div class="curve">${m.curve
    .map((n, i) => {
      const h = Math.round((n / max) * 48);
      const b = before ? before.curve[i] : n;
      const cls = !before || b === n ? "" : n > b ? "up" : "down";
      const ghost = before && b !== n ? `<i class="ghost" style="height:${Math.round((b / max) * 48)}px"></i>` : "";
      return `<div class="bar">${n ? `<em>${n}</em>` : ""}${ghost}<i class="${cls}" style="height:${h}px"></i><span>${CURVE_LABELS[i]}</span></div>`;
    })
    .join("")}</div>`;
}

function pipsEl(m) {
  const order = ["W", "U", "B", "R", "G"];
  return `<div class="pips">${order
    .filter((c) => m.pips[c])
    .map((c) => `<span class="pip"><img src="pip-${c}.svg" alt="${c}">${m.pips[c]}</span>`)
    .join("")}</div>`;
}

function catsEl(m, diff) {
  const names = Object.keys(m.categories).sort((a, b) => (a === "Commander" ? -1 : b === "Commander" ? 1 : m.categories[b] - m.categories[a]));
  if (diff) for (const k of Object.keys(diff.categories)) if (!names.includes(k)) names.push(k);
  return `<div class="cats">${names
    .map((k) => {
      const n = m.categories[k] ?? 0;
      const d = diff?.categories[k];
      const delta = d ? `<span class="delta ${d[1] < d[0] ? "down" : ""}">${d[0]} → ${d[1]}</span>` : "";
      return `<span class="cat ${diff && !d ? "same" : ""}">${esc(k)} <b>${d ? "" : n}</b>${delta}</span>`;
    })
    .join("")}</div>`;
}

function statsEl(m, title, diff) {
  const f = (k, label) => {
    const d = diff?.[k];
    const changed = d && d[0] !== d[1];
    return `<div class="stat">${label} <b>${changed ? `${d[0]} → ${d[1]}` : m[k]}</b></div>`;
  };
  return `<div class="stats">${title ? `<div class="deckname">${title}</div>` : ""}${f("count", "Cards")}${f("lands", "Lands")}${f("avgMv", "Avg MV")}${pipsEl(m)}</div>`;
}

function renderStrip() {
  const strip = $("#deckstrip");
  if (!view?.deckId) return strip.classList.add("hidden");
  strip.classList.remove("hidden");
  const m = view.metadata;
  strip.innerHTML = statsEl(m, esc(view.deckName)) + catsEl(m) + curveEl(m);
  $("#deck-link").href = `https://archidekt.com/decks/${view.deckId}`;
  const sel = $("#deck-select");
  if (sel.value !== String(view.deckId) && decks.length) sel.value = String(view.deckId);
}

function cardMeta(c) {
  return `${esc(c.mana ?? "")} · ${esc(c.typeLine ?? "")}`.replace(/^ · /, "");
}

function proposalEl(p) {
  const el = document.createElement("section");
  el.className = `prop ${p.status}`;
  el.dataset.id = p.id;
  if (p.status !== "open") {
    const chosen = p.options.find((o) => o.name === p.chosen);
    const leaving = p.kind === "cut" ? p.card : chosen?.card ?? p.card;
    const arriving = p.kind === "cut" ? chosen?.card ?? p.card : p.card;
    el.innerHTML =
      `<div class="receipt"><span class="band ${p.status}">${p.status}</span>` +
      (p.status === "applied"
        ? `<img src="${esc(leaving.image)}" alt="${esc(leaving.name)}"><b>${esc(leaving.name)}</b> → <img src="${esc(arriving.image)}" alt="${esc(arriving.name)}"><b>${esc(arriving.name)}</b>`
        : `<img src="${esc(p.card.image)}" alt="${esc(p.card.name)}"><b>${esc(p.card.name)}</b> <span>${p.kind === "cut" ? "stays" : "not added"}</span>`) +
      `</div>`;
    bindPreviews(el, p);
    return el;
  }

  const selName = selected[p.id] ?? (p.options.find((o) => o.primary) ?? p.options[0]).name;
  const sel = p.options.find((o) => o.name === selName) ?? p.options[0];
  const subjectBand = p.kind === "cut" ? "Cut this" : "Add this";
  const optLabel = p.kind === "cut" ? "Bring in instead" : "Cut for it";

  el.innerHTML = `
    <div class="subject">
      <span class="band ${p.kind}">${subjectBand}</span>
      <img src="${esc(p.card.image)}" alt="${esc(p.card.name)}" data-card="subject">
      <div class="meta">${cardMeta(p.card)} · <b>${esc(p.kind === "cut" ? p.card.category : p.subjectCategory)}</b></div>
      <div class="why">${esc(p.why)}</div>
    </div>
    <div class="arrow">⇄</div>
    <div class="options">
      <div class="optlabel">${optLabel}</div>
      <div class="optlist">${p.options
        .map(
          (o) => `<div class="opt ${o.name === sel.name ? "sel" : ""} ${o.error ? "broken" : ""}" data-opt="${esc(o.name)}" title="${esc(o.error ?? "")}">
            <img src="${esc(o.card?.image)}" alt="${esc(o.name)}">
            ${o.primary ? `<span class="rec">Recommended</span>` : ""}
            <div class="name">${esc(o.name)}</div>
            <span class="cat">${esc(o.category)}</span>
            <div class="note">${esc(o.note)}</div>
          </div>`
        )
        .join("")}</div>
      ${
        sel.after
          ? `<div class="after">
               <div><div class="title">Deck after this swap</div>${statsEl(sel.after, "", sel.diff)}</div>
               <div><div class="title">Categories</div>${catsEl(sel.after, sel.diff)}</div>
               <div><div class="title">Curve</div>${curveEl(sel.after, view.metadata)}</div>
             </div>`
          : `<div class="after"><div class="stat">${esc(sel.error ?? "no metadata")}</div></div>`
      }
      <div class="actions">
        ${busyId === p.id ? `<span class="busy">Writing to Archidekt…</span>` : ""}
        <button data-act="dismiss" ${busyId ? "disabled" : ""}>Dismiss</button>
        <button data-act="confirm" class="accent" ${busyId || sel.error ? "disabled" : ""}>Confirm: ${esc(p.kind === "cut" ? `${p.card.name} → ${sel.name}` : `${sel.name} → ${p.card.name}`)}</button>
      </div>
    </div>`;

  el.querySelectorAll(".opt").forEach((o) => {
    o.onclick = () => {
      selected[p.id] = o.dataset.opt;
      render();
    };
  });
  el.querySelector('[data-act="dismiss"]').onclick = () => api("dismiss", { id: p.id }).catch(showError);
  el.querySelector('[data-act="confirm"]').onclick = async () => {
    busyId = p.id;
    render();
    try {
      await api("confirm", { id: p.id, choice: sel.name });
    } catch (e) {
      showError(e);
    } finally {
      busyId = null;
      refresh();
    }
  };
  bindPreviews(el, p);
  return el;
}

function bindPreviews(el, p) {
  el.querySelectorAll("img").forEach((img) => {
    img.onmouseenter = (e) => showPreview(img.src, e);
    img.onmousemove = positionPreview;
    img.onmouseleave = hidePreview;
  });
}

function render() {
  hidePreview();
  renderStrip();
  const err = $("#error");
  if (view?.lastError) {
    err.textContent = view.lastError;
    err.classList.remove("hidden");
  } else err.classList.add("hidden");

  const board = $("#board");
  board.innerHTML = "";
  if (!view?.deckId) {
    board.innerHTML = `<div class="empty">Pick a deck above, then ask your agent for swap proposals. They appear here as it files them.</div>`;
    return;
  }
  const props = view.proposals;
  if (!props.length) {
    board.innerHTML = `<div class="empty">No proposals yet for ${esc(view.deckName)}. Ask your agent — it files them with <code>studio_propose</code>.</div>`;
    return;
  }
  const open = props.filter((p) => p.status === "open").slice().reverse();
  const done = props.filter((p) => p.status !== "open").slice().reverse();
  const groups = new Map();
  for (const p of open) {
    const k = p.package ?? "";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  let i = 0;
  for (const [pkg, list] of groups) {
    const sec = document.createElement("div");
    sec.className = "pkg";
    if (pkg) sec.innerHTML = `<div class="pkg-head"><span class="tag">Package ${String.fromCharCode(65 + i++)}</span><h2>${esc(pkg)}</h2></div>`;
    else if (groups.size > 1) sec.innerHTML = `<div class="pkg-head"><h2>Standalone</h2></div>`;
    for (const p of list) sec.appendChild(proposalEl(p));
    board.appendChild(sec);
  }
  if (done.length) {
    const sec = document.createElement("div");
    sec.className = "pkg";
    sec.innerHTML = `<div class="pkg-head"><h2>Settled</h2><span class="tag">${done.length}</span></div>`;
    for (const p of done) sec.appendChild(proposalEl(p));
    board.appendChild(sec);
  }
}

function showError(e) {
  const err = $("#error");
  err.textContent = e.message;
  err.classList.remove("hidden");
}

// ─── card preview (same widget as the table) ────────────────────────────────
function showPreview(src, e) {
  const pv = $("#cardpreview");
  pv.innerHTML = `<img src="${src}">`;
  pv.classList.remove("hidden");
  positionPreview(e);
}
function positionPreview(e) {
  const pv = $("#cardpreview");
  const w = 260, h = 364;
  let x = e.clientX + 18, y = e.clientY - h / 2;
  if (x + w > innerWidth) x = e.clientX - w - 18;
  y = Math.max(8, Math.min(innerHeight - h - 8, y));
  pv.style.left = x + "px";
  pv.style.top = y + "px";
}
function hidePreview() {
  $("#cardpreview").classList.add("hidden");
}

// ─── boot ───────────────────────────────────────────────────────────────────
$("#deck-select").onchange = async (e) => {
  const id = Number(e.target.value);
  if (!id) return;
  $("#error").classList.add("hidden");
  try {
    await api("select", { deckId: id });
  } catch (err) {
    showError(err);
  }
};
$("#btn-refresh").onclick = () => api("refresh").catch(showError);

refresh().then(loadDecks);
connectWS();
