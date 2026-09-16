#!/usr/bin/env python3
"""Render a Magic research page from a JSON spec.

    build_page.py spec.json out.html          # build (uses spec.cards.json cache)
    build_page.py spec.json out.html --refresh
    build_page.py spec.json --fetch-only      # just write the card cache

Spec format: see ../SKILL.md. Every card is [name, note]; the picture, cost,
type line, color identity, Game Changer flag, legality, oracle text and the
Scryfall link come from Scryfall's /cards/collection endpoint (75 names per
call, one second apart, User-Agent and Accept headers set). Fetched cards are
cached next to the spec so edits to the notes cost no network. If Scryfall is
unreachable, the local database (decks/scryfall/commander-cards.json) fills in
the text and the entry renders without a picture. Run this in the main
session only: Scryfall rate-limits per IP.
"""
import argparse
import html
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api.scryfall.com/cards/collection"
HEADERS = {"User-Agent": "mtg-agent-table-research-page/1.0", "Accept": "application/json",
           "Content-Type": "application/json"}
PIP = {"W": "#f8f2d8", "U": "#2f7fd1", "B": "#5a4a63", "R": "#e0532f", "G": "#3f9a5a"}
LOCAL_DB = Path(__file__).resolve().parents[4] / "decks" / "scryfall" / "commander-cards.json"

CSS = """
:root{--bg:#14110f;--card:#1f1a17;--ink:#f1e9dc;--mute:#a89e90;--acc:#e8663d;--gc:#d8b24a;--line:#3a2f28}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 Georgia,serif}
.wrap{max-width:1360px;margin:auto;padding:0 32px 60px}
header{padding:40px 0 8px}
h1{font-size:40px;margin:0;color:var(--acc)} h1 small{display:block;font-size:16px;color:var(--mute);font-weight:normal;margin-top:6px}
.links{margin:8px 0 0;font-size:14px}.links a{color:var(--acc);margin-right:16px}
.step{margin:36px 0 8px;font-size:13px;letter-spacing:.15em;text-transform:uppercase;color:var(--acc)}
h2{font-size:28px;margin:0 0 6px}
.lede{color:var(--mute);margin:0 0 14px;max-width:900px}
.insight{background:var(--card);border-left:4px solid var(--acc);padding:16px 20px;border-radius:0 10px 10px 0;max-width:980px;margin-top:18px}
.insight b{color:var(--acc)}
.prose{max-width:900px}.prose ul{padding-left:20px}.prose li{margin:4px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}
.grid.big{grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}
.c{background:var(--card);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;transition:opacity .2s;position:relative}
.c img{width:100%;aspect-ratio:488/680;display:block;background:#000}
.c .noimg{aspect-ratio:488/680;display:flex;align-items:center;justify-content:center;color:var(--mute);font-size:13px;background:#000}
.b{padding:10px 12px 12px}
.n{font-weight:bold;font-size:15px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}.n a{color:var(--ink);text-decoration:none}.n a:hover{color:var(--acc)}
.pip{display:inline-block;width:11px;height:11px;border-radius:50%;border:1px solid #0006}
.m{color:var(--mute);font-size:12px;margin-bottom:4px}
.gc{color:var(--gc);font-weight:bold}.ban{color:#f55;font-weight:bold}
.why{color:var(--acc);font-size:13px;font-style:italic;margin:4px 0}
.big .why{font-style:normal;color:var(--ink);font-size:13.5px}
.o{font-size:12.5px;color:#cfc4b4;white-space:pre-line}
.ext{font-size:11px;margin-top:6px}.ext a{color:var(--mute);margin-right:10px}
.options{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}
.opt{background:var(--card);padding:16px 18px;border-radius:12px;border-top:3px solid var(--line);cursor:pointer}
.opt.on{border-top-color:var(--acc);outline:2px solid var(--acc)}
.opt h4{margin:0 0 4px;font-size:19px;display:flex;align-items:center;gap:8px}
.opt .cm{font-size:13px;color:var(--acc);margin:4px 0 8px}
.opt p{margin:6px 0;font-size:14px}.opt .k{color:var(--mute);font-size:13px}
.opt .pw{display:inline-block;background:var(--line);border-radius:6px;padding:1px 8px;font-size:12px;margin-top:6px}
.bar{position:sticky;top:0;background:#14110fee;backdrop-filter:blur(6px);padding:10px 0;z-index:5;border-bottom:1px solid var(--line);display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:14px}
.bar button{background:#2a221d;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:5px 12px;font:inherit;cursor:pointer}
.bar button.on{background:var(--acc);color:#14110f;border-color:var(--acc)}
.off{opacity:.18}.cnt{color:var(--mute);font-size:13px;font-weight:normal;margin-left:8px}
.tscroll{overflow-x:auto;margin:0 0 14px}
table{border-collapse:collapse;font-size:14px;min-width:100%}
th{text-align:left;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--mute);padding:8px 10px;border-bottom:1px solid var(--line)}
td{padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
"""

