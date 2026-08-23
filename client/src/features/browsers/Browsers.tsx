// The three card browsers. All of them are the same thing — a filter bar over
// a grid of cards whose actions live in the card menu — and differ only in
// where the cards come from and what may be done to them.
import { useState } from "react";
import { act, refresh } from "../../api";
import { ModalFrame } from "../../components/Modal";
import { destButton, runDest } from "../../game/dest";
import { useGame } from "../../store/game";
import { ui } from "../../store/ui";
import type { Card, MoveParams, PlayerId } from "../../types";
import { EMPTY_FILTER, FilterBar, matches, type Filter } from "./FilterBar";
import { HiddenCard, ModalCard, type CardAction } from "./ModalCard";

const whose = (p: PlayerId) => (p === "you" ? "Your" : "Agent's");

/** Filter bar + grid. Every browser below is this plus a card source. */
function Browser({
  title,
  cards,
  actionsFor,
  emptyText = "(empty)",
}: {
  title: string;
  cards: Card[];
  actionsFor: (c: Card) => CardAction[];
  emptyText?: string;
}) {
  const [f, setF] = useState<Filter>(EMPTY_FILTER);
  const shown = cards.filter((c) => matches(f, c));
  return (
    <ModalFrame title={title} header={<FilterBar value={f} onChange={setF} />}>
      <div className="modalcards">
        {!shown.length && (cards.length ? "(no matches)" : emptyText)}
        {shown.map((c) =>
          c.hidden ? <HiddenCard key={c.id} /> : <ModalCard key={c.id} info={c} actions={actionsFor(c)} />
        )}
      </div>
    </ModalFrame>
  );
}

// ── a graveyard or an exile pile ──────────────────────────────────────────
// A VIEW of the pile, not a snapshot of it: exiling a card takes it out of the
// graveyard you are looking at, including when the agent is the one moving it.
function ZoneBrowser({ p, zone }: { p: PlayerId; zone: "graveyard" | "exile" }) {
  const cards = useGame((s) => s.view?.players[p].zones[zone]) ?? [];
  // piles read newest-first: the last card added is the top of the pile
  const list = [...cards].reverse();
  const actionsFor = (c: Card): CardAction[] => {
    // runDest casts anything arriving in play and moves everything else, so
    // the battlefield row here is a real play rather than a silent relocation.
    // Refresh rather than wait for the poll — the card should leave the pile
    // the moment you send it somewhere.
    const move = (params: MoveParams) => void runDest(c, params).then(refresh);
    return [
      destButton("myBattlefield", c, (params) => void runDest(c, { ...params, note: `played from ${zone}` }).then(refresh)),
      destButton("hand", c, move),
      destButton(zone === "exile" ? "graveyard" : "exile", c, move),
      destButton("top", c, move),
      destButton("bottom", c, move),
    ];
  };
  return <Browser title={`${whose(p)} ${zone} (${list.length})`} cards={list} actionsFor={actionsFor} />;
}

export function openZoneBrowser(p: PlayerId, zone: "graveyard" | "exile") {
  ui().openModal({ body: <ZoneBrowser p={p} zone={zone} /> });
}

// ── searching a library ───────────────────────────────────────────────────
// A snapshot: view_zone hands over the whole library once. The window stays
// open through every action (Esc or ✕ closes it) — searches usually take
// several cards — and the card leaves the grid as it leaves the library.
function SearchBrowser({ p, initial }: { p: PlayerId; initial: Card[] }) {
  const [cards, setCards] = useState(initial);
  const actionsFor = (c: Card): CardAction[] => {
    const move = (params: MoveParams) =>
      void runDest(c, params).then(() => setCards((cs) => cs.filter((x) => x.id !== c.id)));
    // a found card always comes to YOUR hand — searching the agent's library
    // is a theft effect, and taking the card is the point
    const found = (params: MoveParams) => move({ ...params, note: "from library search" });
    return [
      destButton("hand", c, move),
      destButton("myBattlefield", c, move),
      destButton("graveyard", c, found),
      destButton("exile", c, found),
      destButton("exileDown", c, found),
      destButton("top", c, move),
      destButton("bottom", c, move),
    ];
  };
  return <Browser title={`${whose(p)} library`} cards={cards} actionsFor={actionsFor} />;
}

export function openSearchBrowser(p: PlayerId, cards: Card[]) {
  ui().openModal({ body: <SearchBrowser p={p} initial={cards} /> });
}

// ── cards someone just revealed ───────────────────────────────────────────
// A snapshot of one reveal, the way it was when it happened: the log line
// names the cards, this puts the cards themselves in front of you. Same
// window as a search, and the same reason for being a snapshot — the reveal
// was a moment, and the visibility grant behind it is wiped the instant a
// card changes zones. Acting on one card drops it from the grid; the rest
// stay, and the window closes on Esc or ✕.
function RevealBrowser({ initial }: { initial: Card[] }) {
  const [cards, setCards] = useState(initial);
  const actionsFor = (c: Card): CardAction[] => {
    const move = (params: MoveParams) =>
      void runDest(c, { ...params, note: "revealed" }).then(() => setCards((cs) => cs.filter((x) => x.id !== c.id)));
    return [
      destButton("hand", c, move),
      destButton("myBattlefield", c, move),
      destButton("graveyard", c, move),
      destButton("exile", c, move),
      destButton("top", c, move),
      destButton("bottom", c, move),
    ];
  };
  return <Browser title={`Revealed (${cards.length})`} cards={cards} actionsFor={actionsFor} emptyText="(nothing left)" />;
}

export function openRevealBrowser(cards: Card[]) {
  ui().openModal({ body: <RevealBrowser initial={cards} /> });
}

// ── scry / surveil ────────────────────────────────────────────────────────
// Every action fires immediately and the window stays open; a card that has
// left the top dims in place rather than vanishing, so you can see what you
// did with the rest of the peek.
function PeekBrowser({ p, cards }: { p: PlayerId; cards: Card[] }) {
  const [bottomed, setBottomed] = useState<Record<string, boolean>>({});
  const mark = (id: string, on: boolean) => setBottomed((b) => ({ ...b, [id]: on }));
  return (
    <ModalFrame title={`Top of ${p === "you" ? "your" : "agent's"} library`}>
      <div className="modalcards">
        {cards.map((c) => {
          const leave = (params: MoveParams) => {
            void runDest(c, params);
            mark(c.id, true);
          };
          return (
            <ModalCard
              key={c.id}
              info={c}
              className={bottomed[c.id] ? "bottomed" : ""}
              actions={[
                ["Keep on top", () => { void act("reorder_top", { player: p, top: [c.id] }); mark(c.id, false); }],
                ["Bottom of library", () => { void act("reorder_top", { player: p, toBottom: [c.id] }); mark(c.id, true); }],
                destButton("hand", c, leave),
                destButton("graveyard", c, leave),
                destButton("exile", c, leave),
              ]}
            />
          );
        })}
      </div>
    </ModalFrame>
  );
}

export function openPeekBrowser(p: PlayerId, cards: Card[]) {
  ui().openModal({ body: <PeekBrowser p={p} cards={cards} /> });
}
