# Scryfall oracle tags for Commander deckbuilding

Verified 2026-09-10. Counts are Commander-legal cards returned by
`otag:<tag> legal:commander` on Scryfall that day. Every tag (4530
primary tags plus 850 aliases) is in `oracle-tags-all.tsv` next
to this file; grep it before probing a tag name by hand. Scryfall's own
browsable list is https://scryfall.com/docs/tagger-tags.

## How otag: behaves (the parts that bit us)

- **Tag names are slugs**: lowercase, hyphenated (`otag:lifegain-matters`, not
  `otag:lifegain_matters` or `otag:"lifegain matters"`).
- **A wrong slug returns 0 results, not an error.** Zero is ambiguous: no such
  tag, or tag with no Commander-legal cards. Check the TSV before concluding
  the effect family doesn't exist.
- **Umbrella tags include every descendant.** `otag:removal` has zero direct
  taggings on Tagger but returns ~6,000 cards because `removal-creature`,
  `spot-removal`, `sweeper`... all sit under it. Search the umbrella first to
  see the whole family, then narrow.
- **Prefix grammar** (consistent across the catalogue):
  - `gives-X` grants X to *other* things; `gains-X` only to itself.
  - `repeatable-X` is the engine version of X (on a permanent, or reusable).
  - `synergy-X` cares about X; `hate-X` punishes or shuts off X.
  - `removal-<what>` / `tutor-<what>` / `reanimate-<what>` / `regrowth-<what>`:
    suffix is the card type it hits or fetches.
  - `tutor-to-<zone>` is the destination.
  - `reanimate` = graveyard to battlefield, `regrowth` = to hand,
    `restock` = to library, `rescue` = bounce your own thing (not recursion).
  - `impulse` = look at top N keep some (blue/green); `impulsive-draw` = exile
    top and play it (red). Different tags, different decks.
  - `loot` = draw then discard; `rummage` = discard then draw.
  - `typal-<creature type>` for tribal payoffs. `tribal-*` is the old
    spelling and still works as an alias, as do many other old names
    (`acceleration` = `ramp`, `afterlife` = `leaves-body-behind`).
- **Tags are human-curated and incomplete.** A big family (>200) is near
  complete; a family under ~30 is a hint, not an enumeration. For those,
  also run an `o:` oracle search on the exact rules phrase.
- **Amplifiers never carry the theme's tag.** Cards that double a trigger
  class (`otag:trigger-doubler`, `otag:copy-ability`) are their own family;
  search them separately for any commander whose value is a trigger.

## Curated tags by deckbuilding job

Format: `otag:` slug, Commander-legal count, what it means.

### Umbrella tags (search the whole family at once)

These have few or no direct taggings on Tagger but `otag:` returns every descendant, so they are the widest nets. Narrow with the children listed under each family below.

| tag | cards | meaning |
|---|---:|---|
| `removal` | 6146 | every removal family |
| `tutor` | 1106 | every tutor family |
| `draw` | 4011 | every draw family |
| `ramp` | 2125 | every ramp family |
| `recursion` | 2125 | reanimate + regrowth + restock |
| `hate` | 4356 | every hate-* tag; stax and hosers |
| `protection` | 1259 | every protects-* and gives-hexproof style tag |
| `mill` | 1191 | every mill-* tag |
| `typal` | 2673 | every typal-<tribe> tag |
| `burn` | 2877 | every burn-* tag |
| `flicker` | 180 | every flicker-* tag |
| `animate` | 602 | turns noncreatures into creatures |
| `control-changing-effects` | 737 | theft, threaten, donate, exchange |
| `castable-from-nonhand` | 854 | cast from exile, graveyard, library, top |
| `impulse-to-zone` | 126 | impulse-* (look at top N, keep some) |
| `commander-matters` | 44 | cares about commander mechanics |
| `dice-roll` | 113 | every dice tag |

### Removal

Prefix `removal-` is by what it hits or how; `spot-` / `multi-` / `sweeper` is by how many. `repeatable-removal` is the engine subset.

| tag | cards | meaning |
|---|---:|---|
| `spot-removal` | 4961 | one target |
| `multi-removal` | 654 | more than one, less than all |
| `sweeper` | 901 | board wipes |
| `sweeper-one-sided` | 220 | wipes that spare your side |
| `sweeper-graveyard` | 79 | wipes graveyards |
| `repeatable-removal` | 1689 | removal on a permanent or repeatable ability |
| `removal-creature` | 5243 |  |
| `removal-artifact` | 1117 |  |
| `removal-enchantment` | 976 |  |
| `removal-planeswalker` | 1832 |  |
| `removal-land` | 478 |  |
| `removal-nonland` | 356 | any nonland permanent |
| `removal-permanent` | 180 | any permanent |
| `removal-destroy` | 1657 |  |
| `removal-exile` | 553 |  |
| `removal-bounce` | 418 |  |
| `removal-sacrifice` | 407 | edicts |
| `removal-toughness` | 568 | -X/-X style |
| `removal-fight` | 135 | fight and bite |
| `removal-tuck` | 138 | to library |
| `disenchant-naturalize` | 222 | artifact or enchantment, your choice |
| `abrade` | 40 | damage creature or kill artifact, modal |
| `doom-blade` | 73 | 2-mana conditional creature kill |
| `swap-removal` | 113 | they get something in return |
| `humble` | 112 | nerf as removal |
| `pacifism` | 88 | can't attack or block |
| `lockdown-creature` | 105 | never untaps |
| `freeze-creature` | 174 | skips next N untaps |
| `banish` | 145 | O-Ring style exile-while-here |
| `mass-land-denial` | 106 | Armageddon class |
| `mass-shrink` | 45 | team -X/-X |
| `one-sided-fight` | 157 | bite |
| `extract` | 31 | exile from library, gone |
| `lobotomy` | 35 | exile all copies by name |