JS = """
const cards=[...document.querySelectorAll('.c')];
function apply(ci){
  document.querySelectorAll('#bar button').forEach(b=>b.classList.toggle('on',b.dataset.ci===ci));
  document.querySelectorAll('.opt').forEach(s=>s.classList.toggle('on',s.dataset.ci===ci));
  let on=0;
  cards.forEach(c=>{const ok=!ci||[...c.dataset.ci].every(x=>ci.includes(x));c.classList.toggle('off',!ok);if(ok)on++;});
  document.querySelectorAll('h2').forEach(h=>{let g=h.nextElementSibling;while(g&&!g.classList.contains('grid'))g=g.nextElementSibling;if(!g)return;const all=g.querySelectorAll('.c').length,n=g.querySelectorAll('.c:not(.off)').length;const s=h.querySelector('.cnt');if(s)s.textContent=ci?`${n} of ${all} in color`:`${all} cards`;});
  const st=document.getElementById('status');if(st)st.textContent=ci?`${on} of ${cards.length} cards playable`:`${cards.length} cards`;
}
document.querySelectorAll('#bar button').forEach(b=>b.onclick=()=>apply(b.dataset.ci));
document.querySelectorAll('.opt').forEach(s=>s.onclick=()=>{apply(s.dataset.ci);document.getElementById('bar').scrollIntoView({behavior:'smooth'});});
apply('');
"""


def esc(s):
    return html.escape(s or "", quote=True)


# ---------- Scryfall ----------

def slim(card):
    faces = card.get("card_faces") or []
    if faces and "image_uris" not in card:
        img = faces[0].get("image_uris", {}).get("normal", "")
    else:
        img = card.get("image_uris", {}).get("normal", "")
    oracle = card.get("oracle_text")
    if oracle is None and faces:
        oracle = "\n//\n".join(f.get("oracle_text", "") for f in faces)
    mana = card.get("mana_cost")
    if mana is None and faces:
        mana = " // ".join(f.get("mana_cost", "") for f in faces)
    return {
        "name": card["name"],
        "mana_cost": mana or "",
        "type_line": card.get("type_line", ""),
        "oracle": oracle or "",
        "color_identity": "".join(card.get("color_identity", [])),
        "game_changer": bool(card.get("game_changer")),
        "legal": card.get("legalities", {}).get("commander") == "legal",
        "image": img,
        "url": card.get("scryfall_uri", ""),
    }


def fetch(names):
    out, missing = {}, []
    names = list(dict.fromkeys(names))
    for i in range(0, len(names), 75):
        batch = names[i:i + 75]
        body = json.dumps({"identifiers": [{"name": n} for n in batch]}).encode()
        req = urllib.request.Request(API, data=body, headers=HEADERS, method="POST")
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    data = json.load(r)
                break
            except urllib.error.HTTPError as e:
                if e.code == 429 and attempt < 3:
                    wait = int(e.headers.get("Retry-After", "5"))
                    print(f"429 from Scryfall, waiting {wait}s", file=sys.stderr)
                    time.sleep(wait)
                    continue
                raise
        for c in data.get("data", []):
            out[c["name"]] = slim(c)
            out.setdefault(c["name"].split(" // ")[0], out[c["name"]])
        missing += [m.get("name") for m in data.get("not_found", [])]
        if i + 75 < len(names):
            time.sleep(1)
    return out, missing


