# Deep web research brief

The prompt for the background research agent in SKILL.md's Card research
step 1. Fill in the bracketed parts and pass it to a `general-purpose` agent.
For a broad theme, launch two or three agents, each taking one or two of the
source groups below, so each one goes deep.

Output path: the session scratchpad if there is one, otherwise
`decks/<theme>-research.md` in mtg-agent-table (gitignored; the repo is
public).

---

```
Deep web research for a Magic: The Gathering Commander (EDH) deck.

Theme: [the mechanic or strategy, in the user's words]
Known so far: [commander or colors if chosen, bracket target, cards the user
already likes, anything ruled out]

Find every article, list, primer, deck write-up and discussion that could help
build this deck, then pull out the ideas. Go wide before going deep: run at
least 15 differently worded searches before reading anything closely, then
follow links from the best pages to their sources.

Sources to cover. Each one sees the theme from a different angle:
- Card lists and strategy articles: Draftsim, EDHREC articles
  (edhrec.com/articles, not the stats pages), Commander's Herald, Card
  Kingdom blog, TCGplayer, MTGGoldfish, Star City Games, Wargamer, Hipsters
  of the Coast.
- Deck write-ups: Moxfield and Archidekt primers and deck descriptions,
  TappedOut.
- Discussion: r/EDH, r/EDHbrews, r/magicTCG, MTGSalvation. The comments often
  name the card the article missed, or say why a card disappoints.
- Complete lists and rules: MTG wiki (mtg.fandom.com) keyword and mechanic
  pages, Wizards release notes and mechanics articles.
- Video: episode pages and descriptions for The Command Zone and other
  YouTube deck techs (decklists are often linked there).

Search phrasing: the mechanic and keyword names, "[theme] commander deck",
"[theme] EDH", "best [theme] cards", "[theme] combo", "[theme] synergy",
related mechanics that do the same job, and "[commander] primer" or
"[commander] deck tech" for every commander you find along the way.

Don't call the Scryfall API. The main session is searching it, and parallel
requests get the IP rate-limited. Names get checked later.

Write findings to [output path] as markdown, every item with its source URLs:
1. Cards: name, what it does for the theme, how many independent sources
   mention it.
2. Commanders: name, why it fits.
3. Combos and interactions: the pieces and the claimed result.
4. Strategy: game plans, win conditions, known weaknesses, what experienced
   players warn about.
5. Rules claims to verify: anything a source says about how a rule works.
6. Sources: URL, title, date, one line on what it offered. Flag anything old
   enough that newer sets may have changed the picture.

Reply with a short summary: how many sources, the top cards by mention count,
and the most surprising finds.
```
