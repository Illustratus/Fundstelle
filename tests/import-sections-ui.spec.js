import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { sidePort } from "./sandbox.mjs";
import { BLOCKS, LATE, T0, VTT, openLog } from "./import-sections-study.mjs";
import { startStudy, twoRounds } from "./evaluation-study.mjs";
import { parseTranscript } from "../lib/transcript.js";

/**
 * The section review in the import sheet.
 *
 * A recording brought into a folder whose interview was logged shows every
 * turn with the guide's headings between them, before anything is written:
 * an offset for the whole import, each heading movable by a turn, what could
 * not be placed and what came out empty. The import writes what was shown.
 */

let study;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  study = await startStudy({ port: sidePort(4162) });
  await twoRounds(study);
  await study.put("/api/rounds/evaluation/guide", { blocks: BLOCKS });
  await openLog(study, "spaet", LATE);
  // Two blocks pressed within a few seconds while one question ran.
  await openLog(study, "eng", [
    ["warmfrage", 1],
    ["1-ablage", 31],
    ["5-systeme", 34],
  ]);
});

test.afterAll(() => study?.stop());

const drop = async (page, lang = "de") => {
  await page.goto(`${study.base}/?lang=${lang}`);
  await page.waitForSelector(".turn");
  await page.locator("#import").click();
  await expect(page.locator("#import-sheet")).toBeVisible();
  await page.locator("#import-file").setInputFiles({
    name: "aufnahme.vtt",
    mimeType: "text/plain",
    buffer: Buffer.from(VTT, "utf8"),
  });
  await expect(page.locator("#import-found")).toBeVisible();
  await page.locator("#import-interviewer").selectOption("Anna Berger");
};

/** The heading names and the turn index each stands in front of, as shown. */
const shown = (page) =>
  page.locator("#import-timeline").evaluate((list) => {
    const out = [];
    let turn = 0;
    for (const item of list.children) {
      if (item.classList.contains("import-row")) turn += 1;
      else out.push([item.querySelector(".import-heading-name").textContent, turn]);
    }
    return out;
  });

test("a folder with a log shows its sections among the turns before writing", async ({ page }) => {
  await drop(page);
  const sheet = page.locator("#import-sheet");
  // Waiting logs are offered as targets; a new folder stays the default.
  await expect(sheet.locator("#import-target-field")).toBeVisible();
  await expect(sheet.locator("#import-target")).toHaveValue("");
  await expect(sheet.locator("#import-sections")).toBeHidden();

  await sheet.locator("#import-target").selectOption("spaet");
  await expect(sheet.locator("#import-log")).toContainText("Gesprächsprotokoll gefunden: Vertrieb, 3 Blockbeginne.");
  // The department comes from the log, and the heading with it.
  await expect(sheet.locator("#import-department")).toHaveValue("Vertrieb");
  await expect(sheet.locator("#import-title")).toHaveValue("Interview: Vertrieb");
  // The note that recordings carry no sections is about a different import.
  await expect(sheet.locator("#import-no-sections")).toBeHidden();

  await expect(sheet.locator(".import-row")).toHaveCount(6);
  await expect(sheet.locator(".import-row.asks")).toHaveCount(3);
  // Twenty seconds late: each heading falls before the next block's question.
  expect(await shown(page)).toEqual([
    ["Warmfrage", 2],
    ["1 · Ablage (Wissen festhalten)", 4],
  ]);
  await expect(sheet.locator(".import-heading").first()).toContainText("Block begonnen bei 0:22");
  await expect(sheet.locator("#import-unplaced")).toContainText("5 · Systemlandschaft");
  await expect(sheet.locator("#import-unplaced")).toContainText(
    "Der Block beginnt nach dem letzten Beitrag der Aufnahme.",
  );
  await expect(sheet.locator("#import-sections-count")).toHaveText(
    "2 Abschnitte gesetzt · 1 nicht gesetzt · 0 leer",
  );
  expect(existsSync(join(study.transcripts, "spaet", "final.md"))).toBe(false);
});

