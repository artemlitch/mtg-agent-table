import { act } from "../../api";
import { artFallback } from "../../components/cardArt";
import { previewProps } from "../../components/CardPreview";
import { Text } from "../../components/Text";
import { useGame } from "../../store/game";
import { ui } from "../../store/ui";
import type { StackItem } from "../../types";

/** The action row for a stack item (Resolve / Counter / Take back) — shared by
 *  the Stack tab, the chat widgets and the battlefield lift panels. Renders
 *  nothing when there is nothing to do. */
export function StackItemButtons({ item }: { item: StackItem }) {
  const stack = useGame((s) => s.view?.stack) ?? [];
  const idx = stack.findIndex((i) => i.id === item.id);
  const rows: { label: string; title: string; run: () => void }[] = [];

  // any of the AGENT's items, any position — resolve removes (fizzling if
  // countered), counter marks. Your own items: take back only.
  if (item.player === "agent") {
    rows.push({
      label: "Resolve",
      title: item.countered ? "Fizzle: the countered card goes to its owner's graveyard, no effect" : "Resolve this item",
      run: () => void act("stack_resolve", { item: item.id }),
    });
    rows.push({
      label: item.countered ? "Un-counter" : "Counter",
      title: item.countered ? "Remove the countered mark" : "Mark as countered — it stays on the stack until resolved (then fizzles)",
      run: () => void act("stack_counter", { item: item.id }),
    });
    if (idx >= 0 && idx < stack.length - 1 && stack.slice(idx).every((i) => i.player === "agent")) {
      rows.push({
        label: "Resolve ▲",
        title: "Accept the agent's whole run — this item and everything above it resolve in proposal order",
        run: () => void act("stack_resolve_all", {}),
      });
    }
  } else {
    rows.push({
      label: "Take back",
      title: "Withdraw your own item — the card returns to your hand",
      run: () => void act("stack_remove", { index: idx }),
    });
  }

  if (!rows.length) return null;
  return (
    <div className="sibtns">
      {rows.map((b) => (
        <button
          key={b.label}
          title={b.title}
          onClick={(e) => {
            e.stopPropagation();
            ui().hidePreview();
            b.run();
          }}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}

/** One LIVE stack item, buttons included — the same widget in the Stack tab
 *  and inline in chat. */
export function StackItemEl({ item, inChat }: { item: StackItem; inChat?: boolean }) {
  const stack = useGame((s) => s.view?.stack) ?? [];
  const top = stack.length > 0 && stack[stack.length - 1].id === item.id;
  const cls = [
    "stackitem",
    top && "top",
    item.groupId && "grouped",
    item.countered && "countered",
    inChat && `inchat ${item.player === "you" ? "you" : "agent"}`,
  ]
    .filter(Boolean)
    .join(" ");

  // multi-part announcements (combat damage) render as rows: explicit lines[]
  // from the agent, or a fallback split on "(1) … (2) …" numbering
  let rows = item.lines;
  let headline = item.text;
  if (!rows) {
    const parts = item.text.split(/\s*\(\d+\)\s+/);
    if (parts.length >= 3) {
      headline = parts[0].trim();
      rows = parts.slice(1);
    }
  }

  const card = item.card && !item.card.hidden ? item.card : null;
  return (
    <div className={cls} {...(card ? previewProps(card) : {})}>
      <div className="sihead">
        {card?.image && <img src={card.image} alt="" {...artFallback(card.name)} />}
        <div>
          <div className="siwho">
            {item.player === "you" ? "you" : "agent"}
            {top ? " · TOP" : ""}
            {item.retractable && (
              <span className="siplanned" title="planned follow-up — unwinds if responded below">
                planned
              </span>
            )}
            {item.countered && <span className="ctag">COUNTERED</span>}
          </div>
          <Text as="div" className="sitext">{headline}</Text>
          {rows && rows.length > 0 && (
            <div className="sirows">
              {rows.map((r, i) => (
                <div className="sirow" key={i}>
                  <span className="sirownum">{i + 1}</span>
                  <Text>{r}</Text>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <StackItemButtons item={item} />
    </div>
  );
}
