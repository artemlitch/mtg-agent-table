// What the agent is given to referee WITH.
//
// Live game, round 2: Player tapped two basic Forests and cast a {3} artifact.
// The agent locked it in without a word. The table does not enforce costs on
// purpose — the opponent is the referee — so the only question worth asking is
// whether the referee was handed the two numbers it needed: what the spell
// cost, and what was tapped to pay for it.
import { describe, test, expect, beforeEach } from "vitest";

process.env.ANTHROPIC_KEY_FILE = "/tmp/mtg-agent-test-absent-anthropic-key";
process.env.DEEPSEEK_KEY_FILE = "/tmp/mtg-agent-test-absent-deepseek-key";
process.env.PROVIDER_FILE = "/tmp/mtg-agent-test-absent-provider.json";
process.env.CLAUDE_CLI_MARKER = "/tmp/mtg-agent-test-absent-cli-marker";

const { AgentRunner } = await import("../server/agent");
const { resetGameState, makeCard, game, applyAction } = await import("../server/game");

/** The live seq 28-33 line, rebuilt: two Forests down, both tapped, a {3}
 *  Equipment cast off them. Returns the agent's reaction window. */
function busterSword() {
  resetGameState();
  const lands = ["f1", "f2"].map((id) =>
    makeCard({ id, name: "Forest", owner: "you", controller: "you", zone: "battlefield", typeLine: "Basic Land — Forest" })
  );
  for (const c of lands) {
    game.cards[c.id] = c;
    game.players.you.zones.battlefield.push(c.id);
  }
  const sword = makeCard({
    id: "bs",
    name: "Buster Sword",
    owner: "you",
    controller: "you",
    zone: "hand",
    mana: "{3}",
    typeLine: "Legendary Artifact — Equipment",
  });
  game.cards[sword.id] = sword;
  game.players.you.zones.hand.push(sword.id);

  applyAction("you", "set_phase", { phase: "main1" });
  applyAction("you", "tap", { cards: ["f1"] });
  applyAction("you", "tap", { cards: ["f2"] });
  applyAction("you", "cast", { card: "bs" });

  const a = new AgentRunner();
  a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
  return { agent: a, prompt: a.composeWakePrompt("react") };
}

