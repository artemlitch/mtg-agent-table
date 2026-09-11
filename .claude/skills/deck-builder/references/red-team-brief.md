# Red-team brief

The prompt for the adversarial subagents in SKILL.md step 6. Spawn one
`general-purpose` agent per component (each engine, each payoff package,
the commander ranking, the removal suite) plus one whose only check is fit
to the goal. Run them in parallel; each gets the same materials and a
different target.

## Why the agents get the texts up front

Scryfall rate-limits per IP. Several agents fetching cards at once trips
HTTP 429 and can escalate to a longer block, which stalls the main session
too. So the main session fetches every card the block mentions (one
`/cards/collection` POST, up to 75 names, with `User-Agent` and
`Accept: application/json` headers) and writes the oracle texts to a file
the agents read. The agents are told not to call Scryfall. If an agent
needs a card that is not in the file, it says so in its report and the
main session fetches it.

`scripts/build_page.py --fetch-only spec.json` does this fetch and writes
the cache next to the spec; the cache is plain JSON with `name`, `oracle`,
`type_line`, `mana_cost` and `game_changer` per card, which is what the
agents need.

## The rules file

Download the Comprehensive Rules once and keep it in `decks/` (gitignored):

1. Open https://magic.wizards.com/en/rules and find the link to the current
   text version (it ends in `.txt`; the file name contains a space, for
   example `MagicCompRules 20250919.txt`).
2. Fetch it with the space escaped as `%20`, for example
   `curl -o decks/comp-rules.txt "https://media.wizards.com/2025/downloads/MagicCompRules%2020250919.txt"`
   (the path changes with each update; take it from the rules page).
3. Reuse the file for the rest of the session and across sessions until a
   new set releases.

Agents grep it for the phrases they need to cite (`grep -n "stun counter"
decks/comp-rules.txt`).

## The prompt

Fill in the bracketed parts.

```
You are reviewing one part of a Commander deck plan before it is shown to
its owner. Your job is to find what is wrong with it. Assume the author was
optimistic. The owner is not an experienced player and should not be the
one who catches mistakes, so anything you let through reaches him.

The deck's goal, in the owner's words: "[goal]"

Your target: [the engine / package / ranking / commander choice, described
in two or three sentences, with the claims the plan makes about it: what
it does, how often, what it needs].

Materials:
- Card texts: [path to the card cache JSON]. Every card in the target is
  there with its full oracle text, type line and mana cost. Do not call
  Scryfall or any other API; if a card you need is missing, list it under
  "missing cards" in your report and move on.
- Comprehensive Rules: [path to comp-rules.txt]. Grep it for the rule you
  want to cite.
- Known traps from earlier reviews: [path to references/rules-traps.md].

Run these six checks, in order, and report on each even if it passes:

1. Reach. What can each piece NOT touch? Read the object list in the text
   (permanent vs creature vs "artifacts, creatures, and enchantments";
   target vs no target; battlefield vs exile vs graveyard). Name the deck's
   own cards that fall outside each piece's reach.
2. Timing. When does each piece actually work? Sorcery speed, "activate
   only as a sorcery", summoning sickness on {T} abilities (CR 302.6),
   upkeep vs end step, triggers that need a cast to fire, "enters" vs
   "becomes". State the earliest turn the target is online given its mana
   costs and these limits.
3. Rate. How much does the target produce per turn, honestly: counters
   removed, cards drawn, damage dealt, mana made. One number per turn for
   turns 4, 6 and 8, with the assumptions written out. If the plan's
   number is higher than yours, say by how much and why.
4. Fuel. If the target is called an engine or a loop, name the loop: what
   A produces, and how that output pays for A again. If any step needs a
   card drawn from the library, count how many such cards the deck holds
   and give the chance of having one in the first 7, 10 and 14 cards
   (hypergeometric; the deck is 99 cards). If the loop runs a fixed number
   of times and stops, say it is a synergy, not an engine.
5. Bracket. Does any pair of cards here go infinite (list the pair and the
   loop)? How many Game Changers does the target use (bracket 3 allows
   three in the whole deck)? Is there mass land denial, extra-turn
   chaining, or a two-card win? Cite the card texts.
6. Fit. Does the target do the job in the goal sentence above, or does it
   do something adjacent (fix mana, recur cards, make tokens) that the
   plan is describing as if it were the job? Quote the goal and say which
   words the target satisfies and which it does not.

The one rule for the report: every claim quotes card text or a rule
number. "Hexmage cannot reach exile" is not a finding; "Hexmage: 'remove
all counters from target permanent'; CR 110.1: a permanent is a card or
token on the battlefield; suspended cards are in exile" is. If you cannot
find text or a rule to support a claim, mark it as unverified rather than
asserting it.

Report format:
- Verdict: one line, "holds", "holds with fixes" or "does not hold".
- Findings: one per line, most serious first, each with the quoted text or
  rule that settles it and what it means for the plan.
- Numbers: the rate and fuel figures from checks 3 and 4.
- Missing cards: names you needed and did not have.
- New traps: any rules point that surprised you, in the claim / truth /
  rule form used by rules-traps.md, so it can be added there.
```

## After the agents report

- Fix the plan, then re-run the agent whose target changed. A fix that
  swaps a card can break another check.
- Add every "new trap" to `references/rules-traps.md`.
- Carry the verdicts into the presentation: "red-teamed; the fuel check
  cut this from engine to synergy" is something Artem should read, not
  something to hide.
