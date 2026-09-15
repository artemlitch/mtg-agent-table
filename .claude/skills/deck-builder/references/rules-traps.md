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

## Proliferate can't restart a Saga at 0 counters, and it never forces a held Saga forward
Claim: after Vampire Hexmage strips a Saga to 0, Karn's Bastion re-fires chapter I on the opponent's turn. Or: Atraxa's end-step proliferate pushes every Saga forward and breaks a pin. True: rule 701.34a: "choose any number of permanents and/or players that have a counter, then give each one additional counter of each kind that permanent or player already has." A Saga at 0 can't be chosen. Only the main-phase counter (714.3c), a direct lore adder (Storyweave, Clash of the Eikons, Satsuki), a counter mover (Nesting Grounds, Resourceful Defense) or re-entering play puts a counter on it. "Any number" means you can leave a held Saga out. Karn's Bastion's ruling adds that a chosen permanent "must get one of each kind of counter it already has", so a +1/+1 counter left on a Saga by mistake grows along with the lore counter. For the plan: pins meant to fire on the opponent's turn through proliferate must sit on chapter II or higher, and each proliferate choice should be named out loud.

## Karn's Bastion's proliferate costs five lands, not four
Claim: Bastion plus Hex Parasite is a five-mana loop. True: "{4}, {T}: Proliferate." The land taps as part of the cost, so it can't also make one of the four mana. That is four other lands plus Bastion. Hex Parasite at X=1 ("{X}{B/P}") adds a sixth land plus {B} or 2 life. For the plan: that loop needs six untapped lands on the opponent's turn.

## Power Conduit is one use per turn cycle, not one per turn
Claim: Conduit saves your final chapter on your turn and rewinds another Saga on the opponent's turn. True: its cost is "{T}, Remove a counter from a permanent you control", and it untaps only in your untap step (502.3). Tap it on your turn and it stays tapped through theirs. Tap it at their end step and it is untapped for your turn. Either way you get one use between your untap steps. For the plan: one Conduit holds one Saga. A second pin needs another remover or Voltaic Key ("{1}, {T}: Untap target artifact").

## A Saga fired on the opponent's turn also advances on yours
Claim: proliferate on their turn and the Saga replays the same chapter on both turns. True: your main-phase counter still comes (714.3c). A Saga that fired chapter k on their turn fires k+1 on yours. A final chapter reached that way is sacrificed (714.4) unless a counter is removed in response. For the plan: replaying one chapter twice per cycle costs two removals per cycle for each Saga, or pick a Saga whose two neighboring chapters both hurt.

## Shroud on your own enchantments turns off your own targeted counter removers
Claim: Sterling Grove or Greater Auramancy protects pinned Sagas at no cost. True: both say "Other enchantments you control have shroud". Shroud means "This permanent or player can't be the target of spells or abilities" (702.18a), yours included. Hex Parasite ("target permanent"), Thrull Parasite ("target nonland permanent"), Storyweave, Clash of the Eikons, Nesting Grounds and Resourceful Defense all target, so none of them can reach a shrouded Saga. Power Conduit and Scholar of New Horizons remove a counter as a cost without targeting ("a permanent you control"), and proliferate and the main-phase counter don't target either. Hexproof applies only to "spells or abilities your opponents control" (702.11b), so Privileged Position works with every remover. For the plan: protect Sagas with hexproof, never shroud.

## An exiled commander is not gone for good
Claim: Elspeth Conquers Death I or another exile chapter removes an opposing commander permanently. True: rule 903.9a: "If a commander is in a graveyard or in exile and that object was put into that zone since the last time state-based actions were checked, its owner may put it into the command zone." They recast it for {2} more. For the plan: exile chapters give lasting value only against permanents that aren't commanders. Against a commander they buy tempo and tax.

## Sacrifice goes to the graveyard, just like destroy
Claim: edicts beat graveyard decks and "dies" triggers because nothing is destroyed. True: "To sacrifice a permanent, its controller moves it from the battlefield directly to its owner's graveyard" (701.21a). "Dies means 'is put into a graveyard from the battlefield'" (700.4), so a sacrificed creature triggers Grave Pact, persist and every dies payoff, and graveyard recursion (Muldrotha) gets it back. Only exile avoids all of that. For the plan: against recursion or death-trigger decks, count edicts as no better than destroy. Pick exile.

