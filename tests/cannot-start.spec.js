import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The screen for a tool that could not start.
 *
 * The whole point of `START_SYSTEM` is that somebody brings a category system of
 * their own — so pointing it at a file with a stray comma in it is the likeliest
 * first-run failure this tool has, and the one nobody had ever looked at.
 *
 * What it produced was the application drawn around nothing: an empty interview
 * picker, a search bar over a transcript that was never loaded, a column
 * explaining percentages per guide block, a panel offering to create a category
 * in a system that could not be read, and two other views to walk into. The
 * reason for all of it sat in a red message that faded after six seconds, and
 * said what was wrong without saying what to do.
 *
 * The server side was already right — every bad file has its own named error,
 * with the file and the parser's own words in it. This is about what the person
 * in front of the browser gets.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = 4189;
const BASE = `http://127.0.0.1:${PORT}`;

let folder;
let server;

/** Start a server of our own over a start system that is wrong in some way. */
async function startWith(file) {
  folder = mkdtempSync(join(tmpdir(), "fundstelle-halt-"));
  const transcripts = join(folder, "transcripts");
  mkdirSync(join(transcripts, "interview-01"), { recursive: true });
  writeFileSync(
    join(transcripts, "interview-01", "final.md"),
    "# Interview 1: Vertrieb\n\n- Quelle: erfunden\n\n---\n\n## Erzählanstoß: 1 · Ablage\n\n" +
      "**1 · Interviewer [0:01]**\n\nWie legt ihr das ab?\n\n" +
      "**2 · Vertrieb [0:11]**\n\nJeder macht es ein bisschen anders, und am Ende sucht man doppelt.\n\n",
  );
  const path = join(folder, "start.json");
  writeFileSync(path, file);
  server = spawn(process.execPath, [join(ROOT, "server.js")], {
    env: {
      ...process.env,
      PORT: String(PORT),
      TRANSCRIPTS: transcripts,
      CATEGORIES: join(folder, "categories.json"),
      START_LANGUAGE: "de",
      START_SYSTEM: path,
    },
    stdio: "ignore",
  });
  /* Answering at all, not answering well: the whole point of these is a server
     that is up and refusing, so waiting for a 200 waits for the full twelve
     seconds and then gives up anyway. */
  for (let tries = 0; tries < 60; tries += 1) {
    const up = await fetch(`${BASE}/api/interviews`).then(() => true, () => false);
    if (up) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

test.afterEach(() => {
  server?.kill();
  server = null;
  if (folder) rmSync(folder, { recursive: true, force: true });
  folder = null;
});

test("a start system with a stray comma stops the tool with a screen, not a toast", async ({ page }) => {
  await startWith('{ "categories": [ { "name": "Eins" }, ] }');
  const halt = await page.context().newPage();
  await halt.goto(`${BASE}/?lang=de`);

  const panel = halt.locator(".halt");
  await expect(panel).toBeVisible();
  await expect(panel.locator("h2")).toContainText("kann so nicht starten");
  // The file it is about, and the parser's own complaint, kept verbatim.
  await expect(panel.locator(".halt-reason")).toContainText("start.json");
  await expect(panel.locator(".halt-reason")).toContainText("not valid JSON");
  // And the thing the message never said: what to do about it.
  await expect(panel).toContainText("START_SYSTEM");
  await expect(panel).toContainText("example-start-system.json");
  await expect(panel.locator("#halt-reload")).toBeVisible();

  /* It is a state, not an event. A message that fades leaves somebody in front
     of an empty application with no way to find out why. */
  await halt.waitForTimeout(7000);
  await expect(panel).toBeVisible();
  await expect(panel.locator(".halt-reason")).toContainText("not valid JSON");
  // Said once. The same sentence twice on one screen reads as two problems.
  await expect(halt.locator("#message")).toBeHidden();
  await halt.close();
});

test("nothing is left on the screen that could not work", async ({ page }) => {
  await startWith('{ "categories": [ { "id": "a", "name": "Eins" } ] }');
  const halt = await page.context().newPage();
  await halt.goto(`${BASE}/?lang=de`);
  await expect(halt.locator(".halt")).toBeVisible();

  /* The lesson the empty first screen already taught: a control over nothing
     teaches the reader that parts of this screen mean nothing. */
  for (const sel of ["#sections", ".column-right", ".search-bar", ".views", "#interview-choice", "#import"]) {
    await expect(halt.locator(sel), sel).toBeHidden();
  }
  // What still works stays: the language, so the way out can be read in either.
  await expect(halt.locator("#language")).toBeVisible();
  await expect(halt.locator("#theme")).toBeVisible();
  await halt.close();
});

test("the screen is written in the language that was asked for", async ({ page }) => {
  await startWith('{ "categories": [] }');
  const halt = await page.context().newPage();
  await halt.goto(`${BASE}/?lang=en`);
  const panel = halt.locator(".halt");
  await expect(panel.locator("h2")).toContainText("cannot start");
  await expect(panel).toContainText("built-in start system");
  await expect(panel).not.toContainText("Startsystem");
  await halt.close();
});

test("a file the tool can read starts normally, with those categories", async ({ page }) => {
  await startWith(
    JSON.stringify({
      categories: [
        { id: "raum", name: "Raumnutzung", definition: "Aussagen darüber, welcher Raum wofür benutzt wird." },
        { id: "zeit", name: "Zeitpunkte", definition: "Aussagen darüber, wann etwas geschieht und warum dann." },
      ],
    }),
  );
  const good = await page.context().newPage();
  await good.goto(`${BASE}/?lang=de`);
  await good.waitForSelector(".turn");
  // The negative half of the same check: no halt where nothing is wrong.
  await expect(good.locator(".halt")).toHaveCount(0);
  await expect(good.locator(".column-right")).toBeVisible();
  await expect(good.locator(".category").first()).toContainText("Raumnutzung");
  await good.close();
});
