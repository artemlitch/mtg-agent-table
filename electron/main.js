// Desktop shell for the MTG agent table. Attaches to a running server on the
// table's port; only spawns one (and owns its lifetime) if nothing is there.
const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const PORT = process.env.PORT || 4780;
const URL = `http://localhost:${PORT}/`;
const LOG = path.join(require("os").tmpdir(), "mtg-agent-table.log");

// dev runs from electron/, so the checkout is one level up. A packaged .app
// runs from inside an asar and has no checkout under it at all — point
// MTG_TABLE_DIR at one, or start the server yourself before opening the app.
const REPO = [process.env.MTG_TABLE_DIR, path.join(__dirname, "..")]
  .filter(Boolean)
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
