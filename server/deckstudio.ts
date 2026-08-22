// Deck studio: one selected Archidekt deck + a board of swap proposals an
// agent files through MCP. The human confirms a proposal in the /swap page,
// which is the ONLY path that writes to Archidekt. Archidekt is the single
// source: deck cards carry their exact printing's art (Scryfall CDN url built
// from the printing uid), and proposal cards are resolved through Archidekt's
// card search — so the page never renders a nameless rectangle, and what you
// see is the printing you own.

import { ArchidektClient, type ArchidektDeck, type ArchidektPrinting, type CardAction } from "./archidekt";

export interface StudioCard {
  name: string;
  qty: number;
  category: string;
  image?: string;
  mana?: string;
  mv: number;
  typeLine?: string;
  oracle?: string;
  colorIdentity?: string[];
  deckRelationId?: number;
  printingId?: number;
}

export interface ProposalOption {
  name: string;
  category: string; // category the card lives in (existing) or would join (add)
  note: string;
  primary?: boolean;
  card?: StudioCard; // hydrated
}

export interface Proposal {
  id: string;
  kind: "cut" | "add"; // cut: subject leaves, options come in · add: subject comes in, options leave
  package?: string;
  why: string;
  card: StudioCard; // the subject
  subjectCategory: string; // for add: category the subject would join
  options: ProposalOption[];
  status: "open" | "applied" | "dismissed";
  chosen?: string;
  createdAt: number;
  appliedAt?: number;
}

export interface Metadata {
  count: number;
  lands: number;
  nonlands: number;
  avgMv: number;
  curve: number[]; // index = mv bucket 0..7 (7 = 7+), nonlands only
  categories: Record<string, number>;
  pips: Record<string, number>;
}

export interface StudioState {
  deckId: number | null;
  deckName: string;
  cards: StudioCard[];
  proposals: Proposal[];
  lastError?: string;
}

export const studio: StudioState = { deckId: null, deckName: "", cards: [], proposals: [] };

let nextProposalId = 1;
const listeners: (() => void)[] = [];
export const onStudioChange = (fn: () => void) => listeners.push(fn);
const changed = () => listeners.forEach((f) => f());

export let archidekt = new ArchidektClient();
export const setArchidektClient = (c: ArchidektClient) => (archidekt = c);

// ─── mana / metadata ────────────────────────────────────────────────────────

export function manaValue(mana: string | undefined): number {
  if (!mana) return 0;
  let mv = 0;
  for (const sym of mana.match(/\{([^}]+)\}/g) ?? []) {
    const s = sym.slice(1, -1);
    if (/^\d+$/.test(s)) mv += Number(s);
    else if (s === "X" || s === "Y" || s === "Z") continue;
    else if (/^\d+\/[WUBRG]$/.test(s)) mv += Number(s.split("/")[0]);
    else mv += 1;
  }
  return mv;
}

const isLand = (c: StudioCard) => /\bLand\b/.test(c.typeLine ?? "") && !/Creature|Instant|Sorcery/.test((c.typeLine ?? "").split("//")[0]);

export function deckMetadata(cards: StudioCard[]): Metadata {
  const m: Metadata = { count: 0, lands: 0, nonlands: 0, avgMv: 0, curve: [0, 0, 0, 0, 0, 0, 0, 0], categories: {}, pips: {} };
  let mvSum = 0;
  for (const c of cards) {
    const q = c.qty;
    m.count += q;
    m.categories[c.category || "Uncategorized"] = (m.categories[c.category || "Uncategorized"] ?? 0) + q;
    if (isLand(c)) {
      m.lands += q;
    } else {
      m.nonlands += q;
      mvSum += c.mv * q;
      m.curve[Math.min(7, Math.max(0, Math.round(c.mv)))] += q;
    }
    for (const sym of (c.mana ?? "").match(/\{([^}]+)\}/g) ?? []) {
      for (const col of sym.slice(1, -1).split("/")) {
        if ("WUBRG".includes(col) && col.length === 1) m.pips[col] = (m.pips[col] ?? 0) + q;
      }
    }
  }
  m.avgMv = m.nonlands ? Math.round((mvSum / m.nonlands) * 100) / 100 : 0;
  return m;
}

