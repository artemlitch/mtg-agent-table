// Archive writing: summary + transcript from a raw game state.
import { test, expect } from "bun:test";
import { archiveGame, summarizeGame } from "../server/archive";
import { game, resetGameState, applyAction, newCardId } from "../server/game";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

test("archiveGame writes json + md with result, decks and full log", async () => {
  resetGameState();
  game.started = true;
  game.turnNumber = 9;
  game.players.you.deckName = "Scarab God";
  game.players.you.deckId = 25457454;
  game.players.agent.deckName = "Thromok";
  game.players.agent.deckId = 2638949;
  applyAction("you", "life", { player: "agent", set: -2 });
  applyAction("you", "life", { player: "you", set: 42 });
  const s = summarizeGame(game);
  expect(s.winner).toBe("you");
  const dir = mkdtempSync(tmpdir() + "/games-");
  const base = await archiveGame(game, dir, 1787000000000);
  const rec = await Bun.file(base + ".json").json();
  expect(rec.winner).toBe("you");
  expect(rec.decks.agent.id).toBe(2638949);
  expect(rec.log.length).toBeGreaterThan(0);
  const md = await Bun.file(base + ".md").text();
  expect(md).toContain("PLAYER wins");
  expect(md).toContain("archidekt.com/decks/25457454");
});
