// The entrypoint `bun build --compile` is pointed at — one binary that can be
// either half of a game.
//
// Running from a checkout, the table and the agent's MCP server are two files
// you start with bun. A packaged app has neither a checkout nor bun, so the
// same binary has to answer to both: bare, it is the table server; with `mcp`,
// it is the stdio MCP server the Claude CLI spawns to reach the table.
//
// Dev is unaffected — `bun run server/index.ts` still works exactly as before.
export {}; // top-level await needs this file to be a module

if (process.argv[2] === "mcp") {
  const { runStdioServer } = await import("./mcp-tools");
  runStdioServer();
} else {
  await import("./index");
}
