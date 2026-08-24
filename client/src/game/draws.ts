// A drawn card comes off the library and turns face up on the way to your hand.
//
// Same "what is new since last time" shape as processSounds and processReveals
// next door, with one addition: the log says a draw HAPPENED, and the hand says
// WHICH cards, so this needs both. A card can reach your hand without being
// drawn — bounced off the battlefield, taken back out of the graveyard — and
// those must not fly out of the library, because that is not where they came
// from. So an arrival only flies when a draw was logged in the same breath.
//
// The card that flies is a stand-in, not the real one. The real card is in the
// hand fan the moment the view lands, tilted by its place in the arc; hiding it
// for the flight and dropping the stand-in on its bounding box is what lets the
// flight end without a jump. The stand-in also gets to have a BACK, which the
// hand card does not — turning face up is most of what drawing looks like.
import { cardById } from "../store/game";
import type { GameView, PlayerId } from "../types";

// Your own draw names the cards, because that line is written for your eyes
// only; everyone else's is a count. The seat is "Player" in the log — the UI
// is what calls it "You".
const DREW = /(^Player drew: )|( drew \d+ cards?$)/;
const FLIGHT_MS = 460;
const STAGGER_MS = 95;
/** how much of the flight is spent turning over */
const TURN_MS = 380;

let lastSeq: number | null = null;
let known: Set<string> | null = null;

/** Fly every card that just arrived in your hand BY DRAWING. Call it before
 *  paint, so the card is never seen sitting in the fan before it flies. */
export function processDraws(view: GameView) {
  const ids = view.players.you.zones.hand.map((c) => c.id);
  const maxSeq = view.log.at(-1)?.seq ?? 0;
  // the first view is the game as it already stands, not seven things that
  // just happened
  if (known === null) {
    known = new Set(ids);
    lastSeq = maxSeq;
    return;
  }
  const drew = view.log.some((e) => e.seq > lastSeq! && DREW.test(e.text));
  const arrived = ids.filter((id) => !known!.has(id));
  known = new Set(ids);
  lastSeq = maxSeq;
  if (!drew || !arrived.length) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // drawing three is three cards off the top, not one three-card slab
  arrived.forEach((id, i) => setTimeout(() => fly("you", id), i * STAGGER_MS));
}

/** The deck a card leaves from, and the card it becomes. Either can be missing
 *  — a narrow rail still has both, but a card can be played out of the hand
 *  before its own flight starts. */
function fly(p: PlayerId, id: string) {
  const deck = document.querySelector(`#rail-${p} .deckstack`);
  const target = document.querySelector<HTMLElement>(`#hand-${p} [data-card-id="${CSS.escape(id)}"]`);
  if (!deck || !target) return;
  const from = deck.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  if (!from.width || !to.width) return;

  // The landing pose is the card's OWN transform — the fan's tilt and dip,
  // whatever they are for this slot — so the last frame of the flight and the
  // first frame of the real card are the same picture.
  //
  // Which means the stand-in has to be laid out where the card is BEFORE that
  // transform, or the tilt lands twice. getBoundingClientRect reports the
  // painted box; the fan only rotates (about the centre, which does not move
  // it) and translates, so subtracting the matrix's translation from the
  // painted centre gives the pre-transform one. Size comes from offsetWidth,
  // which is the layout box and ignores the transform outright.
  const landed = getComputedStyle(target).transform;
  const end = landed && landed !== "none" ? landed : "";
  const m = end ? new DOMMatrixReadOnly(end) : new DOMMatrixReadOnly();
  const w = target.offsetWidth;
  const h = target.offsetHeight;
  const left = to.left + to.width / 2 - m.e - w / 2;
  const top = to.top + to.height / 2 - m.f - h / 2;

  const ghost = document.createElement("div");
  ghost.className = "drawfly";
  ghost.style.cssText = `left:${left}px;top:${top}px;width:${w}px;height:${h}px`;
  const face = cardById(id)?.image;
  ghost.innerHTML =
    `<div class="df-inner">` +
    `<img class="df-back" src="/card-back.jpg" alt="">` +
    `<img class="df-face" src="${face ? face.replace(/"/g, "&quot;") : "/card-back.jpg"}" alt="">` +
    `</div>`;
  document.body.appendChild(ghost);

  target.style.visibility = "hidden";

  // centre to centre, in painted space: translate is the outermost function, so
  // it moves the finished card across the screen whatever the fan did to it
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const scale = from.width / w;

  const flight = ghost.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) rotate(-9deg) scale(${scale}) ${end}`, offset: 0 },
      // out of the pile first, then across: a card is lifted before it travels
      { transform: `translate(${dx * 0.82}px, ${dy * 0.78}px) rotate(-6deg) scale(${scale * 1.18}) ${end}`, offset: 0.32 },
      { transform: end || "none", offset: 1 },
    ],
    { duration: FLIGHT_MS, easing: "cubic-bezier(.22,.66,.3,1)" }
  );
  // the turn finishes a little early, so the card is face up as it settles
  // rather than still spinning when it stops
  ghost.querySelector(".df-inner")!.animate([{ transform: "rotateY(0deg)" }, { transform: "rotateY(180deg)" }], {
    duration: TURN_MS,
    easing: "cubic-bezier(.4,0,.25,1)",
    fill: "forwards",
  });

  const land = () => {
    target.style.visibility = "";
    ghost.remove();
  };
  flight.finished.then(land, land);
}