/** The deck as it would stand after a proposal option is taken. */
export function applyOption(cards: StudioCard[], p: Proposal, optionName: string): StudioCard[] {
  const opt = p.options.find((o) => o.name.toLowerCase() === optionName.toLowerCase());
  if (!opt) throw new Error(`option "${optionName}" is not on proposal ${p.id}`);
  const leaving = p.kind === "cut" ? p.card.name : opt.name;
  const arriving: StudioCard = p.kind === "cut" ? { ...(opt.card ?? stub(opt.name)), category: opt.category, qty: 1 } : { ...p.card, category: p.subjectCategory, qty: 1 };
  const out: StudioCard[] = [];
  let removed = false;
  for (const c of cards) {
    if (!removed && c.name.toLowerCase() === leaving.toLowerCase()) {
      removed = true;
      if (c.qty > 1) out.push({ ...c, qty: c.qty - 1 });
      continue;
    }
    out.push(c);
  }
  if (!removed) throw new Error(`"${leaving}" is not in the deck`);
  const existing = out.find((c) => c.name.toLowerCase() === arriving.name.toLowerCase());
  if (existing) existing.qty += 1;
  else out.push(arriving);
  return out;
}

const stub = (name: string): StudioCard => ({ name, qty: 1, category: "", mv: 0 });

export function metadataDiff(before: Metadata, after: Metadata) {
  const cats: Record<string, [number, number]> = {};
  for (const k of new Set([...Object.keys(before.categories), ...Object.keys(after.categories)])) {
    const a = before.categories[k] ?? 0;
    const b = after.categories[k] ?? 0;
    if (a !== b) cats[k] = [a, b];
  }
  return { count: [before.count, after.count], lands: [before.lands, after.lands], avgMv: [before.avgMv, after.avgMv], categories: cats };
}

// ─── hydration (Archidekt only) ─────────────────────────────────────────────

function fromPrinting(p: ArchidektPrinting, base: Partial<StudioCard>): StudioCard {
  return {
    name: p.name,
    qty: base.qty ?? 1,
    category: base.category ?? "",
    image: p.image,
    mana: p.mana,
    mv: p.mv,
    typeLine: p.typeLine,
    oracle: p.oracle,
    colorIdentity: p.colorIdentity,
    deckRelationId: base.deckRelationId,
    printingId: p.printingId,
  };
}

const printingCache = new Map<string, ArchidektPrinting>();
/** tests: seed printings so resolution never hits the network */
export const primePrintings = (list: ArchidektPrinting[]) => list.forEach((p) => printingCache.set(p.name.toLowerCase(), p));

async function resolvePrinting(name: string): Promise<ArchidektPrinting | null> {
  const key = name.toLowerCase();
  const cached = printingCache.get(key) ?? [...printingCache.values()].find((p) => p.name.toLowerCase().startsWith(key + " //"));
  if (cached) return cached;
  const p = await archidekt.findPrinting(name);
  if (p) printingCache.set(p.name.toLowerCase(), p);
  return p;
}

/** Resolve names to renderable cards; throws if any name has no commander-legal printing with art. */
async function hydrateNamed(specs: { name: string; category?: string }[]): Promise<Map<string, StudioCard>> {
  const found = await Promise.all(specs.map((s) => resolvePrinting(s.name)));
  const out = new Map<string, StudioCard>();
  const bad: string[] = [];
  specs.forEach((s, i) => {
    const p = found[i];
    if (!p?.image) bad.push(s.name);
    else out.set(s.name.toLowerCase(), fromPrinting(p, { category: s.category ?? "" }));
  });
  if (bad.length) throw new Error(`no commander-legal printing on Archidekt for: ${bad.join(", ")} (use exact names, front face for DFCs)`);
  return out;
}

// ─── deck ───────────────────────────────────────────────────────────────────

function hydrateDeck(d: ArchidektDeck): StudioCard[] {
  return d.cards.filter((c) => c.inDeck).map((c) => fromPrinting(c, { qty: c.quantity, category: c.category, deckRelationId: c.deckRelationId }));
}

export async function selectDeck(deckId: number) {
  const d = await archidekt.getDeck(deckId);
  const cards = hydrateDeck(d);
  if (studio.deckId !== deckId) studio.proposals = [];
  studio.deckId = deckId;
  studio.deckName = d.name;
  studio.cards = cards;
  studio.lastError = undefined;
  lastSync = Date.now();
  changed();
  return studio;
}

export async function refreshDeck() {
  if (!studio.deckId) throw new Error("no deck selected");
  return selectDeck(studio.deckId);
}

let lastSync = 0;
/** Reads always reflect Archidekt: re-fetch the deck unless we did within 10s.
 * Failures keep the last good copy and surface in lastError. */
export async function syncDeck(maxAgeMs = 10_000) {
  if (!studio.deckId || Date.now() - lastSync < maxAgeMs) return;
  lastSync = Date.now();
  try {
    const d = await archidekt.getDeck(studio.deckId);
    const cards = hydrateDeck(d);
    const before = JSON.stringify(studio.cards.map((c) => [c.name, c.qty, c.category]));
    studio.cards = cards;
    studio.deckName = d.name;
    if (before !== JSON.stringify(cards.map((c) => [c.name, c.qty, c.category]))) changed();
  } catch (e: any) {
    studio.lastError = `could not re-read Archidekt: ${e.message}`;
  }
}