### Counterspells and stack

| tag | cards | meaning |
|---|---:|---|
| `counterspell` | 517 | hard counters |
| `counterspell-soft` | 133 | unless they pay |
| `counterspell-creature` | 46 | Counterspells that call out creatures specifically |
| `counterspell-noncreature` | 29 | Counterspells that call out noncreatures specifically |
| `counterspell-reusable` | 67 | on a permanent |
| `counterspell-ability` | 47 | Stifle class |
| `counterspell-exile` | 40 | counter and exile |
| `hate-counterspell` | 143 | can't be countered / punishes counters |
| `gives-uncounterable` | 32 |  |
| `silence` | 36 | no spells this turn |
| `remove-from-stack` | 42 | Cards that remove spells from the stack without countering them |
| `change-target` | 42 | redirect |
| `copy-spell` | 177 | copy any spell |
| `copy-instant` | 136 |  |
| `copy-sorcery` | 131 |  |
| `copy-ability` | 42 | Strionic Resonator class |
| `trigger-doubler` | 37 | triggers an additional time |
| `gives-flash` | 53 |  |

### Stax, taxes, and hosers

`hate-X` means punishes or shuts off X. `rhystic` can be bought off, `toll` cannot.

| tag | cards | meaning |
|---|---:|---|
| `hatebear` | 60 | cheap disruptive body |
| `rhystic` | 231 | opponents may pay to stop it |
| `toll` | 197 | opponents pay you, no opt-out |
| `tax-attack` | 41 | pay to attack |
| `cost-increaser` | 53 |  |
| `prevent-attack` | 146 |  |
| `prevent-blocker` | 290 |  |
| `prevent-cast` | 79 | Meddling Mage class |
| `prevent-activation` | 83 |  |
| `stasis` | 35 | limits untapping |
| `doesn-t-untap` | 40 | Cards that prevent their own untapping in some way |
| `hate-graveyard` | 407 | graveyard hosers |
| `hate-artifact` | 190 |  |
| `hate-enchantment` | 41 |  |
| `hate-attacker` | 351 | punishes attackers |
| `hate-blocker` | 433 | punishes blockers |
| `hate-flying` | 204 |  |
| `hate-discard` | 129 | anti-discard |
| `hate-lifegain` | 32 |  |
| `hate-token` | 30 |  |
| `hate-nonbasic-land` | 76 |  |
| `hate-high-mv` | 82 | Chalice class |
| `hate-high-pt` | 179 | Wrath of God for fatties, Meekstone |
| `hate-tapped` | 155 | punishes tapped permanents |
| `hate-full-hand` | 57 | Black Vise class |
| `hate-target` | 278 | punishes targeting |
| `hate-color` | 590 | all color hosers; children hate-white, hate-blue, hate-black, hate-red, hate-green |
| `draw-hate` | 52 | Spirit of the Labyrinth class |
| `punisher` | 153 | choose your doom |
| `group-slug` | 804 | hurts every opponent |
| `symmetrical` | 832 | hurts everyone equally; check if you break the symmetry |
| `aikido` | 173 | turns their strength on them |

### Card advantage and selection

`pure-draw` has no discard or sacrifice cost. `draw-engine` is repeatable, `burst-draw` is one-shot for 3+.

