// Turning a vendored game-icon into a card face.
//
// The icons are CSS masks: the sheet holds each one as a data-URI SVG whose
// paths are fill='currentColor', and .gi paints them by using that URI as a
// mask over a currentColor background. That works on the page and nowhere
// else — a token's art has to be an <img> the board can draw, so the icon has
// to become a real picture with its own colours baked in.
//
// So: read the mask URI back off the stylesheet, unwrap the paths, swap
// currentColor for the tint, and hand back a plain data: URL that rides on the
// token through create_token like any Scryfall art.
//
// It is only the ART, not a whole card face — the board draws the frame, name,
// type line, rules text and P/T around it from the card's own fields, so a
// custom token looks on the battlefield exactly like the thing you built. That
// also means a data: image is the signal for "we drew this": a Scryfall token
// carries a printed card and covers the frame instead.

/** The mask URI the sheet holds for a `gi-*` class, via a throwaway element —
 *  the value lives in a custom property, so there is nothing to parse by hand. */
function maskUri(giClass: string): string | null {
  const probe = document.createElement("i");
  probe.className = `gi ${giClass}`;
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  const raw = getComputedStyle(probe).getPropertyValue("--gi");
  probe.remove();
  // the URI is double-quoted in the sheet and is FULL of single quotes — the
  // build script rewrites the SVG's own attribute quotes to ' so the data URI
  // survives being wrapped. Match the double-quoted span, not "up to a quote".
  const m = raw.match(/url\(\s*"([^"]+)"\s*\)/) ?? raw.match(/url\(\s*([^)]+?)\s*\)/);
  const uri = m?.[1]?.trim();
  return uri && uri.startsWith("data:image/svg+xml,") ? uri : null;
}

/** One icon as a square of art. Returns null if the class is unknown, which
 *  the caller treats as "no art" rather than a broken image. */
export function iconArtImage(giClass: string, tint = "#e2b355"): string | null {
  const uri = maskUri(giClass);
  if (!uri) return null;
  const svg = decodeURIComponent(uri.slice("data:image/svg+xml,".length));
  const viewBox = svg.match(/viewBox=['"]([^'"]+)['"]/)?.[1] ?? "0 0 512 512";
  // the wrapper carries width/height in em, which means nothing here; only the
  // paths are wanted, re-hung under a viewBox we control
  const body = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/currentColor/g, tint);
  const art =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>` +
    `<svg viewBox='${viewBox}' x='18' y='18' width='64' height='64'>${body}</svg>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(art)}`;
}

/** The icons offered for a custom token — the ones from the vendored set that
 *  read as a creature or an object rather than as a UI verb. */
export const TOKEN_ICONS = [
  "gi-token",
  "gi-sparkles",
  "gi-dragon-head",
  "gi-crossed-swords",
  "gi-shield",
  "gi-crown",
  "gi-gems",
  "gi-gears",
  "gi-castle",
  "gi-chess-king",
  "gi-mountains",
  "gi-scroll-unfurled",
  "gi-magic-swirl",
  "gi-arcing-bolt",
  "gi-hood",
  "gi-moon",
  "gi-stack",
  "gi-book-pile",
];