describe("refereeing a spell on the stack", () => {
  beforeEach(() => resetGameState());

  test("the wake shows the spell and the tapped lands", () => {
    const { prompt } = busterSword();
    // this much already works: the item is named and the board is current
    expect(prompt).toContain("Buster Sword");
    expect(prompt).toContain("Forest (T) · Forest (T)");
  });

  test("the wake names what the spell costs", () => {
    // Without the cost, "Buster Sword" is a name the agent has to price from
    // memory — and this one was printed in 2025. Refereeing a payment it
    // cannot see the price of is guesswork.
    const { prompt } = busterSword();
    expect(prompt).toContain("{3}");
  });

  test("the wake counts what Player turned sideways to pay for it", () => {
    // Two Forests. The agent used to be shown two permanents with (T) beside
    // them in a digest whose whole job is to be glanced at, and left to do the
    // counting itself. The table counts permanents, not mana — one can make
    // two and a tapped creature makes none — so the sum stays the agent's.
    const { prompt } = busterSword();
    expect(prompt).toContain("Player's tapped permanents (2): Forest, Forest");
  });

  test("the wake asks for the check while the spell is still on the stack", () => {
    // The referee duty is one line of the system prompt, hundreds of lines
    // back. The moment it matters is this window and no other: the untap step
    // wipes the evidence, and once the item resolves taking it back is an
    // argument instead of a question.
    const { prompt } = busterSword();
    expect(prompt).toContain("PAYMENT CHECK");
    expect(prompt).toMatch(/ASK in chat before resolving/);
  });

  test("nothing of Player's on the stack, nothing to price", () => {
    // The check rides only the windows it is about — it is not another
    // standing paragraph in every wake.
    resetGameState();
    const a = new AgentRunner();
    a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
    expect(a.composeWakePrompt("react")).not.toContain("PAYMENT CHECK");
  });

  test("the agent's own items are not its to referee", () => {
    resetGameState();
    const rock = makeCard({ id: "sr", name: "Sol Ring", owner: "agent", controller: "agent", zone: "hand", mana: "{1}", typeLine: "Artifact" });
    game.cards[rock.id] = rock;
    game.players.agent.zones.hand.push(rock.id);
    (game.agentSeen ??= {})[rock.id] = true;
    applyAction("agent", "cast", { card: "sr" });

    const a = new AgentRunner();
    a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
    expect(a.composeWakePrompt("window")).not.toContain("PAYMENT CHECK");
  });

  test("an attacker is sideways from attacking, and says so", () => {
    // In a combat trick every attacker is tapped, and an unmarked count reads
    // as mana that paid for the trick. Marked, not dropped: which permanents
    // make mana is a card reading, and the table does not do those.
    resetGameState();
    const bear = makeCard({ id: "bear", name: "Bear", owner: "you", controller: "you", zone: "battlefield", power: "2", toughness: "2" });
    const land = makeCard({ id: "f3", name: "Forest", owner: "you", controller: "you", zone: "battlefield", typeLine: "Basic Land — Forest" });
    const trick = makeCard({ id: "gg", name: "Giant Growth", owner: "you", controller: "you", zone: "hand", mana: "{G}", typeLine: "Instant" });
    for (const c of [bear, land]) {
      game.cards[c.id] = c;
      game.players.you.zones.battlefield.push(c.id);
    }
    game.cards[trick.id] = trick;
    game.players.you.zones.hand.push(trick.id);
    applyAction("you", "set_phase", { phase: "combat" });
    applyAction("you", "attack", { pairs: [{ attacker: bear.id, target: "agent" }] });
    applyAction("you", "finish_attacks", {});
    applyAction("agent", "stack_resolve", {});
    applyAction("you", "tap", { cards: [bear.id, "f3"] });
    applyAction("you", "cast", { card: "gg" });

    const a = new AgentRunner();
    a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
    const prompt = a.composeWakePrompt("react");
    expect(prompt).toContain("Giant Growth costs {G}");
    expect(prompt).toContain("Bear (attacking), Forest");
  });

  test("the wake says what Player's card actually DOES", () => {
    // Live game, round 5: Player cast Archdruid's Charm and the agent — asked
    // to resolve it — spent a whole thinking block reconstructing the card
    // from memory before it thought to look:
    //
    //   "Actually, Archdruid's Charm is a real card (MH3). Its modes:
    //    - Search your library … (or put creature onto battlefield? Let me
    //      recall.)  - Create a 3/3 green Beast token? No.
    //    - Put a +1/+1 counter…? Hmm.  … Wait, let me get the exact text."
    //
    // The text was on the server the whole time. The table already refuses to
    // let the agent cast a card whose oracle it has never been shown
    // (READ FIRST, in cast) — it guaranteed the agent had read its OWN cards
    // and guaranteed nothing about the one it is being asked to adjudicate.
    resetGameState();
    const charm = makeCard({
      id: "adc",
      name: "Archdruid's Charm",
      owner: "you",
      controller: "you",
      zone: "hand",
      mana: "{G}{G}{G}",
      typeLine: "Instant",
      oracle: "Choose one —\n• Search your library for a creature or land card and reveal it.\n• Put a +1/+1 counter on target creature you control. It deals damage equal to its power to target creature you don't control.",
    });
    game.cards[charm.id] = charm;
    game.players.you.zones.hand.push(charm.id);
    applyAction("you", "cast", { card: charm.id });

    const a = new AgentRunner();
    a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
    const prompt = a.composeWakePrompt("react");
    expect(prompt).toContain("Put a +1/+1 counter on target creature you control");
    expect(prompt).toContain("Choose one");
  });

  test("...and says nothing about a card it is not allowed to see", () => {
    // a face-down item is text the agent has not been shown, and inventing it
    // here would be worse than the guessing this replaces
    resetGameState();
    const morph = makeCard({
      id: "mo",
      name: "Secret",
      owner: "you",
      controller: "you",
      zone: "hand",
      mana: "{3}",
      typeLine: "Creature",
      oracle: "Nobody's business",
      faceDown: true,
      visibleTo: ["you"],
    });
    game.cards[morph.id] = morph;
    game.players.you.zones.hand.push(morph.id);
    applyAction("you", "cast", { card: morph.id });
    applyAction("you", "flip_card", { cards: [morph.id] });

    const a = new AgentRunner();
    a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
    expect(a.composeWakePrompt("react")).not.toContain("Nobody's business");
  });
});

