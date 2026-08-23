// Every conversation with the server. The UI never fetches anywhere else.
import { useGame } from "./store/game";
import type { BrainEntry, GameView } from "./types";

export interface ActionResult {
  ok: boolean;
  error?: string;
  [k: string]: any;
}

/** Run a table action as the player. Anything the agent can do to your cards
 *  you can do to its cards — same endpoint, same vocabulary. */
export async function act(type: string, params: Record<string, any> = {}): Promise<ActionResult> {
  const res = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actor: "you", type, params }),
  });
  const data = (await res.json()) as ActionResult;
  if (!data.ok) alert(`Action failed: ${data.error}`);
  return data;
}

export async function refresh(): Promise<void> {
  const res = await fetch("/api/state?viewer=you");
  useGame.getState().applyView((await res.json()) as GameView);
}

export async function loadBrain(): Promise<void> {
  const res = await fetch("/api/brain");
  const data = (await res.json()) as { entries: BrainEntry[]; busy: boolean };
  useGame.getState().setBrain(data.entries, data.busy);
}

/** Undo / redo. Nothing to step to is not an error worth a dialog — the
 *  button just sits there. */
const step = (what: "undo" | "redo") => async () => {
  await fetch(`/api/${what}`, { method: "POST" });
  await refresh();
};
export const undoLastAction = step("undo");
export const redoLastAction = step("redo");

export async function newGame(youDeck: string, agentDeck: string, model: string): Promise<ActionResult> {
  const res = await fetch("/api/new_game", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ youDeck, agentDeck, model }),
  });
  return (await res.json()) as ActionResult;
}

export async function testClaudeCli(): Promise<ActionResult> {
  const res = await fetch("/api/claude/test", { method: "POST" });
  return (await res.json()) as ActionResult;
}

export async function saveKey(key: string, provider = "anthropic"): Promise<ActionResult> {
  const res = await fetch("/api/key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, provider }),
  });
  return (await res.json()) as ActionResult;
}

export const deleteKey = (provider = "anthropic") =>
  fetch(`/api/key?provider=${encodeURIComponent(provider)}`, { method: "DELETE" });

/** The push channel. `update` means refetch the view; `brain` streams the
 *  agent's thoughts as they happen. Reconnects forever. */
export function connectWS(onBrain: (e: BrainEntry) => void) {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "update") refresh();
    if (msg.type === "brain") {
      useGame.getState().pushBrain(msg.entry, msg.busy);
      onBrain(msg.entry);
    }
  };
  ws.onclose = () => setTimeout(() => connectWS(onBrain), 1500);
}
