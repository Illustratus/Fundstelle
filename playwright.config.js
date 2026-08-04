import { defineConfig, devices } from "@playwright/test";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SANDBOX = join(HERE, ".sandbox");

// The test runs work on a copy of the synthetic test transcripts from
// tests/fixtures/ — never on real interviews. Two interviews from two
// departments, because the department count, the cross table and the
// requirement citations cannot be checked with a single transcript.
rmSync(SANDBOX, { recursive: true, force: true });
mkdirSync(SANDBOX, { recursive: true });
cpSync(join(HERE, "tests", "fixtures"), join(SANDBOX, "transcripts"), { recursive: true });

const PORT = 4199;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "de-DE",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  metadata: { sandbox: SANDBOX },
  webServer: {
    command: "node server.js",
    url: `http://127.0.0.1:${PORT}/api/interviews`,
    reuseExistingServer: false,
    env: {
      PORT: String(PORT),
      TRANSCRIPTS: join(SANDBOX, "transcripts"),
      CATEGORIES: join(SANDBOX, "categories.json"),
      // The seed would otherwise follow whichever request happens to arrive
      // first, and the suite reads the seeded category names by name.
      START_LANGUAGE: "de",
    },
  },
});