| tag | cards | meaning |
|---|---:|---|
| `pure-draw` | 3085 | Spells and abilities that let you draw (a) card(s) without discarding other cards or sacrificing other permanents |
| `repeatable-pure-draw` | 1279 | Repeatable ways to draw a card with no additional cost or sacrifice, such as discarding a card |
| `draw-engine` | 1470 | repeatable, nets cards over time |
| `burst-draw` | 554 | 3+ cards at once |
| `cantrip` | 618 | replaces itself |
| `delayed-cantrip` | 58 | draw next turn |
| `card-advantage` | 5739 | umbrella: draw, tutors, impulse, regrowth; too wide on its own |
| `repeatable-card-advantage` | 2487 | Things that give you access to more cards, repeatably |
| `manaless-value` | 203 | value with no mana |
| `curiosity` | 228 | draw on damage to opponent |
| `curiosity-like` | 318 | draw on other damage |
| `saboteur` | 928 | trigger on damage to a player |
| `loot` | 400 | draw then discard |
| `rummage` | 268 | discard then draw |
| `repeatable-loot` | 228 |  |
| `repeatable-rummage` | 127 |  |
| `plunder` | 203 | sacrifice to draw |
| `repeatable-plunder` | 129 |  |
| `life-for-cards` | 287 | Phyrexian Arena class |
| `tome` | 145 | tap-to-draw artifacts |
| `impulse` | 549 | look at top N, keep some to hand |
| `impulsive-draw` | 251 | exile top, play it this turn (red draw) |
| `repeatable-impulsive-draw` | 161 |  |
| `long-term-impulsive-draw` | 110 | play it later, not just this turn |
| `precognition-engine` | 45 | play off the top |
| `top-matters` | 76 | The top card of your library matters for purposes other than playing it or drawing it |
| `scry` | 448 | the keyword |
| `surveil` | 275 | the keyword |
| `scry-like` | 47 |  |
| `peek-library` | 921 | Look at some number of cards from the top of libraries |
| `peek-hand` | 220 | Take a quick look at a players hand |
| `mulch` | 166 | filter top, rest to graveyard |
| `consult` | 208 | dig until you hit |
| `wheel-one-sided` | 88 | Wheel effects that affect one player (usually you) |
| `wheel-symmetrical` | 45 | Wheel effects that effect each player, sometimes with no choice on whether they want to or not |
| `miniwheel` | 38 | discard hand, draw fewer than 7 |
| `force-draw` | 313 | make opponents draw |
| `draw-matters` | 167 | payoffs for drawing |
| `second-draw-matters` | 69 | Cards that care when the player casting or controlling them draws their second card for the turn |
| `hand-size-matters` | 269 |  |
| `hand-size-increase` | 47 | no max hand size |

### Tutors

`tutor-to-X` is the destination, `tutor-<type>` the target.

| tag | cards | meaning |
|---|---:|---|
| `tutor-to-hand` | 574 | Cards that tutor cards to the player's hand |
| `tutor-to-battlefield` | 468 | Cards that tutor something out of the library and straight onto the battlefield |
| `tutor-to-top` | 50 | Cards that tutor something and put it on the top of the library |
| `tutor-to-graveyard` | 29 | entomb class |
| `tutor-card` | 94 | any card |
| `tutor-creature` | 191 | Cards that tutor creature cards |
| `tutor-artifact` | 66 | Cards that tutor artifact cards |
| `tutor-mv` | 102 | by mana value |
| `tutor-land-basic` | 396 | Cards that tutor basic land cards |
| `tutor-land-any` | 38 | Tutors with restricted effects that are able to search for any land |
| `tutor-land-to-battlefield` | 306 |  |
| `tutors-by-name` | 140 | These cards tutor other cards by their name |
| `wish` | 42 | outside the game |
| `tutor-self` | 23 | puts itself somewhere |

### Mana

`ramp` is broad. `mana-rock` needs to net mana; `utility-mana-rock` does something else too. `refund`/`mini-refund`/`full-refund` is how much you get back on cast.

| tag | cards | meaning |
|---|---:|---|
| `land-ramp` | 578 | lands to battlefield |
| `multi-land-ramp` | 150 | 2+ lands |
| `mana-dork` | 414 | Creatures which can repeatedly generate mana |
| `mana-rock` | 350 | Noncreature artifacts that net increase your mana |
| `utility-mana-rock` | 224 | Mana rocks that do extra things |
| `mana-egg` | 33 | sacrifice for mana |
| `mana-producer` | 870 | nonland mana source |
| `adds-multiple-mana` | 479 | Cards that net you more than one mana at a time |
| `mana-increaser` | 52 | doublers |
| `mana-filter` | 212 | fix colors |
| `ritual` | 59 | one-shot mana spells |
| `refund` | 663 | Immediately get mana or untapped lands back |
| `mini-refund` | 329 | Immediately gives you a small amount of mana or untapped lands back (typically no more than about one-third of the mana cost you paid) |
| `full-refund` | 89 | free or better |
| `mana-storage` | 78 | Cards that can be used to store mana for later phases and/or turns |
| `restricted-mana` | 209 | only for X |
| `non-mana-ability-mana` | 181 | makes mana but is not a mana ability (targets, uses stack) |
| `cost-reducer` | 297 | Cards that make other spells cost less |
| `cost-reducer-creature` | 68 |  |
| `cost-reducer-instant-sorcery` | 38 |  |
| `cost-ignorer` | 874 | cast for free or fixed cost |
| `free-cast-another` | 366 | cast others for free |
| `extra-land` | 152 | extra land drops from hand or graveyard |
| `play-additional-land` | 39 |  |
| `sneak-land` | 68 | lands onto battlefield without playing |
| `landfall` | 265 | Cards which reward you for playing lands |
| `lands-matter` | 509 |  |
| `land-count-matters` | 115 |  |
| `combat-ramp` | 190 | mana from attacking |
| `repeatable-treasures` | 189 |  |
| `energy-generator` | 135 | Cards that in some way give you energy counters |
| `untapper-land` | 159 |  |
| `untapper-creature` | 480 |  |
| `untapper-artifact` | 114 |  |
| `extra-untap` | 97 | mass untap |
| `mana-sink` | 1786 | 3+ mana repeatable outlet |
| `bottomless-mana-sink` | 754 | wins with infinite mana |
| `utility-land` | 614 |  |
| `rainbow-land` | 99 | any color |
| `filterland` | 72 | Lands that take one mana and give you back another colour of mana, sometimes in greater quantities |
| `creatureland` | 52 | manlands |
| `land-conversion` | 77 | changes land types |
| `chromatic-lantern` | 55 | lands tap for any color |

