# MTG Agent Table

A local virtual tabletop for 1v1 Commander where the opponent's seat is piloted
by a Claude agent (Opus via the `claude` CLI). No rules engine — it's a shared
table with **server-enforced hidden information**: the agent literally never
receives your hand or library in its context, and you see card backs for its
hand. Reveals, scries, and face-down theft exiles are explicit visibility
grants, exactly like paper.

## Run

```
bun run server/index.ts
```

Open http://localhost:4780. Enter two Archidekt deck ids (yours + the agent's),
hit **New game**. Decks load from Archidekt (public read) and are hydrated with
Scryfall images/oracle text. Both players start at 40, draw 7; the agent wakes
up, evaluates its hand, mulligans if it wants, and passes back.

## How the loop works

- Everything is an action against `POST /api/action`; the UI and the agent use
  the same API, so anything you can do to its cards it can do to yours.
- You act freely, then press **Done — agent's window** (or send a chat
  message). The server wakes the agent with every log event since it last
  looked, rendered from its viewpoint.
- The agent is a `claude -p --resume <session>` conversation with an MCP tool
  server (`server/mcp-tools.ts`) exposing the table: get_state, draw, move,
  tap, attack, life, peek/reorder (scry), view_zone, say, ask_user, done…
- Its entire output (reasoning text + every tool call) streams into the
  **Agent brain** tab. `say`/`ask_user` land in **Chat**. Questions it asks
  block until you answer in chat.

## Layout

- `server/game.ts` — state model, actions, per-viewer redaction, event log
- `server/decks.ts` — Archidekt + Scryfall deck loading
- `server/agent.ts` — Claude CLI harness (one session per game)
- `server/mcp-tools.ts` — stdio MCP server the CLI mounts (zero-dep JSON-RPC)
- `server/index.ts` — Bun HTTP + WebSocket server
- `web/` — vanilla JS tabletop UI

Zero npm dependencies; Bun and the `claude` CLI are the only requirements.