## Kaya's Ghostform: creatures and planeswalkers only, and it beats exile too
Claim: Kaya's Ghostform can protect a Saga. Or: exile gets around an opposing Ghostform. True: it reads "Enchant creature or planeswalker you control", so it can only go on a Saga that is also a creature (a Summon, or a Saga animated by Starfield of Nyx). Its trigger is "When enchanted permanent dies or is put into exile, return that card to the battlefield". Its ruling covers exile that would return the card later: "Kaya's Ghostform will return that card to the battlefield and it won't be returned later." For the plan: on your side it is Narci and Summon insurance only. Against an opponent's Ghostform, remove the Aura first.

## A returned Saga is a new object at chapter I
Claim: Faith's Reward or Brought Back after a wipe puts a pinned board back as it was. True: "An object that moves from one zone to another becomes a new object with no memory of, or relation to, its previous existence" (400.7), and a Saga "enters with a lore counter on it" (714.3a). The held chapter is lost. Read ahead from Barbara Wright applies only if she is already on the battlefield as the Saga enters (614.12). If the same wipe killed her, the Sagas come back at chapter I. For the plan: recursion rebuilds the Sagas but not the pins. Plan on replaying chapters from I.

## Split second applies only while the spell is on the stack
Claim: nothing in white, black or green answers Krosan Grip on a Saga or engine piece except static hexproof. True: rule 702.61a: split second "functions only while the spell with split second is on the stack". While Grip is on the stack, Power Conduit and Hex Parasite can't be activated, since those aren't mana abilities. Krosan Grip's ruling: "After a spell with split second resolves ... players may again cast spells and activate abilities." Brought Back or Faith's Reward can return the destroyed Saga afterwards, as a new object at chapter I. Grip reads "target artifact or enchantment", and Force of Vigor reads "up to two target artifacts and/or enchantments", free when it isn't the caster's turn. Both hit Conduit, Hex Parasite (an artifact creature) and the Sagas. For the plan: count artifact engine pieces as targets for the same removal that hits Sagas, and keep instant recursion for after a split-second spell.

## Cost reducers reduce only generic mana
Claim: a cost reducer makes cheap Sagas and removal free. True: rule 118.7a: "Effects that reduce a cost by an amount of generic mana affect only the generic mana component of that cost. They can't affect the colored or colorless mana components of that cost." A {W} or {B} Saga costs the same with or without it. For the plan: reducers only help cards with generic mana in their cost. Don't count them as ramp for a curve of single-pip cards.

## Glen Elendra Archmage counters two spells per card
Claim: point removal answers Glen Elendra. Or: Destiny Spinner stops it from countering your protection. True: "{U}, Sacrifice this creature: Counter target noncreature spell" and "Persist (When this creature dies, if it had no -1/-1 counters on it, return it to the battlefield ... with a -1/-1 counter on it.)" (702.79a). It sacrifices itself to counter the removal, comes back, and can counter a second spell. After the second sacrifice it has a -1/-1 counter and stays in the graveyard. A -1/-1 counter put on it earlier also turns off persist. Destiny Spinner covers only "Creature and enchantment spells you control", so instant protection (Heroic Intervention) can still be countered. Veil of Summer ("Spells you control can't be countered this turn") covers everything. Exile, a -1/-1 counter, a creature's triggered ability or split second all get around it. For the plan: never aim a single removal spell at Glen. Use exile, a trigger, or Veil first.

## The Princess Takes Flight's exile ends at chapter III even if you sacrifice it in response
Claim: sacrifice The Princess Takes Flight with chapter III on the stack and the creature stays exiled. True: "III — Return the exiled card to the battlefield under its owner's control." Once triggered, the ability "exists on the stack independently of its source" (113.7a), so it still returns the card. III triggers when the main-phase counter goes on (714.3c). For the plan: to keep the creature exiled, the Saga has to leave the battlefield before your precombat main phase begins, in your upkeep or draw step at the latest.

## Solemnity freezes Sagas instead of keeping them working
Claim: Solemnity keeps Sagas on the battlefield forever. True: "Counters can't be put on artifacts, creatures, enchantments, or lands." The main-phase lore counter and every proliferate fail, so no chapter fires again. Its rulings: it "doesn't remove any counters", and it "stops counters from being put on an artifact, creature, enchantment, or land as it enters the battlefield". A Saga cast afterwards has no counter and never fires chapter I, and nothing is ever sacrificed. For the plan: never in a Saga deck.