export const listDecks = () => archidekt.listMyDecks();

// ─── proposals ──────────────────────────────────────────────────────────────

export interface ProposalInput {
  kind: "cut" | "add";
  card: string;
  category?: string; // add: category the card joins (required)
  package?: string;
  why: string;
  options: { name: string; category?: string; note?: string; primary?: boolean }[];
}

const findDeckCard = (name: string) => studio.cards.find((c) => c.name.toLowerCase() === name.toLowerCase());

export async function propose(input: ProposalInput): Promise<Proposal> {
  if (!studio.deckId) throw new Error("select a deck first (studio_select_deck)");
  if (input.kind !== "cut" && input.kind !== "add") throw new Error("kind must be 'cut' or 'add'");
  if (!input.card) throw new Error("card is required");
  if (!input.why) throw new Error("why is required — say why in one or two sentences");
  if (!input.options?.length) throw new Error("at least one option is required");

  let subject: StudioCard;
  let options: ProposalOption[];
  if (input.kind === "cut") {
    const dc = findDeckCard(input.card);
    if (!dc) throw new Error(`"${input.card}" is not in ${studio.deckName}`);
    subject = dc;
    for (const o of input.options) {
      if (!o.category) throw new Error(`option "${o.name}" needs a category (the deck category it would join)`);
      if (findDeckCard(o.name) && !/^(Plains|Island|Swamp|Mountain|Forest|Wastes)$/i.test(o.name)) throw new Error(`"${o.name}" is already in the deck`);
    }
    const hyd = await hydrateNamed(input.options.map((o) => ({ name: o.name, category: o.category })));
    options = input.options.map((o) => ({ name: hyd.get(o.name.toLowerCase())!.name, category: o.category!, note: o.note ?? "", primary: !!o.primary, card: hyd.get(o.name.toLowerCase()) }));
  } else {
    if (!input.category) throw new Error("category is required for an add: which deck category does the card join?");
    if (findDeckCard(input.card) && !/^(Plains|Island|Swamp|Mountain|Forest|Wastes)$/i.test(input.card)) throw new Error(`"${input.card}" is already in ${studio.deckName}`);
    const hyd = await hydrateNamed([{ name: input.card, category: input.category }]);
    subject = hyd.get(input.card.toLowerCase())!;
    options = input.options.map((o) => {
      const dc = findDeckCard(o.name);
      if (!dc) throw new Error(`cut option "${o.name}" is not in ${studio.deckName}`);
      return { name: dc.name, category: dc.category, note: o.note ?? "", primary: !!o.primary, card: dc };
    });
  }
  if (!options.some((o) => o.primary)) options[0].primary = true;
  const p: Proposal = {
    id: `p${nextProposalId++}`,
    kind: input.kind,
    package: input.package || undefined,
    why: input.why,
    card: subject,
    subjectCategory: input.kind === "add" ? input.category! : subject.category,
    options,
    status: "open",
    createdAt: Date.now(),
  };
  // every option must produce a legal deck state now, not at confirm time
  for (const o of options) applyOption(studio.cards, p, o.name);
  studio.proposals.push(p);
  changed();
  return p;
}

export function withdraw(id: string) {
  const i = studio.proposals.findIndex((p) => p.id === id);
  if (i < 0) throw new Error(`no proposal ${id}`);
  studio.proposals.splice(i, 1);
  changed();
}

export function dismiss(id: string) {
  const p = studio.proposals.find((x) => x.id === id);
  if (!p) throw new Error(`no proposal ${id}`);
  p.status = "dismissed";
  changed();
}

export function clearProposals(includeApplied = false) {
  studio.proposals = includeApplied ? [] : studio.proposals.filter((p) => p.status === "applied");
  changed();
}

/** Archidekt actions for taking `optionName` on proposal `p` against `cards`. */
export async function actionsFor(p: Proposal, optionName: string, cards = studio.cards): Promise<CardAction[]> {
  const opt = p.options.find((o) => o.name.toLowerCase() === optionName.toLowerCase());
  if (!opt) throw new Error(`option "${optionName}" is not on proposal ${p.id}`);
  const leavingName = p.kind === "cut" ? p.card.name : opt.name;
  const arriving = p.kind === "cut" ? { name: opt.name, category: opt.category } : { name: p.card.name, category: p.subjectCategory };
  const leaving = cards.find((c) => c.name.toLowerCase() === leavingName.toLowerCase());
  if (!leaving?.deckRelationId || !leaving.printingId) throw new Error(`"${leavingName}" is not in the deck any more — refresh`);
  const actions: CardAction[] = [];
  if (leaving.qty > 1) {
    actions.push({ action: "modify", printingId: leaving.printingId, deckRelationId: leaving.deckRelationId, category: leaving.category, quantity: leaving.qty - 1 });
  } else {
    actions.push({ action: "remove", printingId: leaving.printingId, deckRelationId: leaving.deckRelationId, category: leaving.category });
  }
  const existing = cards.find((c) => c.name.toLowerCase() === arriving.name.toLowerCase());
  if (existing?.deckRelationId && existing.printingId) {
    actions.push({ action: "modify", printingId: existing.printingId, deckRelationId: existing.deckRelationId, category: existing.category, quantity: existing.qty + 1 });
  } else {
    const known = p.kind === "cut" ? opt.card?.printingId : p.card.printingId;
    const printingId = known ?? (await archidekt.findPrintingId(arriving.name));
    actions.push({ action: "add", printingId, category: arriving.category, quantity: 1 });
  }
  return actions;
}

