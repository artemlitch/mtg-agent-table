---
name: archidekt
description: Read and edit Magic decks on archidekt.com via its (unofficial) REST API, and research cards for Commander decks. Use when asked to fetch, analyze, or modify an Archidekt deck — adding/removing/recategorizing cards, checking deck contents, or resolving card printings — and whenever brainstorming, building, or upgrading a deck around a commander, theme, or mechanic (its Card research section is the method). Logs in as the artemlitch account with ARCHIDEKT_USER / ARCHIDEKT_PASS from the mtg-agent-table repo's .env.
---

# Archidekt API

Archidekt has no official public API, but its Django REST backend is stable and
scriptable. Everything below was reverse-engineered from the site's frontend
bundles and verified working (2026-08).

A ready-to-use helper lives next to this file: `archidekt_api.py`
(login, deck fetch, commander-legal printing search, batch edits).

## Credentials (account: artemlitch, user id `1023451`)

The login lives in the mtg-agent-table repo's `.env` (gitignored) as
`ARCHIDEKT_USER` / `ARCHIDEKT_PASS`, the same variables the deck studio server
reads. **Never write the password into this skill or any tracked file: the
repo is public.**

- `archidekt_api.py` finds them on its own: the environment first, then the
  nearest `.env` walking up from the script's folder or the working directory.
- For raw curl, load them first from the repo root:
  `set -a; source .env; set +a`

## Auth

```
POST https://archidekt.com/api/rest-auth/login/
Content-Type: application/json
{"username": "$ARCHIDEKT_USER", "password": "$ARCHIDEKT_PASS"}
```

Response contains `access_token` (JWT, expires in **1 hour**) and
`refresh_token`. Send on every authenticated request as:

```
Authorization: JWT <access_token>
```

`POST /api/rest-auth/token/refresh/` with cookies does NOT work; just re-login
when the token expires. Read endpoints need no auth for public decks.

## Reading a deck

```
GET https://archidekt.com/api/decks/{deckId}/
```

Key structure:
- `cards[]` — each entry:
  - `id` — the **deckRelationId** (needed to modify/remove this entry)
  - `card.id` — the **printing id** (edition-specific)
  - `card.oracleCard.name`, `.cmc`, `.colors`, `.legalities`
  - `quantity`, `categories` (list of names; first = primary), `modifier`, `label`
- `categories[]` — `{name, includedInDeck, includedInPrice}`. A card's primary
  category having `includedInDeck: false` (Maybeboard, Sideboard) excludes it
  from the deck count.

## Searching public decks by commander (meta corpora)

```
GET https://archidekt.com/api/decks/v3/?commanderName=<urlencoded name>&formats=3&orderBy=-viewCount&pageSize=50&page=N
```

No auth needed. Rows carry `id`, `name`, `owner.username`, `updatedAt`,
`viewCount`, `edhBracket` (declared bracket, or null), `size`, `theorycrafted`,
`private`. Two traps, both hit on 2026-09-16 while building the Zur corpus:
- `/api/decks/cards/` (the older route) now answers "Unknown API route".
- The filter parameter is `commanderName`. Archidekt **silently ignores
  unknown parameters** and returns HTTP 200 with a page of unrelated decks,
  so a scraper must fetch one probe deck and abort if its commander is wrong
  (`decks/zur/scrape_archidekt.py` `check_filter()` is the reference).

Fetch each deck with the read endpoint above, about one request a second,
and keep a fetch log so a re-run resumes. Corpus schema: any deck file in
`decks/narci/corpus/archidekt/`.

## Finding a printing id for a card name

```
GET https://archidekt.com/api/cards/v2/?name=<urlencoded name>
```

Filter `results[]`:
- exact name match on `oracleCard.name` (front face for `//` split/MDFC cards)
- `oracleCard.legalities.commander == "legal"` if building EDH
- skip `collectorNumber` starting with `A-` (Alchemy rebalances — different
  oracle text, first result is often one of these!)