### Tokens and go-wide

| tag | cards | meaning |
|---|---:|---|
| `repeatable-creature-tokens` | 1363 | Repeatable ways to create creature tokens |
| `repeatable-artifact-tokens` | 531 |  |
| `repeatable-noncreature-tokens` | 409 | Repeatable ways to create noncreature tokens |
| `repeatable-clues` | 78 |  |
| `repeatable-food` | 54 |  |
| `multiple-bodies` | 839 | one-shot 2+ creatures |
| `enters-in-company` | 461 | creature that brings friends |
| `temporary-token` | 196 |  |
| `donate-token` | 175 | tokens to opponents |
| `copy-token` | 52 | Effects that copy specifically tokens, like populate |
| `synergy-token` | 216 |  |
| `synergy-token-creature` | 105 |  |
| `anthem` | 500 | team +N/+N |
| `keyword-anthem` | 494 | team keyword |
| `power-boost-to-all` | 1158 | Cards that provide power to all creatures you control |
| `toughness-boost-to-all` | 910 |  |
| `overrun` | 64 | trample plus pump |
| `creature-count-matters` | 310 |  |
| `warlord` | 76 | P/T = creatures you control |

### Counters and proliferate

`gives-` puts counters on others, `gains-` only on itself.

| tag | cards | meaning |
|---|---:|---|
| `gives-pp-counters` | 1571 | Cards that give +1/+1 counters |
| `gives-pp-counters-to-all` | 180 | Put +1/+1 counters on all of your creatures |
| `gains-pp-counters` | 1757 | only itself |
| `repeatable-pp-counters` | 1673 | Repeatable ways of putting +1/+1 counters on creatures |
| `pp-counters-matter` | 432 |  |
| `counters-matter` | 1228 | any counter type |
| `counter-doubler` | 61 |  |
| `repeatable-proliferate` | 41 |  |
| `pseudo-proliferate` | 44 | Effects that sorta-proliferate some counters |
| `move-counters` | 62 |  |
| `gives-mm-counters` | 224 | Cards that give -1/-1 counters |
| `counter-fuel-pp` | 98 | cares about +1/+1 counters as cost or fuel |
| `counter-fuel-charge` | 62 |  |
| `counter-fuel-energy` | 121 |  |
| `counter-fuel-any` | 32 | Use any type of counter as fuel |
| `pridemate` | 48 | +1/+1 counter on lifegain |
| `slith-ability` | 61 | counter on combat damage to player |

### Aristocrats: sacrifice and death

| tag | cards | meaning |
|---|---:|---|
| `sacrifice-outlet-creature` | 948 |  |
| `sacrifice-outlet-artifact` | 327 |  |
| `sacrifice-outlet-enchantment` | 122 |  |
| `sacrifice-outlet-land` | 273 |  |
| `sacrifice-outlet-token` | 42 |  |
| `sacrifice-outlet-universal` | 48 | any permanent |
| `free-sacrifice-outlet` | 182 | no mana, no limit |
| `repeatable-sacrifice-outlet` | 876 | Repeatedly sacrifice stuff |
| `death-trigger` | 1523 | when another creature dies |
| `death-trigger-self` | 851 | when it dies |
| `death-trigger-opponent` | 66 | when an opponent's dies |
| `blood-artist-ability` | 35 | Cards that have abilities along the lines of: "Whenever creature dies target/each opponent loses X life and you gain X life." |
| `martyr` | 562 | sacrifices itself for value |
| `morbid` | 125 | a creature died this turn |
| `your-sacrifice-matters` | 108 | Effects that reward you for sacrificing your own permanents |
| `mutual-sacrifice` | 69 | everyone sacrifices |
| `leaves-body-behind` | 153 | makes tokens on death |
| `splits-on-death` | 53 | Cards with abilities that create multiple creature tokens when a creature dies |
| `cheat-death` | 299 | comes back on death |
| `cheat-death-self` | 142 | Cards that return themselves to the battlefield or to your hand at the moment they die |
| `persist` | 26 |  |
| `egg` | 323 | artifact you sacrifice for effect |
| `revolt` | 35 | permanent left this turn |

### Graveyard and recursion

reanimate = to battlefield, regrowth = to hand, restock = to library. Suffix is what it returns.

