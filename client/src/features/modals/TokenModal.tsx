import { useState } from "react";
import { act } from "../../api";
import { ModalFrame } from "../../components/Modal";
import { useGame } from "../../store/game";
import { ui } from "../../store/ui";
import { ModalCard } from "../browsers/ModalCard";
import { askText } from "./AskText";

/** Tokens harvested from both imported decks (Scryfall all_parts) show as
 *  clickable cards; anything else can be typed in as a custom token. */
export function openTokenModal() {
  ui().openModal({ body: <TokenModal /> });
}

async function create(params: Record<string, unknown>) {
  const n = Number((await askText("How many?", "1")) || 0);
  if (n > 0) void act("create_token", { ...params, n, player: "you" }).then(ui().closeModal);
}

function TokenModal() {
  const catalog = useGame((s) => s.view?.tokenCatalog) ?? {};
  const cat = Object.values(catalog);
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [pt, setPt] = useState("");

  const createCustom = () => {
    if (!name.trim()) return alert("Token needs a name");
    const m = pt.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
    void create({
      name: name.trim(),
      ...(type.trim() ? { typeLine: type.trim() } : {}),
      ...(m ? { power: m[1], toughness: m[2] } : {}),
    });
  };

  return (
    <ModalFrame title="Create a token">
      <div className="modalcards">
        {!cat.length && "(no tokens came with the decks — make a custom one below)"}
        {cat.map((t) => (
          <ModalCard key={t.id ?? t.name} info={t} actions={[["create…", () => void create({ name: t.name })]]} />
        ))}
      </div>
      <div className="tokencustom">
        <div className="tclabel">Custom token</div>
        <input placeholder="name (e.g. Treasure, Soldier)" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="type line (optional)" value={type} onChange={(e) => setType(e.target.value)} />
        <input placeholder="P/T (optional, e.g. 1/1)" value={pt} onChange={(e) => setPt(e.target.value)} />
        <button onClick={createCustom}>Create custom</button>
      </div>
    </ModalFrame>
  );
}