def local_fill(names):
    """Text-only entries from the local Scryfall database, for when the API is down."""
    if not LOCAL_DB.exists():
        return {}
    db = {c["name"]: c for c in json.loads(LOCAL_DB.read_text())}
    out = {}
    for n in names:
        c = db.get(n)
        if not c:
            continue
        out[n] = {"name": n, "mana_cost": c.get("cost", ""), "type_line": c.get("type", ""),
                  "oracle": c.get("text", ""), "color_identity": c.get("ci", ""),
                  "game_changer": bool(c.get("gc")), "legal": True, "image": "",
                  "url": "https://scryfall.com/search?q=" + urllib.parse.quote(f'!"{n}"')}
    return out


def all_names(spec):
    names = []
    for s in spec.get("sections", []):
        names += [c[0] for c in s.get("cards", [])]
    return names


# ---------- rendering ----------

def pips(ci):
    return "".join(f'<i class=pip style="background:{PIP[c]}" title="{c}"></i>' for c in ci if c in PIP)


def card_html(card, why):
    flags = ""
    if card["game_changer"]:
        flags += ' <span class=gc>GAME CHANGER</span>'
    if not card["legal"]:
        flags += ' <span class=ban>NOT COMMANDER-LEGAL</span>'
    a = f'<a href="{esc(card["url"])}" target=_blank>'
    pic = (f'{a}<img loading=lazy src="{esc(card["image"])}" alt="{esc(card["name"])}"></a>' if card["image"]
           else '<div class=noimg>no picture (offline build)</div>')
    q = urllib.parse.quote(card["name"])
    ext = (f'<div class=ext><a href="{esc(card["url"])}" target=_blank>Scryfall</a>'
           f'<a href="https://edhrec.com/cards/{esc(slug(card["name"]))}" target=_blank>EDHREC</a>'
           f'<a href="https://archidekt.com/search/cards?name={q}" target=_blank>Archidekt</a></div>')
    return (f'<div class="c" data-ci="{esc(card["color_identity"])}">{pic}<div class=b><div class=n>{a}{esc(card["name"])}</a> {pips(card["color_identity"])}</div>'
            f'<div class=m>{esc(card["mana_cost"])} · {esc(card["type_line"])}{flags}</div>'
            f'<div class=why>{why}</div><div class=o>{esc(card["oracle"])}</div>{ext}</div></div>\n')


def slug(name):
    n = name.split(" // ")[0].lower()
    return "".join(ch if ch.isalnum() or ch == " " else "" for ch in n).replace(" ", "-")


def grid(cards, cache, big=False):
    out = [f'<div class="grid{" big" if big else ""}">\n']
    for name, why in cards:
        out.append(card_html(cache[name], why))
    out.append("</div>\n")
    return "".join(out)


def option_html(o):
    return (f'<div class=opt data-key="{esc(o["key"])}" data-ci="{esc(o["ci"])}"><h4>{pips(o["ci"])} {esc(o["title"])}</h4>'
            f'<div class=cm>{esc(o.get("commanders", ""))}</div><p>{o.get("text", "")}</p>'
            + (f'<p class=k><b>Gains:</b> {o.get("gains", "")}<br><b>Loses:</b> {o.get("loses", "")}</p>' if o.get("gains") or o.get("loses") else "")
            + f'<span class=pw>{esc(o.get("tag", ""))}</span></div>\n')