| tag | cards | meaning |
|---|---:|---|
| `reanimate-creature` | 494 | Return creature cards currently in the graveyard to the battlefield |
| `reanimate-artifact` | 74 |  |
| `reanimate-enchantment` | 33 |  |
| `reanimate-permanent` | 56 |  |
| `reanimate-from-any` | 89 | from any graveyard |
| `reanimate-from-opponent` | 131 | Cards that specifically have the ability to reanimate cards opponents have, if not any card |
| `reanimate-self` | 232 | returns itself |
| `reanimate-cast` | 134 | cast from graveyard instead |
| `mass-reanimation` | 64 | Reanimate everything (or every thing of a kind) from one or more graveyards (or potentially do this) |
| `temporary-reanimation` | 94 | until end of turn |
| `regrowth-creature` | 321 |  |
| `regrowth-instant` | 70 | Effects that put an instant back in your hand from the graveyard |
| `regrowth-sorcery` | 71 | Effects that put a sorcery back in your hand from the graveyard |
| `regrowth-artifact` | 68 | Effects that put an artifact back in your hand from the graveyard |
| `regrowth-enchantment` | 42 |  |
| `regrowth-land` | 39 |  |
| `regrowth-permanent` | 60 |  |
| `regrowth-any` | 48 | Bring back a card of any card type from your graveyard to your hand |
| `regrowth-self` | 184 | Cards that can return themselves from the graveyard to the hand |
| `restock-to-top` | 63 | Put cards from your graveyard on top of your library |
| `restock-to-bottom` | 44 | Put cards from your graveyard on the bottom of your library |
| `restock-all` | 40 | shuffle graveyard in |
| `castable-from-graveyard` | 391 | Cards you can cast or access from the graveyard |
| `gives-castable-from-graveyard` | 138 | Allows you to play other cards from the graveyard |
| `activate-from-graveyard` | 318 | Abilities that can be activated from inside a graveyard |
| `trigger-from-graveyard` | 116 | Abilities that trigger from inside the graveyard |
| `graveyard-fuel` | 435 | uses graveyard as a resource |
| `graveyard-fuel-creature` | 170 | Exiles creatures from the graveyard for value |
| `cards-in-graveyard-matter` | 611 | Mechanics that care about the cards in one or more graveyards |
| `card-types-in-graveyard-matter` | 99 | delirium |
| `undergrowth` | 131 | creature cards in graveyard |
| `threshold` | 108 | Cards that care about you having seven or more cards in your graveyard |
| `delve` | 28 | Exile cards from your graveyard to reduce the cost |
| `lhurgoyf` | 98 | P/T = graveyard size |
| `mill-self` | 976 | Cards that put cards from top of your own library to the graveyard |
| `mill-opponent` | 432 |  |
| `mill-any` | 177 | Cards that let you choose a library to mill |
| `mill-each` | 55 | Cards that mill each player simultaneously, putting cards from top of their library to their graveyards |
| `mill-exile` | 139 | mills to exile |
| `repeatable-mulch` | 52 |  |
| `graveyard-seal` | 47 | Rest in Peace class |
| `discard-outlet` | 1237 | Ways to discard your own cards |
| `free-discard-outlet` | 68 | Ways to discard repeatedly that require no additional cost or numerical limit |
| `discard-outlet-land` | 49 |  |
| `self-discard-matters` | 160 | Cards that reward you for tossing your own hand into the graveyard |
| `discarded-type-matters` | 113 | The type of card you discard matters for some effect |
| `madness` | 61 | The specific keyword, madness (Used for applying specific subtags) |
| `hellbent` | 50 | empty hand |
| `ditch-hand` | 220 | dump your hand |
| `discard` | 544 | makes opponents discard |
| `thoughtseize` | 136 | look and pick |
| `specter-ability` | 59 | discard on damage |
| `hate-discard` | 129 | anti-discard |

### Blink, enters, and leaves

| tag | cards | meaning |
|---|---:|---|
| `flicker-creature` | 144 | exile and return now |
| `flicker-self` | 33 |  |
| `flicker-slow` | 97 | returns at end of turn or later |
| `bounce-self` | 209 |  |
| `creaturefall` | 581 | whenever a creature enters |
| `artifactfall` | 87 | Cards that care about an artifact entering the battlefield |
| `enchantmentfall` | 70 | Cards that care about enchantments entering the batllefield |
| `titan-trigger` | 148 | on enter and on attack |
| `man-o-war` | 93 | bounce on enter |
| `leaves-trigger-self` | 149 | Permanents with abilities that trigger when they leave the battlefield |
| `leaves-battlefield-trigger` | 210 | Cards that trigger on something leaving the battlefield |
| `cast-trigger-you` | 1153 | whenever you cast |
| `cast-trigger-self` | 223 | when cast, before it resolves |
| `cast-trigger-other` | 112 |  |
| `delayed-trigger` | 1165 | Create a triggered ability that may trigger later |
| `reflexive-trigger` | 266 | An ability that triggers based on actions taken earlier during a spell or ability's resolution |
| `exile-self` | 1270 | exiles itself |
| `castable-from-exile` | 466 | Cards you can cast or access from exile |
| `gives-castable-from-exile` | 684 | Cards that let you cast things from exile |
| `trigger-from-exile` | 74 | Abilities that trigger from inside exile |
| `sneak-creature` | 82 | creature onto battlefield without casting |
| `impulse-creature` | 179 | top N, creature to hand or battlefield |
| `impulse-land` | 101 |  |
| `impulse-onto-battlefield` | 112 |  |
| `impulse-permanent` | 34 |  |
| `repeatable-impulse` | 201 |  |

### Combat

`gives-` grants to others, `gains-` only to itself.

