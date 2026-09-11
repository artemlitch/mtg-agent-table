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