Then pick the **cheapest printing, ties to the oldest** (Artem's standing
rule, 2026-09-16: "pick the cheapest printing for every single card; tie
breaker goes to oldest printing"). `archidekt_api.Archidekt.search_printing`
does this by default: it walks every page of the search (60 per page),
skips `editiontype == "memorabilia"` (gold-bordered World Championship
decks: Archidekt marks them commander-legal because legality is per oracle
card, but they are not real cards), ranks by `prices.tcg` (TCGplayer nonfoil
market), then printings with only a Card Kingdom price, then only a
Cardmarket price, then unpriced (0 means "not listed", never free), and
breaks ties on `releasedAt`. Pass `choose="oldest"` only if asked.

## Editing a deck (the important part)

```
PATCH https://archidekt.com/api/decks/{deckId}/modifyCards/v2/
Authorization: JWT <token>
{"cards": [ <action objects> ]}
```

One action object per change. All three actions share this shape:

```json
{
  "action": "add" | "modify" | "remove",
  "cardid": <printing id>,
  "customCardId": null,
  "categories": ["Category Name"],
  "patchId": "any-unique-string",
  "modifications": {
    "quantity": 1,
    "modifier": "Normal",
    "customCmc": null,
    "companion": false,
    "flippedDefault": false,
    "label": ""
  }
}
```

Rules learned the hard way:
- **`modify` and `remove` REQUIRE an extra `"deckRelationId": <cards[].id>`
  field.** Omitting it fails with the cryptic 400
  `"Uh oh, failed to create a log. Not saving anything"` — nothing saves.
- `patchId` is a client echo: the response's `add[]` maps your patchIds to new
  `deckRelationId`s. Any unique string works.
- For `remove`, the modifications content is ignored but must be present.
- Success is **HTTP 201**. Response: `{"add": [...], "createdCategories": [...]}`.
- Unknown category names are auto-created with `includedInDeck: true` and
  reported in `createdCategories`.
- Quantity changes (e.g. basics 4 -> 3) are `action: "modify"` with the new
  quantity, not remove+add.
- Batching: one PATCH can mix dozens of adds/modifies/removes; it is atomic in
  practice. Always re-GET the deck afterward and verify totals.
- `label: ""` is fine. `label: ","` works but shows a stray comma in the UI.

## Other verified endpoints

- `PATCH /api/decks/{id}/synchronizeCategories/` `{"categories": [...]}` —
  edit category properties (includedInDeck etc.)
- `GET /api/decks/{id}/logs/` — per-change edit history (auth, owner)
- `GET /api/cards/auto/?string=<q>` — name autocomplete

## Related data sources (no auth)

- EDHREC stats: `https://json.edhrec.com/pages/commanders/<slug>.json` —
  per-card inclusion % (`num_decks`/`potential_decks`) and `synergy`.
  The `/average-deck.json` variant is 403-blocked; synthesize a consensus list
  from the cardlists instead.
- Scryfall: `https://api.scryfall.com/cards/named?exact=<name>` and
  `/cards/search?q=is%3Agamechanger` (official Commander bracket
  Game Changer list). Scryfall requires a `User-Agent` header — requests
  without one get HTTP 400.

## Finding decks

Browse the account's decks at https://archidekt.com/decks/ (deck ids are in the
URLs), or list them via the login response, which includes `user.decks[]` with
`{id, name}` for every deck on the account.

## Creating & updating decks

- `POST /api/decks/v2/` (auth) `{"name": ..., "deckFormat": 3, "private": false}`
  → 201 with deck object. deckFormat 3 = EDH. (`POST /api/decks/` is 405.)
- `PATCH /api/decks/{id}/update/` (auth) — set `description` (markdown renders
  as the deck primer), `name`, `private`, etc. Plain PATCH/PUT on
  `/api/decks/{id}/` are 405.
- Helper methods: `create_deck()`, `update_deck()` in archidekt_api.py.

## Card research: finding cards by EFFECT (do this, in this order)

Hard-learned rules from real deck builds. Recall-built decks reliably miss
cards; search-built decks don't. When building or upgrading a deck:

### 1. Start a deep web research agent first (it runs while you search)

Scryfall only finds cards whose wording or tag you already thought to search
for, and EDHREC only shows what people already play under an existing
commander. Neither finds *ideas*: combos, rules interactions that make a card
better than it reads, odd commanders built for the theme, the archetype's
known weak spots. People writing about the game do. One card list on Draftsim
turned up Amy Pond and Sensational Spider-Man for a suspend and stun-counter deck; no
planned oracle search would have.

For a new deck, a new theme or mechanic, a commander hunt, or a big upgrade,
launch a background `general-purpose` agent before your own Scryfall work,
with the brief in `references/web-research-brief.md` filled in. It covers
strategy articles, primers and public decklists, Reddit and forum threads,
MTG wiki mechanic pages and deck-tech videos. For a broad theme, split it
across two or three agents by source type. Skip it for a few targeted swaps,
where EDHREC consensus (step 7) is enough.

When it reports back:
- Merge its cards with your search results. Several independent sources
  naming a card means consensus; a card named once is a hidden gem worth a
  closer look, not an automatic include.
- Everything in it is a lead. Articles go stale, list Alchemy cards, and get
  rules wrong: verify every name (step 8) and re-check every rules claim
  before it reaches a deck page.
- Mine it for search terms. The articles' vocabulary (mechanic names, cycle
  names, rules phrases) becomes new `otag:` and `o:` searches.

### 2. Scryfall oracle tags beat regex — start your own searches here

Human-curated function tags immune to wording differences:

    /cards/search?q=otag:theft            # 720 cards, all theft effects
    /cards/search?q=otag:impulse          # exile-and-play effects

