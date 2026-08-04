/**
 * The tool on the oldest Node it claims to run on, with nothing installed.
 *
 * package.json says ">=18" and the server checks for it at startup, but nothing
 * ever ran there: Playwright needs Node 20 or newer, so the suite cannot say
 * anything about 18. A matrix entry for it would have exercised the test runner
 * and called that a result.
 *
 * So this asks the narrower question the claim is actually about — does the
 * tool run — and asks it with no `npm install` at all, because the other claim
 * in the README is that there are no runtime dependencies. If a `node_modules`
 * were quietly needed, this is what would notice.
 *
 * Written against nothing but Node itself, for the same reason.
 *
 *   node tests/node-minimum.mjs
 */

import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(HERE, "..");
const PORT = Number(process.env.PORT ?? 4194);
const BASE = `http://127.0.0.1:${PORT}`;

const work = mkdtempSync(join(tmpdir(), "fundstelle-minimum-"));
cpSync(join(HERE, "fixtures"), join(work, "transcripts"), { recursive: true });
rmSync(join(work, "transcripts", "generator.mjs"), { force: true });

const server = spawn(process.execPath, [join(ROOT, "server.js")], {
  env: {
    ...process.env,
    PORT: String(PORT),
    TRANSCRIPTS: join(work, "transcripts"),
    CATEGORIES: join(work, "categories.json"),
    START_LANGUAGE: "de",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
server.stdout.on("data", (chunk) => (log += chunk));
server.stderr.on("data", (chunk) => (log += chunk));

const done = (code) => {
  server.kill();
  rmSync(work, { recursive: true, force: true });
  process.exit(code);
};
function fail(what) {
  console.error(`FAILED: ${what}`);
  if (log.trim()) console.error(log);
  done(1);
}
const ok = (what) => console.log(`  ok — ${what}`);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function get(path) {
  const answer = await fetch(`${BASE}${path}`);
  if (!answer.ok) fail(`GET ${path} answered ${answer.status}`);
  return answer;
}

console.log(`Node ${process.versions.node}, nothing installed`);

// The server binds and seeds in well under a second; this gives a cold runner
// room without waiting on a fixed sleep any longer than it has to.
let up = false;
for (let tries = 0; tries < 60 && !up; tries++) {
  up = await fetch(`${BASE}/api/interviews`).then(
    (answer) => answer.ok,
    () => false,
  );
  if (!up) await wait(250);
}
if (!up) fail("the server never answered");

const interviews = await (await get("/api/interviews")).json();
if (!interviews.some((one) => one.id === "interview-01")) {
  fail("the fixture interviews should be listed");
}
ok("serves the interviews it was pointed at");

const { categories } = await (await get("/api/categories")).json();
if (!categories?.length) fail("the category system should be seeded");
if (!existsSync(join(work, "categories.json"))) fail("the seed should have been written");
ok("seeded the category system into an empty folder");

// A coding written and read back. Storage is where a runtime that is too old
// would actually break — not in the routing.
const transcript = await (await get("/api/interviews/interview-01")).json();
const turn = transcript.turns.find((one) => !one.interviewer);
const created = await fetch(`${BASE}/api/interviews/interview-01/codings`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    turn: turn.number,
    start: 0,
    end: 40,
    text: turn.text.slice(0, 40),
    category: categories[0].id,
    reviewed: true,
  }),
});
if (!created.ok) fail(`a coding should be accepted, answered ${created.status}`);
const analysis = await (await get("/api/analysis")).json();
if (analysis.total !== 1) fail(`the analysis should count the one coding, said ${analysis.total}`);
ok("wrote a coding and counted it");

const guide = await (await get("/api/export/coding-guide.md?lang=de")).text();
if (!guide.includes("Kodierleitfaden")) fail("the coding guide should be written");
const paper = await (await get("/api/export/agreement.md?lang=en")).text();
if (!paper.includes("Intercoder reliability")) fail("the reliability export should be written");
ok("wrote the exports");

const page = await (await get("/")).text();
if (!page.includes("Fundstelle")) fail("the interface should be served");
ok("serves the interface");

console.log(`Runs on Node ${process.versions.node} with nothing installed`);
done(0);
