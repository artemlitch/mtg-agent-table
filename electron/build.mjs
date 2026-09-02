// Packages the table into a standalone desktop app.
//
//   node electron/build.mjs                      # this machine's platform
//   node electron/build.mjs --target=win-x64      # a Windows installer, from anywhere
//
// Three things get fused together:
//
//   1. web/          the UI, from `vite build`
//   2. mtg-server    the Bun server, compiled to a single native executable
//   3. Electron      the window it all runs in
//
// (2) is why the result needs nothing installed on the target machine. Both
// halves cross-compile — bun builds a Windows server binary on a Mac, and
// electron-builder writes the .exe's icon and version resources itself rather
// than shelling out to a Windows tool — so every target can be built anywhere.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

// bun's cross-compile target, and the electron-builder flags that go with it.
// What each one produces is in electron-builder.yml.
const TARGETS = {
  "mac-arm64": { bun: "bun-darwin-arm64", exe: "mtg-server", builder: ["--mac", "--arm64"] },
  "mac-x64": { bun: "bun-darwin-x64", exe: "mtg-server", builder: ["--mac", "--x64"] },
  "win-x64": { bun: "bun-windows-x64", exe: "mtg-server.exe", builder: ["--win", "--x64"] },
  "linux-x64": { bun: "bun-linux-x64", exe: "mtg-server", builder: ["--linux", "--x64"] },
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
const run = (cmd, cmdArgs, cwd, env) =>
  execFileSync(cmd, cmdArgs, { cwd, stdio: "inherit", env: { ...process.env, ...env } });

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
//
// Staged under a fixed name because electron-builder.yml has to name the
// directory it copies into Resources, and cannot know which target this is.
const staging = join(HERE, "build", "resources");
rmSync(join(HERE, "build"), { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

console.log(`• mtg-server — bun compile for ${target.bun}`);
run("bun", ["build", "--compile", `--target=${target.bun}`, "server/main.ts", "--outfile", join(staging, target.exe)], REPO);

// ---------------------------------------------------------- 3. the Electron
// bun, not node: electron-builder 26 `require()`s ES modules, which needs node
// 20.19+. Running it under bun sidesteps the question, and bun is already a
// hard requirement here — it is what compiles the server.
console.log(`• electron-builder — ${name}`);
run(
  "bun",
  [join(HERE, "node_modules", "electron-builder", "cli.js"), ...target.builder, "--config", "electron-builder.yml"],
  HERE,
  // Nothing here is signed or notarized. Left on, electron-builder finds a
  // Developer ID in the login keychain and half-signs a build that then fails
  // to launch for anyone else.
  { CSC_IDENTITY_AUTO_DISCOVERY: "false" }
);

console.log(`\ndone — see ${join(HERE, "dist")}`);
