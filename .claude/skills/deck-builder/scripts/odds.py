#!/usr/bin/env python3
"""Draw odds for a Commander deck.

The chance that at least one of k copies (or k different cards that all do
the job) shows up in the first n cards seen: the opening hand is 7, then one
more per draw step. Hypergeometric, no replacement, 99-card deck by default.

    odds.py 4 10            # P(at least one of 4 in the first 10 cards)
    odds.py 4 10 --at-least 2
    odds.py 4 --table       # n = 7, 10, 14 in one line
    odds.py 3 5 8 --table   # one line per k
    odds.py 4 10 --deck 60
"""
import argparse
from math import comb

TABLE_N = (7, 10, 14)


def p_at_least(k: int, n: int, deck: int = 99, m: int = 1) -> float:
    """P(at least m of the k target cards are among n cards drawn from deck)."""
    if k < 0 or n < 0 or deck <= 0 or n > deck or k > deck:
        raise ValueError("need 0 <= k, n <= deck")
    total = comb(deck, n)
    hits = sum(comb(k, i) * comb(deck - k, n - i) for i in range(m, min(k, n) + 1))
    return hits / total


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("k", type=int, nargs="+", help="copies of the card, or cards that do the job")
    ap.add_argument("n", type=int, nargs="?", help="cards seen (7 = opening hand, +1 per draw)")
    ap.add_argument("--deck", type=int, default=99, help="deck size (default 99)")
    ap.add_argument("--at-least", type=int, default=1, metavar="M", help="need at least M hits (default 1)")
    ap.add_argument("--table", action="store_true", help="print n = 7, 10, 14 for each k")
    a = ap.parse_args()

    # "odds.py 4 10" parses as k=[4, 10]; the last positional is n unless --table.
    ks, n = a.k, a.n
    if not a.table:
        if n is None:
            if len(ks) < 2:
                ap.error("give n, or use --table")
            ks, n = ks[:-1], ks[-1]
        for k in ks:
            print(f"{k} in {a.deck}, first {n} cards, at least {a.at_least}: {p_at_least(k, n, a.deck, a.at_least):.1%}")
        return

    if n is not None:
        ks = ks + [n]
    print("k    " + "  ".join(f"n={x:<3}" for x in TABLE_N))
    for k in ks:
        row = "  ".join(f"{p_at_least(k, x, a.deck, a.at_least):5.1%}" for x in TABLE_N)
        print(f"{k:<4} {row}")


if __name__ == "__main__":
    main()
