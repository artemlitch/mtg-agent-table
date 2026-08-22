import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose: that config sets root: "client" and
// exists to build the UI. The tests live at the repo root and exercise the
// server, so they get their own config and never load the React plugin.
//
// The suite must run on the Bun runtime (`bun run test`) — the server and
// several tests use Bun.serve / Bun.spawn / Bun.file directly.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // server.test.ts / persist.test.ts boot the real server as a subprocess
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
