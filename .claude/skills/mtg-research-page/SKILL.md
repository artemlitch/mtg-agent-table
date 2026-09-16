---
name: mtg-research-page
description: How any Magic research is presented to Artem — archetype surveys, matchup guides, commander shortlists, meta studies, card comparisons, game post-mortems, anything that names cards. Builds a local HTML page in decks/ (gitignored) where every card is its Scryfall picture with oracle text and links, via scripts/build_page.py from a JSON spec. Use it whenever research is about to be shown to him, whether or not a deck is being built; the deck-builder skill is the method for building a deck, this is the presentation for everything.
---

# MTG research page

Artem does not know cards by name. A page of card names is useless to him;
the picture and the oracle text are the content. Every piece of research
that names cards is presented as a local HTML page built by
`scripts/build_page.py`, in the same shell as every page he has been given
so far.

## Rules

- **Local file, in `decks/`.** The repo is public and `decks/` is gitignored.
  Spec, card cache and notes go in `decks/<theme>/`, the page at
  `decks/<theme>-<kind>.html`. Give him the file path; he opens it in a
  browser. Never publish through the Artifact tool (its sandbox blocks the
  Scryfall image host, so cards render as names) and never hand-write a
  card page.
- **Never write credentials, tokens or his email** into a page, spec or
  note.
- **Every card entry shows** the picture (linked to Scryfall), name with
  color pips, cost and type line, GAME CHANGER and NOT COMMANDER-LEGAL
  flags, your role note, the full oracle text (both faces), and Scryfall /
  EDHREC / Archidekt links. The builder fills all of it except the note.
- **The role note is the point.** One line, written by you, saying what the
  card does *for this question* and why it is here. "Exiles their dying
  creatures and any creature card they would mill; turns off the edict
  recasts" is a note. "Good graveyard hate" is not.
- **Rejected things stay visible** with the reason, so he sees why and does
  not ask again.
- **His goal, in his words, at the top.** The `goal` field is the quote.

## The spec

```json
{
  "title": "Cast Denial Field Guide",
  "goal": "his request, quoted",
  "verdict": "<b>Pick: X.</b> one paragraph, HTML allowed",
  "links": [{"label": "Opponent deck on Archidekt", "url": "https://archidekt.com/decks/20926601"}],
  "options_step": "Survey", "options_title": "Seven archetypes, ranked",
  "options_lede": "Click one to filter the page to its colors.",
  "options": [
    {"key": "kutzil", "ci": "GW", "short": "Kutzil (GW)", "title": "1 · Cast denial — PICK",
     "commanders": "Kutzil, Malamet Exemplar", "text": "why, one paragraph",
     "gains": "optional", "loses": "optional", "tag": "Bracket 3 · lethal T7–8 · 1 GC"}
  ],
  "sections": [
    {"eyebrow": "The opponent", "title": "What the Muldrotha deck relies on",
     "lede": "one or two sentences", "html": "<p>optional free prose or lists</p>",
     "table": {"head": ["Archetype", "Why"], "rows": [["Cast denial", "…"]]},
     "cards": [["Muldrotha, the Gravetide", "role note"]], "big": true}
  ]
}
```

Every part of a section is optional; a section can be prose only, a table
only, cards only, or any mix (prose renders first, then the table, then the
cards). `big` makes the card grid wider, for commanders. `options` is for
ranked alternatives (archetypes, shapes, commanders, lines) and drives the
color filter; leave it out when there is nothing to rank. Card names are
exact Scryfall names, front face for double-faced cards. Notes may contain
HTML.

## Building

```
python3 .claude/skills/mtg-research-page/scripts/build_page.py decks/<theme>/spec.json decks/<theme>-guide.html
```

The builder fetches every name from Scryfall's `/cards/collection` (75 per
call, one second apart, with the headers Scryfall requires), caches the
results in `spec.cards.json` next to the spec, and reuses the cache on later
builds, so editing a note costs no network. `--refresh` refetches;
`--fetch-only` writes the cache and stops. A name Scryfall cannot resolve
stops the build. If Scryfall is down, the text comes from the local database
(`decks/scryfall/commander-cards.json`, maintained by the deck-builder
skill's `scryfall_local.py --refresh`) and the entry renders without a
picture; rebuild with `--refresh` once it is back.

Run the builder in the main session, never from a subagent running beside
another Scryfall user; the rate limit is per IP.

## In chat

The page carries the volume; the message carries the decision: the pick,
the reasons, and the file path. Every card named in chat still gets its job
in the same sentence, because the message is read before the page is opened.

## Research itself

This skill is presentation only. The method for a survey lives elsewhere:
the `archidekt` skill's Card research section and web-research brief, the
`deck-builder` skill's steps for a deck, and subagents for deep research
(they search the local database, never the API).
