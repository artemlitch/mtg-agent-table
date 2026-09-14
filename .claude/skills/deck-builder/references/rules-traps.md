# Rules traps

Claims that sounded right from memory and were wrong when checked. Each one
cost a round of correction from Artem in the September 2026 counter-lock
session. Read this before writing any interaction claim, and add an entry
whenever a red-team pass catches a new one.

Rule numbers drift between editions of the Comprehensive Rules. When citing
one, grep the rules file for the quoted phrase and use the number the file
gives; the numbers below were current in 2026.

## Zones and reach

**Claim:** Vampire Hexmage (or any "remove all counters from target
permanent" effect) can pull the time counters off a suspended card so it
casts at once.
**True:** Suspended cards are in exile (CR 702.62b: "A card is suspended if it's in the exile zone, has suspend, and has a time counter on it"). A permanent is a card or token on
the battlefield (CR 110.1), so nothing that targets a permanent can reach
a suspended card. Only effects that name "a card in exile" or the suspend
rule's own upkeep trigger touch those counters. This is why suspend was
dropped from the counter-lock plan: every remover in the deck works on the
battlefield.

**Claim:** Sin, Unending Cataclysm strips the ice counters off Dark Depths.
**True:** Sin's text names "artifacts, creatures, and enchantments". Lands
are not on the list, so Dark Depths, a sleeping Arixmethes and any other
land keep their counters. Removers that reach lands say "permanent"
(Hexmage, Hex Parasite, Glissa Sunslayer, Power Conduit, Nesting Grounds).
Read the object list on every remover before claiming reach.

**Claim:** Populate makes a token copy of any creature you control.
**True:** Populate creates a token that is a copy of a creature *token* you
control (CR 701.36a and 701.36b; the reminder text says the same). With no
creature token on the battlefield it creates nothing. Xavier Sal's
activation still removes the counter, which is the reason to activate it,
but the populate half needs a token first.

## Timing

**Claim:** Impending Overlords lose a time counter at your upkeep.
**True:** "At the beginning of your end step, remove a time counter from
it" (the impending reminder text and the keyword rule in CR 702). The
counters tick at the end of your turn, so a four-counter Overlord cast on
turn 3 is a creature at the start of turn 7, not turn 6. Strip the last
counter during your main phase and it is a creature at once; it can attack
that turn if you have controlled it continuously since the turn began (CR
302.6 cares about control, not creature-ness).

**Claim:** Stun counters come off at upkeep, or with extra upkeeps.
**True:** "If a permanent with a stun counter would become untapped,
instead remove a stun counter from it" (CR 122.1d; also every
stun card's reminder text). The only thing that removes a stun counter is
an untap event: your untap step, an untap effect, or a counter remover.
Extra upkeeps do nothing; untap effects are removers; a permanent that
never untaps keeps its counters forever.

**Claim:** Removing all age counters makes a cumulative upkeep card free.
**True:** Cumulative upkeep first puts an age counter on the permanent,
then asks for the cost once per age counter (CR 702.24b). Removing the
counters at instant speed before the trigger resolves gets you to zero
counters, then the trigger adds one, so the floor is one payment per turn.
Only Solemnity (counters can't be put on permanents) makes it zero, because
the counter is never added.

**Claim:** Thing in the Ice transforms as soon as its last ice counter is
gone.
**True:** The transform is inside the cast trigger: "Whenever you cast an
instant or sorcery spell, remove an ice counter from this creature. Then
if it has no ice counters on it, transform it." Strip the counters some
other way and it sits there until you cast one more instant or sorcery.
Count that spell in the setup cost.

**Claim:** Tap abilities on a creature work the turn it enters.
**True:** A creature's {T} ability needs the creature to have been under
your control since the start of your most recent turn (CR 302.6). Xavier
Sal, Hex Parasite's tap-less ability is fine, but any tap-to-remove
creature does nothing the turn it lands without haste or Thousand-Year
Elixir. Sorcery-speed activations ("activate only as a sorcery") also
cannot be used in response to anything.

## Copies

**Claim:** Vesuva copying Dark Depths gives you a counter-less Depths and an
instant Marit Lage.
**True:** Vesuva "enters tapped as a copy of any land": the copy is applied
as it enters, so it also gets Dark Depths' "enters with ten ice counters"
(CR 614.12 and the copy rules in 707). Thespian's Stage and Mirage Mirror
become copies while already on the battlefield, so they never had the
enters-with counters, and the copy's "when this has no ice counters"
trigger fires at once.

**Claim:** A token copy of a legendary creature gives you two of it.
**True:** The legend rule (CR 704.5j) applies to the token too; you choose
one and put the other into the graveyard. A token copy of Glissa is useful
only with Mirror Box ("the legend rule doesn't apply to permanents you
control") or as fuel for something that wants a creature to die. Say which
before listing copy effects as a Glissa multiplier.

## Color identity

**Claim:** Clara Oswald is a mono-white companion, so she fits any deck with
white.
**True:** Clara's chosen color is part of her color identity (CR 903.4b: "If a commander has a static ability that causes a player to choose its color before the game begins, that choice applies during deck construction and throughout the game... That choice affects the commander's color identity"), so
a commander pair or a deck that includes her must have that color in its
identity. Read the card and the rule before pairing her.

**Claim:** Phyrexian mana symbols are colorless for color identity because
you can pay life.
**True:** A Phyrexian mana symbol is a colored mana symbol (CR 107.4f) and
counts toward color identity (CR 903.4). A {G/P} card is green for deck
legality no matter how you pay. Same for hybrid symbols.

## How to add an entry

One trap per entry, three parts: the claim as someone would say it, what
is actually true, and the card text or rule number that settles it (quoted
or close to it). If the fix changes what a card can do in the deck (Sin
and lands, Hexmage and exile), say what that means for the plan in one
sentence, because that is what Artem needs to know.

## Kenrith's Transformation does not clear counters
Claim: turning a locked creature into a 3/3 Elk wipes its counters. True: the Aura sets base power and toughness and removes abilities; counters stay (ruling on the card: counters that change power or toughness still apply, and stun counters are counters, not abilities). On your own six-counter Moonshadow it makes a -3/-3 that dies. It is removal plus a cantrip, never a counter fix.

## Melira makes "enters with -1/-1 counters" creatures enter clean
Claim: Melira only stops later -1/-1 counters. True: "can't" beats "enters with" (rule 101.2), so with Melira, Sylvok Outcast out, Moonshadow is a 7/7 for one mana, Bristlebane Battler a 6/6 trample for two, and blight (Sinister Gnarlbark) does nothing. She does not remove counters already on the battlefield and does nothing for stun counters.

## Rewinding a Saga does not re-trigger chapters, and Glissa cannot save one at chapter III
Claim: Glissa's "remove up to three counters" replays a Saga at once, or rescues it from its last chapter. True: removing lore counters triggers nothing; a chapter fires again when a counter is added after the draw step. A three-chapter Saga is sacrificed (state-based action, rule 714.4) as soon as chapter III's trigger has left the stack, in the first main phase, before combat, so a combat-damage trigger never reaches it. Hit the Saga at chapter II to loop I and II. Instant-speed removers (Power Conduit, Hex Parasite, Vampire Hexmage) can respond to the chapter III trigger, get the chapter and keep the Saga.

## Aether Snap and Dark Depths: Marit Lage survives, every other token does not
Claim: Aether Snap exiles the Marit Lage it makes. True: Dark Depths' "when it has no ice counters" is a state trigger that goes on the stack after Snap has finished resolving, so the 20/20 is created after "exile all tokens." An existing Marit Lage, Everywhere lands, Constructs and Saga tokens are exiled, and every +1/+1 or deathtouch counter on your side goes too. Cast Snap before Lage, never after.

## Vanishing is the wrong mechanic for a counter-purge deck
Claim: stripping time counters from a vanishing creature keeps it around. True: rule 702.63 sacrifices the permanent when the last time counter is removed. Only impending (and suspend) reward early removal.

## Invasion of Fiora forces a choice
Claim: its front face is a one-sided wipe. True: "choose one or both: destroy all legendary creatures / destroy all nonlegendary creatures" always kills one of your halves, and flipping it into Marchesa needs the battle defeated first (six defense), eight or nine mana of purge in one turn.

## Counter doublers break read ahead
Claim: with Doubling Season or Vorinclex, a Saga enters with 2 counters (I and II), and Satsuki's one tap adds 2 more for III, so all three chapters fire in one turn, even with Barbara Wright out. True: read ahead (rule 702.155a) says chapters "can't trigger the turn it entered the battlefield unless it has exactly the number of lore counters on it specified in the chapter symbol." With Barbara, choosing 1 under Doubling Season lands on 2, so only II fires. Choosing 2 lands on 4, so nothing fires, and rule 714.4 sacrifices the Saga with no final chapter and no Narci drain. Satsuki going from 2 to 4 that turn also fires nothing. Pir and Doc Samson (plus one) can land exactly on 3. Count each Saga's landing number before pairing doublers with Barbara.

## Doubling Season does not double the main-phase lore counter
Claim: Doubling Season adds two lore counters each turn. True: it says "If an effect would put." Rule 609.1 defines "an effect is something that happens in the game as a result of a spell or ability," and the precombat main-phase counter is a turn-based action (714.3c, 703.1). Doubling Season doubles only the counter a Saga enters with (its ruling: "affects permanents that enter with counters") and proliferate or Satsuki counters. Vorinclex, Doc Samson ("you would put") and Pir ("would be put") do apply, because 714.3c says "that player puts a lore counter."

## A final chapter with no legal target drains nothing
Claim: Replenish with Barbara Wright drains the total mana value of every returned Saga. True: a chapter whose target can't be chosen "is simply removed from the stack" (603.3d), and one whose targets all become illegal "doesn't resolve" (608.2b). Narci and Tom Bombadil trigger only when the final chapter resolves. The Eldest Reborn III and The Cruelty of Gix III need a creature card in a graveyard, so with none they give no drain, though the Saga is still sacrificed and Narci still draws.

## Starfield of Nyx Sagas still have summoning sickness
Claim: Sagas animated by Starfield of Nyx can attack right away. True: its ruling says "A noncreature permanent that turns into a creature can attack, and its {T} abilities can be activated, only if its controller has continuously controlled that permanent since the beginning of their most recent turn." A Saga cast this turn, or returned by Starfield at this upkeep, cannot attack. A mana value 0 Saga is 0/0 and dies (704.5f). Creature wipes now hit your Sagas.

## City of Death does not make more Marit Lages
Claim: City of Death's chapters II to VI copy Marit Lage for a 20/20 every turn. True: Dark Depths makes "Marit Lage, a legendary 20/20", a token copy is legendary too, and the legend rule (704.5j) keeps only one. Copy nonlegendary tokens with it.

## Sacrificing a Saga in response to its last chapter loses Narci's drain
Claim: sacrifice a Summon with its final chapter on the stack and Narci still drains, because the chapter still resolves. True: the chapter does resolve (113.7a, "the ability on the stack won't be affected ... if it leaves the battlefield"), but Narci's trigger is "the final chapter ability of a Saga you control resolves". That trigger is not on the look-back list (603.10a covers leaves-the-battlefield, sacrifice, leaving a graveyard, and put into hand or library). Rule 603.10 checks "objects that exist immediately after an event", and the Tom Bombadil ruling puts that moment at the ability being "removed from the stack". By then the Saga is in the graveyard. Plan for no drain. Narci still draws for the sacrifice. Sacrifice before the chapter triggers or after the Saga is gone, never in between.

## Living Death sacrifices Narci and Barbara too
Claim: Living Death sacrifices every Summon for a Narci draw and brings them all back to drain. True: "sacrifices all creatures they control" includes Narci (Human Bard) and Barbara Wright (Human Advisor). Narci draws for the Summons sacrificed with her, because sacrifice triggers look back (603.10a). She is gone before the returned Summons finish, so they drain nothing. Barbara is not on the battlefield as they enter (614.12 only counts "continuous effects that already exist"), so they enter at chapter I (714.3a). It is a reset, not a payoff turn.

## Case of the Uneaten Feast is not usable the turn you gain the life
Claim: one Narci drain of 5 solves it, then you sacrifice it and cast creatures from the graveyard that turn. True: its ruling says "To Solve" means "At the beginning of your end step, if [condition] ... it becomes solved." Creature spells need your main phase with an empty stack (302.1), so the first turn you can cast from the graveyard is your next one.

## God-Pharaoh's Gift's token keeps its chapters
Claim: God-Pharaoh's Gift's "4/4 black Zombie" token loses Enchantment and Saga, so a copied Summon does nothing. True: rule 205.1a says a new subtype "replaces any existing subtypes from the appropriate set (creature types, ...)". Zombie replaces Dragon or Knight, while Enchantment, Creature and Saga stay. Its rulings add that the token "has the mana cost and thus mana value of the card it's copying" and that "enters with" abilities work. So read ahead applies, Narci drains the full mana value, and the token's sacrifice draws. The only cost is exiling the card.

## Read ahead on the turn a Saga enters: one counter at a time is safe, two at once skips
Claim: with Barbara Wright out, Satsuki or proliferate can skip chapters on a Saga that entered this turn. True only for adders of two or more. Rule 702.155a: "Chapter abilities of this Saga can't trigger the turn it entered the battlefield unless it has exactly the number of lore counters on it specified in the chapter symbol." A Saga that entered on chapter k and gets one counter (Satsuki, any proliferate, the main-phase counter) has exactly k+1, so chapter k+1 fires. Storyweave's two counters, or a counter doubler, jump to k+2: chapter k+1 is skipped that turn and only k+2 fires. Without Barbara the restriction doesn't exist.

## Two chapters from one resolution lock their targets together
Claim: Contagion Engine's "proliferate twice" on The Eldest Reborn lets chapter III steal the creature chapter II made an opponent discard. True: both proliferates happen inside one resolution, so chapters II and III trigger during it and are put on the stack together the next time a player would receive priority (603.3). III's target is chosen then, before II resolves. Separate proliferates (two Evolution Sage landfall triggers, two Yawgmoth activations) avoid this because each chapter resolves before the next counter.

## Resourceful Defense passes a finished Saga's lore counters to the next Saga
Claim: counters on a sacrificed Saga just vanish (122.2), so nothing can reuse them. True for the counters themselves, but Resourceful Defense ("Whenever a permanent you control leaves the battlefield, if it had counters on it, put those counters on target permanent you control") is a leaves-the-battlefield trigger, which looks back (603.10a), and rule 122.8 has it put the same number of counters on the target. A three-chapter Saga sacrificed after III puts three lore counters on another Saga; going from 1 to 4 fires II and III there (714.2b), which sacrifices that Saga and passes its counters on again. Trap: a read-ahead Saga that entered this turn only fires a chapter whose number it hits exactly (702.155a), so a +3 jump skips chapters on it. The Ozolith only collects from creatures and only gives to a creature at beginning of combat, so it chains only Summon Sagas, and too late for main-phase plays.

## Narci gains X once, not X per opponent
Claim: Narci's drain of 5 gains you 15 life in a four-player game. True: the text is "each opponent loses X life and you gain X life". The loss is per opponent; the gain is a single "you gain X life". Only drains worded "you gain life equal to the life lost this way" scale with the table.

## Chapter III's "no legal target" also hits one-turn lines
Claim: every one-turn Saga finish drains Narci's full mana value. True only if the final chapter resolves. The Eldest Reborn III and The Cruelty of Gix III need a creature card in a graveyard; Elspeth's Nightmare III needs a target opponent. With none, 603.3d removes the chapter and Narci drains nothing, though the Saga is still sacrificed and Narci draws.
