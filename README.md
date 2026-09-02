# MTG Agent Table

A local virtual tabletop for 1v1 Commander where the opponent's seat is piloted
by an agent. No rules engine — it's a shared table with **server-enforced hidden
information**: the agent literally never receives your hand or library in its
context, and you see card backs for its hand. Reveals, scries and face-down
theft exiles are explicit visibility grants, exactly like paper.

Unofficial fan project. Not affiliated with Wizards of the Coast, Archidekt or
Scryfall.

## Download

A desktop app, if you would rather not keep a terminal open:

- **macOS (Apple silicon)** —
  [MTG-Battlefield-mac-arm64.zip](https://github.com/artemlitch/mtg-agent-table/releases/latest/download/MTG-Battlefield-mac-arm64.zip)
- **Windows (x64)** —
  [MTG-Battlefield-win-x64.zip](https://github.com/artemlitch/mtg-agent-table/releases/latest/download/MTG-Battlefield-win-x64.zip)

The server is compiled into the app, so nothing has to be installed to open it —
no Bun, no checkout. The brain is still your choice on first run, and a Claude
brain still wants the `claude` CLI logged in on the machine.

Neither build is code-signed, so each OS objects once. On macOS, unzip, drag
`MTG Battlefield.app` to Applications, and clear the quarantine flag the
download put on it:

```
xattr -dr com.apple.quarantine "/Applications/MTG Battlefield.app"
```

On Windows, unzip anywhere and run `MTG Battlefield.exe`; SmartScreen warns
about an unknown publisher, and **More info → Run anyway** gets past it.

The app and the checkout share one data directory, so a game started in either
is waiting in the other.

## Requirements

Only for running from source — the download above needs none of this.

- [Bun](https://bun.sh) — runs the server and the test suite
- A brain for the other seat, either:
  - [Claude Code](https://claude.com/claude-code) logged in — Claude plays on
    your subscription, nothing per game, or
  - a [DeepSeek](https://platform.deepseek.com) API key — billed per token, a
    game costs cents
- Two [Archidekt](https://archidekt.com) deck ids: yours and the agent's. Public
  decks, no account needed to play.

## Run

```
bun install
bun run build          # compiles the UI into web/
bun run server/index.ts
```

Open http://localhost:4780. Enter two Archidekt deck ids (or paste the deck
URLs), pick the brain, hit **New game**. Decks load from Archidekt and are
hydrated with Scryfall images and oracle text. Both players start at 40, draw 7;
the agent wakes up, evaluates its hand, mulligans if it wants, and passes back.

The first run has no brain configured, so the Chat tab becomes a setup screen:
test Claude Code, or paste a DeepSeek key. Whatever you give it is stored 0600
in the app data dir and never sent back to the page.

For UI work, `bun run dev` puts Vite on :4781 with hot reload, proxying the API
and websocket to the server on :4780. Both have to be running. (Note: :4781 is
also the deck studio's default port — run one or the other, or move one with
`STUDIO_PORT`.)

## Configuration

Nothing needs configuring. Every secret can be typed into the app.

If you'd rather keep them in a file, copy `.env.example` to `.env` — Bun loads
it from the repo root at boot. It documents every variable the app reads: keys,
base URLs, ports, and where state lives. `.env` is gitignored.

Games, keys and the live state file go to the OS application-data directory
(`~/Library/Application Support/MTG Battlefield` on macOS), never the checkout,
so the repo stays disposable. `DATA_DIR` moves them.

## Who plays the other seat

Pick the brain in **New game**. The catalog lives in `server/models.ts`: Opus,
Sonnet and Haiku on Anthropic, DeepSeek Pro and Flash on their own key. All of
them speak the Anthropic Messages API — DeepSeek through the `/anthropic` skin
it publishes — so one tool loop in `server/agent.ts` drives every one of them.

Claude is deliberately the exception to the key box: it runs the local `claude`
CLI on your Claude Code login, and the server refuses to store an Anthropic API
key at all, so a Claude game can never bill per token. Everything else pastes a
key in the Chat tab.

`server/keystore.ts` also holds an escape hatch for any other
Messages-compatible endpoint (OpenRouter, llama.cpp, LM Studio). Configuring one
overrides the picker while it is set.

## How the loop works

- Everything is an action against `POST /api/action`; the UI and the agent use
  the same API, so anything you can do to its cards it can do to yours.
- You act freely, then press **Done — agent's window** (or send a chat message).
  The server wakes the agent with every log event since it last looked, rendered
  from its viewpoint. `server/wake.ts` decides which actions are worth a window
  and how long to wait first — a run of three taps is one wake, not three.
- The agent gets the table as MCP tools (`server/mcp-tools.ts`): get_state,
  draw, move, tap, attack, life, peek/reorder (scry), view_zone, say, ask_user,
  done. On the CLI transport it is a `claude -p --resume <session>`
  conversation; on an API key it is a tool loop in `server/agent.ts`.
- Its entire output — reasoning text and every tool call — streams into the
  **Agent** tab. `say`/`ask_user` land in **Chat**. Questions it asks block until
  you answer there.

## Deck studio (optional)

A second, separate server for editing decks with an agent rather than playing
with them:

```
bun run server/studio-server.ts
```

Open http://localhost:4781. The agent files swap proposals through its own MCP
server (`server/studio-mcp-tools.ts`); each one renders as a card-by-card
comparison with the deck metadata it would produce. Nothing is written to
Archidekt until you press Confirm.

This is the one place that needs an Archidekt account, because Archidekt has no
API tokens and editing a deck costs the password. The page asks for it on first
load and stores it 0600 in the app data dir; `ARCHIDEKT_USER`/`ARCHIDEKT_PASS`
in `.env` work too. Playing never needs it — reading a public deck needs nobody.

## Pointing your own agent at the table

`mcp.json` and `mcp-studio.json` wire an outside agent session (a terminal
Claude Code, say) to a running table or studio, instead of the one the server
spawns:

```
claude --mcp-config mcp.json
```

## Development

```
bun run test        # vitest, under the Bun runtime — NOT `bun test`
bun run typecheck   # tsc --noEmit
bun run build       # typecheck + vite build into web/
```

Layout:

- `server/game.ts` — state model, actions, per-viewer redaction, event log
- `server/decks.ts` — Archidekt + Scryfall deck loading
- `server/agent.ts` — the agent harness: Messages-API tool loop + Claude CLI
- `server/models.ts` — the brain catalog: which models exist, and where
- `server/mcp-tools.ts` — stdio MCP server for the table (zero-dep JSON-RPC)
- `server/wake.ts` — when the agent gets a window
- `server/index.ts` — Bun HTTP + WebSocket server
- `server/main.ts` — the entrypoint the shipped binary compiles from
- `client/` — the React UI; `bun run build` compiles it into `web/`
- `electron/` — the desktop shell, and the script that packages it

### Packaging the desktop app

```
cd electron && npm install    # once: electron + electron-packager
cd .. && bun run app          # this machine's platform, zipped, into electron/dist/
```

`electron/build.mjs` fuses three things: the Vite output, the server compiled to
a single native executable by `bun build --compile`, and Electron. That compiled
server is what makes the app self-contained — and it is one binary doing two
jobs, because a packaged app has no `bun` to start a second script with. Run
bare it is the table; run as `mtg-server mcp` it is the stdio MCP server the
Claude CLI spawns to reach the table. `server/packaged.ts` is how the code tells
which world it is in: from a checkout it resolves `web/` and the CLI's working
directory against the repo, and from a binary against the executable and the
data dir.

Other platforms are `--target=mac-x64 | win-x64 | linux-x64` passed to
`build.mjs`. The Windows app is the one exception to cross-building: the server
half compiles for Windows from anywhere, but stamping the `.exe` with its icon
needs rcedit, which needs Windows or wine — so the build refuses rather than
quietly shipping an app wearing Electron's default icon. Push a `v*` tag and
`.github/workflows/release.yml` builds both on native runners and attaches them
to a GitHub Release, which is also the only place they fit: each zip is ~120MB
and GitHub rejects any file over 100MB on push.

Artwork lives in `electron/icon.icns`; `npm run icons` regenerates the `.ico`
and `.png` beside it.

`tools/token-cost.ts` and `tools/effort-test.ts` measure what a game costs on a
metered brain: they replay a saved game against the real API and print predicted
against billed. Both spend money; read the header comments first.

## Third-party assets

- UI icons: [game-icons.net](https://game-icons.net) (Lorc, Delapouite and
  contributors, CC BY 3.0), inlined by `tools/build-icons.mjs`
- Fonts: Alegreya Sans, Cinzel, IM Fell English (SIL Open Font License, texts in
  `client/public/fonts/`)
- Card images and oracle text are fetched from Scryfall at runtime and are not
  redistributed here. `client/public/card-back.jpg` is the one bundled piece of
  Magic art; swap it if that matters for your use.

Magic: The Gathering is a trademark of Wizards of the Coast. This project is
unaffiliated and not endorsed by them.

## License

MIT — see [LICENSE](LICENSE).
