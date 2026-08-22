// Drag and placement tracing.
//
// The whole pipeline is one number line with two conversions at the ends
// (felt pixels <-> stored fraction), so a card landing in the wrong place is
// always one of: a bad surface measurement, a bad drop conversion, a server
// disagreement, or a render reading the wrong source. This prints each of
// those with the numbers, so the broken link identifies itself.
//
// On by default while we are working on the drag. Silence it from the
// console with __dragLog(false), bring it back with __dragLog(true).

let on = true;

export const dlogEnabled = () => on;

if (typeof window !== "undefined") {
  (window as unknown as { __dragLog: (v?: boolean) => string }).__dragLog = (v = true) => {
    on = v;
    return `drag logging ${on ? "on" : "off"}`;
  };
}

export function dlog(tag: string, data?: Record<string, unknown>) {
  if (!on) return;
  // eslint-disable-next-line no-console
  console.log(`%c[drag]%c ${tag}`, "color:#e2b355;font-weight:700", "color:inherit", data ?? "");
}

/** pixels: two decimals is well past what a screen can show */
export const px = (n: number) => Math.round(n * 100) / 100;
/** fractions: four decimals, since the whole table is 0..1 */
export const fr = (n: number) => Math.round(n * 10000) / 10000;
export const pt = (p: { x: number; y: number }) => `${fr(p.x)}, ${fr(p.y)}`;
export const box = (b: { left: number; top: number }) => `${px(b.left)}, ${px(b.top)}`;

/** Short label for a card in a log line — the name is what you recognise, the
 *  id is what you grep for. */
export const tag = (c: { id: string; name?: string; zone?: string }) => `${c.name ?? "?"}(${c.id}${c.zone ? ` @${c.zone}` : ""})`;

// Where each card was last drawn, so the render trace can print only the ones
// that actually moved instead of every card on every poll.
const lastDrawn = new Map<string, string>();

/** Called from the render path for every card it positions. Logs only on a
 *  change, and says WHICH source won: a local claim you just dropped, the
 *  server's view, or the fallback home corner. */
export function traceDraw(
  id: string,
  name: string | undefined,
  at: { left: number; top: number },
  pos: { x: number; y: number },
  source: "claim" | "server" | "home",
  depth: number
) {
  if (!on) return;
  const key = `${box(at)}|${pt(pos)}|${source}`;
  if (lastDrawn.get(id) === key) return;
  lastDrawn.set(id, key);
  dlog(`draw   ${name ?? "?"}(${id})`, { px: box(at), pos: pt(pos), from: source, ...(depth ? { pileDepth: depth } : {}) });
}

export const forgetDrawn = (id: string) => lastDrawn.delete(id);
