// The filter bar every card browser wears: free text on its own line, then
// type, power, toughness, mana cost, the colour pips clustered right after the
// numbers, and the density slider pinned to the far right.
import { Dropdown } from "../../components/Dropdown";
import { Icon } from "../../components/Icon";
import { PER_ROW } from "../../components/Modal";
import { cardColors, manaValue } from "../../game/rules";
import { useUI } from "../../store/ui";
import type { Card } from "../../types";

export interface Filter {
  q: string;
  type: string;
  powOp: Op;
  pow: string;
  touOp: Op;
  tou: string;
  mvOp: Op;
  mv: string;
  colors: string[];
}
type Op = ">=" | "<=";

export const EMPTY_FILTER: Filter = { q: "", type: "", powOp: ">=", pow: "", touOp: ">=", tou: "", mvOp: "<=", mv: "", colors: [] };

// value is what the type line is matched against; the glyph is what you see
const CARD_TYPES = [
  { value: "", label: "Any type", icon: "anyType" },
  { value: "creature", label: "Creature", icon: "creature" },
  { value: "land", label: "Land", icon: "land" },
  { value: "artifact", label: "Artifact", icon: "artifact" },
  { value: "enchantment", label: "Enchantment", icon: "enchantment" },
  { value: "instant", label: "Instant", icon: "instant" },
  { value: "sorcery", label: "Sorcery", icon: "sorcery" },
  { value: "planeswalker", label: "Planeswalker", icon: "planeswalker" },
  { value: "battle", label: "Battle", icon: "battle" },
];

const PIP_NAMES: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", C: "No color" };

const active = (f: Filter) => !!(f.q || f.type || f.pow !== "" || f.tou !== "" || f.mv !== "" || f.colors.length);
const cmp = (val: number, op: Op, target: number) => (op === ">=" ? val >= target : val <= target);

/** Does this card survive the filter? Hidden cards can't match anything, so
 *  they only show while the bar is untouched. */
export function matches(f: Filter, c: Card): boolean {
  if (c.hidden) return !active(f);
  // free text matches EVERYTHING: name, type line, oracle text —
  // "mountain" finds duals, "token" finds token-makers
  if (f.q) {
    const hay = `${c.name || ""} ${c.typeLine || ""} ${c.oracle || ""}`.toLowerCase();
    if (!hay.includes(f.q)) return false;
  }
  if (f.type && !(c.typeLine || "").toLowerCase().includes(f.type)) return false;
  if (f.pow !== "") {
    const v = Number(c.power);
    if (isNaN(v) || !cmp(v, f.powOp, Number(f.pow))) return false;
  }
  if (f.tou !== "") {
    const v = Number(c.toughness);
    if (isNaN(v) || !cmp(v, f.touOp, Number(f.tou))) return false;
  }
  if (f.mv !== "" && !cmp(manaValue(c.mana), f.mvOp, Number(f.mv))) return false;
  const cols = cardColors(c);
  for (const col of f.colors) {
    if (col === "C") {
      if (cols.size > 0) return false; // "no color" = zero colored pips
    } else if (!cols.has(col)) return false;
  }
  return true;
}

export function FilterBar({ value: f, onChange }: { value: Filter; onChange: (f: Filter) => void }) {
  const perRow = useUI((s) => s.cardsPerRow);
  const setPerRow = useUI((s) => s.setCardsPerRow);
  const patch = (p: Partial<Filter>) => onChange({ ...f, ...p });

  return (
    <div className="filterbar">
      <input
        className="namein"
        placeholder="Search name, type, or card text…"
        autoFocus
        value={f.q}
        onChange={(e) => patch({ q: e.target.value.toLowerCase() })}
      />
      <div className="frow">
        <Dropdown options={CARD_TYPES} value={f.type} onPick={(type) => patch({ type })} />
        <NumFilter label="power" op={f.powOp} val={f.pow} onOp={(powOp) => patch({ powOp })} onVal={(pow) => patch({ pow })} />
        <NumFilter label="toughness" op={f.touOp} val={f.tou} onOp={(touOp) => patch({ touOp })} onVal={(tou) => patch({ tou })} />
        <NumFilter label="mana cost" op={f.mvOp} val={f.mv} onOp={(mvOp) => patch({ mvOp })} onVal={(mv) => patch({ mv })} />
        <span className="pips">
          {["W", "U", "B", "R", "G", "C"].map((col) => (
            <button
              key={col}
              className={`colbtn col${col}${f.colors.includes(col) ? " on" : ""}`}
              title={PIP_NAMES[col]}
              onClick={() =>
                patch({ colors: f.colors.includes(col) ? f.colors.filter((c) => c !== col) : [...f.colors, col] })
              }
            />
          ))}
        </span>
        {/* one notch per row density, persisted, pinned right by margin-left:auto */}
        <input
          type="range"
          className="sizeslider"
          min={0}
          max={PER_ROW.length - 1}
          step={1}
          title={`${perRow} cards per row`}
          value={Math.max(0, PER_ROW.indexOf(perRow))}
          onChange={(e) => setPerRow(PER_ROW[Number(e.target.value)])}
        />
      </div>
    </div>
  );
}

/** A ≥/≤ plate, a number, and our own stepper — the native spinner can't be
 *  themed, so it is hidden and this pair of plates does the stepping. */
function NumFilter({
  label,
  op,
  val,
  onOp,
  onVal,
}: {
  label: string;
  op: Op;
  val: string;
  onOp: (op: Op) => void;
  onVal: (v: string) => void;
}) {
  return (
    <span className="numf">
      <span className="numlabel">{label}</span>
      {/* two states don't deserve a popup — the plate flips between them */}
      <button className="opbtn" title="At least / at most" onClick={() => onOp(op === ">=" ? "<=" : ">=")}>
        {op === ">=" ? "≥" : "≤"}
      </button>
      <input type="number" className="numin" value={val} onChange={(e) => onVal(e.target.value)} />
      <span className="spin">
        {([["caretUp", 1], ["caret", -1]] as const).map(([icon, d]) => (
          <button key={icon} className="spinb" onClick={() => onVal(String(Math.max(0, Number(val || 0) + d)))}>
            <Icon name={icon} />
          </button>
        ))}
      </span>
    </span>
  );
}
