// Desktop shell for the MTG agent table. Attaches to a running server on
// :4780; only spawns one (and owns its lifetime) if nothing is listening.
const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const URL = "http://localhost:4780/";
const LOG = "/tmp/mtg-agent-table.log";

// dev runs from electron/, the packaged .app from inside an asar — find the
// checkout that actually holds the server
const REPO = [path.join(__dirname, ".."), path.join(require("os").homedir(), "projects/mtg-agent-table")]
  .find((p) => fs.existsSync(path.join(p, "server/index.ts")));

// Finder-launched apps get a bare PATH; resolve bun explicitly
const BUN = [path.join(require("os").homedir(), ".bun/bin/bun"), "/opt/homebrew/bin/bun", "/usr/local/bin/bun"]
  .find((p) => fs.existsSync(p)) || "bun";

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
  const log = fs.openSync(LOG, "a");
  ownedServer = spawn(BUN, ["run", "server/index.ts"], {
    cwd: REPO,
    stdio: ["ignore", log, log],
  });
  ownedServer.on("exit", () => { ownedServer = null; });
  for (let i = 0; i < 80; i++) {
    if (await serverUp()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not come up on :4780 — see " + LOG);
}

// frameless: hide the titlebar, pad the topbar past the traffic lights and
// make it the drag region (controls opt back out)
const SHELL_CSS = `
  #topbar { padding-left: 84px !important; -webkit-app-region: drag; }
  #topbar button, #topbar select, #topbar input, #topbar a, #topbar label { -webkit-app-region: no-drag; }
`;

function createWindow() {
  win = new BrowserWindow({
    width: 1680,
    height: 1050,
    minWidth: 1100,
    minHeight: 700,
    title: "MTG Agent Table",
    backgroundColor: "#0f0a06",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 12 },
    webPreferences: { contextIsolation: true },
  });

  win.webContents.on("did-finish-load", () => {
    win.webContents.insertCSS(SHELL_CSS);
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
    await ensureServer();
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
