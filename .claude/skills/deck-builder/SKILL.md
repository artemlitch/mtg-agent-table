---
name: deck-builder
description: The method for building a Commander deck from an idea, in order, with evidence — pin the goal, survey the whole design space, rank with reasons, pool cards by job, build in blocks with odds, red-team every block, then present. Use it whenever Artem wants to brainstorm a deck, build a deck, talks about a deck idea, a commander choice, an engine, a synergy, a package, a combo, or asks "is this reliable" or "does this work"; and use it for ANY plan, engine, package or card list that will be shown to him during deck work, even mid-conversation, even when the archidekt or archidekt-recommender skill is already loaded (those are the tools; this is the process that uses them).
---

# Deck builder

Artem says he is not good at Magic and should not have to catch mistakes in a
plan. In one brainstorm session (September 2026) he caught seven, all of the
same kind: the plan sounded right and was not checked. This skill is the order
of work that would have prevented each of them. The `archidekt` skill holds
the tools (API, Scryfall searches, oracle tags, the web-research agent); the
`archidekt-recommender` skill holds the /swap board for tuning an existing
deck. Read the `archidekt` skill's Card research section once per session,
then follow the steps below.

Two rules run through every step:

- **Evidence, not memory.** Every rules claim quotes card text or a rule.
  Every "this card exists and does X" comes from a Scryfall fetch. The
  session's wrong claims (Hexmage reaching exile, Sin touching lands,
  Overlords ticking at upkeep) were all things that sounded right from
  memory. `references/rules-traps.md` lists the ones caught so far; read it
  before writing any interaction claim.
- **Explain before you act.** Artem does not know cards by name. A bare card
  name is not information. Every card mentioned in chat or on a page comes
  with what it does and why it is there; a page shows the picture and the
  full oracle text too. And nothing is written to Archidekt until he says go.

## The steps

### 1. Pin the goal, in his words

Write down what he asked for, quoted, before doing anything else. Keep it at
the top of every artifact (research notes, pages, chat summaries) and
re-check every later choice against it. The session recommended Muldrotha
because it fixed a color problem; it does not remove counters, which was the
whole point. A commander, an engine or a package that does not do the
deck's stated job is wrong no matter what else it fixes. When a choice
serves something other than the goal, say so plainly and rank it below the
ones that do.

### 2. Survey the whole space before ranking anything

The first thing he names is a starting point, not the answer. He said
"suspend"; stun, ice, impending, -1/-1 as a cost and cumulative upkeep all
turned out to be better fits, and anchoring on suspend cost most of a day.
For a mechanic, enumerate every family that does the same job (for counters:
every counter type Scryfall knows). For a strategy, enumerate every way to
get the effect. Two sources, run together:

- A systematic Scryfall sweep in the main session, spaced about a second
  apart, using `otag:` names from the archidekt skill's
  `references/oracle-tags.md` and, for mechanics, `keyword:` plus the
  counter or cost words. Record counts per family so the ranking has
  numbers.
- The archidekt skill's deep web-research agent (its
  `references/web-research-brief.md`), started first so it runs while you
  search.

**Subagents search the local Scryfall database, never the API.** Parallel
API calls from one IP get rate limited, and the first fix for that (telling
agents not to search at all) blinded the reviewers. `scripts/scryfall_local.py`
searches a local copy of every Commander-legal card, oracle tag and ruling
(`decks/scryfall/`, built by `--refresh` from Scryfall's bulk downloads;
refresh when a set lands). Any number of agents can run it at once. It is Scryfall's own data, not a sample: on 2026-09-12 ten payoff searches (stun, -1/-1, blight, cumulative upkeep, impending, finality, persist, undying, ice, doesn't untap) returned the same cards live and locally, and for -1/-1 the local copy found more, because its text includes reminder text that Scryfall's `o:` search skips. Give
every research or review agent the script path and tell it to search as
much as it wants.

Write the survey up as families with counts, pros and cons, and only then
move to ranking.

### 3. Rank with reasons, and say where his preference moves things

Rank options on fit to the goal first, power second, and give the reason for
every position. He is allowed to like something; that is guidance, not a
ranking input. The session moved Sin to #1 because he said he liked it,
which hid that Sin cannot touch lands and that real Sin lists were
+1/+1-counter decks. The honest form is: "On fit and power the order is A,
B, C. You said you like C; if that weighs more than the land problem, C
moves to first, and here is what you give up." Then recommend one and say
why.

