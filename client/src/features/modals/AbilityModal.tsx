import { createRef, useState, type RefObject } from "react";
import { act } from "../../api";
import { artFallback } from "../../components/cardArt";
import { previewProps } from "../../components/CardPreview";
import { Icon } from "../../components/Icon";
import { ModalFrame } from "../../components/Modal";
import { Text } from "../../components/Text";
import { isLand } from "../../game/rules";
import { playCard } from "../nextaction/steps";
import { useGame } from "../../store/game";
import { ui } from "../../store/ui";
import type { Card } from "../../types";

/** Announce what a card is doing onto the stack: the card and its oracle text
 *  for reference, one input, Enter submits. The target palette floats beside
 *  the box, outside it.
 *
 *  Which announcement it is comes off the card. One on the battlefield is
 *  activating an ability, and may be tapping to do it. One still in HAND is
 *  not activating anything — it is arriving, so the box is its
 *  enters-the-battlefield trigger, and playing it is part of submitting. */
export function openAbilityModal(c: Card) {
  const input = createRef<HTMLTextAreaElement>();
  ui().openModal({
    compact: true,
    body: <AbilityModal card={c} inputRef={input} />,
    side: <TargetPanel inputRef={input} />,
  });
}

function AbilityModal({ card: c, inputRef }: { card: Card; inputRef: RefObject<HTMLTextAreaElement | null> }) {
  const [text, setText] = useState("");
  const arriving = c.zone === "hand";
  const name = c.hidden ? "?" : c.name;
  const submit = async (tapToo: boolean) => {
    const t = text.trim();
    if (!t) return;
    // The play happens HERE, not on the way in, so a box you opened and
    // thought better of costs you nothing.
    if (arriving && !(await playCard({ card: c.id })).ok) return;
    if (tapToo && !arriving && !c.tapped) void act("tap", { cards: [c.id], tapped: true });
    void act("stack_push", { text: `${name}${arriving ? " enters the battlefield" : ""}: ${t}`, source: c.id });
    ui().closeModal();
  };
  return (
    <ModalFrame title={<><Icon name={arriving ? "battlefield" : "ability"} /> <Text>{c.hidden ? "Hidden card" : c.name}</Text></>}>
      <div className="abilitymodal">
        {c.image ? <img src={c.image} alt="" {...artFallback(c.name)} /> : <Text as="div" className="amoracle">{c.oracle || "(no rules text)"}</Text>}
        <div className="amcol">
          <textarea
            ref={inputRef}
            autoFocus
            placeholder={arriving ? "What happens as it enters? (targets, numbers…)" : "What does the ability do? (targets, numbers…)"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              void submit(e.shiftKey);
            }}
          />
          <div className="ambtns">
            {/* not everything taps to activate: [Tap + Stack] (⇧⏎) vs [Stack]
                (⏎). Nothing pays to enter, so a card arriving gets neither. */}
            {!arriving && (
              <button className="ambtn" onClick={() => void submit(true)}>
                <span><Icon name="tap" /> Tap + Stack</span>
                <small>⇧⏎</small>
              </button>
            )}
            <button className="ambtn accent" onClick={() => void submit(false)}>
              <span><Icon name={arriving ? "battlefield" : "ability"} /> Stack</span>
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