| tag | cards | meaning |
|---|---:|---|
| `attack-trigger` | 2024 |  |
| `attacking-matters` | 1148 | Cards that care about attacking |
| `attacking-matters-self` | 1464 | Cards that care about themselves attacking |
| `unblocked-trigger` | 42 |  |
| `evasion` | 5079 | broad; any evasion keyword |
| `unblockable` | 184 |  |
| `gives-unblockable` | 175 |  |
| `gives-flying` | 448 |  |
| `gives-trample` | 489 |  |
| `gives-menace` | 156 |  |
| `gives-haste` | 601 |  |
| `gives-double-strike` | 142 |  |
| `gives-first-strike` | 265 |  |
| `gives-deathtouch` | 163 |  |
| `gives-lifelink` | 210 |  |
| `gives-vigilance` | 258 | See also untapper-creature |
| `gives-indestructible` | 264 |  |
| `gives-hexproof` | 151 |  |
| `extra-combat-phase` | 45 |  |
| `extra-turn` | 53 | Cards that grant extra turns |
| `force-attacker` | 152 | makes opponents' creatures attack |
| `forced-attacker` | 82 | must attack each combat |
| `lure` | 29 | All creatures able to block this creature must do so |
| `threaten` | 121 | steal until end of turn |
| `combat-trick` | 1326 | Effects that can be used during combat to help a creature survive, destroy opposing creatures, or deal additional combat damage |
| `giant-growth` | 295 | Combat tricks that give a creature +N/+N |
| `enlarge` | 299 | +3/+3 or better |
| `shade-pump` | 289 | +1/+1 per mana |
| `firebreathing` | 279 | +X/+0 per mana |
| `jump` | 181 | flying until end of turn |
| `power-matters` | 1443 |  |
| `power-matters-self` | 288 |  |
| `scales-with-power` | 664 | Effects which scale with the power of one or more creatures |
| `power-doubler` | 61 |  |
| `damage-multiplier` | 46 | Things deal double or triple damage |
| `damage-increaser` | 24 | Things deal +N damage |
| `fling` | 32 | Sacrifice a creature to deal its power in damage to something |
| `tap-fuel-creature` | 696 | tap creatures to pay |
| `tap-fuel-power` | 283 | tap creatures with power X |
| `tapper-creature` | 649 | taps down creatures |
| `twiddle` | 64 | tap or untap |
| `block-trigger` | 404 | Effects that trigger on a creature blocking or becoming blocked |
| `fog` | 92 | Effects that can prevent all or most of the damage from an entire combat, similar to the card Fog |
| `pseudo-fog` | 74 | Effects that can protect you from an entire combat phase, similar to the card Fog, but using less conventional means than damage prevention |
| `damage-prevention` | 577 |  |
| `restricted-attacker` | 113 | Cards that can only attack in specific circumstances |
| `restricted-blocker` | 144 | Cards that can block, but only in specific circumstances |
| `exalted` | 46 | Creatures attacking alone get +N/+N |
| `heroic` | 125 | Whenever you cast a spell targeting your permanent, something good happens |
| `ferocious` | 118 | power 4+ |
| `raid` | 49 | Cards that have an upside if you attacked this turn |
| `battalion` | 25 | Attacking with at least two other creatures matters |
| `crew` | 181 | the keyword |
| `synergy-vehicle` | 116 |  |
| `wingman` | 30 | Creatures with flying that give other creatures flying until end of turn when they attack |
| `combat-neutral-damage-trigger` | 117 | triggers on any damage, not only combat |

### Burn, drain, and life

| tag | cards | meaning |
|---|---:|---|
| `burn-any` | 806 | any target |
| `burn-creature` | 2143 |  |
| `burn-player` | 1721 |  |
| `burn-player-each` | 114 | each opponent |
| `burn-planeswalker` | 1150 |  |
| `pinger` | 703 | 1-2 damage repeatedly |
| `opponent-loses-life` | 819 |  |
| `drain-life` | 394 | they lose, you gain |
| `drain-creature` | 88 | Hurt a creature and gain life to match |
| `lifegain` | 2443 | Cards that cause you to gain life |
| `repeatable-lifegain` | 1401 |  |
| `lifegain-matters` | 219 | payoffs |
| `lifegain-to-damage` | 20 | Sanguine Bond class |
| `lifegain-increaser` | 14 | doublers |
| `soul-warden-ability` | 35 | Creatures entering the battlefield causes you to gain N life |
| `life-payment` | 752 | costs life |
| `life-for-cards` | 287 | Get cards in exchange for your life (damage causes loss of life) |
| `life-loss-matters` | 138 |  |
| `self-life-loss-matters` | 30 |  |
| `life-total-matters-self` | 71 | Cards that care about your life total being above or below a certain amount |
| `set-life-total` | 46 | Your life total becomes N |
| `opponent-lifegain` | 56 | gives opponents life |
| `poisonous` | 115 | Makes, or is, a creature that poisons a player when it hits them |
| `synergy-poison` | 34 |  |
| `earthquake` | 51 | Spells that deal damage to creatures without flying |
| `hurricane` | 35 | Spells that deal damage to creatures with flying |
| `spite-damage` | 35 | When you deal me damage, I deal you damage right back |
| `retaliate-to-damage` | 37 | Effects that retaliate to damage inflicted upon you, by benefitting you or punishing the opponent |
| `alternate-win-condition` | 61 | New ways for you to win the game (or cause your opponent to lose) |
| `alternate-loss-condition` | 28 | New ways for you to lose the game |

