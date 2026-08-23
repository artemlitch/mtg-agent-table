import { artFallback } from "../../components/cardArt";
import { previewProps } from "../../components/CardPreview";
import { Text } from "../../components/Text";
import { menuOpen, ui } from "../../store/ui";
import type { Card } from "../../types";

export type CardAction = [label: string, run: () => void];

/** One card in a browser. No button strip under the art: clicking the card
 *  opens THE menu, exactly like the battlefield, and clicking again dismisses
 *  it. A card with a single action just runs it. */
export function ModalCard({
  info,
  actions,
  className = "",
  menu,
}: {
  info: Card;
  actions: CardAction[];
  className?: string;
  /** open something other than the actions list — the pile browser hands over
   *  the card's whole board menu, since a pile is on the board */
  menu?: (e: React.MouseEvent) => void;
}) {
  const open = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (menuOpen()) return ui().closeMenu(); // second click dismisses, same as the board
    ui().hidePreview();
    if (menu) return menu(e);
    if (actions.length === 1) return actions[0][1]();
    ui().openMenu([{ label: info.name ?? "", title: true }, ...actions.map(([label, fn]) => ({ label, fn }))], e);
  };
  return (
    <div
      className={`modalcard${className ? " " + className : ""}`}
      {...previewProps(info)}
      onClick={open}
      onContextMenu={(e) => {
        e.preventDefault();
        open(e);
      }}
    >
      {info.image ? (
        <img src={info.image} data-tip={info.name} alt="" {...artFallback(info.name)} />
      ) : (
        <div className="textcard" style={{ height: "auto", minHeight: 60 }}>
          <Text as="b">{info.name}</Text>
          <br />
          <Text>{info.typeLine}</Text>
        </div>
      )}
    </div>
  );
}

/** A face-down card in a browser: no name, no menu, just a back. */
export function HiddenCard() {
  return (
    <div className="modalcard">
      <img className="cardback" src="/card-back.jpg" alt="face-down card" />
    </div>
  );
}
