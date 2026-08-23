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
