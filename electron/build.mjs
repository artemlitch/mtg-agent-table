// Packages the table into a standalone desktop app.
//
//   node electron/build.mjs                 # this machine's platform
//   node electron/build.mjs --target=win-x64 --zip
//
// Three things get fused together:
//
//   1. web/          the UI, from `vite build`
//   2. mtg-server    the Bun server, compiled to a single native executable
//   3. Electron      the window it all runs in
//
// (2) is why the result needs nothing installed on the target machine: bun
// cross-compiles, so a Windows server binary is produced on a Mac in seconds.
// Electron itself does not cross-compile as cleanly — see WINDOWS below.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import packager from "electron-packager";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

// bun's cross-compile target, electron's platform/arch, and what to call the
// zip — one row per thing we ship.
const TARGETS = {
  "mac-arm64": { bun: "bun-darwin-arm64", platform: "darwin", arch: "arm64" },
  "mac-x64": { bun: "bun-darwin-x64", platform: "darwin", arch: "x64" },
  "win-x64": { bun: "bun-windows-x64", platform: "win32", arch: "x64" },
  "linux-x64": { bun: "bun-linux-x64", platform: "linux", arch: "x64" },
};

function hostTarget() {
  if (process.platform === "win32") return "win-x64";
  if (process.platform === "linux") return "linux-x64";
  return process.arch === "x64" ? "mac-x64" : "mac-arm64";
}

const args = process.argv.slice(2);
const flag = (name) => args.some((a) => a === `--${name}`);
const value = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;

const name = value("target", hostTarget());
const target = TARGETS[name];
if (!target) {
  console.error(`unknown target "${name}" — one of: ${Object.keys(TARGETS).join(", ")}`);
  process.exit(1);
}

// No shell: every command here is a real executable (bun.exe included), and a
// shell would need every path with a space in it quoted by hand.
const run = (cmd, cmdArgs, cwd) => execFileSync(cmd, cmdArgs, { cwd, stdio: "inherit" });

// ---------------------------------------------------------------- 1. the UI
if (flag("skip-web")) {
  if (!existsSync(join(REPO, "web/index.html"))) {
    console.error("--skip-web, but web/ has no build in it. Run `bun run build` first.");
    process.exit(1);
  }
  console.log("• web/ — reusing the existing build");
} else {
  console.log("• web/ — vite build");
  run("bun", ["run", "build"], REPO);
}

// ------------------------------------------------------------ 2. the server
const exe = target.platform === "win32" ? "mtg-server.exe" : "mtg-server";
const staging = join(HERE, "build", name);
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

console.log(`• mtg-server — bun compile for ${target.bun}`);
run("bun", ["build", "--compile", `--target=${target.bun}`, "server/main.ts", "--outfile", join(staging, exe)], REPO);

// ---------------------------------------------------------- 3. the Electron
//
// WINDOWS: electron-packager stamps the .exe's icon and version strings with
// rcedit, which is itself a Windows program — so building a Windows app on a
// Mac needs wine, and without it we would ship an app wearing Electron's
// default icon. Rather than do that silently, the cross-build is refused and
// pointed at the workflow that builds it on a real Windows runner.
const foreignWindows = target.platform === "win32" && process.platform !== "win32";
if (foreignWindows && !hasWine()) {
  console.error(
    "\nCannot build the Windows app here: stamping the .exe icon needs wine (or Windows).\n" +
      "Push a tag instead — .github/workflows/release.yml builds it on a Windows runner\n" +
      "and attaches it to the GitHub Release. Or `brew install --cask wine-stable` and retry.\n"
  );
  process.exit(1);
}

function hasWine() {
  try {
    execFileSync("wine", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

console.log(`• electron — packaging ${target.platform}/${target.arch}`);
const out = join(HERE, "dist");
const [appPath] = await packager({
  dir: HERE,
  out,
  platform: target.platform,
  arch: target.arch,
  overwrite: true,
  icon: join(HERE, target.platform === "win32" ? "icon.ico" : "icon.icns"),
  appBundleId: "net.artemlitch.mtg-battlefield",
  appCategoryType: "public.app-category.games",
  // The two things that make the app self-contained. They land beside each
  // other in Resources, which is exactly what the server expects: it serves
  // the web/ next to its own executable (see server/packaged.ts).
  extraResource: [join(staging, exe), join(REPO, "web")],
  // Everything here is either build machinery or a second copy of what
  // extraResource already placed.
  ignore: [/^\/dist($|\/)/, /^\/build($|\/)/, /^\/build\.mjs$/, /^\/make-icons\.mjs$/, /^\/icon\.svg$/],
});

console.log(`  → ${appPath}`);

// ----------------------------------------------------------------- 4. a zip
if (flag("zip")) {
  const zip = join(out, `MTG-Battlefield-${name}.zip`);
  rmSync(zip, { force: true });
  console.log(`• zipping → ${zip}`);
  if (process.platform === "darwin" && target.platform === "darwin") {
    // ditto, not zip: an .app is full of symlinks and executable bits, and a
    // plain zip loses enough of them that the copy will not launch.
    run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", join(appPath, "MTG Battlefield.app"), zip], out);
  } else if (process.platform === "win32") {
    // no zip(1) on a Windows runner; Compress-Archive ships with the OS
    run("powershell.exe", ["-NoProfile", "-Command", `Compress-Archive -Path '${appPath}\\*' -DestinationPath '${zip}'`], out);
  } else {
    run("zip", ["-r", "-q", zip, appPath.split(/[\\/]/).pop()], out);
  }
}

console.log("done.");