describe("a card the events named, delivered once", () => {
  // The general form of the block above, and what naming a card in the log
  // registers the id FOR. A card that never touches the stack — a creature
  // reanimated straight onto the battlefield, a land with text on it — was
  // named and nothing else, and the agent had to remember or go looking.
  const reanimate = () => {
    resetGameState();
    const c = makeCard({
      id: "gd",
      name: "Gilded Drake",
      owner: "you",
      controller: "you",
      zone: "graveyard",
      mana: "{1}{U}",
      typeLine: "Creature — Drake",
      oracle: "Flying\nWhen Gilded Drake enters, exchange control of it and up to one target creature an opponent controls.",
    });
    game.cards[c.id] = c;
    game.players.you.zones.graveyard.push(c.id);
    applyAction("you", "move", { card: c.id, toZone: "battlefield", note: "reanimated" });
    const a = new AgentRunner();
    a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
    return a;
  };

  test("arrives with its full text the window it is named in", () => {
    const a = reanimate();
    const prompt = a.composeWakePrompt("react");
    expect(prompt).toContain("CARDS NAMED ABOVE");
    expect(prompt).toContain("Gilded Drake — {1}{U}");
    expect(prompt).toContain("exchange control of it");
  });

  test("...and never a second time", () => {
    // agentSeen is the ledger READ FIRST already keeps; a card whose text has
    // reached the agent's context has reached it, and repeating it every window
    // is the bloat that made the board digest deliberately textless
    const a = reanimate();
    a.composeWakePrompt("react");
    applyAction("you", "tap", { cards: ["gd"] });
    expect(a.composeWakePrompt("react")).not.toContain("CARDS NAMED ABOVE");
  });

  test("a card the agent may not see is not described to it", () => {
    resetGameState();
    const c = makeCard({
      id: "sk",
      name: "Skulking Ghost",
      owner: "you",
      controller: "you",
      zone: "hand",
      mana: "{2}{B}",
      typeLine: "Creature — Spirit",
      oracle: "Flying\nWhen Skulking Ghost becomes the target of a spell, sacrifice it.",
    });
    game.cards[c.id] = c;
    game.players.you.zones.hand.push(c.id);
    applyAction("you", "move", { card: c.id, toZone: "exile", faceDown: true, revealTo: "you" });

    const a = new AgentRunner();
    a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
    const prompt = a.composeWakePrompt("react");
    expect(prompt).not.toContain("Skulking Ghost");
    expect(prompt).not.toContain("sacrifice it");
  });

  test("the stack block keeps its own copy — an item you must adjudicate is not said once", () => {
    // deliberately not deduped against CARDS NAMED ABOVE from the other side:
    // an item sits on the stack across several windows, and the whole reason
    // the board digest exists is that the agent plays off its own older prose
    resetGameState();
    const c = makeCard({
      id: "ct", name: "Counterspell", owner: "you", controller: "you", zone: "hand",
      mana: "{U}{U}", typeLine: "Instant", oracle: "Counter target spell.",
    });
    game.cards[c.id] = c;
    game.players.you.zones.hand.push(c.id);
    applyAction("you", "cast", { card: c.id });

    const a = new AgentRunner();
    a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
    expect(a.composeWakePrompt("react")).toContain("Counter target spell.");
    // still there a window later, while it is still Player's to resolve
    applyAction("you", "chat", { text: "anything?" });
    expect(a.composeWakePrompt("react")).toContain("Counter target spell.");
  });
});

describe("refereeing, continued", () => {
  test("the duty in the system prompt has the shape the evasion check has", () => {
    // The evasion line works and this one did not, and they were not written
    // alike: "check X before you Y", the inputs named, an observable output
    // ("name the check"), and whose failure it is. The referee line said
    // "challenge suspicious plays" — no moment, no inputs, no output, no
    // owner — and sat mid-list under stack mechanics.
    resetGameState();
    const a = new AgentRunner();
    a.reset({ agentDeck: "Gonti", decklist: ["Sol Ring"], userDeck: "Marchesa" });
    expect(a.systemPrompt).toMatch(/Before you resolve ANY item of theirs, price the spell/);
    expect(a.systemPrompt).toMatch(/Name the check you made/);
    expect(a.systemPrompt).toMatch(/The table stops nothing, which makes catching it yours/);
    // and resolving is assent, not a formality
    expect(a.systemPrompt).toMatch(/Resolving is your assent that the item was legal/);
  });
});