Oracle-text regex (`o:/exile.*top card/`) silently misses novel templating —
it missed Black Widow, Super Spy ("that player exiles cards from the top of
their library until...") because the words appear in a different order.
Use regex only for exact rules phrases, never to enumerate an effect family.

**Tag names are the fragile part** — a bad otag returns 0 results, not an
error, and guessed spellings (`lifegain-payoff`, `pay-life`) miss real tags
(`lifegain-matters`, `life-payment`). Before typing any `otag:`, open
`references/oracle-tags.md`: ~550 verified tags grouped by deckbuilding job
(removal, tutors, mana, aristocrats, blink, theft, typal...) with
Commander-legal counts, the prefix grammar (`gives-` vs `gains-`,
`reanimate` vs `regrowth` vs `restock`, umbrella tags that include all
descendants), and a trap list. For anything not on that page, grep
`references/oracle-tags-all.tsv` (every primary tag plus its aliases, so old
names like `tribal-elf` resolve too) or browse Scryfall's public list at
https://scryfall.com/docs/tagger-tags; regenerate the TSV with
`scripts/refresh_oracle_tags.py` when new sets land.

### 3. Filter traps (these produced real wrong answers)

- `is:commander` WITHOUT `legal:commander` returns Mystery Booster playtest
  cards (Kuroki, Thief of Talents; The Madcap Jester) — always add
  `legal:commander`.
- Alchemy/digital-only cards look real: "heist" mechanic, "perpetually",
  "conjure" wording = Arena-only. Check `legalities.commander`.
- Check the `game_changer` field on every recommendation when brackets matter
  (bracket 2 = zero GCs, bracket 3 = max three).
- Hybrid mana pips count for color identity (Nightveil Specter {U/B} is UB,
  illegal in mono-B).
- Scryfall rate-limits per IP, so several agents searching at once trip
  HTTP 429 even at 0.25s spacing (it can threaten a longer network block).
  Space searches ~1s apart, honor `Retry-After`, and run them in the
  foreground. A 429 body has no `total_cards` — record it as an error and
  retry, never as 0 (two test runs logged a whole batch of real tags as
  "0 results" this way).

### 4. Re-scope searches when the job changes

A commander search (`is:commander cmc<=4 otag:theft`) is NOT a 99 search.
Re-run the same tags UNFILTERED when filling the deck — the 7-mana non-legend
engine cards (e.g. Brainstealer Dragon) live outside the commander filter.

### 5. Always run an amplifier search for the commander's trigger class

No theme-worded search finds cards that DOUBLE the theme. If the commander's
value is a triggered ability, separately search for its multipliers:

    q=o:"triggers an additional time"     # Felix Five-Boots, Isshin, etc.
    q=o:"copy target triggered ability"   # Strionic Resonator class

Felix Five-Boots (doubles all combat-damage triggers) will never appear in any
theft search; it was the single biggest miss in a real build.

### 6. Fill card-type slots by query, not memory

Memory skews pre-2022 and misses Universes Beyond staples (Brotherhood
Regalia, Silver Shroud Costume, Psychic Paper are all UB sets). For
equipment/aura/land slots:

    /cards/search?q=t:equipment+ci<=BGU+legal:commander&order=edhrec

and review the top ~30 by EDHREC rank.

### 7. Finish with an EDHREC consensus check

Before calling a list done, pull the commander's page:

    https://json.edhrec.com/pages/commanders/<slug>.json

(slug = lowercase-hyphenated name, e.g. kotis-the-fangkeeper). Cards ranked by
inclusion + `synergy` score. Anything with high synergy you didn't consider is
a probable miss. This catches in 30 seconds what recall never will.

### 8. Batch verification via /cards/collection

Verify a whole decklist in 1-2 calls (75 identifiers max each):

    POST https://api.scryfall.com/cards/collection
    {"identifiers": [{"name": "..."}, ...]}

Check per card: color identity subset, `legalities.commander`, `game_changer`.
Scryfall requires BOTH `User-Agent` AND `Accept: application/json` headers on
POST (GET needs only User-Agent) — missing either = HTTP 400.
For double-faced cards pass the front-face name.

### Rules gotchas that keep coming up in theft decks

- "you may CAST a spell" never gets lands (lands are played, not cast);
  only "you may PLAY" effects take lands, and they still use the one
  land-drop-per-turn.
- Face-down opponent-owned exile is private — no card can poach another
  player's theft stash; permission is written into the exiling effect.
- "Whenever one or more creatures ... deal combat damage" batches to ONE
  trigger per event; "whenever a creature deals combat damage" triggers per
  creature. Read which one it is before claiming scaling.
- Double strike = two combat-damage events = two triggers.

For building a deck from an idea, or any plan/engine/package that will be presented to Artem, follow the deck-builder skill.