### Spellslinger

| tag | cards | meaning |
|---|---:|---|
| `synergy-instant` | 517 |  |
| `synergy-sorcery` | 515 |  |
| `magecraft` | 31 |  |
| `young-pyromancer-ability` | 36 | token per spell |
| `storm-count-matters` | 24 | Storm count is the number of spells cast in a turn, named for the Storm mechanic |
| `second-spell-matters` | 66 | Cards that care when the player casting or controlling them casts their second spell for the turn |
| `off-turn-casting-matters` | 30 |  |
| `cast-on-resolution` | 501 | cast something as it resolves |
| `modal` | 738 | Spells which give you your choice from two or more distinct functions |
| `charm` | 109 | Modal spells where you pick one option out of three |
| `single-target-instant-sorcery` | 4422 | huge; combine with something else |
| `cheaper-than-mv` | 1938 | alt cost below its mana value |
| `more-expensive-than-mv` | 1023 | kicker, X, additional costs |
| `amount-spent-matters` | 102 | The amount of mana you spent to do the thing matters |
| `mana-value-matters` | 923 |  |
| `high-mana-value-matters` | 73 | Effects that care about your things with mana value above some boundary value (usually 4 or 5) |
| `low-mana-value-matters` | 209 | Effects that care about your things with mana value below some boundary value, usually 2 to 4 |

### Artifacts, enchantments, and equipment

| tag | cards | meaning |
|---|---:|---|
| `synergy-artifact` | 1025 |  |
| `synergy-artifact-creature` | 130 |  |
| `synergy-equipment` | 231 |  |
| `synergy-aura` | 191 |  |
| `synergy-enchantment` | 245 |  |
| `affinity-for-artifacts` | 40 |  |
| `metalcraft` | 39 | Effects when the player controls three or more artifacts |
| `animate-artifact` | 66 | Cards that can turn other noncreature artifacts into creatures |
| `artifactify` | 44 | turns things into artifacts |
| `auraify` | 63 | Effects that turn things into auras |
| `enchantmentize` | 29 | Effects that turn things into enchantments |
| `living-weapon` | 80 | Equipments that attach themselves to a creature they create on ETB |
| `quick-equip` | 238 | cheap or free equip |
| `auto-equip` | 65 | attaches on its own |
| `alternate-equip-cost` | 30 |  |
| `copy-artifact` | 86 |  |
| `copy-equipment` | 23 |  |
| `cranial-plating` | 37 | +1/+0 per artifact |
| `tap-fuel-artifact` | 94 |  |
| `synergy-clue` | 29 |  |
| `synergy-food` | 68 |  |
| `synergy-treasure` | 49 |  |
| `synergy-historic` | 63 |  |
| `synergy-legendary` | 259 |  |

### Theft and control-changing

| tag | cards | meaning |
|---|---:|---|
| `theft-creature` | 219 | permanent steal |
| `theft-artifact` | 47 |  |
| `theft-permanent` | 28 |  |
| `theft-land` | 21 |  |
| `theft-mass` | 50 |  |
| `theft-cast` | 177 | cast their cards |
| `nightveil-theft` | 96 | draw off their library |
| `threaten` | 121 | until end of turn |
| `exchange-control` | 38 | Here's my stuff, give me yours |
| `donate` | 65 | give them your stuff |
| `donate-mana` | 35 |  |
| `bribery` | 25 | Give an opponent something in exchange for a benefit to you |
| `synergy-theft` | 21 | payoffs for stolen stuff |
| `defector` | 58 | changes sides on its own |
| `clone` | 67 | Cards that enter as copies of other things |
| `copy-creature` | 325 |  |
| `copy-self` | 275 | Cards that make a copy of themselves |
| `copy-legendary` | 43 | These cards can give you a copy of a legendary permanent you control that you can actually keep (instead of immediately sacrificing) |
| `copy-permanent-spell` | 41 |  |
| `copy-from-graveyard` | 63 | "Brings back" a copy of a permanent card in a graveyard instead of the original |
| `shapesharing` | 65 | becomes a copy |
| `mimic` | 33 | copies abilities |
| `shapechange` | 213 | sets P/T |
| `polymorph` | 34 | Effects that remove a permanent and replace it with another random one |

### Typal (tribal)

`typal-<type>` for a specific type; check the full list for any type not shown here.

