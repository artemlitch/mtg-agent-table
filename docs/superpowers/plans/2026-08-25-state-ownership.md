# State Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every game fact the client reconstructs from log prose onto the server — a typed phase, a combat sub-machine, per-turn flags — and give `damage()` its first ordering precondition.

**Architecture:** The server (`server/game.ts`) is the single source of truth; the client's next-action prompt (`client/src/features/nextaction/steps.ts`) becomes a pure reader of `viewFor()`. Eight tests already exist and are red — they were written first and are this plan's acceptance criteria. Tasks 2–4 turn them green; Tasks 1 and 5 carry their own new tests.

**Tech Stack:** Bun runtime, TypeScript, Vitest (via `bun run test` — NOT `bun test`), React client built with Vite.

**Spec:** `proposals/state-ownership.md` (note: `proposals/` is gitignored — read it, don't try to commit changes to it).

## Global Constraints

- **Test command:** `bun run test` (or `bun --bun vitest run <file>`). Plain `bun test` runs the wrong runner and the repo's test script tells you so.
- **Typecheck + build:** `bun --bun run build` (runs `tsc --noEmit && vite build`). Plain `bun run build` fails on system Node 18.
- **Multiple agents work in this repo.** Stage by explicit path only — never `git add .` or `git add -A`. Commit with `git commit -m "..." -- <paths>` or `git commit -F <msgfile> -- <paths>`. `server/game.ts` may carry other agents' uncommitted edits; your commits must include only files this plan touches.
- **Commit message style:** lowercase prose sentence describing the behavior change (repo examples: "the priority pass goes back to being silent", "declaring attackers is yours to finish"). No `feat:`/`fix:` prefixes. End the body with `Co-Authored-By:` naming your model, e.g. `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Server restart:** server code changes need a restart to take effect on the live table at :4780. Find the PID with `lsof -nP -iTCP:4780 -sTCP:LISTEN`, `kill -TERM <pid>` (it flushes state on SIGTERM), then `nohup bun run server/index.ts > <scratchpad>/server.log 2>&1 &`. **Never `pkill -f "server/index.ts"`** — the pattern matches other servers.
- **Line numbers in this plan are approximate** (the file is actively edited). Anchor every edit on the quoted code, not the line number.
- Where this plan and the spec disagree, this plan wins; deviations are called out inline with reasons.

---

### Task 1: Phase vocabulary

`game.phase` is a free string today — `set_phase` stores `String(p.phase).slice(0, 40)` verbatim, so a typo silently falsifies every phase comparison in the client. Make phase a 5-value type with alias folding.

**Files:**
- Modify: `server/game.ts` (type + `normalizePhase` near `GameState`; `set_phase` action)
- Modify: `server/persist.ts` (`restoreState` migration)
- Modify: `server/mcp-tools.ts` (`set_phase` tool description)
- Test: `tests/game.test.ts` (new describe block)

**Interfaces:**
- Consumes: nothing new.
- Produces: `export const PHASES: readonly ["untap/upkeep", "main 1", "combat", "main 2", "end"]`, `export type Phase = (typeof PHASES)[number]`, `export function normalizePhase(raw: string): Phase` — Tasks 2 and 5 rely on these exact names. `GameState.phase` becomes `Phase`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/game.test.ts` (top level, after the last describe):

```ts
describe("phase labels are a vocabulary, not free text", () => {
  test("aliases fold into the five canonical phases", () => {
    for (const [raw, canon] of [
      ["untap", "untap/upkeep"],
      ["upkeep", "untap/upkeep"],
      ["draw", "untap/upkeep"],
      ["Main 1", "main 1"],
      ["combat", "combat"],
      ["second main", "main 2"],
      ["cleanup", "end"],
      ["end step", "end"],
    ] as const) {
      applyAction("you", "set_phase", { phase: raw });
      expect(game.phase).toBe(canon);
    }
  });

  test("bare main resolves to main 1 before combat has resolved", () => {
    // the agent's most common label — "Agent moves to main" — is ambiguous,
    // and before this turn's combat is done it means the first main phase
    applyAction("agent", "set_phase", { phase: "main" });
    expect(game.phase).toBe("main 1");
  });

  test("garbage is refused, naming the vocabulary", () => {
    expect(() => applyAction("you", "set_phase", { phase: "combatt" })).toThrow(/untap\/upkeep.*main 1.*combat.*main 2.*end/);
    expect(game.phase).toBe("untap/upkeep"); // unchanged
  });

  test("the auto-untap still fires on an alias of the untap step", () => {
    const c = seedCard("Guy", "you", "battlefield", { tapped: true });
    applyAction("you", "set_phase", { phase: "untap" });
    expect(c.tapped).toBe(false);
    expect(game.phase).toBe("untap/upkeep");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun --bun vitest run tests/game.test.ts -t "phase labels"`
Expected: FAIL — aliases stay verbatim (`"untap"` !== `"untap/upkeep"`), garbage does not throw.

- [ ] **Step 3: Add the type and normalizer to `server/game.ts`**

Directly above `export interface GameState {`:

```ts
/** The five phases this table tracks. Not the CR's eleven steps — the table
 *  runs at the granularity the two seats actually play at. */
export const PHASES = ["untap/upkeep", "main 1", "combat", "main 2", "end"] as const;
export type Phase = (typeof PHASES)[number];

const PHASE_ALIASES: Record<string, Phase> = {
  "untap/upkeep": "untap/upkeep", untap: "untap/upkeep", upkeep: "untap/upkeep", draw: "untap/upkeep", beginning: "untap/upkeep",
  "main 1": "main 1", main1: "main 1", "first main": "main 1", "precombat main": "main 1", "pre-combat main": "main 1",
  combat: "combat", attack: "combat", attackers: "combat", "declare attackers": "combat", "declare blockers": "combat", blockers: "combat", "combat damage": "combat",
  "main 2": "main 2", main2: "main 2", "second main": "main 2", "postcombat main": "main 2", "post-combat main": "main 2",
  end: "end", "end step": "end", "end of turn": "end", cleanup: "end",
};

/** Any phase label a seat might write, folded to the canonical five — or a
 *  loud error naming them. A typo used to become the phase: set_phase stored
 *  whatever string arrived, and every phase comparison downstream went
 *  quietly false. */
export function normalizePhase(raw: unknown): Phase {
  const key = String(raw ?? "").trim().toLowerCase();
  const hit = PHASE_ALIASES[key];
  if (hit) return hit;
  // "main" alone is the agent's most common label and is genuinely ambiguous;
  // Task 2 refines this to "main 2 once this turn's combat is done"
  if (key === "main") return "main 1";
  throw new Error(`unknown phase "${String(raw)}" — use one of: ${PHASES.join(", ")}`);
}
```

In `GameState`, change `phase: string;` to `phase: Phase;`.

In the `set_phase` action, replace:

```ts
    const phase = String(p.phase).slice(0, 40);
    game.phase = phase;
```

with:

```ts
    const phase = normalizePhase(p.phase);
    game.phase = phase;
```

and replace its auto-untap condition `/^untap/i.test(phase)` with `phase === "untap/upkeep"`.

`newGameState()` already uses `"untap/upkeep"` — no change. If `tsc` flags other assignments to `game.phase` (e.g. `game.phase = "combat"` in `resolveStackItem`), they are already canonical literals and will typecheck as `Phase`.

- [ ] **Step 4: Migrate old saves in `server/persist.ts`**

In `restoreState`, after `(game as any).tokenCatalog ??= {};` add:

```ts
  // phase became a closed vocabulary; live saves hold the old free strings
  try {
    game.phase = normalizePhase(game.phase);
  } catch {
    game.phase = "main 1";
  }
```

and add `normalizePhase` to the import from `./game`.

- [ ] **Step 5: Update the tool description in `server/mcp-tools.ts`**

In the `set_phase` entry, replace the schema line `obj({ phase: str("phase label") }, ["phase"])` with:

```ts
obj({ phase: str("one of: untap/upkeep, main 1, combat, main 2, end (aliases like untap, draw, second main, cleanup are folded in; bare 'main' resolves by whether combat is done)") }, ["phase"])
```

- [ ] **Step 6: Run tests, typecheck**

Run: `bun --bun vitest run tests/game.test.ts -t "phase labels"` → PASS.
Run: `bun run test` → the only failures are the 8 pre-existing red acceptance tests (combat happens in order ×2, the view says where combat is ×3, combat comes from the view ×3). If any *other* test fails, it was passing a non-canonical phase — fix that call site to a canonical label or alias, not the normalizer.
Run: `bunx tsc --noEmit` → clean.

- [ ] **Step 7: Commit**

```bash
git commit -m "a phase is one of five words, not whatever string arrived" -- server/game.ts server/persist.ts server/mcp-tools.ts tests/game.test.ts
```

(Include the Co-Authored-By trailer via `-m` second paragraph or `-F`.)

---

### Task 2: The combat sub-machine

`"combat"` is one phase value covering declare-attackers, declare-blockers, and damage. Add `game.combat` with guarded transitions, a `finished` flag on attack declarations (replacing the client's `finishedAt` log scrape), and expose both on the view. Turns green: the 3 red tests in `tests/game.test.ts` › "the view says where combat is".

**Files:**
- Modify: `server/game.ts` (GameState, StackItem, `newGameState`, `set_phase`, `resolveStackItem`, `clear_combat`, `finish_attacks`, `attack`, `viewFor`)
- Modify: `server/persist.ts` (migration)
- Modify: `client/src/types.ts` (`GameView`, `StackItem`)
- Test: `tests/game.test.ts` › "the view says where combat is" (already written, red) + one new test for `finished`

**Interfaces:**
- Consumes: `Phase`/`normalizePhase` from Task 1.
- Produces: `export type CombatStep = "attackers" | "blockers" | "damage" | "done"`; `GameState.combat: CombatStep | null`; server `StackItem.finished?: boolean`; view fields `combat` (top level) and `finished` (per stack item). Tasks 3 and 4 read all of these by exactly these names.

- [ ] **Step 1: Run the already-red tests to confirm the starting point**

Run: `bun --bun vitest run tests/game.test.ts -t "the view says where combat is"`
Expected: 3 FAIL — `viewFor(p).combat` is `undefined`, tests expect `null`/step names.

- [ ] **Step 2: Add the field and helper to `server/game.ts`**

Below the `Phase` definitions from Task 1:

```ts
/** Where this combat is. The word "combat" in `phase` covers three different
 *  questions — who attacks, who blocks, what lands — and the table needs to
 *  know which one is open: damage() refuses to run while blocks are owed,
 *  and the client prompt asks whichever question is current. null = not in
 *  combat; "done" = damage resolved, combat not yet left. */
export type CombatStep = "attackers" | "blockers" | "damage" | "done";
```

In `GameState` add `combat: CombatStep | null;` (after `phase`). In `newGameState()` add `combat: null,`.

In the `StackItem` interface (the server one, with `apply?:`), add:

```ts
  // an attack declaration the attacker has handed over (finish_attacks) but
  // the defender has not yet resolved — the "you said you were done" fact the
  // client used to scrape out of the log with an anchored regex
  finished?: boolean;
```

Add the sweep helper next to `who()` in the Helpers section, and make the two existing copies of the loop call it:

```ts
/** Take every attacking/blocking mark off the table. */
function clearCombatMarks() {
  for (const c of Object.values(game.cards)) {
    c.attacking = null;
    c.blocking = null;
  }
}
```

Replace the identical `for` loops inside `resolveStackItem`'s `turn` branch and inside the `clear_combat` action with `clearCombatMarks();`.

- [ ] **Step 3: Wire the transitions**

All in `server/game.ts`:

**`set_phase`** — after `const phase = normalizePhase(p.phase);`, before `game.phase = phase;`:

```ts
    if (phase === "combat") {
      // always resets: re-entering combat after an undo is the ordinary
      // second swing, and it gets a fresh declare-attackers step
      game.combat = "attackers";
    } else if (game.combat !== null) {
      // Leaving combat ends it, marks included. The marks used to linger
      // until the turn passed — three creatures stood ringed as blocking
      // Rats that had ceased to exist two log lines earlier.
      game.combat = null;
      clearCombatMarks();
    }
```

Also refine Task 1's bare-`main` line in `normalizePhase` to:

```ts
  if (key === "main") return game.combat === "done" ? "main 2" : "main 1";
```

**`resolveStackItem`, `attack` branch** (the one that sets `c.attacking`, `c.tapped`, `game.phase = "combat"`): after `game.phase = "combat";` add:

```ts
    // locking attackers in IS entering combat, whether or not set_phase was
    // called first — so this is deliberately unguarded (spec deviation: the
    // spec guards it on "attackers", but an attack locked in from main must
    // still open the blockers step, or damage() would owe no blocks)
    game.combat = "blockers";
```

**`resolveStackItem`, `block` branch**: add as its first line:

```ts
    if (game.combat === "blockers") game.combat = "damage";
```

**`resolveStackItem`, `damage` branch**: add as its first line:

```ts
    // guarded: a damage item resolved outside combat (a ping announced in
    // main, or resolved after the phase moved on) must not resurrect a
    // combat state that no longer exists. "blockers" is a legal source —
    // later per-creature block declarations may still be resolving under it.
    if (game.combat === "damage" || game.combat === "blockers") game.combat = "done";
```

**`resolveStackItem`, `turn` branch**: next to the (now) `clearCombatMarks()` call add `game.combat = null;`.

**`clear_combat` action**: add `game.combat = null;` next to its `clearCombatMarks()`.

**`finish_attacks`**: after `const pairs = ...` add `decl.finished = true;`.

**`attack`** (the action): in the `if (open)` branch that amends an existing declaration, add `delete open.finished;` — declaring another creature means you are not finished any more.

- [ ] **Step 4: Expose on the view**

In `viewFor`'s returned object add `combat: game.combat,` (next to `phase`). In the `stack:` mapping add `finished: item.finished,` (next to `retractable`).

In `client/src/types.ts`: add to `GameView`:

```ts
  /** where combat is — null outside combat; see CombatStep in server/game.ts */
  combat?: "attackers" | "blockers" | "damage" | "done" | null;
```

and to the client `StackItem`: `finished?: boolean;`.

- [ ] **Step 5: Migrate old saves**

In `restoreState` in `server/persist.ts`, next to the phase migration:

```ts
  (game as any).combat ??= null;
```

(A live game restored mid-combat gets `null` — combat re-enters cleanly on the next `set_phase`. One-time wrinkle, accepted by the spec.)

- [ ] **Step 6: Add the `finished` round-trip test**

Append inside the existing `describe("the view says where combat is", ...)` in `tests/game.test.ts`:

```ts
  test("finishing a declaration marks it on the view; declaring more un-finishes it", () => {
    const a = seedCard("Carrion Feeder", "you", "battlefield");
    const b = seedCard("Tergrid, God of Fright", "you", "battlefield");
    applyAction("you", "set_phase", { phase: "combat" });
    applyAction("you", "attack", { pairs: [{ attacker: a.id, target: "agent" }] });
    expect(viewFor("you").stack[0].finished).toBeUndefined();
    applyAction("you", "finish_attacks", {});
    expect(viewFor("you").stack[0].finished).toBe(true);
    // tapping one more creature reopens the declaration
    applyAction("you", "attack", { pairs: [{ attacker: b.id, target: "agent" }] });
    expect(viewFor("you").stack[0].finished).toBeUndefined();
  });
```

- [ ] **Step 7: Run tests, typecheck**

Run: `bun --bun vitest run tests/game.test.ts -t "the view says where combat is"` → all 4 PASS (3 formerly red + the new one).
Run: `bun run test` → remaining failures are exactly 5: "combat happens in order" ×2 and "combat comes from the view" ×3.
Run: `bunx tsc --noEmit` → clean.

- [ ] **Step 8: Commit**

```bash
git commit -m "combat knows which of its three questions is open" -- server/game.ts server/persist.ts client/src/types.ts tests/game.test.ts
```

---

### Task 3: The prompt reads the view

Delete the four log-position scrapes from the prompt's context, point every combat guard at `view.combat`/`item.finished`, and make the "No blocks" button *declare* instead of chat. Rewrite the nextaction tests that fed the scrapes. Turns green: the 3 red tests in `tests/nextaction.test.ts` › "combat comes from the view".

**Order matters:** this task MUST land before Task 4 — gate `damage()` while the decline button still sends chat and a defender has no way to open the damage step.

**Files:**
- Modify: `client/src/features/nextaction/steps.ts`
- Modify: `tests/nextaction.test.ts`
- Test: `tests/nextaction.test.ts` (3 red tests + rewritten combat suites)

**Interfaces:**
- Consumes: `view.combat`, `stackItem.finished` from Task 2.
- Produces: `Ctx.combat: GameView["combat"]`; `noBlocks` export DELETED (Task 5 has no dependency on it; the test file's import is updated here).

- [ ] **Step 1: Confirm the red starting point**

Run: `bun --bun vitest run tests/nextaction.test.ts -t "combat comes from the view"`
Expected: 3 FAIL — "asks for damage on a silent log" (gets `past-combat`), "declines blocks by declaring it" (sends `chat`), "stops offering it once the view says the step has moved on" (still `no-blocks`).

- [ ] **Step 2: Rewrite `Ctx` and `nextActionContext` in `steps.ts`**

In the `Ctx` interface, DELETE `enteredCombatAt`, `finishedAt`, `lockedAt`, `damageAt` (and their comment block) and `attackSig`; ADD:

```ts
  /** where combat is, straight off the view — see CombatStep in server/game.ts */
  combat: GameView["combat"];
```

In `nextActionContext`, delete the four `lastLogIndex(...)` lines, the `attackSig` line, and the `const log = view.log ?? [];` line if nothing else uses it; add `combat: view.combat ?? null,`. Remove `lastLogIndex` from the import (keep `didThisTurn` — Task 5 removes it).

Delete the `noBlocks` export entirely:

```ts
// DELETE:
export const noBlocks: { declaredFor: string | null } = { declaredFor: null };
```

- [ ] **Step 3: Rewrite the four combat guards**

**`no-blocks`** — replace `when` and the button `fn`:

```ts
    // only while the blockers step is actually open — the table's own answer,
    // not a phase regex plus a memory of which attacks were waved through
    when: (c) =>
      !c.mine &&
      c.combat === "blockers" &&
      c.theirAttackers.length > 0 &&
      !c.iAmBlocking &&
      // your declaration may still be on the stack, unresolved — the step is
      // answered even though the view has not moved yet
      !c.stack.some((i) => i.player === "you" && !!i.blockPairs),
    step: () => ({
      label: "No blocks — take the damage",
      icon: "noBlocks",
      // a DECLARATION, not a sentence: block with no pairs is "no blocks",
      // the attacker locks it in, and that is what opens the damage step.
      // The old chat message left the table never learning blocks were
      // answered — the step recognised its own English back out of the log.
      fn: () => void act("block", { pairs: [] }),
    }),
```

**`finish-attacks`** — replace `when` and the hand-over test inside `step`:

```ts
    when: (c) => c.phase === "combat" && c.combat === "attackers" && c.myAttackers.length === 0,
    step: (c) =>
      c.view.waitingOn === "agent" || (c.myAttackDecls.length > 0 && c.myAttackDecls.every((d) => d.finished))
        ? { hint: waitingHint(c, "declared") }
        : { /* unchanged button body */ },
```

(Keep the existing button object verbatim — label "Finish declaring attackers", the `sub`, `title`, and the `fn` with its `finish_attacks` / `set_phase main 2` split.) Delete the `finishedAt`/`enteredCombatAt` comment blocks; the `finished` flag on the declaration is now the fact, and undoing the hand-over restores the item without the flag — no anchored regex needed.

**`combat-damage`** — replace `when`:

```ts
    when: (c) => c.phase === "combat" && c.myAttackers.length > 0 && (c.combat === "blockers" || c.combat === "damage"),
```

**`past-combat`** — unchanged (`c.phase === "combat"` fallthrough).

Also update the stale comment on `myAttackDecls` in `Ctx` ("Each tap pushes its OWN item") — `attack()` merges now; say "the one open declaration, still unresolved (attack() amends it in place)".

- [ ] **Step 4: Rewrite the tests that fed the scrapes**

In `tests/nextaction.test.ts`:

1. `view()` gains a `combat` knob:

```ts
function view({
  mine = [] as Card[],
  stack = [] as StackItem[],
  log = [] as LogEntry[],
  phase = "combat",
  turnNumber = 4,
  combat = null as GameView["combat"],
}: { ... }): GameView {
  return { ..., combat, ... } as unknown as GameView;
}
```

2. Delete the log-line helpers `ENTERED`, `LOCKED`, `FINISHED`, `ASKED`, `ANNOUNCED`, `APPLIED` and apply this mapping in every test that used them (`log: [...]` entries that only existed for the scrape are dropped; `said(...)` lines stay):

| old log recipe | new view facts |
|---|---|
| `ENTERED()` | `combat: "attackers"` |
| `ENTERED(), LOCKED()` | `combat: "blockers"` (the test already marks `attacking:` on creatures) |
| `..., FINISHED()` | mark the declaration: `{ ...declaration("d1", "bear"), finished: true }` |
| `..., ASKED()` | no extra fact — the ask changes nothing; `combat` stays `"blockers"` |
| `..., APPLIED()` | `combat: "done"` |
| second-combat recipes (`ENTERED, LOCKED, APPLIED, undo, ENTERED`) | just the final state: `combat: "attackers"` (that IS the point — no history needed) |

Worked examples (rewrite the rest identically):

```ts
it("asks you to declare as soon as you reach combat", () => {
  const { id, action } = prompt(view({ mine: [creature("bear")], combat: "attackers" }));
  expect(id).toBe("finish-attacks");
  expect(action?.label).toBe("Finish declaring attackers");
  expect(action?.sub).toBeUndefined();
});

it("asks for damage once the attackers are locked in", () => {
  const { id, action } = prompt(view({ mine: [creature("bear", { attacking: "agent" })], combat: "blockers" }));
  expect(id).toBe("combat-damage");
  expect(action?.label).toBe("Go to damage");
});

it("stays down after you finish, even when the agent hands the window back", () => {
  const v = view({
    mine: [creature("bear")],
    stack: [{ ...declaration("d1", "bear"), finished: true }],
    combat: "attackers",
  });
  (v as any).waitingOn = "you";
  const { id, action } = prompt(v);
  expect(id).toBe("finish-attacks");
  expect(action?.fn).toBeUndefined();
  expect(action?.hint).toMatch(/waiting/i);
});

it("gives the button back when you undo the hand-over", () => {
  // undo restores the snapshot, and the snapshot's declaration has no
  // finished flag — no log-quoting regex required to know you took it back
  const v = view({ mine: [creature("bear")], stack: [declaration("d1", "bear")], combat: "attackers" });
  (v as any).waitingOn = "you";
  const { action } = prompt(v);
  expect(action?.label).toBe("Finish declaring attackers");
  expect(action?.fn).toBeDefined();
});
```

3. DELETE the test `"…or once it has been announced by hand, the way a game in flight still does it"` — hand-written `COMBAT DAMAGE` text announcements were the pre-`damage`-tool era this spec retires; the state field replaces recognizing them.
4. Keep `"ignores the agent TALKING about combat damage"` — rewrite as `view({ mine: [creature("bear", { attacking: "agent" })], combat: "blockers", log: [said("Please announce combat damage on the stack and I will resolve it.")] })`, expect `combat-damage`. It documents the bug class even though the guard no longer reads the log at all.
5. In the `"combat comes from the view"` describe, delete the `beforeEach` that resets `noBlocks` and delete `noBlocks` from the `await import(...)` destructure.
6. The first-turn / mulligan / untap / draw suites still use `line(...)` log entries — LEAVE THEM; they exercise `didThisTurn`, which lives until Task 5.

- [ ] **Step 5: Run tests, typecheck, build**

Run: `bun --bun vitest run tests/nextaction.test.ts` → ALL PASS, including the 3 formerly red.
Run: `bun run test` → remaining failures are exactly the 2 "combat happens in order" server tests.
Run: `bun --bun run build` → clean (this is also the typecheck).

- [ ] **Step 6: Commit**

```bash
git commit -m "the prompt asks the table where combat is instead of reading the log" -- client/src/features/nextaction/steps.ts tests/nextaction.test.ts
```

---

### Task 4: The damage gate

`damage()` accepts an announcement at any moment — round 6, seq 456, the agent called three creatures "unblocked" before the defender had a blockers step. Refuse damage while blocks are owed. Turns green: the last 2 red tests.

**Files:**
- Modify: `server/game.ts` (`damage` action)
- Modify: `server/mcp-tools.ts` (`damage` and `block` tool descriptions)
- Test: `tests/game.test.ts` › "combat happens in order" (already written, red)

**Interfaces:**
- Consumes: `game.combat` from Task 2; the Task 3 button (a defender can now open the damage step with one click).
- Produces: nothing new — a precondition only.

- [ ] **Step 1: Confirm the red starting point**

Run: `bun --bun vitest run tests/game.test.ts -t "combat happens in order"`
Expected: 2 FAIL ("damage cannot be announced while the defender still owes blockers", "a block declaration still on the stack does not open the damage step") — both `expected [Function] to throw`.

- [ ] **Step 2: Add the gate**

In the `damage` action in `server/game.ts`, insert as the FIRST lines of the body:

```ts
    // Combat has an order. This is the whole reason game.combat exists: the
    // agent once announced "unblocked ×3" before the defender had a
    // declare-blockers step, and nothing here objected. "attackers" and
    // "blockers" both mean blocks are still owed — a declaration on the stack
    // is not an answer until the attacker locks it in. null and "done" pass:
    // a ping in main owes nobody a blocks step, and re-announcing after
    // damage resolved is a legal correction.
    if (game.combat === "attackers" || game.combat === "blockers") {
      throw new Error(
        "declare blockers first — blocks must be declared AND locked in (stack_resolve) before damage is announced. A defender with nothing to block declares block with pairs: [], and resolving that opens the damage step."
      );
    }
```

- [ ] **Step 3: Run to verify green**

Run: `bun --bun vitest run tests/game.test.ts -t "combat happens in order"` → all 5 PASS (the 2 red plus the 3 guard rails: no-blocks path, non-combat ping, per-creature lock-ins).

- [ ] **Step 4: Teach the agent the rule where it reads it**

In `server/mcp-tools.ts`:

- `damage` description: prepend `"Requires blocks to be settled first: while attackers are locked in, a blocks declaration must be declared and resolved before damage is announced — if the defender has not answered yet, pass (done) or ask. "` to the existing text.
- `block` description: append `" Declaring pairs: [] is the explicit 'no blocks' — resolving it is what opens the damage step."`.

- [ ] **Step 5: Full suite, typecheck**

Run: `bun run test` → **everything passes** (all 8 acceptance tests green, zero failures).
Run: `bunx tsc --noEmit` → clean.

- [ ] **Step 6: Commit, then restart the live server**

```bash
git commit -m "damage waits for the blockers step to be answered" -- server/game.ts server/mcp-tools.ts
```

Restart per Global Constraints (PID kill + relaunch), then `curl -s localhost:4780/api/state | head -c 200` to confirm state restored.

---

### Task 5: Per-turn facts, mulligan legality, and the death of the log scrapes

The last three scrapes: "did I untap", "did I draw", "has the game begun" (nine verbs in one regex gating both the opening prompt and mulligan legality). Track them on the server, expose them, gate `mulligan()`, and delete `lastLogIndex`/`didThisTurn`/`HAS_STARTED_PLAYING`.

**Files:**
- Modify: `server/game.ts` (`PlayerState`, `emptyPlayer`, `untapPermanents` or its callers, `draw`, the land-drop branch of `cast`, `resolveStackItem` turn branch, `applyAction`, `mulligan`, `viewFor`)
- Modify: `server/persist.ts` (migration)
- Modify: `client/src/types.ts` (`PlayerView`, `GameView`)
- Modify: `client/src/features/nextaction/steps.ts` (`game-start`, `untap`, `draw` guards; imports)
- Modify: `client/src/game/rules.ts` (`canMulligan`; delete `HAS_STARTED_PLAYING`)
- Modify: `client/src/store/game.ts` (delete `lastLogIndex`, `didThisTurn`)
- Test: `tests/game.test.ts` (new describe), `tests/nextaction.test.ts` (rewrite first-turn + mulligan suites)

**Interfaces:**
- Consumes: nothing beyond Task 2's view plumbing pattern.
- Produces: `PlayerState.turnDone: { untap: boolean; draw: boolean; lands: number; acted: boolean }` (serialized per player on the view as `turnDone`); `GameView.canMulligan: boolean`; client `canMulligan(view)` keeps its signature but reads the view field.

- [ ] **Step 1: Write the failing server tests**

Append to `tests/game.test.ts`:

```ts
describe("the turn knows what has already happened in it", () => {
  test("untap, draw and land drops are facts on the view, reset when the turn passes", () => {
    const land = seedCard("Swamp", "you", "hand", { typeLine: "Basic Land — Swamp" });
    seedLibrary("you", ["Island"]);
    expect(viewFor("you").players.you.turnDone).toEqual({ untap: false, draw: false, lands: 0, acted: false });
    applyAction("you", "untap_all", {});
    applyAction("you", "draw", { n: 1 });
    applyAction("you", "cast", { card: land.id }); // land drop: straight to battlefield
    const td = viewFor("you").players.you.turnDone;
    expect(td.untap).toBe(true);
    expect(td.draw).toBe(true);
    expect(td.lands).toBe(1);
    expect(td.acted).toBe(true);
    // the turn pass resolving wipes the slate for BOTH seats
    game.started = true;
    applyAction("you", "set_turn", { player: "agent" });
    applyAction("agent", "stack_resolve", {});
    expect(viewFor("you").players.you.turnDone).toEqual({ untap: false, draw: false, lands: 0, acted: false });
    expect(viewFor("you").players.agent.turnDone.acted).toBe(false);
  });

  test("the set_phase auto-untap counts as the untap", () => {
    seedCard("Guy", "you", "battlefield", { tapped: true });
    applyAction("you", "set_phase", { phase: "untap/upkeep" });
    expect(viewFor("you").players.you.turnDone.untap).toBe(true);
  });

  test("mulligan is offered until you act, and the server enforces it", () => {
    game.started = true;
    seedCard("Keep Me", "you", "hand");
    seedLibrary("you", ["A", "B", "C", "D", "E", "F", "G"]);
    expect(viewFor("you").canMulligan).toBe(true);
    applyAction("you", "mulligan", { n: 7 }); // mulliganing is not acting
    expect(viewFor("you").canMulligan).toBe(true);
    applyAction("you", "tap", { cards: [game.players.you.zones.hand[0]], tapped: true });
    expect(viewFor("you").canMulligan).toBe(false);
    expect(() => applyAction("you", "mulligan", { n: 7 })).toThrow(/already/i);
  });

  test("the agent's seat never sees canMulligan on your turn", () => {
    game.started = true;
    seedCard("Keep Me", "you", "hand");
    expect(viewFor("agent").canMulligan).toBe(false);
  });
});
```

(Check the exact `tap` action param shape against the existing "tap, counters, piles" suite in this file and match it.)

- [ ] **Step 2: Run to verify they fail**

Run: `bun --bun vitest run tests/game.test.ts -t "the turn knows"`
Expected: FAIL — `turnDone` undefined.

- [ ] **Step 3: Implement on the server**

In `PlayerState` add:

```ts
  // what this seat has already done THIS turn — the facts the client used to
  // reconstruct by grepping the log ("did I untap", "did I draw", "has
  // anything been played"). lands is bookkeeping like commanderTax: both
  // seats read it, either corrects it.
  turnDone: { untap: boolean; draw: boolean; lands: number; acted: boolean };
```

In `emptyPlayer()` add `turnDone: { untap: false, draw: false, lands: 0, acted: false },`.

Add a reset helper next to `clearCombatMarks()`:

```ts
function resetTurnDone() {
  for (const ps of Object.values(game.players)) ps.turnDone = { untap: false, draw: false, lands: 0, acted: false };
}
```

and call it in `resolveStackItem`'s `turn` branch (next to `game.combat = null`).

Mark the facts at the actions:
- in `untapPermanents(player)` (the shared helper both `untap_all` and `set_phase`'s auto-untap call) add `game.players[player].turnDone.untap = true;` — if `untapPermanents` is not a single shared helper, mark in both call sites instead.
- in `draw`, after the loop: `game.players[player].turnDone.draw = true;`
- in the land-drop branch of `cast` (the one logging `"land_played"`): `game.players[ctx.actor].turnDone.lands += 1;`

`acted` is marked centrally so a new action can't silently break mulligan the way a new log verb silently broke `HAS_STARTED_PLAYING`. Replace `applyAction`:

```ts
/** The actions that count as having STARTED PLAYING — the same set the old
 *  HAS_STARTED_PLAYING regex named by its log verbs, now named by action.
 *  Deliberately excludes draw (the deal draws for you), mulligan (taking the
 *  offer must not revoke it), and pure bookkeeping (life, counters). */
const PLAY_ACTIONS = new Set(["cast", "tap", "untap_all", "move", "create_token", "attack", "block", "stack_push", "set_phase", "set_turn", "damage", "finish_attacks"]);

export function applyAction(actor: PlayerId, type: string, params: any): ActionResult {
  const fn = actions[type];
  if (!fn) throw new Error(`unknown action ${type}`);
  const res = fn({ actor }, params ?? {});
  if (PLAY_ACTIONS.has(type)) game.players[actor].turnDone.acted = true;
  return res;
}
```

In `mulligan`, insert at the top:

```ts
    if (game.turnNumber !== 1 || game.players[player].turnDone.acted) {
      throw new Error("mulligans are decided before anything is played — you have already started the turn");
    }
```

In `viewFor`: inside the per-player object add `turnDone: ps.turnDone,`; in the top-level return add:

```ts
    canMulligan:
      game.started &&
      game.turnNumber === 1 &&
      game.turn === viewer &&
      game.players[viewer].zones.hand.length > 0 &&
      !game.players[viewer].turnDone.acted,
```

In `restoreState` in `server/persist.ts`:

```ts
  for (const ps of Object.values(game.players) as any[]) ps.turnDone ??= { untap: false, draw: false, lands: 0, acted: false };
```

In `client/src/types.ts`: `PlayerView` gains `turnDone: { untap: boolean; draw: boolean; lands: number; acted: boolean };`, `GameView` gains `canMulligan?: boolean;`.

- [ ] **Step 4: Run the server tests**

Run: `bun --bun vitest run tests/game.test.ts` → PASS. If the new-game deal path marks `acted` for "you" (canMulligan test fails on a fresh table), the deal is going through `applyAction` — mark `acted` only when `game.started` is true, and note it in the code comment.

- [ ] **Step 5: Point the client at the facts and delete the scrapes**

In `client/src/features/nextaction/steps.ts`:

```ts
  // game-start
  when: (c) => c.mine && c.view.turnNumber === 1 && !c.view.players.you.turnDone.acted,
  // untap
  when: (c) => c.phase === "untap/upkeep" && c.myTapped && !c.view.players.you.turnDone.untap,
  // draw
  when: (c) => c.phase === "untap/upkeep" && c.view.turnNumber > 1 && !c.view.players.you.turnDone.draw,
```

Remove `didThisTurn` and `HAS_STARTED_PLAYING` from the imports.

In `client/src/game/rules.ts`: delete `HAS_STARTED_PLAYING`; replace `canMulligan`'s body:

```ts
/** Is a mulligan still on the table? The server decides — same fact the
 *  mulligan action itself enforces, so the offer and the rule cannot drift. */
export function canMulligan(view: GameView | null | undefined): boolean {
  return !!view?.canMulligan;
}
```

Remove the now-unused `lastLogIndex` import there. In `client/src/store/game.ts`: delete `lastLogIndex` and `didThisTurn` entirely (comment block included).

- [ ] **Step 6: Rewrite the client tests that fed these scrapes**

In `tests/nextaction.test.ts`:

1. Give `view()` a `turnDone`/`canMulligan` knob — simplest is post-construction assignment in each test. Add a helper next to `view()`:

```ts
const done = (v: GameView, patch: Partial<{ untap: boolean; draw: boolean; lands: number; acted: boolean }>) => {
  (v.players.you as any).turnDone = { untap: false, draw: false, lands: 0, acted: false, ...patch };
  return v;
};
```

and in `view()` itself default both players' `turnDone` to all-false (inside the `players` literal) so untouched tests keep working.

2. "the first turn" suite:

```ts
it("says nothing while you are still settling in", () => {
  expect(prompt(fresh()).action).toBeNull();
});
it("still says nothing after a mulligan — that is the deal, not a play", () => {
  // mulligan never marks acted on the server, so the view arrives unchanged
  expect(prompt(fresh()).action).toBeNull();
});
it("opens on the main phase once you have actually played something", () => {
  const { id, action } = prompt(done(fresh(), { acted: true }));
  expect(id).toBe("main-1");
  expect(action?.label).toBe("untap → main phase 1");
});
it("never offers the first-turn draw", () => {
  expect(prompt(done(fresh(), { acted: true })).id).not.toBe("draw");
});
```

3. "when the mulligan offer is on the table" suite: the legality logic moved to the server (Task 5 Step 1 tests it there). Replace the whole describe with the passthrough:

```ts
describe("the mulligan offer is the server's call", () => {
  it("shows exactly what the view says", () => {
    const v = view({});
    (v as any).canMulligan = true;
    expect(canMulligan(v)).toBe(true);
    (v as any).canMulligan = false;
    expect(canMulligan(v)).toBe(false);
    expect(canMulligan(null)).toBe(false);
  });
});
```

4. Add the untap/draw guard tests:

```ts
describe("untap and draw are turn facts, not log lines", () => {
  const upkeep = (patch: Parameters<typeof done>[1]) =>
    done(view({ phase: "untap/upkeep", mine: [creature("bear", { tapped: true })] }), patch);
  it("offers the untap until the view says it happened", () => {
    expect(prompt(upkeep({})).id).toBe("untap");
    expect(prompt(upkeep({ untap: true })).id).toBe("draw");
  });
  it("offers the draw until the view says it happened", () => {
    expect(prompt(upkeep({ untap: true, draw: true })).id).toBe("main-1");
  });
});
```

- [ ] **Step 7: Full suite, build, delete-check**

Run: `bun run test` → ALL PASS.
Run: `bun --bun run build` → clean.
Run: `grep -rn "lastLogIndex\|didThisTurn\|HAS_STARTED_PLAYING" client/src tests/` → **zero matches**. Any hit is a missed scrape — fix it, don't keep the helper.

- [ ] **Step 8: Commit, restart the live server**

```bash
git commit -m "what this turn has already seen is the server's memory, not the log's" -- server/game.ts server/persist.ts client/src/types.ts client/src/features/nextaction/steps.ts client/src/game/rules.ts client/src/store/game.ts tests/game.test.ts tests/nextaction.test.ts
```

Restart per Global Constraints; confirm with a curl that the live game restored.

---

## Final acceptance (after Task 5)

- [ ] `bun run test` — zero failures; the 8 acceptance tests pass unmodified (Tasks 2–4 were forbidden from editing them; Task 3/5 rewrote only *other* tests that fed the scrapes).
- [ ] `grep -rn "lastLogIndex\|didThisTurn\|HAS_STARTED_PLAYING\|noBlocks" client/src tests/` → nothing.
- [ ] On the live table: declare an attack as the player, have the agent attempt `damage` before any `block` — the call is refused and the error text names the recovery. (The agent's next window will read the updated tool descriptions.)
- [ ] Reload the client (`bun --bun run build` already done); hover/prompt behavior in a normal combat: declare → finish → agent blocks or declines → damage → main 2, with the prompt tracking `view.combat` at each step.