test("the offset moves every heading, live and from the keyboard", async ({ page }) => {
  await drop(page);
  await page.locator("#import-target").selectOption("spaet");
  await expect(page.locator(".import-heading")).toHaveCount(2);

  const offset = page.locator("#import-offset");
  await offset.fill("-20");
  await expect(page.locator(".import-heading")).toHaveCount(3);
  expect(await shown(page)).toEqual([
    ["Warmfrage", 0],
    ["1 · Ablage (Wissen festhalten)", 2],
    ["5 · Systemlandschaft", 4],
  ]);
  await expect(page.locator("#import-unplaced")).toBeHidden();
  await expect(page.locator(".import-heading.warn")).toHaveCount(0);

  // The arrow keys step it; Enter in the field does not import.
  await offset.focus();
  await page.keyboard.press("ArrowUp");
  await expect(offset).toHaveValue("-19");
  await page.keyboard.press("Shift+ArrowUp");
  await expect(offset).toHaveValue("-9");
  await page.keyboard.press("Enter");
  await expect(page.locator("#import-sheet")).toBeVisible();
  // −9: the log is still eleven seconds late, the first heading behind again.
  await expect.poll(() => shown(page)).toEqual([
    ["Warmfrage", 2],
    ["1 · Ablage (Wissen festhalten)", 4],
  ]);
  await page.locator("#import-offset-earlier").click();
  await page.locator("#import-offset-earlier").click();
  await page.locator("#import-offset-earlier").click();
  await expect(offset).toHaveValue("-24");
  await expect.poll(() => shown(page)).toEqual([
    ["Warmfrage", 0],
    ["1 · Ablage (Wissen festhalten)", 2],
    ["5 · Systemlandschaft", 4],
  ]);
  expect(existsSync(join(study.transcripts, "spaet", "final.md"))).toBe(false);
  expect(JSON.parse(readFileSync(join(study.transcripts, "spaet", "session.json"), "utf8")).t0).toBe(T0);
});

test("a heading moves by a turn, or to the next question, and is written where it was put", async ({ page }) => {
  await drop(page);
  await page.locator("#import-target").selectOption("spaet");
  await page.locator("#import-offset").fill("-20");
  await expect(page.locator(".import-heading")).toHaveCount(3);

  const ablage = page.locator(".import-heading-name", { hasText: "Ablage" });
  await ablage.focus();
  await page.keyboard.press("ArrowDown");
  expect(await shown(page)).toContainEqual(["1 · Ablage (Wissen festhalten)", 3]);
  await expect(page.locator(".import-heading-name", { hasText: "Ablage" })).toBeFocused();
  await expect(page.locator(".import-heading.manual")).toContainText("von Hand gesetzt");
  // Opening on an answer is allowed, and said.
  await expect(page.locator(".import-heading.manual")).toContainText("Beginnt mit einer Antwort");

  // Shift jumps to the next question; there it lands on the same turn as the
  // next heading and leaves itself empty, which is said too.
  await page.keyboard.press("Shift+ArrowDown");
  expect(await shown(page)).toEqual([
    ["Warmfrage", 0],
    ["1 · Ablage (Wissen festhalten)", 4],
    ["5 · Systemlandschaft", 4],
  ]);
  await expect(page.locator("#import-sections-count")).toHaveText(
    "3 Abschnitte gesetzt · 0 nicht gesetzt · 1 leer",
  );
  await expect(page.locator(".import-heading.manual")).toContainText("Leerer Abschnitt");

  // Back up by two with the buttons, the mouse's way to the same moves.
  await page.locator('.import-heading.manual [data-move="-1"]').click();
  await page.locator('.import-heading.manual [data-move="-1"]').click();
  expect(await shown(page)).toContainEqual(["1 · Ablage (Wissen festhalten)", 2]);
  await page.locator(".import-heading.manual [data-reset]").click();
  await expect(page.locator(".import-heading.manual")).toHaveCount(0);

  // Once more one turn on, and written.
  await page.locator(".import-heading-name", { hasText: "Ablage" }).focus();
  await page.keyboard.press("ArrowDown");
  await page.locator('#import-form button[type="submit"]').click();
  await expect(page.locator("#import-sheet")).toBeHidden();

  const text = readFileSync(join(study.transcripts, "spaet", "final.md"), "utf8");
  const parsed = parseTranscript(text, "spaet");
  expect(parsed.problems).toEqual([]);
  expect(parsed.turns.map((turn) => turn.section)).toEqual([0, 0, 0, 1, 2, 2]);
  expect(text).toContain("## Section: 1 · Ablage (Wissen festhalten)\n\n**4 · Vertrieb");
  // The offset was this import's; the log keeps its own start.
  expect(JSON.parse(readFileSync(join(study.transcripts, "spaet", "session.json"), "utf8")).t0).toBe(T0);
});

