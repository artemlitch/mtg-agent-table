// Am I a shipped binary, or a file bun is running out of a checkout?
//
// It matters in three places, and they all fail the same way if you get it
// wrong: a compiled binary has no repo underneath it. `../web/` relative to
// this source file resolves inside Bun's virtual filesystem, `cwd` for a child
// process points at nothing, and `bun` is not on the machine at all. Everything
// a packaged app needs at runtime sits beside the executable instead.
import { dirname } from "node:path";

/** Bun's compiled binaries run as themselves; under `bun run`, the executable
 *  IS bun. That is the whole test — there is no flag for it. */
export const COMPILED = !/[\\/]bun(\.exe)?$/i.test(process.execPath);

/** Where the files shipped alongside the binary live (web assets, and the
 *  binary itself when it has to hand its own path to a child process). */
export const RESOURCE_DIR = dirname(process.execPath);
