// The card menu: everything you can do to one card, wherever it is. Built as
// data and handed to THE menu — the board, the hand, the command zone and the
// browsers all open this same list.
import { act } from "../../api";
import { destItem } from "../../game/dest";
import { pendingAttackOf, removeAttacker, typeCat } from "../../game/rules";
import { gameView } from "../../store/game";
import { ui, type Anchor, type MenuItem } from "../../store/ui";
import type { Card } from "../../types";
import { openAbilityModal } from "../modals/AbilityModal";
import { askNumber, askPT, askText } from "../modals/AskText";
import { playCard } from "../nextaction/steps";

export function cardMenu(c: Card, e: Anchor) {
  const view = gameView();
  if (!view) return;
  const items: MenuItem[] = [{ label: c.hidden ? "(hidden card)" : c.name ?? "", title: true }];

  if (c.zone === "hand" && c.controller === "you") {
    if ((c.faceCount ?? 1) > 1 && c.faces) {
      // one Play per face — the chosen face decides land-drop vs stack
      c.faces.forEach((f, i) => items.push({ label: `🌀 Play ${f.name}`, fn: () => void playCard({ card: c.id, face: i }) }));
    } else {
      items.push({ label: "🌀 Play → stack", fn: () => void playCard({ card: c.id }) });
    }
    items.push(destItem("graveyard", c, { note: "discard" }));
    items.push(destItem("exile", c));
    items.push({ label: "Reveal to agent", fn: () => void act("reveal", { cards: [c.id], to: "agent" }) });
    items.push({ label: "Reveal to all", fn: () => void act("reveal", { cards: [c.id], to: "all" }) });
    items.push(destItem("top", c), destItem("bottom", c));
  }

  if (c.zone === "battlefield") {
    const pendingAtk = pendingAttackOf(c.id);
    const canAttack = c.controller === "you" && !c.attacking && !pendingAtk;
    // in combat E declares the attack rather than tapping, so the menu leads
    // with attack there and the [E] hint follows the gesture
    const eAttacks = canAttack && typeCat(c) === "creature" && !c.tapped && /combat|attack/i.test(view.phase || "");
    const attackItem: MenuItem = {
      label: "⚔ Attack agent",
      ...(eAttacks ? { keys: ["E"] } : {}),
      fn: () => void act("attack", { pairs: [{ attacker: c.id, target: "agent" }] }),
    };
    const tapItem: MenuItem = {
      label: c.tapped ? "Untap" : "Tap",
      ...(eAttacks ? {} : { keys: ["E"] }),
      fn: () => void act("tap", { cards: [c.id], tapped: !c.tapped }),
    };
    // announcing an ability is the second thing you reach for after the main
    // gesture, so it sits directly under it rather than at the bottom
    const abilityItem: MenuItem = { label: "⚡ Ability → stack…", keys: ["⇧", "E"], fn: () => openAbilityModal(c) };
    const primary = eAttacks ? attackItem : tapItem;
    const secondary = eAttacks ? tapItem : canAttack ? attackItem : null;
    items.push(primary, abilityItem);
    if (secondary) items.push(secondary);
    if (c.controller === "you" && pendingAtk) {
      items.push({ label: "✖ Remove attacker", fn: () => void removeAttacker(c, pendingAtk) });
    }
    if (c.attacking) items.push({ label: "Cancel attack", fn: () => void act("clear_combat", {}) });
    const attackers = view.players.agent.zones.battlefield.filter((x) => x.attacking);
    if (c.controller === "you" && attackers.length) {
      for (const a of attackers)
        items.push({
          label: `🛡 Block ${a.hidden ? "?" : a.name}`,
          fn: () => void act("block", { pairs: [{ blocker: c.id, attacker: a.id }] }),
        });
    }
    if (c.power !== undefined && c.power !== null) {
      items.push({
        label: `⚔ Set P/T… (now ${c.power}/${c.toughness})`,
        fn: async () => {
          // two dials instead of a "4/4" string to mistype; the printed values
          // are one button away rather than an empty-box convention
          const r = await askPT(`P/T for ${c.name}`, Number(c.power) || 0, Number(c.toughness) || 0);
          if (r === null) return;
          if (r === "printed") void act("set_pt", { card: c.id });
          else void act("set_pt", { card: c.id, power: String(r.power), toughness: String(r.toughness) });
        },
      });
    }
    items.push({
      label: "Other counter…",
      fn: async () => {
        const kind = await askText("Counter kind (e.g. loyalty, charge)");
        if (!kind) return;
        // counters come off as well as on, so this one goes negative
        const delta = await askNumber(`How many ${kind} counters?`, 1, { min: -99 });
        if (delta) void act("counters", { card: c.id, kind, delta });
      },
    });
    if (c.under) items.push({ label: "Pull out of pile", fn: () => void act("tuck", { card: c.id, under: "" }) });
    // A token that leaves the battlefield ceases to exist, so there is nowhere
    // to send it: no graveyard, no exile, no hand, no library. One row that
    // says what actually happens.
    if (c.isToken) {
      items.push({ ...destItem("graveyard", c, { note: "token removed" }), label: "🗑 Delete token", sep: true });
    } else {
      items.push({ ...destItem("graveyard", c), sep: true });
      items.push(destItem("exile", c), destItem("exileDown", c), destItem("hand", c), destItem("top", c));
    }
    if (c.isCommander) items.push(destItem("command", c));
    if (c.controller === "agent") items.push(destItem("steal", c));
    if (c.controller === "you" && c.owner === "agent") items.push(destItem("giveBack", c));
    if (c.controller === "you" && c.owner === "you") items.push(destItem("give", c));
  }

  if (c.zone === "command") {
    // no "straight to battlefield" companion: a commander arriving in play is
    // cast like anything else, so that row was this row under another name
    items.push({ label: "🌀 Cast → stack", fn: () => void playCard({ card: c.id, note: "from command zone" }) });
  }

  if (!c.hidden) {
    // token copy of any visible card (clone effects, Scarab God eternalize, …)
    items.push({
      label: "🪞 Copy as token",
      fn: async () => {
        const n = await askNumber(`Token copies of ${c.name}`, 1, { min: 1, max: 20 });
        if (!n || n <= 0) return;
        const face = c.faces?.[c.face ?? 0] ?? ({} as Record<string, unknown>);
        const pick = (k: string) => (face as any)[k] ?? (c as any)[k];
        void act("create_token", {
          name: pick("name") ?? c.name,
          n,
          player: "you",
          ...(pick("image") ? { image: pick("image") } : {}),
          ...(pick("oracle") ? { oracle: pick("oracle") } : {}),
          ...(pick("typeLine") ? { typeLine: pick("typeLine") } : {}),
          ...(pick("power") !== undefined && pick("power") !== null
            ? { power: pick("power"), toughness: pick("toughness") }
            : {}),
        });
      },
    });
  }

  items.push({
    label: c.faceDown ? "🔍 Turn face-up" : "🙈 Turn face-down",
    fn: () => void act("flip_card", { card: c.id, faceDown: !c.faceDown }),
  });

  if ((c.faceCount ?? 1) > 1 && c.faces) {
    const next = ((c.face ?? 0) + 1) % (c.faceCount ?? 1);
    items.push({ label: `⟳ Show ${c.faces[next].name}`, fn: () => void act("set_face", { card: c.id, face: next }) });
  }

  if (c.zone === "exile" && !c.hidden) {
    items.push(destItem("myBattlefield", c, { note: "cast from exile" }), destItem("graveyard", c), destItem("hand", c));
  }

  ui().openMenu(items, e);
}
