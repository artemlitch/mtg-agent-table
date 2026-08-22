// The board's SPACE, not its contents. Cards are drawn by CardLayer, in one
// layer over the whole felt, because the table is a single surface. What is
// left here is the flex child that gives each seat's boardwrap its height —
// take it away and the hands collapse onto the midline.
import type { PlayerId } from "../../types";

export function Battlefield({ p }: { p: PlayerId }) {
  return <div className="battlefield" id={`bf-${p}`} />;
}
