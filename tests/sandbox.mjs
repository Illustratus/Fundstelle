/**
 * Where a test run lives, so that two runs can live side by side.
 *
 * The suite drives one server on one port against one copy of the fixtures.
 * Two worktrees running their suites at the same time used to share both — the
 * second server could not start, or worse, both runs wrote into the same
 * `.sandbox` and each other's checks failed for reasons neither had caused.
 *
 * `TEST_PORT` moves a run: the main server goes there, its sandbox becomes
 * `.sandbox-<port>`, and every spec that starts a server of its own moves its
 * port by a hundred per step away from the default, so the side servers of two
 * runs cannot meet either. Without `TEST_PORT` everything stays where it was.
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_PORT = 4199;

export const PORT = Number(process.env.TEST_PORT) || DEFAULT_PORT;

export const SANDBOX = join(ROOT, `.sandbox-${PORT}`);

export const SANDBOX_TRANSCRIPTS = join(SANDBOX, "transcripts");

/** A port of a spec's own server, moved along with the run. */
export const sidePort = (port) => port + (PORT - DEFAULT_PORT) * 100;
