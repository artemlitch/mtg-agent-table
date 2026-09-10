"""Archidekt API helper. See SKILL.md for endpoint docs and gotchas.

Usage:
    from archidekt_api import Archidekt
    a = Archidekt()                      # logs in with ARCHIDEKT_USER/PASS from .env
    deck = a.get_deck(25319832)
    pid, info = a.search_printing("Blood Artist")
    a.modify_cards(25319832, [a.add(pid, ["Win Conditions"])])

Or from the shell:
    python3 archidekt_api.py verify 25319832
    python3 archidekt_api.py search "Blood Artist" "Gilded Drake"
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "https://archidekt.com"


def _load_login():
    """ARCHIDEKT_USER / ARCHIDEKT_PASS from the environment, else from the
    nearest .env above this file or the working directory: the mtg-agent-table
    repo's .env, which the deck studio server reads too. Never hardcode them
    here; this file lives in a public repo."""
    user, pw = os.environ.get("ARCHIDEKT_USER"), os.environ.get("ARCHIDEKT_PASS")
    if user and pw:
        return user, pw
    for start in (Path(__file__).resolve().parent, Path.cwd()):
        for d in (start, *start.parents):
            env = d / ".env"
            if not env.is_file():
                continue
            vals = {}
            for line in env.read_text().splitlines():
                line = line.strip()
                if line.startswith("export "):
                    line = line[len("export "):]
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    vals[k.strip()] = v.strip().strip('"').strip("'")
            if vals.get("ARCHIDEKT_USER") and vals.get("ARCHIDEKT_PASS"):
                return vals["ARCHIDEKT_USER"], vals["ARCHIDEKT_PASS"]
    raise RuntimeError("Archidekt login not found: set ARCHIDEKT_USER and ARCHIDEKT_PASS "
                       "in the environment or in the mtg-agent-table repo's .env")


class Archidekt:
    def __init__(self):
        self.token = None

    def _req(self, path, method="GET", body=None, auth=False):
        headers = {"Accept": "application/json", "User-Agent": "Mozilla/5.0"}
        if auth:
            if not self.token:
                self.login()
            headers["Authorization"] = "JWT " + self.token
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode()
        r = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
        try:
            resp = urllib.request.urlopen(r, timeout=60)
            return resp.status, json.load(resp)
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode()[:2000]

    def login(self):
        user, pw = _load_login()
        st, res = self._req("/api/rest-auth/login/", "POST",
                            {"username": user, "password": pw})
        assert st == 200, f"login failed: HTTP {st}"
        self.token = res["access_token"]  # expires in 1 hour
        return res

    def create_deck(self, name, deck_format=3, private=False):
        """POST /api/decks/v2/ — deck_format 3 = EDH. Returns deck dict (id in login user.decks too)."""
        st, res = self._req("/api/decks/v2/", "POST",
                            {"name": name, "deckFormat": deck_format, "private": private}, auth=True)
        assert st == 201, f"create_deck failed: {st} {res}"
        return res

    def update_deck(self, deck_id, **fields):
        """PATCH /api/decks/{id}/update/ — e.g. description=, name=, private=. Markdown OK in description."""
        st, res = self._req(f"/api/decks/{deck_id}/update/", "PATCH", fields, auth=True)
        assert st == 200, f"update_deck failed: {st} {res}"
        return res

    def get_deck(self, deck_id):
        st, d = self._req(f"/api/decks/{deck_id}/")
        assert st == 200, d
        return d

    def search_printing(self, name):
        """Commander-legal, non-Alchemy printing id for an exact card name."""
        st, res = self._req("/api/cards/v2/?name=" + urllib.parse.quote(name))
        if st != 200:
            return None, f"search HTTP {st}"
        cands = []
        for p in res.get("results", []):
            oc = p.get("oracleCard", {})
            full = oc.get("name") or ""
            front = full.split(" // ")[0]
            if full.lower() != name.lower() and front.lower() != name.lower():
                continue
            if oc.get("legalities", {}).get("commander") != "legal":
                continue
            if p.get("collectorNumber", "").startswith("A-"):
                continue
            cands.append(p)
        if not cands:
            return None, f"no commander-legal printing among {res.get('count')} results"
        p = sorted(cands, key=lambda x: x.get("releasedAt") or "9999")[0]
        return p["id"], f"{p['edition']['editioncode']} #{p['collectorNumber']} ({full})"

    # -- action builders ----------------------------------------------------
    @staticmethod
    def _mods(quantity=1):
        return {"quantity": quantity, "modifier": "Normal", "customCmc": None,
                "companion": False, "flippedDefault": False, "label": ""}

    def add(self, printing_id, categories, quantity=1, patch_id=None):
        return {"action": "add", "cardid": printing_id, "customCardId": None,
                "categories": categories, "patchId": patch_id or f"add-{printing_id}",
                "modifications": self._mods(quantity)}

    def remove(self, deck_card):
        """deck_card: an entry from get_deck()['cards']."""
        return {"action": "remove", "cardid": deck_card["card"]["id"], "customCardId": None,
                "categories": deck_card["categories"], "patchId": f"rm-{deck_card['id']}",
                "deckRelationId": deck_card["id"], "modifications": self._mods()}

    def set_quantity(self, deck_card, quantity):
        return {"action": "modify", "cardid": deck_card["card"]["id"], "customCardId": None,
                "categories": deck_card["categories"], "patchId": f"mod-{deck_card['id']}",
                "deckRelationId": deck_card["id"], "modifications": self._mods(quantity)}

    def modify_cards(self, deck_id, actions):
        st, res = self._req(f"/api/decks/{deck_id}/modifyCards/v2/", "PATCH",
                            {"cards": actions}, auth=True)
        assert st == 201, f"modifyCards failed: {st} {res}"
        return res


def _verify(deck_id):
    a = Archidekt()
    d = a.get_deck(deck_id)
    cats = {c["name"]: c for c in d.get("categories", [])}
    total = 0
    by_cat = {}
    for card in d["cards"]:
        primary = (card.get("categories") or ["(none)"])[0]
        by_cat.setdefault(primary, []).append((card["card"]["oracleCard"]["name"], card["quantity"]))
        if cats.get(primary, {}).get("includedInDeck", True):
            total += card["quantity"]
    print(f"{d['name']}: TOTAL {total}")
    for cat in sorted(by_cat):
        print(f"== {cat} ({sum(q for _, q in by_cat[cat])}) ==")
        for n, q in sorted(by_cat[cat]):
            print(f"  {q}x {n}")


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "verify":
        _verify(int(sys.argv[2]))
    elif cmd == "search":
        a = Archidekt()
        for name in sys.argv[2:]:
            pid, info = a.search_printing(name)
            print(f"{name!r}: id={pid} {info}")
