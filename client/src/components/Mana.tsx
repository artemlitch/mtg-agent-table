// Mana written the way Magic writes it — {G}, {2}{U}{B} — drawn as the real
// pips instead of left as braces. Same six SVGs the search filter's colour
// buttons use, so a symbol looks the same wherever it turns up.
//
// Only the symbols we have art for become pips. Anything else — {T}, {X},
// hybrids like {B/R} — stays exactly as written, because a wrong pip is worse
// than honest braces and half-drawn hybrid art is worse than both.
import type { ReactNode } from "react";

const COLORS: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", C: "Colorless" };
const SYMBOL = /\{([^{}]{1,4})\}/g;

function pip(sym: string, key: string): ReactNode | null {
  const s = sym.toUpperCase();
  if (COLORS[s]) return <i key={key} className={`pip pip${s}`} title={COLORS[s]} />;
  // generic cost: the number rides inside a plain round chip
  if (/^\d{1,2}$/.test(s)) return <i key={key} className="pip pipnum" title={`${s} generic`}>{s}</i>;
  return null;
}

/** Mana written for somewhere a pip cannot go — a title, an alt, anything that
 *  takes a string and not an element. The braces are the noise, so they come
 *  off and the symbol itself stays: "Equip to Pest ({1})" reads "Equip to Pest
 *  (1)". Only the symbols withMana would have drawn; the ones it leaves alone
 *  are left alone here too, so the two functions never disagree about what
 *  counts as a symbol. */
export function plainMana(text: string): string {
  if (!text || !text.includes("{")) return text;
  return text.replace(SYMBOL, (whole, sym: string) => {
    const s = sym.toUpperCase();
    return COLORS[s] || /^\d{1,2}$/.test(s) ? sym : whole;
  });
}

/** The text with every symbol we can draw swapped for its pip. Returns nodes,
 *  so it drops straight into JSX wherever a string used to sit. */
export function withMana(text: string): ReactNode {
  if (!text || !text.includes("{")) return text;
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(SYMBOL)) {
    const node = pip(m[1], `${m.index}`);
    if (!node) continue; // unknown symbol: leave the braces in the sentence
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(node);
    last = m.index + m[0].length;
  }
  if (!out.length) return text;
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Anything <Text> would have drawn as a pip, still written as braces. Asked
 *  by running the transform and seeing whether it changed anything, so the
 *  watchdog below cannot drift from what the transform actually does — a
 *  hand-written pattern here would be a second definition of "a symbol" and
 *  the two would disagree the day someone adds one. */
const leaks = (s: string) => plainMana(s) !== s;

/** The rule that <Text> exists to keep: no braces in front of the player.
 *
 *  The rule cannot be enforced by types — every one of these strings is a
 *  string, and React will happily render it raw — so it is enforced by
 *  watching. Any text node that lands in the document still carrying a symbol
 *  we can draw is a render site that reached for a bare span instead of
 *  <Text>, and it says so in the console with the offending words and the
 *  element they landed in. That turns "someone will notice it in a screenshot
 *  weeks later" into "it is named the moment it happens".
 *
 *  Undrawable symbols are not leaks: {T}, {X} and hybrids like {B/R} stay as
 *  braces on purpose, so `leaks` asks about exactly the ones we have art for.
 *
 *  Each distinct string is reported once — a leak inside a list that
 *  re-renders would otherwise fill the console with the same line. */
export function watchForRawMana(): () => void {
  const seen = new Set<string>();
  const report = (node: Node) => {
    const text = node.nodeValue ?? "";
    if (!text.includes("{") || !leaks(text) || seen.has(text)) return;
    seen.add(text);
    console.error("[mana] braces reached the screen — this needs <Text>:", text.trim().slice(0, 140), node.parentElement);
  };
  const scan = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) return report(node);
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) report(n);
  };
  scan(document.body);
  const mo = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") report(r.target);
      else r.addedNodes.forEach(scan);
    }
  });
  mo.observe(document.body, { subtree: true, childList: true, characterData: true });
  return () => mo.disconnect();
}