| tag | cards | meaning |
|---|---:|---|
| `typal-choose` | 85 | choose a creature type |
| `typal-share` | 72 | shares a type |
| `typal-coupling` | 304 | two or more types |
| `noncreature-typal` | 1524 | typal on noncreatures |
| `changeling` | 63 | Cards that have all creature types in all zones |
| `type-addition-human` | 572 | got the Human type in errata |
| `type-change` | 1172 |  |
| `universal-type-change` | 84 | Cards that turn every type A into type B |
| `typal-dragon` | 124 |  |
| `typal-elf` | 122 |  |
| `typal-goblin` | 126 |  |
| `typal-zombie` | 120 |  |
| `typal-spirit` | 128 |  |
| `typal-sliver` | 117 |  |
| `typal-human` | 103 |  |
| `typal-vampire` | 82 |  |
| `typal-merfolk` | 74 |  |
| `typal-wizard` | 115 |  |
| `typal-knight` | 43 |  |
| `typal-soldier` | 50 |  |
| `typal-warrior` | 100 |  |
| `typal-dinosaur` | 58 |  |
| `typal-elemental` | 44 |  |
| `typal-pirate` | 64 |  |
| `typal-rat` | 33 |  |
| `typal-squirrel` | 24 |  |
| `typal-ally` | 85 |  |
| `typal-army` | 72 |  |

### Commander, politics, and chaos

| tag | cards | meaning |
|---|---:|---|
| `synergy-commander` | 166 | cares about your commander |
| `pair-commander` | 223 | partner and similar |
| `alt-commander` | 165 | precon backup commander and similar |
| `legendary-team-up` | 25 | March of the Machines introduced a number of cards representing legendary cards teaming up |
| `monarch-matters` | 41 |  |
| `the-ring-tempts-you` | 49 |  |
| `group-hug` | 397 | Cards that can be used to benefit other players, including opponents, usually by giving them resources |
| `selective-group-hug` | 206 | Group Hug cards that benefit only certain opponents in particular |
| `catch-up` | 90 | behind players get more |
| `multiplayer` | 585 | Cards that interact with all of the players in the game |
| `per-player` | 439 | scales with player count |
| `voting` | 33 |  |
| `opponent-chooses` | 139 |  |
| `roll-d6` | 50 | rolls a d6 |
| `roll-d20` | 50 | rolls a d20 |
| `coin-flip` | 71 | Cards that flip coins |
| `guess` | 34 | Effects that force you to guess at unknown information |
| `clash-like` | 36 | Cards that compare the mana values of multiple players' revealed cards |
| `minigame` | 44 | Engages one or more other players in a bet or mind game (not necessarily explicitly) |
| `secretly-choose` | 18 |  |

### Protection

| tag | cards | meaning |
|---|---:|---|
| `protects-creature` | 886 | protection, hexproof, indestructible, etc. for a creature |
| `protects-all` | 267 | team-wide |
| `protects-planeswalker` | 122 |  |
| `protects-artifact` | 62 |  |
| `protects-enchantment` | 33 |  |
| `protects-permanent` | 32 |  |
| `gives-protection` | 117 | protection from |
| `gives-shroud` | 48 |  |
| `gives-ward` | 56 |  |
| `ward` | 187 | the keyword |
| `regenerates-self` | 175 | Cards with effects that regenerate themselves |
| `regenerates-other` | 97 | Cards with effects that regenerate other things (and possibly including themselves.) |
| `damage-prevention-creature` | 153 |  |
| `damage-prevention-you` | 150 |  |
| `counter-preservation-self` | 43 | When this thing leaves, put its counters on something else you control |
| `phasing` | 66 | Cards that involve phasing, whether the action or ability |

### Tags that look useful but are traps

| tag | cards | why to avoid |
|---|---:|---|
| `activated-ability` | 9536 | structural tag on nearly every card with an activated ability |
| `triggered-ability` | 15034 | same, for triggers |
| `intervening-if-clause` | 2060 | rules-structure tag |
| `alliteration` | 3957 | name flavor, not function |
| `single-english-word-name` | 1226 | name flavor |
| `punny-name` | 312 | name flavor |
| `namesake-spell` | 1503 | flavor |
| `unique-type-line` | 1947 | trivia |
| `virtual-vanilla` | 1473 | creatures with no relevant text; useful only as a negative filter |
| `french-vanilla` | 1318 | keywords only; same |
| `repeatable-crime` | 3471 | anything that targets an opponent repeatedly; too broad to mean 'crime deck' |
| `digital-only-mechanics` | 0 | Arena only; 0 with legal:commander |
| `conjure-creature` | 0 | Alchemy; any conjure-* or seek-* tag is not paper and returns 0 with legal:commander |
| `drawback` | 1684 | half the card pool |
| `synergy-white` | 195 | color synergy tags are very loose |
| `hate-set-mechanic` | 269 | hoses one set's mechanic; almost never what you want |

## Finding a tag that is not on this page

1. `grep -i <keyword> oracle-tags-all.tsv` — columns are slug, direct
   taggings on Tagger, descendant-inclusive taggings (blank if not crawled),
   parent tag, alias_of, description. A row with `alias_of` set is an
   alternate name that works in `otag:` and returns the target's cards
   (`?` = listed on Scryfall's public page, target not yet resolved). Sort by
   the count columns to find the big families.
2. Probe on Scryfall through the studio: `card_search {q: "otag:<slug>",
   deckFilter: false, limit: 1}` and read `total`.
3. Browse `https://tagger.scryfall.com/tags/card/<slug>` for the tag's parent,
   children, and aliases when the family shape matters.
4. Regenerate the TSV with `scripts/refresh_oracle_tags.py` when it looks
   stale (new sets add tags every few months).