## Starfield of Nyx returns a Saga in upkeep, so it fires I and II that turn
Claim: a Saga returned by Starfield only fires chapter I that turn. True: "At the beginning of your upkeep, you may return target enchantment card from your graveyard to the battlefield." It enters with a lore counter (714.3a), so I fires in upkeep. Your precombat main phase adds another counter (714.3c), so II fires the same turn. For the plan: count two chapters per Starfield return.

## Roaming Throne makes a Summon's chapter trigger twice, and it can't help other Sagas
Claim: Roaming Throne doubles every Saga's chapters. True: "If a triggered ability of another creature you control of the chosen type triggers, it triggers an additional time." Its ruling: it "doesn't copy the triggered ability; it just causes the ability to trigger an additional time", and targets are chosen separately for each instance (603.2d). Only Summon Sagas have creature types (Summon: Yojimbo is "Enchantment Creature — Saga Samurai"). Starfield of Nyx makes enchantments creatures "in addition to its other types" but gives no creature type, so Throne can't name them. For the plan: Throne is a Summon-only doubler. Choose the type shared by the most Summons in the deck.

## One Ring to Rule Them All chapter II kills your own engine
Claim: pin One Ring to Rule Them All on chapter II with Hex Parasite for a permanent board lock. True: "II — Destroy all nonlegendary creatures." That includes Hex Parasite (artifact creature), Thrull Parasite, Scholar of New Horizons and every Summon Saga. With five or more enchantments, Starfield of Nyx makes "each other non-Aura enchantment you control ... a creature", so the Ring kills your other Sagas and itself too. Power Conduit, Karn's Bastion and legendary creatures (Garnet, Narci, Barbara Wright, Satsuki) survive. For the plan: build a Ring pin only from noncreature or legendary removers, and never with Starfield active.

## Fall of the First Civilization III is a reset, not a pin
Claim: pin Fall of the First Civilization on chapter III for a hard lock. True: "Each player chooses three nonland permanents they control. Destroy all other nonland permanents." That includes your own board. Fall, the remover that holds it and Narci use up all three of your picks. For the plan: fire it once, when you have fewer than four nonland permanents worth keeping.

## Held Sagas give Narci nothing
Claim: a field of Sagas pinned below their last chapter feeds Narci. True: Narci reads "Whenever you sacrifice an enchantment, draw a card" and "Whenever the final chapter ability of a Saga you control resolves, each opponent loses X life". A Saga held on chapter I or II does neither. A Saga held at its final chapter drains each time that chapter resolves, but it is never sacrificed, so it never draws. For the plan: count Narci value only from final-chapter pins and Sagas that finish. Every pinned board needs one of those or another win condition.

## Welcome to . . . chapter I takes Equipment off a commander
Claim: Welcome to . . . is only a Wall-maker and does nothing to Lightning Greaves. True: "I — For each opponent, up to one target noncreature artifact they control becomes a 0/4 Wall artifact creature". Rule 301.5c: "An Equipment that's also a creature can't equip a creature unless that Equipment has reconfigure." The Equipment falls off and can't be re-equipped while you control the Saga. For the plan: it is a three-mana answer to Greaves or Boots. Its III flips the Saga instead of sacrificing it, so Narci draws nothing.

## Flip Sagas are never sacrificed
Claim: every finished Saga is a Narci card. True: Kamigawa-style double-faced Sagas end with "III — Exile this Saga, then return it to the battlefield transformed" (The Restoration of Eiganjo, Welcome to . . .). Exile is not a sacrifice (701.21a), so "Whenever you sacrifice an enchantment" doesn't trigger. For the plan: count double-faced flip Sagas as zero Narci cards.

## A replaced Role or a fallen Aura is not sacrificed
Claim: putting a second Role on a creature, or killing the creature under an Aura, gives a Narci draw. True: the extra Roles are "put into its owner's graveyard" (303.7a), and so is an unattached Aura (704.5m). Both are state-based moves, not sacrifices (701.21a). For the plan: Roles and Auras draw with Narci only when a real outlet sacrifices them.

## Satsuki's death trigger can't save a Saga that died with her
Claim: when a wipe kills Satsuki, her first mode rescues a Saga. True: mode one is "Return target Saga or enchantment creature you control to its owner's hand", which needs the Saga on the battlefield. A Saga destroyed in the same event is already in the graveyard. Only mode two, "Return target Saga card from your graveyard to your hand", works. For the plan: after a wipe, Satsuki gets back one Saga to hand, not the board.