### 4. Pool, not list

During brainstorming show every valid card by job, each with a one-line
role note (what it does, why it is here). Do not trim to 99, do not pick a
"best 30": he asked for the pool and the session cut it before he asked.
Game Changers go in their own section, not out of the pool; bracket 3
allows three, and he decides which. The cut to 99 happens in step 5, when
he asks for it. `references/pages.md` has the layout and the builder
script.

### 5. Build in blocks, explain each, add nothing without a go

Build in this order, because each block constrains the next:

1. Lands (36 minimum) and the base removal suite: the skeleton.
2. Engines: the loops that generate the deck's resource.
3. Payoffs and locks: what the engines are for.
4. Ramp, draw, protection and the connect package (how the key creature
   actually deals damage or the key permanent survives).

For each block, before touching Archidekt, present: the pieces (with what
each does), how many and why that many, the odds of having the block online
by turn N (`scripts/odds.py`; see below), and what stops it. Then stop and
wait. The session added cards while he only wanted the plan explained; an
explicit "add them" is the only thing that moves cards into Archidekt.
Once the deck exists on Archidekt, further changes go through the
`archidekt-recommender` /swap board, not direct API writes.

**What counts as an engine.** An engine is a loop that feeds itself: its
output is the input that runs it again. Glissa's combat trigger is a
repeatable effect, not an engine; a land-sacrifice "loop" with five
one-shot fuel cards is a synergy that runs five times. Before calling
anything an engine, name the loop (A makes X, X pays for A again), name the
fuel, count the fuel cards in the deck, and give the odds of drawing them.
If the loop needs a card that is not in the deck yet, it is a plan, and say
so.

**Odds.** `scripts/odds.py k n` prints the chance that at least one of `k`
copies is in the first `n` cards of a 99-card deck (opening hand is 7; add
one per draw step). `scripts/odds.py k --table` prints n = 7, 10 and 14 in
one line, which is what a block summary needs. Use the numbers rather than
"likely" or "usually"; "4 pieces, 47% by turn 4" is something he can weigh.

### 6. Sweep every role in the block, then red-team it

A red team can only judge what it is handed. In the counter-lock session the
five reviewers were given 116 card texts and told not to search, so they
checked the plan's soundness and could not see that Journey to Eternity,
Phyrexian Reclamation, Conduit of Worlds and Bear Umbra were missing from
it; Artem found that gap by asking. So before the adversaries run, name
every role in the block (for a counter engine: strip, return, fuel, untap,
sink, closer) and run one systematic Scryfall search per role in the deck's
colors, ordered by EDHREC rank, and put the whole result in the bundle the
reviewers get. The survey finds what is missing; the red team finds what is
wrong. Neither does the other's job.

Spawn adversarial subagents on every block and every ranking before
presenting: one per component (each engine, the payoff package, the
commander choice) plus one whose only job is "does this match the goal, in
his words". Give each the card texts and the rules file up front; they must
not call Scryfall. `references/red-team-brief.md` is the prompt: six checks
(reach, timing, rate, fuel, bracket, fit) and the rule that every claim
quotes card text or a rule number. Fix what they find, then present. The
point of the pass is that he stops being the one who catches things.

### 7. Present

Pages go in `decks/` (gitignored; the repo is public), built from a JSON
spec by `scripts/build_page.py` in the style of
`decks/counter-lock-brainstorm.html`: the goal at the top, sections of
cards with picture, full oracle text and a role note, Game Changers flagged.
`references/pages.md` has the spec format and the rules for what a page
shows. Never write credentials or his email into any page, spec or note.

In chat, the same standard as on the page: each card with its job, blocks
with counts and odds, and the recommendation with its reasons. Keep it
short and let the page carry the volume.

## Files

- `references/rules-traps.md`: the rules claims that were wrong from memory,
  each as claim, what is true, and the rule or card text that settles it.
  Read before writing any interaction claim; add to it when a red-team pass
  finds a new one.
- `references/red-team-brief.md`: the adversary prompt and how to hand it
  card texts and the Comprehensive Rules.
- `references/pages.md`: the page spec format, the builder, and what every
  card entry shows.
- `scripts/scryfall_local.py`: offline search over every Commander-legal
  card, oracle tag and ruling; the tool every agent uses instead of the API.
- `scripts/odds.py`: hypergeometric draw odds.
- `scripts/build_page.py`: JSON spec to brainstorm page, with a Scryfall
  collection fetch and a local card cache.
