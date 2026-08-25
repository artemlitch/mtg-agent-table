// The card menu: everything you can do to one card, wherever it is. Built as
// data and handed to THE menu — the board, the hand, the command zone and the
// browsers all open this same list.
import { act } from "../../api";
import { destItem } from "../../game/dest";
import { incomingAttackers, isSpellCard, nextUnblockedAttacker, pendingAttackOf, removeAttacker, typeCat } from "../../game/rules";
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
      // one Play per face — the chosen face decides land-drop vs stack, and
      // the [E] rides the face E would actually play: the one showing
      const shown = c.face ?? 0;
      c.faces.forEach((f, i) =>
        items.push({ label: `Play ${f.name}`, ...(i === shown ? { keys: ["E"] } : {}), fn: () => void playCard({ card: c.id, face: i }) })
      );
    } else {
      items.push({ label: "Play → field", keys: ["E"], fn: () => void playCard({ card: c.id }) });
    }
    // the same card, played, plus the thing it does on arrival — one gesture,
    // because reaching for the ability box afterwards is a step you forget.
    // The box plays it on submit, so closing it leaves the card in hand.
    // ...and a spell has no arrival to trigger on — the same box, asked for
    // the thing an instant or a sorcery actually needs saying: its targets
    items.push({ label: isSpellCard(c) ? "Play → with targets…" : "Play → ETB trigger…", keys: ["⇧", "E"], fn: () => openAbilityModal(c) });
    items.push(destItem("graveyard", c, { note: "discard" }));
    items.push(destItem("exile", c));
    items.push({ label: "Reveal to agent", fn: () => void act("reveal", { cards: [c.id], to: "agent" }) });
    items.push({ label: "Reveal to all", fn: () => void act("reveal", { cards: [c.id], to: "all" }) });
    items.push(destItem("top", c), destItem("bottom", c));
  }

  if (c.zone === "battlefield") {
    const pendingAtk = pendingAttackOf(c.id);
    const canAttack = c.controller === "you" && !c.attacking && !pendingAtk;
    const inCombat = /combat|attack/i.test(view.phase || "");
    const yourCombat = inCombat && view.turn === "you";
    // E means "declare", and combat is the one place that word points two
    // ways: in YOUR combat this creature attacks, in the agent's it blocks.
    // The menu leads with whichever one E does. "Attack agent" is not offered
    // at all in the agent's combat — offering it is how an illegal attack
    // declaration reached the stack and had to be taken back.
    const attackers = incomingAttackers();
    const eAttacks = canAttack && typeCat(c) === "creature" && !c.tapped && yourCombat;
    const eBlocks = !yourCombat && c.controller === "you" && !c.tapped && !c.blocking && attackers.length > 0;
    const attackItem: MenuItem = {
      label: "Attack agent",
      ...(eAttacks ? { keys: ["E"] } : {}),
      fn: () => void act("attack", { pairs: [{ attacker: c.id, target: "agent" }] }),
    };
    const tapItem: MenuItem = {
      label: c.tapped ? "Untap" : "Tap",
      ...(eAttacks || eBlocks ? {} : { keys: ["E"] }),
      fn: () => void act("tap", { cards: [c.id], tapped: !c.tapped }),
    };
    // announcing an ability is the second thing you reach for after the main
    // gesture, so it sits directly under it rather than at the bottom
    const abilityItem: MenuItem = { label: "Ability → stack…", keys: ["⇧", "E"], fn: () => openAbilityModal(c) };
    // E answers the attacker nothing of yours is declared against yet
    const eBlockId = eBlocks ? nextUnblockedAttacker()?.id : undefined;
    const blockItems: MenuItem[] =
      c.controller === "you"
        ? attackers.map((a) => ({
            label: `Block ${a.hidden ? "?" : a.name}`,
            ...(a.id === eBlockId ? { keys: ["E"] } : {}),
            fn: () => void act("block", { pairs: [{ blocker: c.id, attacker: a.id }] }),
          }))
        : [];
    const leadBlock = blockItems.findIndex((it) => it.keys);
    if (eAttacks) items.push(attackItem, abilityItem, tapItem);
    else if (leadBlock >= 0) {
      items.push(blockItems[leadBlock], abilityItem, ...blockItems.filter((_, i) => i !== leadBlock), tapItem);
    } else {
      items.push(tapItem, abilityItem);
      if (canAttack && yourCombat) items.push(attackItem);
      items.push(...blockItems);
    }
    if (c.controller === "you" && pendingAtk) {
      items.push({ label: "Remove attacker", fn: () => void removeAttacker(c, pendingAtk) });
    }
    if (c.attacking) items.push({ label: "Cancel attack", fn: () => void act("clear_combat", {}) });
    if (c.power !== undefined && c.power !== null) {
      items.push({
        label: `Set P/T… (now ${c.power}/${c.toughness})`,
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
      items.push({ ...destItem("graveyard", c, { note: "token removed" }), label: "Delete token", sep: true });
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
    // cast like anything else, so that row was this row under another name.
    // The same pair the hand offers, because a commander waiting here is a
    // card of yours waiting to be played — see cardPrimaryAction.
    items.push({ label: "Cast → field", keys: ["E"], fn: () => void playCard({ card: c.id }) });
    items.push({ label: isSpellCard(c) ? "Cast → with targets…" : "Cast → ETB trigger…", keys: ["⇧", "E"], fn: () => openAbilityModal(c) });
  }

  if (!c.hidden) {
    // token copy of any visible card (clone effects, Scarab God eternalize, …)
    items.push({
      label: "Copy as token",
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
    label: c.faceDown ? "Turn face-up" : "Turn face-down",
    fn: () => void act("flip_card", { card: c.id, faceDown: !c.faceDown }),
  });

  if ((c.faceCount ?? 1) > 1 && c.faces) {
    const next = ((c.face ?? 0) + 1) % (c.faceCount ?? 1);
    items.push({ label: `Show ${c.faces[next].name}`, fn: () => void act("set_face", { card: c.id, face: next }) });
  }

  if (c.zone === "exile" && !c.hidden) {
    items.push(
      destItem("myBattlefield", c, { note: "cast from exile" }),
      destItem("putBattlefield", c, { note: "put onto the battlefield from exile" }),
      destItem("graveyard", c),
      destItem("hand", c)
    );
  }

  ui().openMenu(items, e);
}
