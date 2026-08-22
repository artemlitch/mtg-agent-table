// Loaded only by `bun test` (via [test].preload in bunfig.toml). The suite runs
// on Vitest now, and Bun's builtin runner half-executes the files — it resolves
// most of the `vitest` imports but chokes on things like describe.runIf, so it
// reports plausible-looking failures that mean nothing. Stop it up front.
console.error(
  "\n`bun test` runs Bun's builtin runner, not this project's suite.\n" +
    "The tests run on Vitest (under the Bun runtime):\n\n" +
    "  bun run test        # one shot\n" +
    "  bun run test:watch  # watch mode\n",
);
process.exit(1);
