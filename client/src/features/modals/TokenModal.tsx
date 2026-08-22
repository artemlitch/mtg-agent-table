import { useState } from "react";
import { act } from "../../api";
import { ModalFrame } from "../../components/Modal";
import { useGame } from "../../store/game";
import { ui } from "../../store/ui";
import { ModalCard } from "../browsers/ModalCard";
import { askNumber } from "./AskText";
import { CustomTokenCard, EMPTY_TOKEN, tokenParams, type CustomToken } from "./CustomTokenCard";

/** Tokens harvested from both imported decks (Scryfall all_parts) show as
 *  clickable cards; anything else can be typed in as a custom token. */
export function openTokenModal() {
  ui().openModal({ body: <TokenModal /> });
}

async function create(params: Record<string, unknown>) {
  const n = await askNumber("How many?", 1, { min: 1, max: 20 });
  if (n && n > 0) void act("create_token", { ...params, n, player: "you" }).then(ui().closeModal);
}

function TokenModal() {
  const catalog = useGame((s) => s.view?.tokenCatalog) ?? {};
  const cat = Object.values(catalog);
  const [custom, setCustom] = useState<CustomToken>(EMPTY_TOKEN);

  return (
    <ModalFrame title="Create a token">
      <div className="modalcards">
        {!cat.length && "(no tokens came with the decks — build one below)"}
        {cat.map((t) => (
          <ModalCard key={t.id ?? t.name} info={t} actions={[["create…", () => void create({ name: t.name })]]} />
        ))}
      </div>
      <div className="tokencustom">
        <CustomTokenCard value={custom} onChange={setCustom} />
        <div className="tcside">
          <div className="tclabel">Custom token</div>
          <button className="accent" onClick={() => void create(tokenParams(custom))}>
            Create
          </button>
        </div>
      </div>
    </ModalFrame>
  );
}
