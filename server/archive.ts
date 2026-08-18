// Post-game archive for deck-performance analysis: one JSON record (machine)
// plus a readable .md transcript per finished game, written into games/ when
// the next game starts (that's the only moment the table knows a game is over).

import { mkdirSync } from "node:fs";
import { renderLogFor, type PlayerId } from "./game";

const slug = (s?: string) =>
  (s ?? "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

/** Result summary from a raw game state (also used for retro-converting backups). */
export function summarizeGame(g: any) {
  const you = g.players.you;
  const agent = g.players.agent;
  const winner: PlayerId | null =
    you.life <= 0 && agent.life > 0 ? "agent" : agent.life <= 0 && you.life > 0 ? "you" : null;
  return {
    rounds: g.turnNumber,
    winner,
    life: { you: you.life, agent: agent.life },
    decks: {
      you: { id: you.deckId ?? null, name: you.deckName ?? "unknown" },
      agent: { id: agent.deckId ?? null, name: agent.deckName ?? "unknown" },
    },
  };
}

/** Write <dir>/<stamp>-<you>-vs-<agent>.{json,md}; returns the base path. */
export async function archiveGame(g: any, dir: string, endedAtMs = Date.now()) {
  mkdirSync(dir, { recursive: true });
  const s = summarizeGame(g);
  const stamp = new Date(endedAtMs).toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const base = `${dir}/${stamp}-${slug(s.decks.you.name)}-vs-${slug(s.decks.agent.name)}`;
  // Artem's view of the log: what was public at the table, plus his private lines
  const log = (g.log ?? []).map((e: any) => renderLogFor(e, "you"));
  await Bun.write(
    base + ".json",
    JSON.stringify({ endedAt: new Date(endedAtMs).toISOString(), ...s, log }, null, 1)
  );
  const deckLink = (d: { id: number | null; name: string }) =>
    d.id ? `[${d.name}](https://archidekt.com/decks/${d.id})` : d.name;
  const md = [
    `# ${s.decks.you.name} vs ${s.decks.agent.name}`,
    ``,
    `- ended: ${new Date(endedAtMs).toISOString()}`,
    `- rounds: ${s.rounds}`,
    `- result: ${s.winner ? (s.winner === "you" ? "ARTEM wins" : "AGENT wins") : "unfinished"} — ${s.life.you} vs ${s.life.agent}`,
    `- decks: Artem ${deckLink(s.decks.you)} · Agent ${deckLink(s.decks.agent)}`,
    ``,
    `## Log`,
    ``,
    ...log.map((e: any) => `- \`${e.seq}\` ${e.text}`),
    ``,
  ].join("\n");
  await Bun.write(base + ".md", md);
  return base;
}
