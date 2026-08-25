import { createRef, useState, type RefObject } from "react";
import { act } from "../../api";
import { artFallback } from "../../components/cardArt";
import { previewProps } from "../../components/CardPreview";
import { Icon } from "../../components/Icon";
import { ModalFrame } from "../../components/Modal";
import { Text } from "../../components/Text";
import { isLand } from "../../game/rules";
import { useGame } from "../../store/game";
import { ui } from "../../store/ui";
import type { Card } from "../../types";

/** Which announcement this is. An ability is something the card does while it
 *  sits there, paid for by you; an ETB is what happens on the way in, and the
 *  card has just been played. Same box either way — the difference is what it
 *  offers and how the stack line reads. */
type Announce = "ability" | "etb";

/** Announce something a card is doing onto the stack: an ability of one on the
 *  battlefield, or the enters-the-battlefield trigger of one you have just
 *  played. The card and its oracle text for reference, one input, Enter
 *  submits. The target palette floats beside the box, outside it. */
export function openAbilityModal(c: Card, kind: Announce = "ability") {
  const input = createRef<HTMLTextAreaElement>();
  ui().openModal({
    compact: true,
    body: <AbilityModal card={c} kind={kind} inputRef={input} />,
    side: <TargetPanel inputRef={input} />,
  });
}

function AbilityModal({ card: c, kind, inputRef }: { card: Card; kind: Announce; inputRef: RefObject<HTMLTextAreaElement | null> }) {
  const [text, setText] = useState("");
  const etb = kind === "etb";
  // Tapping is a cost you pay to activate, so it is only on offer for a card
  // that is on the battlefield and could be tapped. Nothing pays to enter.
  const canTap = !etb && c.zone === "battlefield";
  const name = c.hidden ? "?" : c.name;
  const submit = (tapToo: boolean) => {
    const t = text.trim();
    if (!t) return;
    if (tapToo && canTap && !c.tapped) void act("tap", { cards: [c.id], tapped: true });
    void act("stack_push", { text: etb ? `${name} enters the battlefield: ${t}` : `${name}: ${t}`, source: c.id });
    ui().closeModal();
  };
  return (
    <ModalFrame title={<><Icon name={etb ? "battlefield" : "ability"} /> <Text>{c.hidden ? "Hidden card" : c.name}</Text></>}>
      <div className="abilitymodal">
        {c.image ? <img src={c.image} alt="" {...artFallback(c.name)} /> : <Text as="div" className="amoracle">{c.oracle || "(no rules text)"}</Text>}
        <div className="amcol">
          <textarea
            ref={inputRef}
            autoFocus
            placeholder={etb ? "What happens as it enters? (targets, numbers…)" : "What does the ability do? (targets, numbers…)"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              submit(e.shiftKey);
            }}
          />
          <div className="ambtns">
            {/* not everything taps to activate: [Tap + Stack] (⇧⏎) vs [Stack] (⏎) */}
            {canTap && (
              <button className="ambtn" onClick={() => submit(true)}>
                <span><Icon name="tap" /> Tap + Stack</span>
                <small>⇧⏎</small>
              </button>
            )}
            <button className="ambtn accent" onClick={() => submit(false)}>
              <span><Icon name={etb ? "battlefield" : "ability"} /> Stack</span>
              <small>⏎</small>
            </button>
          </div>
        </div>
      </div>
    </ModalFrame>
  );
}

/** Every legal target, click to insert [Card Name] into the input at the
 *  cursor. */
function TargetPanel({ inputRef }: { inputRef: RefObject<HTMLTextAreaElement | null> }) {
  const view = useGame((s) => s.view);
  if (!view) return null;
  const P = view.players;
  const cols: [string, Card[], boolean, Card[]][] = [
    ["My field", P.you.zones.battlefield, false, []],
    ["Agent field", P.agent.zones.battlefield, false, []],
    ["My hand", P.you.zones.hand, false, []],
    ["My graveyard", [...P.you.zones.graveyard].reverse(), true, [...P.you.zones.exile].reverse()],
    ["Agent graveyard", [...P.agent.zones.graveyard].reverse(), true, [...P.agent.zones.exile].reverse()],
  ];
  const insert = (name: string) => {
    const el = inputRef.current;
    if (!el) return;
    const s = el.selectionStart ?? el.value.length;
    const e = el.selectionEnd ?? s;
    el.setRangeText(`[${name}]`, s, e, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
  };
  return (
    <div className="targetpanel">
      {cols.map(([title, cards, collapsed, exileCards]) => (
        <TargetColumn
          key={title}
          title={title}
          cards={cards}
          startCollapsed={collapsed}
          exileCards={exileCards}
          onPick={insert}
        />
      ))}
    </div>
  );
}

const sortLandsLast = (arr: Card[]) => [...arr].sort((a, b) => Number(isLand(a)) - Number(isLand(b)));

function TargetColumn({
  title,
  cards,
  exileCards,
  startCollapsed,
  onPick,
}: {
  title: string;
  cards: Card[];
  exileCards: Card[];
  startCollapsed: boolean;
  onPick: (name: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(startCollapsed);
  const item = (c: Card) =>
    c.hidden || !c.name ? null : (
      <div key={c.id} className="titem" {...previewProps(c)} onClick={() => onPick(c.name!)}>
        {c.image ? <img src={c.image} alt="" {...artFallback(c.name)} /> : <Text>{c.name}</Text>}
      </div>
    );
  return (
    <div className={`tcol${collapsed ? " collapsed" : ""}`}>
      <div className="tcolhead" title="Toggle" onClick={() => setCollapsed((c) => !c)}>
        {title}
      </div>
      <div className="tlist">
        {sortLandsLast(cards).map(item)}
        {exileCards.some((c) => !c.hidden) && <div className="tsub">Exile</div>}
        {exileCards.some((c) => !c.hidden) && sortLandsLast(exileCards).map(item)}
      </div>
    </div>
  );
}
