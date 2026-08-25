import { createRef, useLayoutEffect, useState, type RefObject } from "react";
import { act } from "../../api";
import { CardEl } from "../../components/Card";
import { artFallback } from "../../components/cardArt";
import { Icon } from "../../components/Icon";
import { ModalFrame } from "../../components/Modal";
import { Text } from "../../components/Text";
import { cardAnchor, placeRect } from "../../game/table";
import { playCard } from "../nextaction/steps";
import { useGame } from "../../store/game";
import { ui } from "../../store/ui";
import type { Card, PlayerId } from "../../types";

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
  // not on the table yet: this box is its arrival trigger, and the play is
  // part of submitting. A commander waiting in the command zone is in exactly
  // the same position as a card in your hand.
  const arriving = c.zone === "hand" || c.zone === "command";
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

/** The table itself, small, beside the box: both battlefields with every card
 *  where it actually sits and in the state it is actually in. Hovering one
 *  raises the full-size preview the board raises; clicking one drops its name
 *  into the input.
 *
 *  It is the REAL board scaled down, not a small board laid out again — the
 *  same felt-local pixels from cardAnchor, in a div the size of the felt,
 *  under one transform. That is what makes a tapped card tapped, a pile a
 *  pile, and an attacker's badge an attacker's badge without this file
 *  knowing what any of those look like. Laying the cards out again at a
 *  smaller size would be a second board to keep in step with the first. */
function TargetPanel({ inputRef }: { inputRef: RefObject<HTMLTextAreaElement | null> }) {
  const view = useGame((s) => s.view);
  // as tall and as wide as the box it stands beside, whatever size that box's
  // own content settled at
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = document.getElementById("modal-box");
    if (!el) return;
    // offset, not client: the box's own border is part of how tall it stands,
    // and these two are meant to line up edge to edge
    const read = () => setFit({ w: el.offsetWidth, h: el.offsetHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const insert = (name: string) => {
    const el = inputRef.current;
    if (!el) return;
    const s = el.selectionStart ?? el.value.length;
    const e = el.selectionEnd ?? s;
    el.setRangeText(`[${name}]`, s, e, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
  };

  const board = placeRect();
  if (!view || !fit || !board) return null;
  const cards = (["agent", "you"] as PlayerId[])
    .flatMap((p) => view.players[p].zones.battlefield)
    .map((c) => ({ c, at: cardAnchor(c) }))
    .filter((x): x is { c: Card; at: NonNullable<ReturnType<typeof cardAnchor>> } => !!x.at)
    // paint order, exactly as the real board sorts it
    .sort((a, b) => (a.c.z ?? 0) - (b.c.z ?? 0));
  const scale = Math.min(fit.w / board.width, fit.h / board.height);

  return (
    <div className="targetpanel" style={{ width: fit.w, height: fit.h }}>
      <div className="tfhint">select one or more targets</div>
      <div
        className="tfboard"
        style={{ width: board.width, height: board.height, transform: `translate(-50%, -50%) scale(${scale})` }}
        /* every control ON a card — the counter chip, the flip button, the
           live badges — is dead in here (pointer-events, in the sheet). The
           menu is the one that opens on the card itself, so it is refused on
           the way down instead. This is a picker, not a second table. */
        onContextMenuCapture={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div className="tfmid" style={{ height: 1 / scale }} />
        {cards.map(({ c, at }) => (
          <CardEl
            key={c.id}
            card={c}
            className="placed"
            style={{ left: at.left - board.left, top: at.top - board.top, zIndex: at.depth > 0 ? Math.max(1, 20 - at.depth) : 21 }}
            // a face-down card has no name to insert, and says so by doing
            // nothing rather than by being left off the table
            onClick={c.hidden || !c.name ? () => {} : () => insert(c.name!)}
          />
        ))}
      </div>
    </div>
  );
}
