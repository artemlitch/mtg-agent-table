// Desktop shell for the MTG agent table.
//
// Packaged, this app is self-contained: the server is a compiled Bun binary in
// Resources with the built UI beside it, so nothing has to be installed on the
// machine to play. (A Claude brain still wants the `claude` CLI, and a DeepSeek
// brain still wants a key — but those are choices made inside the app, not
// prerequisites for opening it.)
//
// Run from the checkout instead and there is no binary in Resources, so it
// falls back to `bun run server/index.ts` against the repo one level up.
//
// Either way it attaches to a server already listening on the port rather than
// starting a second one, and only kills a server it started itself.
const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const PORT = process.env.PORT || 4780;
const URL = `http://localhost:${PORT}/`;
const LOG = path.join(os.tmpdir(), "mtg-agent-table.log");
const WIN = process.platform === "win32";

/** The shipped server binary, or null when running from a checkout. */
function packagedServer() {
  const bin = path.join(process.resourcesPath, WIN ? "mtg-server.exe" : "mtg-server");
  return fs.existsSync(bin) ? bin : null;
}

/** Dev fallback: bun, plus a checkout to run it in. Finder- and Start-menu-
 * launched apps get a bare PATH, so bun's usual homes are checked by hand. */
function devServer() {
  const repo = [process.env.MTG_TABLE_DIR, path.join(__dirname, "..")]
    .filter(Boolean)
    .find((p) => fs.existsSync(path.join(p, "server/index.ts")));
  if (!repo) return null;
  const bun = [
    path.join(os.homedir(), ".bun/bin/bun" + (WIN ? ".exe" : "")),
    "/opt/homebrew/bin/bun",
    "/usr/local/bin/bun",
  ].find((p) => fs.existsSync(p)) || (WIN ? "bun.exe" : "bun");
  return { cmd: bun, args: ["run", "server/index.ts"], cwd: repo };
}

let win = null;
let ownedServer = null;

async function serverUp() {
  try {
    const res = await fetch(URL + "api/state?viewer=you", { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await serverUp()) return;

  const bin = packagedServer();
  const launch = bin
    ? { cmd: bin, args: [], cwd: process.resourcesPath }
    : devServer();
  if (!launch) {
    throw new Error(
      "no server to run: this build has no bundled binary and no checkout was found. " +
        "Point MTG_TABLE_DIR at one, or start the server yourself before opening the app."
    );
  }

  const log = fs.openSync(LOG, "a");
  ownedServer = spawn(launch.cmd, launch.args, {
    cwd: launch.cwd,
    stdio: ["ignore", log, log],
    windowsHide: true,
  });
  ownedServer.on("exit", () => { ownedServer = null; });

  for (let i = 0; i < 80; i++) {
    if (await serverUp()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not come up on :${PORT} — see ${LOG}`);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1680,
    height: 1050,
    minWidth: 1100,
    minHeight: 700,
    title: "MTG Battlefield",
    backgroundColor: "#0f0a06",
    // macOS takes its icon from the bundle; Windows and Linux want one here
    ...(WIN || process.platform === "linux" ? { icon: path.join(__dirname, "icon.png") } : {}),
    webPreferences: { contextIsolation: true },
  });

  // same-origin pages (studio, soundlab) stay in the app; everything else
  // goes to the default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(URL)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(URL)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  win.on("closed", () => { win = null; });
  win.loadURL(URL);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      await ensureServer();
    } catch (e) {
      // a window that never loads tells you nothing; the log path does
      dialog.showErrorBox("MTG Battlefield could not start", String(e.message || e));
      app.quit();
      return;
    }
    createWindow();
  });

  app.on("activate", () => {
    if (!win) createWindow();
  });

  app.on("window-all-closed", () => app.quit());

  app.on("quit", () => {
    if (ownedServer) ownedServer.kill();
  });
}
