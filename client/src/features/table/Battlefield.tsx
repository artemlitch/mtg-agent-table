// The board. Placement has been torn out: every card — permanent, resolving
// ghost or mid-cast spell — renders at the top-left corner of its controller's
// half. The corner comes from CSS (.battlefield.freeboard .card.placed), so
// there is exactly one place that decides where a card sits, and it is a
// stub waiting for the new drag-and-drop system.
import { CardEl } from "../../components/Card";
import { battlefieldGhosts, battlefieldTriggerGhosts, pendingAttackOf, resolveZoneOf, stackCardsOf } from "../../game/rules";
import { useGame } from "../../store/game";
import { ui } from "../../store/ui";
import type { PlayerId, StackItem } from "../../types";
import { StackItemButtons } from "../stack/StackItem";

export function Battlefield({ p }: { p: PlayerId }) {
  const view = useGame((s) => s.view!);
  const cards = view.players[p].zones.battlefield;
  const ghosts = battlefieldGhosts(p);
  // spells that DON'T resolve to the battlefield (sorceries, instants,
  // graveyard-to-hand returns) still hover over the caster's half
  const spells = stackCardsOf(p).filter((it) => resolveZoneOf(it) !== "battlefield");

  // a trigger on the stack LIFTS its real source card — a state on the card,
  // not a copy (one element per card)
  const lifts = new Map<string, StackItem>();
  for (const { item, source } of battlefieldTriggerGhosts(p)) if (!lifts.has(source.id)) lifts.set(source.id, item);

  return (
    <div className="battlefield freeboard" id={`bf-${p}`}>
      {cards.map((c) => {
        const lift = lifts.get(c.id);
        return (
          <CardEl
            key={c.id}
            card={c}
            className={["placed", c.under && "tucked", lift && "lifted", pendingAttackOf(c.id) && "declaring"].filter(Boolean).join(" ")}
          >
            {lift && (
              <div className="liftpanel">
                <div
                  className="trigchip"
                  title={lift.text}
                  onClick={(e) => {
                    e.stopPropagation();
                    ui().setTab("stack");
                  }}
                >
                  {lift.text.length > 110 ? lift.text.slice(0, 110) + "…" : lift.text}
                </div>
                <StackItemButtons item={lift} />
              </div>
            )}
          </CardEl>
        );
      })}

      {ghosts.map((g) => (
        <Ghost key={g.card!.id} item={g} />
      ))}
      {spells.map((g) => (
        <Ghost key={g.card!.id} item={g} extraClass="spell" />
      ))}
    </div>
  );
}

/** THE card, in its on-the-stack presentation — the SAME .card.placed element
 *  as any board card; "ghost" is a state class, and the stack buttons ride
 *  below as a child panel that doesn't affect the card's bounding box. */
function Ghost({ item, extraClass = "" }: { item: StackItem; extraClass?: string }) {
  const c = item.card!;
  return (
    <CardEl
      card={c}
      className={["placed", "ghost", item.countered && "countered", extraClass].filter(Boolean).join(" ")}
      onClick={() => {
        ui().hidePreview();
        ui().setTab("stack");
      }}
    >
      <div className="liftpanel">
        <StackItemButtons item={item} />
      </div>
    </CardEl>
  );
}
