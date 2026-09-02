// icon.icns -> icon.ico (Windows) + icon.png (runtime window/taskbar icon).
//
// icon.icns is the master and is already checked in; the two files this writes
// are checked in beside it, so a build never has to run this. Re-run it only
// when the artwork changes:
//
//   node electron/make-icons.mjs
//
// macOS only — it leans on iconutil and sips, which is fine because that is
// also the only place icon.icns can be regenerated from the SVG.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ICNS = join(HERE, "icon.icns");

// Every size Windows picks between. 256 is the one Explorer shows at large
// sizes; 16 and 32 are the ones it shows in lists and the taskbar, and they
// are separate images rather than downscales precisely so they stay legible.
const SIZES = [16, 32, 48, 64, 128, 256];

const tmp = mkdtempSync(join(tmpdir(), "mtg-icons-"));
try {
  // the biggest square the icns carries, as the source every size resamples from
  execFileSync("iconutil", ["-c", "iconset", ICNS, "-o", join(tmp, "icon.iconset")]);
  const master = join(tmp, "icon.iconset", "icon_512x512@2x.png");

  const pngs = SIZES.map((size) => {
    const out = join(tmp, `${size}.png`);
    execFileSync("sips", ["-z", String(size), String(size), master, "--out", out], { stdio: "ignore" });
    return { size, data: readFileSync(out) };
  });

  // ICO container: a 6-byte header, one 16-byte directory entry per image,
  // then the images themselves. The entries hold PNG data rather than BMP —
  // legal since Vista, and it keeps the 256px image from costing 256KB raw.
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(pngs.length, 4);

  let offset = 6 + pngs.length * 16;
  const entries = [];
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size === 256 ? 0 : size, 0); // 0 means 256 — a byte cannot say 256
    e.writeUInt8(size === 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette size: 0 for truecolour
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }

  writeFileSync(join(HERE, "icon.ico"), Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]));
  // 512 is what Electron wants for a window icon it may render at any size
  execFileSync("sips", ["-z", "512", "512", master, "--out", join(HERE, "icon.png")], { stdio: "ignore" });
  console.log(`wrote icon.ico (${SIZES.join(", ")}) and icon.png (512)`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
