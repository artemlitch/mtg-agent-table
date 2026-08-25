import { Fragment, useEffect, useState } from "react";
import { act, newGame, redoLastAction, undoLastAction } from "../../api";
import { Dropdown } from "../../components/Dropdown";
import { Icon } from "../../components/Icon";
import { useGame } from "../../store/game";
import type { GameView } from "../../types";

// The turn as a route: dots on a line, one lit. The phase itself is free text,
// so each stop owns a pattern rather than an exact string — "declare blockers"
// still lights combat.
const PHASES = [
  { key: "untap/upkeep", label: "Untap", re: /untap|upkeep/i },
  { key: "main 1", label: "Main 1", re: /main 1/i },
  { key: "combat", label: "Combat", re: /combat|attack|block|damage/i },
  { key: "main 2", label: "Main 2", re: /main 2/i },
  { key: "end", label: "End", re: /end/i },
];

// The brains come from the server's catalog — it owns which ones exist and
// which ones have a key. This is only the fallback for a view that has not
// arrived yet, so the picker is never empty.
const FALLBACK_MODEL = { value: "opus", name: "Opus", note: "strongest", provider: "anthropic", ready: true };

const modelOptions = (view: GameView | null) =>
  (view?.models?.length ? view.models : [FALLBACK_MODEL]).map((m) => ({
    value: m.value,
    label: `${m.name} — ${m.ready ? m.note : "needs a key"}`,
  }));

export function TopBar() {
  const view = useGame((s) => s.view);
  const [newGameOpen, setNewGameOpen] = useState(false);
  const [autoOpened, setAutoOpened] = useState(false);

  // no game loaded and nothing asked for yet: put the deck picker up once
  useEffect(() => {
    if (view && !view.started && !autoOpened) {
      setAutoOpened(true);
      setNewGameOpen(true);
    }
  }, [view, autoOpened]);

  return (
    <div id="topbar">
      <div className="setup">
        <button id="btn-newgame" onClick={() => setNewGameOpen(true)}>
          New game
        </button>
      </div>
      {/* the banner says whose turn it is and nothing else — the phase lives
          on the track at the other end of the bar */}
      <div id="turnbanner">
        {view?.started
          ? `Round ${view.turnNumber} — ${view.turn === "you" ? "Your turn" : "Agent's turn"}`
          : "No game — hit New game to load decks"}
      </div>
      {newGameOpen && <NewGameOverlay onClose={() => setNewGameOpen(false)} />}
      <div className="phasebtns">
        <PhaseTrack phase={view?.phase ?? ""} />
        <button
          id="btn-endturn"
          className="accent"
          data-tip="End your turn and hand the table to the agent"
          data-tip-keys="⇧,space"
          onClick={async () => {
            await act("set_turn", { player: "agent" });
            await act("done", {});
          }}
        >
          End turn → Agent
        </button>
        <button id="btn-undo" data-tip="Undo" data-tip-keys="⌘,Z" onClick={() => void undoLastAction()}>
          <Icon name="undo" />
        </button>
        <button id="btn-redo" data-tip="Redo" data-tip-keys="⌘,⇧,Z" disabled={!view?.canRedo} onClick={() => void redoLastAction()}>
          <Icon name="redo" />
        </button>
      </div>
    </div>
  );
}

function PhaseTrack({ phase }: { phase: string }) {
  const now = PHASES.findIndex((p) => p.re.test(phase));
  return (
    <div id="phasetrack">
      {PHASES.map((p, i) => (
        <Fragment key={p.key}>
          {i > 0 && <span className={`pt-line${i - 1 < now ? " done" : ""}`} />}
          <button
            className={`pt-node${i === now ? " now" : ""}${i < now ? " done" : ""}`}
            data-tip={p.label}
            // moving to the untap step untaps you — the server does it now, for
            // whichever seat's turn it is, so both players get the same step
            onClick={() => void act("set_phase", { phase: p.key })}
          >
            <span className="pt-dot" />
            <span className="pt-name">{p.label}</span>
          </button>
        </Fragment>
      ))}
    </div>
  );
}

/** Accepts a bare id or any archidekt.com URL ("…/decks/25319832/slug"). */
const parseDeckRef = (v: string) => String(v).match(/(\d{4,})/)?.[1] ?? "";

/** Fields come prefilled with the currently loaded decks, so a straight
 *  re-match is one click; type over them to switch decks. */
function NewGameOverlay({ onClose }: { onClose: () => void }) {
  const view = useGame((s) => s.view);
  const deckUrl = (id?: number) => (id ? `https://archidekt.com/decks/${id}` : "");
  const [you, setYou] = useState(deckUrl(view?.lastDecks?.you));
  const [agent, setAgent] = useState(deckUrl(view?.lastDecks?.agent));
  const models = modelOptions(view);
  const [model, setModel] = useState(models.some((m) => m.value === view?.agentModel) ? view!.agentModel! : "opus");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const youDeck = parseDeckRef(you);
    const agentDeck = parseDeckRef(agent);
    if (!youDeck || !agentDeck) return alert("Enter a deck for each side — an Archidekt URL or deck id.");
    setLoading(true);
    try {
      const data = await newGame(youDeck, agentDeck, model);
      if (!data.ok) alert("New game failed: " + data.error);
      else onClose();
    } finally {
      setLoading(false);
    }
  };

  const row = (id: string, label: string, value: string, set: (v: string) => void, current?: number) => (
    <div className="ngrow">
      <label htmlFor={id}>{label}</label>
      <input id={id} value={value} onChange={(e) => set(e.target.value)} placeholder="Archidekt URL or deck id" autoComplete="off" autoFocus={id === "deck-agent"} />
      <a href={deckUrl(current) || "#"} target="_blank" rel="noopener">
        {current ? `current: archidekt.com/decks/${current}` : ""}
      </a>
    </div>
  );

  return (
    <div id="newgame-overlay">
      <div className="ngtitle">New game</div>
      {row("deck-agent", "Agent's deck", agent, setAgent, view?.lastDecks?.agent)}
      {row("deck-you", "Your deck", you, setYou, view?.lastDecks?.you)}
      <div className="ngrow">
        <label>Opponent</label>
        <Dropdown options={models} value={model} onPick={setModel} />
      </div>
      <div className="ngbtns">
        <button id="btn-loaddecks" disabled={loading} onClick={() => void load()}>
          {loading ? "Loading…" : "Load decks"}
        </button>
        <button id="btn-ngcancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