def table_html(t):
    head = "".join(f"<th>{h}</th>" for h in t.get("head", []))
    rows = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in t.get("rows", []))
    return f'<div class=tscroll><table><tr>{head}</tr>{rows}</table></div>\n'


def render(spec, cache):
    p = [f'<title>{esc(spec["title"])}</title><style>{CSS}</style><body><div class=wrap>\n',
         f'<header><h1>{esc(spec["title"])}<small>{esc(spec.get("goal", ""))}</small></h1>']
    if spec.get("links"):
        p.append('<div class=links>' + "".join(f'<a href="{esc(l["url"])}" target=_blank>{esc(l["label"])} ↗</a>' for l in spec["links"]) + '</div>')
    p.append('</header>\n')
    if spec.get("verdict"):
        p.append(f'<div class=insight>{spec["verdict"]}</div>\n')
    options = spec.get("options", [])
    if options:
        p.append(f'<div class=step>{esc(spec.get("options_step", "Options"))}</div><h2>{esc(spec.get("options_title", "Ranked options"))}</h2>'
                 f'<p class=lede>{spec.get("options_lede", "Click one to filter the page to its colors.")}</p><div class=options>\n')
        p += [option_html(o) for o in options]
        p.append("</div>\n")
    p.append('<div class=bar id=bar><span>Filter:</span><button data-ci="" class=on>All colors</button>')
    p += [f'<button data-ci="{esc(o["ci"])}" data-key="{esc(o["key"])}">{esc(o.get("short", o["title"]))}</button>' for o in options]
    p.append('<span id=status class=cnt></span></div>\n')
    for i, s in enumerate(spec.get("sections", []), 1):
        p.append(f'<div class=step>{esc(s.get("eyebrow", f"Section {i}"))}</div>'
                 f'<h2>{esc(s["title"])}{" <span class=cnt></span>" if s.get("cards") else ""}</h2>')
        if s.get("lede"):
            p.append(f'<p class=lede>{s["lede"]}</p>')
        if s.get("html"):
            p.append(f'<div class=prose>{s["html"]}</div>')
        if s.get("table"):
            p.append(table_html(s["table"]))
        if s.get("cards"):
            p.append(grid(s["cards"], cache, s.get("big", False)))
        p.append("\n")
    p.append(f"<script>{JS}</script></div>\n")
    return "".join(p)


# ---------- main ----------

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("spec")
    ap.add_argument("out", nargs="?")
    ap.add_argument("--refresh", action="store_true", help="refetch every card even if cached")
    ap.add_argument("--fetch-only", action="store_true", help="write the card cache and stop")
    a = ap.parse_args()

    spec_path = Path(a.spec)
    spec = json.loads(spec_path.read_text())
    cache_path = spec_path.with_suffix(".cards.json")
    cache = {} if a.refresh or not cache_path.exists() else json.loads(cache_path.read_text())

    names = all_names(spec)
    need = [n for n in names if n not in cache]
    if need:
        try:
            fetched, _ = fetch(need)
        except (urllib.error.URLError, OSError) as e:
            print(f"Scryfall unreachable ({e}); filling text from the local database, no pictures", file=sys.stderr)
            fetched = local_fill(need)
        cache.update(fetched)
        missing = [n for n in need if n not in cache]
        cache_path.write_text(json.dumps(cache, indent=1, ensure_ascii=False))
        if missing:
            print("These names did not resolve (check spelling, use the front face):", file=sys.stderr)
            for m in missing:
                print("  " + m, file=sys.stderr)
            sys.exit(1)
    print(f"{len(names)} cards, {len(need)} fetched, cache at {cache_path}", file=sys.stderr)
    if a.fetch_only:
        return
    if not a.out:
        ap.error("give an output path, or use --fetch-only")
    Path(a.out).write_text(render(spec, cache))
    gcs = sorted({n for n in names if cache[n]["game_changer"]})
    print(f"wrote {a.out}; Game Changers on the page: {', '.join(gcs) or 'none'}", file=sys.stderr)


if __name__ == "__main__":
    main()
