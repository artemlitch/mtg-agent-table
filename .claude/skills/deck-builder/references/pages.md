# Brainstorm pages

How a deck page is built and what it must show. The reference page is
`decks/counter-lock-brainstorm.html`; `scripts/build_page.py` produces the
same layout from a JSON spec.

## Where pages live

`decks/` in mtg-agent-table, which is gitignored. The repo is public, so a
page in the repo root would be published with the next push. Put the spec,
the card cache and any research notes in a folder next to the page
(`decks/<theme>/`). Never write credentials, tokens or Artem's email into a
page, a spec or a note; the pages are opened in a browser and shared as
files.

## What every card entry shows

Artem does not know cards by name, so a name on its own tells him nothing.
Each entry renders:

- the card picture (Scryfall `normal` image, linked to the Scryfall page);
- the name, with color pips for its color identity;
- mana cost and type line, with a GAME CHANGER flag when Scryfall says so
  and a BANNED flag if it is not Commander-legal (the entry stays visible so
  he sees why it was considered and rejected);
- the role note: one italic line, written by you, saying what the card
  does for this deck and why it is in this section. "A 10/10 for four under
  six stun counters; sacrificing a land untaps it" is a role note. "Good
  stun creature" is not;
- the full oracle text, both faces for double-faced cards.

The builder fills in everything except the role note from Scryfall, so the
spec only carries names and notes.

## Pool, not list

During brainstorming, a section holds every valid card for its job in the
chosen colors, not a shortlist. Artem asked for the whole pool and the
session cut it to 99 before he asked; the cut is his to make, later, on the
/swap board. Rules for the pool:

- Group by job (removers, locks by family, untappers, ramp, draw,
  protection, connect), one section per job, a lede sentence saying what
  the job is and how the family works.
- Game Changers get their own section rather than being dropped: bracket 3
  allows three and he picks which.
- Off-color cards that are worth knowing about (a better version in another
  color, a reason a shape was ranked lower) can appear with the color
  filter marking them off; the page's filter greys out cards outside the
  chosen shape instead of hiding them.
- Trap cards (Vesuva and Dark Depths) stay in with a role note that says
  why they do not work. Seeing the trap prevents the question later.

## Page structure

The reference page walks the steps of SKILL.md in order, and a page for a
later stage (engines, a block explanation) uses the same shell with the
parts it does not need left empty:

1. Header: title and a subtitle that is the goal in Artem's words.
2. Insight box: the one paragraph that explains why the plan works.
3. Shapes: the color/commander options, ranked, each with gains, losses and
   bracket; clicking one filters the page to its colors.
4. Commanders: ranked candidates as card entries, including the rejected
   ones with the reason ("Not a remover. Listed so you know why it was
   dropped").
5. Sections: the pool by job.
6. Extras: free HTML blocks for the draft list, how a game goes, gotchas,
   and where the research came from. A draft or a pool list can be given
   as groups of names and the builder renders the column list.

## The spec

```json
{
  "title": "Counter Lock Brainstorm",
  "subtitle": "the goal, in his words",
  "insight": "<b>The core insight.</b> one paragraph, HTML allowed",
  "shapes_lede": "Ranked. Click a shape to filter.",
  "shapes": [
    {"key": "sultai", "ci": "BGU", "short": "Sultai Xavier Sal (recommended)",
     "title": "Sultai Xavier Sal — RECOMMENDED",
     "commanders": "Xavier Sal, Infested Captain · Glissa in the 99",
     "text": "why this shape, in a paragraph",
     "gains": "what it gets", "loses": "what it gives up", "bracket": "Bracket 3"}
  ],
  "commanders_lede": "Ranked by fit.",
  "commanders": [["Xavier Sal, Infested Captain", "role note"]],
  "fill_lede": "Cards grouped by family.",
  "sections": [
    {"title": "Stun counters: untap to unlock", "lede": "how the family works",
     "cards": [["Baloth Prime", "role note"], ["Sleep-Cursed Faerie", "role note"]]}
  ],
  "extras": [
    {"step": "Step 4", "title": "Draft", "lede": "optional", "html": "<p>free HTML</p>",
     "groups": [["Lands (36)", ["Command Tower", "Forest ×4"]]]}
  ]
}
```

`ci` on a shape is the color identity letters the filter uses. Every card
is `[name, role note]`; use the exact Scryfall name, front face for
double-faced cards. A note may contain HTML.

## Building

```
python3 .claude/skills/deck-builder/scripts/build_page.py decks/<theme>/spec.json decks/<theme>-brainstorm.html
```

The builder fetches every name in one or more `/cards/collection` calls
(75 per call, one second apart, with the `User-Agent` and `Accept` headers
Scryfall requires), caches the results in `spec.cards.json` next to the
spec, and reuses the cache on later builds so editing a role note costs no
network. `--refresh` refetches; `--fetch-only` fetches and writes the cache
without rendering (this is how the red-team agents get their card texts).
Names Scryfall cannot resolve are reported and the build stops, because a
misspelled name would otherwise render as a missing card.

Run the builder in the main session, never from a subagent running beside
another Scryfall user; the rate limit is per IP.

## In chat

The page carries the volume; the chat message carries the decision. Give
the recommendation and its reasons, each block with its count and odds,
and the link to the page. Every card named in chat still gets its job in
the same sentence, because the message is read before the page is opened.
