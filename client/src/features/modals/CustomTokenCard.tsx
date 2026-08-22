import { useState } from "react";
import { Icon } from "../../components/Icon";
import { TOKEN_ICONS, iconArtImage } from "../../game/tokenArt";

// The custom-token maker, as the card it is going to make. A row of labelled
// text boxes described the same fields, but you had to imagine the result;
// here the thing you are filling in IS the preview. Every field sits where it
// sits on a real card — name across the title bar, type line under the art,
// rules text in the box, P/T in the corner — and is a plain input dressed to
// look printed until you focus it.
//
// The art is one of the vendored game-icons, cycled with the arrows. It is not
// decoration: tokenArt bakes the chosen icon into a card-shaped image that
// goes to the server with the token, so it is what you see on the board.

export interface CustomToken {
  name: string;
  typeLine: string;
  oracle: string;
  power: string;
  toughness: string;
  icon: string;
}

export const EMPTY_TOKEN: CustomToken = {
  name: "",
  typeLine: "",
  oracle: "",
  power: "",
  toughness: "",
  icon: TOKEN_ICONS[0],
};

/** What create_token wants for this card. */
export function tokenParams(t: CustomToken): Record<string, unknown> {
  const image = iconArtImage(t.icon);
  return {
    name: t.name.trim() || "Custom",
    typeLine: t.typeLine.trim() || "Token",
    ...(t.oracle.trim() ? { oracle: t.oracle.trim() } : {}),
    ...(t.power.trim() && t.toughness.trim() ? { power: t.power.trim(), toughness: t.toughness.trim() } : {}),
    ...(image ? { image } : {}),
  };
}

export function CustomTokenCard({ value, onChange }: { value: CustomToken; onChange: (t: CustomToken) => void }) {
  const set = (patch: Partial<CustomToken>) => onChange({ ...value, ...patch });
  const [i, setI] = useState(Math.max(0, TOKEN_ICONS.indexOf(value.icon)));
  const cycle = (d: number) => {
    const next = (i + d + TOKEN_ICONS.length) % TOKEN_ICONS.length;
    setI(next);
    set({ icon: TOKEN_ICONS[next] });
  };

  return (
    <div className="tokencard">
      <div className="tc-title">
        <input value={value.name} onChange={(e) => set({ name: e.target.value })} placeholder="Custom" spellCheck={false} />
      </div>

      <div className="tc-art">
        <Icon name={TOKEN_ICONS[i]} className="tc-icon" />
        {/* the arrows sit on the art rather than under it — the art box is the
            control, the way the title bar is the name field */}
        <button className="tc-arrow left ghost" title="Previous art" onClick={() => cycle(-1)}>
          ‹
        </button>
        <button className="tc-arrow right ghost" title="Next art" onClick={() => cycle(1)}>
          ›
        </button>
      </div>

      {/* type line and rules text share one box: on a token the type labels
          the text under it rather than standing as its own bar */}
      <div className="tc-body">
        <div className="tc-type">
          <input value={value.typeLine} onChange={(e) => set({ typeLine: e.target.value })} placeholder="Token" spellCheck={false} />
        </div>
        <div className="tc-text">
          <textarea value={value.oracle} onChange={(e) => set({ oracle: e.target.value })} placeholder="Rules text (optional)" />
        </div>
      </div>

      <div className="tc-pt">
        <input value={value.power} onChange={(e) => set({ power: e.target.value })} placeholder="1" aria-label="power" />
        <span>/</span>
        <input value={value.toughness} onChange={(e) => set({ toughness: e.target.value })} placeholder="1" aria-label="toughness" />
      </div>
    </div>
  );
}
