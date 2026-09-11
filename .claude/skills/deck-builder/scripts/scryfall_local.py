#!/usr/bin/env python3
"""Search a local copy of Scryfall's card database. No network, no rate limit,
so any number of agents can run it at once.

The database lives in decks/scryfall/ (gitignored) and is built by
`scryfall_local.py --refresh` from Scryfall's bulk-data downloads:
commander-cards.json (every Commander-legal card, slimmed),
oracle-tags.json (every oracle tag with its cards, parents and aliases) and
rulings.json (rulings by card name). Refresh it when a new set lands.

Usage:
    scryfall_local.py --ci BG --text "remove all counters"          # substring, case-insensitive
    scryfall_local.py --ci BG --regex "untap all (lands|permanents)"  # regex on oracle text
    scryfall_local.py --ci BG --otag free-sacrifice-outlet           # oracle tag, descendants included
    scryfall_local.py --ci BG --keyword persist --type creature --cmc-max 3
    scryfall_local.py --name "Vampire Hexmage" --rulings             # one card, full text + rulings
    scryfall_local.py --ci BG --text counter --limit 200 --json out.json

--ci is the deck's color identity; a card qualifies if its identity is a
subset (colorless always qualifies). Results are ordered by EDHREC rank
(most played first). Game Changers are flagged GC.
"""
import argparse, json, os, re, sys, gzip, io, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
DB = os.path.join(ROOT, 'decks', 'scryfall')
UA = 'mtg-agent-table/1.0 (+https://github.com/artemlitch/mtg-agent-table)'


def refresh():
    os.makedirs(DB, exist_ok=True)
    meta = json.load(urllib.request.urlopen(urllib.request.Request('https://api.scryfall.com/bulk-data', headers={'User-Agent': UA, 'Accept': 'application/json'}), timeout=60))
    B = {b['type']: b for b in meta['data']}

    def rows(kind):
        raw = urllib.request.urlopen(urllib.request.Request(B[kind]['jsonl_download_uri'], headers={'User-Agent': UA}), timeout=600).read()
        for line in gzip.GzipFile(fileobj=io.BytesIO(raw)):
            if line.strip():
                yield json.loads(line)

    def faces(c, k):
        return c.get(k) or ' // '.join(f.get(k, '') for f in c.get('card_faces', []))
    cards, ids = [], {}
    for c in rows('oracle_cards'):
        # Commander legality alone: the oracle file holds one printing per card, and for some
        # cards that printing is digital-only (Glacial Chasm's is), so a paper filter drops real cards.
        if c.get('legalities', {}).get('commander') != 'legal':
            continue
        cards.append({'name': c['name'], 'oracle_id': c.get('oracle_id'), 'ci': ''.join(c.get('color_identity', [])), 'cost': faces(c, 'mana_cost'), 'cmc': c.get('cmc'), 'type': c.get('type_line', ''), 'pt': (f"{c.get('power')}/{c.get('toughness')}" if c.get('power') is not None else ''), 'text': faces(c, 'oracle_text'), 'keywords': c.get('keywords', []), 'gc': c.get('game_changer', False), 'rank': c.get('edhrec_rank'), 'set': c.get('set'), 'released': c.get('released_at')})
        ids[c.get('oracle_id')] = c['name']
    json.dump(cards, open(os.path.join(DB, 'commander-cards.json'), 'w'))
    tags = {}
    for t in rows('oracle_tags'):
        tags[t['slug']] = {'label': t.get('label'), 'description': t.get('description'), 'parents': t.get('parent_ids'), 'id': t.get('id'), 'aliases': t.get('aliases'), 'cards': [ids[g['oracle_id']] for g in t['taggings'] if g.get('oracle_id') in ids]}
    json.dump(tags, open(os.path.join(DB, 'oracle-tags.json'), 'w'))
    rul = {}
    for r in rows('rulings'):
        if r.get('oracle_id') in ids:
            rul.setdefault(ids[r['oracle_id']], []).append(r.get('comment'))
    json.dump(rul, open(os.path.join(DB, 'rulings.json'), 'w'))
    print(f"refreshed: {len(cards)} Commander-legal paper cards, {len(tags)} oracle tags, rulings for {len(rul)} cards, updated {B['oracle_cards']['updated_at'][:10]}", file=sys.stderr)


def load():
    try:
        cards = json.load(open(os.path.join(DB, 'commander-cards.json')))
    except FileNotFoundError:
        sys.exit(f'no local database at {DB}; run scryfall_local.py --refresh first')
    return cards


