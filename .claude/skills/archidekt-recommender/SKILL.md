---
name: archidekt-recommender
description: Propose card swaps for one of Artem's Archidekt Commander decks through the mtg-agent-table Deck Studio (the /swap page) — select the deck, research with the studio's normalized card_search / card_lookup / edhrec_commander MCP tools, file cut/add proposals with studio_propose, and let Artem confirm in the UI (the confirm is what writes to Archidekt). Use when asked to tune, upgrade, find cuts for, or suggest additions to a deck.
---

# Archidekt Recommender (Deck Studio)

You are a deckbuilding consultant. Your output is **proposals on a board**, not
edits. Artem reviews each one at http://localhost:4781/swap and clicks
*Confirm*; that click is the only thing that touches Archidekt. Never edit the
deck yourself with the `archidekt` skill's write endpoints while working in the
studio — you would desync the board.

## Setup

The studio is its OWN server, separate from the game table (the table app gets
shared with other people and must never see Archidekt credentials):

```
cd ~/projects/mtg-agent-table
bun run server/studio-server.ts        # http://localhost:4781  (STUDIO_PORT)
```

Tools come from the `studio` MCP server in `mcp-studio.json` there
(`server/studio-mcp-tools.ts`, talks to `STUDIO_URL`, default :4781). Start
your session with it mounted:

```
claude --mcp-config ~/projects/mtg-agent-table/mcp-studio.json
```

If the `studio_*` tools are not in your tool list, you are not mounted — say
so rather than hand-rolling HTTP. (Fallback only if Artem says so: every tool
is `POST http://localhost:4781/api/studio/<op>` with the same arguments;
`studio_get` is `GET /api/studio?lean=1`.)

Open the page so Artem watches proposals land: http://localhost:4781/swap

## Tools

| tool | use |
|---|---|
| `studio_list_decks` | Artem's decks (id + name) |
| `studio_select_deck {deckId}` | load the deck under discussion (clears old proposals if it's a different deck) |
| `studio_get` | the LIVE deck (re-read from Archidekt on every call) with categories/mana/mv, metadata (count, lands, avg mv, curve, per-category counts, pips), all proposals with per-option "deck after" metadata. `metadata.count` is the card count; the `cards` list is shorter because basics carry `qty` |
| `studio_propose` | file ONE proposal (see below) |
| `studio_withdraw {id}` / `studio_clear` | take proposals back |
| `studio_refresh` | force an immediate re-read (rarely needed — `studio_get` and `studio_propose` already re-read Archidekt, throttled to 10s) |
| `card_search {q}` | Scryfall search, auto-scoped to `legal:commander`, paper, and the deck's color identity; normalized fields + `inDeck` / `offColor` / `gameChanger` flags |
| `card_lookup {names[]}` | verify exact names, legality, color identity, GC status in one call |
| `edhrec_commander` | synergy/inclusion list for the deck's commander with `inDeck` flags — the consensus check |

## Workflow

1. `studio_list_decks` → `studio_select_deck` (or confirm Artem already picked one: `studio_get`).
2. Read `studio_get`. Understand the plan from the **categories** — Artem tags
   every card (Theft, Removal, Sac Outlets, Win Conditions…). Those category
   counts are the "deck metadata" he cares about; your proposals are judged by
   how they move them.
3. Research before proposing. Follow the `archidekt` skill's **Card research**
   section, but through these tools instead of raw curl. For a big upgrade or
   a new direction for the deck, start its deep web research agent first
   (step 1); for a few targeted swaps, EDHREC is usually enough. Then `otag:` searches over
   regex (pick tag names from the archidekt skill's
   `references/oracle-tags.md` rather than guessing — a wrong slug silently
   returns 0), an amplifier search for the commander's trigger class, EDHREC
   consensus (`edhrec_commander` — anything high-synergy and not `inDeck` is a
   candidate), `card_lookup` to verify every name you are about to file.
   Respect brackets: check `gameChanger` on every add.
4. File proposals with `studio_propose`. Read the response: it carries the
   finalized-deck metadata per option. If a swap drops a category below what
   the plan needs, or breaks the land count, fix the proposal before moving on.
5. Tell Artem in chat what you filed and why, in two or three lines per
   package. Then stop — he confirms or dismisses on the page. Re-run
   `studio_get` before filing more; applied swaps change the deck. There is
   no local copy to worry about — every read and every propose re-reads
   Archidekt, and confirm re-reads it again right before writing.

## The two proposal styles

**kind = "cut"** — *"This card is weak; here is what to bring in instead."*
`card` is the deck card. `options` are replacements (1–5), each with the
`category` it would join and a one-line `note` (what it adds, what it costs).

**kind = "add"** — *"This card is great; add it, here is what to cut for it."*
`card` is the new card, `category` is the category it joins. `options` are deck
cards that could leave (1–5), each with a `note`.

Rules:
- Exact Scryfall names, front face for DFCs. The board renders art for every
  card and rejects any name it cannot picture.
- Exactly one option `primary: true` — your recommendation, listed first.
- `why` and `note` are shown verbatim. One or two sharp sentences; say what the
  slot does for the plan, not generic praise.
- `package` groups related proposals ("Counter glue", "Theft engines").
  Proposals in one package render together; keep packages to 2–5 swaps.
- Basics are valid cuts (quantity is decremented). Prefer them when the add is a
  utility land.
- One proposal per card. Don't file the same cut under two packages — the board
  auto-dismisses proposals whose cards have left the deck, so the second would
  just die.

## Related

- `archidekt` skill: API details, research method, rules gotchas, credentials.
  Read its *Card research* section once per session.
- Server code: `server/deckstudio.ts`, `server/cardsearch.ts`,
  `server/studio-server.ts`, `server/studio-mcp-tools.ts` (tool docs are in
  the MCP descriptions too).