/** The human confirmed: write to Archidekt, re-read, and mark applied. */
export async function confirm(id: string, optionName?: string): Promise<Proposal> {
  const p = studio.proposals.find((x) => x.id === id);
  if (!p) throw new Error(`no proposal ${id}`);
  if (p.status !== "open") throw new Error(`proposal ${id} is already ${p.status}`);
  const choice = optionName ?? p.options.find((o) => o.primary)?.name ?? p.options[0].name;
  // never write against a stale copy: re-read Archidekt first, and re-check
  // the swap against what is actually there now (Artem may have edited the
  // deck on the site since the proposal was filed)
  const fresh = hydrateDeck(await archidekt.getDeck(studio.deckId!));
  studio.cards = fresh;
  let expected: Metadata;
  try {
    expected = deckMetadata(applyOption(fresh, p, choice));
  } catch (e: any) {
    studio.lastError = `deck changed on Archidekt since this was proposed: ${e.message}`;
    p.status = "dismissed";
    changed();
    throw new Error(studio.lastError);
  }
  const actions = await actionsFor(p, choice, fresh);
  try {
    await archidekt.modifyCards(studio.deckId!, actions);
  } catch (e: any) {
    studio.lastError = e.message;
    changed();
    throw e;
  }
  // trust only what Archidekt says it has now
  const d = await archidekt.getDeck(studio.deckId!);
  const cards = hydrateDeck(d);
  const got = deckMetadata(cards);
  if (got.count !== expected.count) {
    studio.cards = cards;
    studio.lastError = `Archidekt deck count is ${got.count}, expected ${expected.count} after the swap — check the deck`;
    changed();
    throw new Error(studio.lastError);
  }
  studio.cards = cards;
  studio.lastError = undefined;
  p.status = "applied";
  p.chosen = choice;
  p.appliedAt = Date.now();
  // other open proposals that depended on a card that just left are now moot
  for (const q of studio.proposals) {
    if (q.status !== "open") continue;
    try {
      for (const o of q.options) applyOption(studio.cards, q, o.name);
    } catch {
      q.status = "dismissed";
    }
  }
  changed();
  return p;
}

// ─── views ──────────────────────────────────────────────────────────────────

function proposalView(p: Proposal, lean: boolean) {
  const current = deckMetadata(studio.cards);
  const options = p.options.map((o) => {
    let after: Metadata | null = null;
    let error: string | undefined;
    if (p.status === "open") {
      try {
        after = deckMetadata(applyOption(studio.cards, p, o.name));
      } catch (e: any) {
        error = e.message;
      }
    }
    return {
      ...o,
      card: lean ? undefined : o.card,
      after,
      diff: after ? metadataDiff(current, after) : null,
      error,
    };
  });
  return { ...p, card: lean ? { name: p.card.name, category: p.card.category, mana: p.card.mana, mv: p.card.mv, typeLine: p.card.typeLine } : p.card, options };
}

export function studioView(lean = false) {
  return {
    deckId: studio.deckId,
    deckName: studio.deckName,
    lastError: studio.lastError,
    metadata: deckMetadata(studio.cards),
    cards: lean ? studio.cards.map(({ image, oracle, deckRelationId, printingId, ...c }) => c) : studio.cards,
    proposals: studio.proposals.map((p) => proposalView(p, lean)),
  };
}

// ─── persistence ────────────────────────────────────────────────────────────

export function serializeStudio() {
  return { ...studio, nextProposalId };
}

export function restoreStudio(snap: any) {
  if (!snap) return;
  studio.deckId = snap.deckId ?? null;
  studio.deckName = snap.deckName ?? "";
  studio.cards = snap.cards ?? [];
  studio.proposals = snap.proposals ?? [];
  studio.lastError = snap.lastError;
  nextProposalId = snap.nextProposalId ?? studio.proposals.length + 1;
}