def tag_cards(slug):
    tags = json.load(open(os.path.join(DB, 'oracle-tags.json')))
    byid = {v['id']: k for k, v in tags.items() if v.get('id')}
    for k, v in tags.items():
        if slug in (v.get('aliases') or []):
            slug = k
    if slug not in tags:
        sys.exit(f'no oracle tag {slug!r}; grep the tag list with: python3 -c "import json;print([k for k in json.load(open(\'{DB}/oracle-tags.json\')) if \'{slug}\' in k])"')
    want = {slug}
    changed = True
    while changed:  # include every descendant tag
        changed = False
        for k, v in tags.items():
            if k not in want and any(byid.get(p) in want for p in (v.get('parents') or [])):
                want.add(k); changed = True
    names = set()
    for k in want:
        names.update(tags[k]['cards'])
    return names


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--refresh', action='store_true', help='rebuild the local database from Scryfall bulk data')
    ap.add_argument('--ci', help='color identity the deck allows, e.g. BG, C for colorless only')
    ap.add_argument('--text', action='append', default=[], help='substring the oracle text must contain (repeatable, all must match)')
    ap.add_argument('--regex', action='append', default=[], help='regex the oracle text must match (repeatable)')
    ap.add_argument('--not-text', action='append', default=[], help='substring the text must NOT contain')
    ap.add_argument('--otag', help='oracle tag slug; descendants and aliases included')
    ap.add_argument('--keyword', action='append', default=[], help='keyword ability the card has, e.g. persist')
    ap.add_argument('--type', help='substring of the type line, e.g. creature, land, "artifact creature"')
    ap.add_argument('--not-type', help='substring the type line must NOT contain')
    ap.add_argument('--cmc-max', type=float)
    ap.add_argument('--cmc-min', type=float)
    ap.add_argument('--name', help='exact card name (case-insensitive)')
    ap.add_argument('--rulings', action='store_true', help='print rulings too (with --name, or for every result)')
    ap.add_argument('--no-gc', action='store_true', help='exclude Game Changers')
    ap.add_argument('--limit', type=int, default=60)
    ap.add_argument('--full', action='store_true', help='print full oracle text instead of the first 200 characters')
    ap.add_argument('--json', help='also write the results to this JSON file')
    a = ap.parse_args()
    if a.refresh:
        refresh(); return
    cards = load()
    if a.name:
        cards = [c for c in cards if c['name'].lower() == a.name.lower() or c['name'].split(' // ')[0].lower() == a.name.lower()]
    if a.ci is not None:
        allowed = set(a.ci.upper().replace('C', ''))
        cards = [c for c in cards if set(c['ci']) <= allowed]
    if a.otag:
        names = tag_cards(a.otag)
        cards = [c for c in cards if c['name'] in names]
    for t in a.text:
        cards = [c for c in cards if t.lower() in c['text'].lower()]
    for t in a.not_text:
        cards = [c for c in cards if t.lower() not in c['text'].lower()]
    for r in a.regex:
        rx = re.compile(r, re.I)
        cards = [c for c in cards if rx.search(c['text'])]
    for k in a.keyword:
        cards = [c for c in cards if k.lower() in (x.lower() for x in c['keywords'])]
    if a.type:
        cards = [c for c in cards if a.type.lower() in c['type'].lower()]
    if a.not_type:
        cards = [c for c in cards if a.not_type.lower() not in c['type'].lower()]
    if a.cmc_max is not None:
        cards = [c for c in cards if (c['cmc'] or 0) <= a.cmc_max]
    if a.cmc_min is not None:
        cards = [c for c in cards if (c['cmc'] or 0) >= a.cmc_min]
    if a.no_gc:
        cards = [c for c in cards if not c['gc']]
    cards.sort(key=lambda c: (c['rank'] is None, c['rank'] or 0))
    print(f'{len(cards)} cards match; showing {min(len(cards), a.limit)}')
    rul = json.load(open(os.path.join(DB, 'rulings.json'))) if a.rulings else {}
    for c in cards[:a.limit]:
        text = c['text'] if a.full or a.name else c['text'][:200]
        print(f"- {c['name']} [{c['ci'] or 'C'}] {c['cost']} | {c['type']} {c['pt']} {'| GC ' if c['gc'] else ''}| rank {c['rank']} :: {text.replace(chr(10), ' | ')}")
        for r in rul.get(c['name'], []):
            print(f"    ruling: {r}")
    if a.json:
        json.dump(cards[:a.limit], open(a.json, 'w'), indent=1)


if __name__ == '__main__':
    main()
