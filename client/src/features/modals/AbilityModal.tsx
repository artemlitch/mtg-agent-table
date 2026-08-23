import { createRef, useState, type RefObject } from "react";
import { act } from "../../api";
import { artFallback } from "../../components/cardArt";
import { previewProps } from "../../components/CardPreview";
import { ModalFrame } from "../../components/Modal";
import { isLand } from "../../game/rules";
import { useGame } from "../../store/game";
import { ui } from "../../store/ui";
import type { Card } from "../../types";

/** Announce an ability of a battlefield card onto the stack: the card and its
 *  oracle text for reference, one input, Enter submits. The target palette
 *  floats beside the box, outside it. */
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
  // not everything taps to activate: [Tap + Stack] (⇧⏎) vs [Stack] (⏎)
  const submit = (tapToo: boolean) => {
    const t = text.trim();
    if (!t) return;
    if (tapToo && !c.tapped) void act("tap", { cards: [c.id], tapped: true });
    void act("stack_push", { text: `${c.hidden ? "?" : c.name}: ${t}`, source: c.id });
    ui().closeModal();
  };
  return (
    <ModalFrame title={`⚡ ${c.hidden ? "Hidden card" : c.name}`}>
      <div className="abilitymodal">
        {c.image ? <img src={c.image} alt="" {...artFallback(c.name)} /> : <div className="amoracle">{c.oracle || "(no rules text)"}</div>}
        <div className="amcol">
          <textarea
            ref={inputRef}
            autoFocus
            placeholder="What does the ability do? (targets, numbers…)"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              submit(e.shiftKey);
            }}
          />
          <div className="ambtns">
            <button className="ambtn" onClick={() => submit(true)}>
              <span>⚡ Tap + Stack</span>
              <small>⇧⏎</small>
            </button>
            <button className="ambtn accent" onClick={() => submit(false)}>
              <span>⚡ Stack</span>
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
        {c.image ? <img src={c.image} alt="" {...artFallback(c.name)} /> : <span>{c.name}</span>}
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