test("an empty section and an unplaced block are shown, and the latter can be set by hand", async ({ page }) => {
  await drop(page);
  await page.locator("#import-target").selectOption("eng");
  await expect(page.locator(".import-heading")).toHaveCount(3);
  expect(await shown(page)).toEqual([
    ["Warmfrage", 0],
    ["1 · Ablage (Wissen festhalten)", 2],
    ["5 · Systemlandschaft", 2],
  ]);
  await expect(page.locator(".import-heading").nth(1)).toContainText("Leerer Abschnitt");
  await expect(page.locator("#import-sections-count")).toHaveText(
    "3 Abschnitte gesetzt · 0 nicht gesetzt · 1 leer",
  );

  // Shifted far enough, the last block lies beyond the recording; set by hand
  // it goes before the last turn and can be moved from there.
  await page.locator("#import-offset").fill("120");
  await expect(page.locator("#import-unplaced")).toBeVisible();
  await page.locator("#import-unplaced [data-place]").first().click();
  await expect(page.locator(".import-heading.manual")).toHaveCount(1);
  await expect(page.locator(".import-heading.manual .import-heading-name")).toBeFocused();
});

test("saving the offset corrects the log's start, and the headings stay put", async ({ page }) => {
  await openLog(study, "korrektur", LATE, { department: "Einkauf" });
  await drop(page);
  await page.locator("#import-target").selectOption("korrektur");
  await expect(page.locator("#import-offset-save")).toBeHidden();
  await page.locator("#import-offset").fill("-20");
  await expect(page.locator(".import-heading")).toHaveCount(3);
  const before = await shown(page);

  await page.locator("#import-offset-save").click();
  await expect(page.locator("#message")).toContainText("Protokollstart um -20 s korrigiert");
  await expect(page.locator("#import-offset")).toHaveValue("0");
  await expect.poll(() => shown(page)).toEqual(before);

  const log = JSON.parse(readFileSync(join(study.transcripts, "korrektur", "session.json"), "utf8"));
  expect(log.t0).toBe("2026-10-14T09:00:20.000Z");
  expect(log.blockStarts.map((one) => one.at)).toEqual([2, 30, 90]);
});

test("without sections, or without a log, the import is what it always was", async ({ page }) => {
  await openLog(study, "ohne", LATE, { department: "Marketing" });
  await drop(page);
  await page.locator("#import-target").selectOption("ohne");
  await page.locator("#import-sections-use").uncheck();
  await expect(page.locator("#import-sections-body")).toBeHidden();
  await page.locator('#import-form button[type="submit"]').click();
  await expect(page.locator("#import-sheet")).toBeHidden();
  expect(readFileSync(join(study.transcripts, "ohne", "final.md"), "utf8")).not.toContain("## Section");

  // Back to a new folder: nothing of the review is sent.
  await drop(page);
  await page.locator("#import-target").selectOption("eng");
  await page.locator("#import-target").selectOption("");
  await expect(page.locator("#import-sections")).toBeHidden();
  await expect(page.locator("#import-no-sections")).toBeVisible();
  await expect(page.locator("#import-preview")).toBeVisible();
  await page.locator("#import-department").fill("Lager");
  await page.locator('#import-form button[type="submit"]').click();
  await expect(page.locator("#import-sheet")).toBeHidden();
  expect(readFileSync(join(study.transcripts, "interview-lager", "final.md"), "utf8")).not.toContain(
    "## Section",
  );
});

test("a study without logs offers no folder choice", async ({ page }) => {
  // The suite's own sandbox server has no rounds and no logs.
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await page.locator("#import").click();
  await page.locator("#import-file").setInputFiles({
    name: "aufnahme.vtt",
    mimeType: "text/plain",
    buffer: Buffer.from(VTT, "utf8"),
  });
  await expect(page.locator("#import-found")).toBeVisible();
  await expect(page.locator("#import-target-field")).toBeHidden();
  await expect(page.locator("#import-sections")).toBeHidden();
  await expect(page.locator("#import-no-sections")).toBeVisible();
  await expect(page.locator(".import-turn")).toHaveCount(4);
});

test("the review speaks English when the interface does", async ({ page }) => {
  await drop(page, "en");
  await expect(page.locator("#import-target-field")).toContainText("Folder");
  await page.locator("#import-target").selectOption("eng");
  await expect(page.locator("#import-log")).toContainText("Interview log found: Vertrieb, 3 block starts.");
  await expect(page.locator("#import-sections-count")).toHaveText(
    "3 sections placed · 0 not placed · 1 empty",
  );
  await expect(page.locator(".import-heading").nth(1)).toContainText("Empty section");
  await expect(page.locator("#import-sections")).toContainText("Shift every section");
  await expect(page.locator("#import-sections")).not.toContainText("Abschnitte");
});
