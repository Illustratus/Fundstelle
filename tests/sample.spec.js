import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { sampleMarkdown } from "../lib/analysis.js";

/**
 * The sample, described from the files that describe it.
 *
 * A transcript may carry `- Key: Value` lines under its heading, and the format
 * has parsed them since the beginning: a role, a tenure, a site, the date of
 * the interview. Exactly one of them was ever used — the date, for the subtitle
 * — and the rest was read and dropped.
 *
 * Meanwhile every qualitative study has to describe who it spoke to, and that
 * description was being typed out by hand from the same files the tool had
 * already read. So it writes it: the columns are whatever the transcripts
 * record, and the two figures at the end are what the tool knows and a header
 * cannot say.
 */

const SANDBOX = join(fileURLToPath(new URL("..", import.meta.url)), ".sandbox", "transcripts");
const FIRST = join(SANDBOX, "interview-01", "final.md");
const SECOND = join(SANDBOX, "interview-02", "final.md");

let originals;

test.beforeAll(() => {
  originals = { first: readFileSync(FIRST, "utf8"), second: readFileSync(SECOND, "utf8") };
});

test.afterEach(() => {
  writeFileSync(FIRST, originals.first, "utf8");
  writeFileSync(SECOND, originals.second, "utf8");
});

/** Put a line into a transcript's header block. */
function record(file, line) {
  const text = readFileSync(file, "utf8");
  const at = text.indexOf("\n---");
  writeFileSync(file, `${text.slice(0, at)}\n${line}${text.slice(at)}`, "utf8");
}

test("what the transcripts record becomes the columns", async ({ request }) => {
  record(FIRST, "- Rolle: Führungskraft");
  record(FIRST, "- Jahre im Haus: 12");
  record(SECOND, "- Rolle: Sachbearbeitung");

  const paper = await (await request.get("/api/export/sample.md?lang=de")).text();
  expect(paper).toContain("# Stichprobe");
  expect(paper).toContain("Rolle");
  expect(paper).toContain("Jahre im Haus");
  expect(paper).toContain("Führungskraft");
  expect(paper).toContain("Sachbearbeitung");

  /* A field one interview carries and another does not is left blank. The gap
     is a fact about the sample, not something to fill in. */
  const rows = paper.split("\n").filter((line) => line.startsWith("| Interview 2"));
  expect(rows).toHaveLength(1);
  const cells = rows[0].split("|").map((cell) => cell.trim());
  expect(cells).toContain("Sachbearbeitung");
  expect(cells.filter((cell) => cell === "")).not.toHaveLength(0);
});

test("the two figures at the end are the tool's own", async ({ request }) => {
  const data = await (await request.get("/api/interviews/interview-01")).json();
  for (const coding of data.codings) {
    await request.delete(`/api/interviews/interview-01/codings/${coding.id}`);
  }
  const codable = data.turns.filter((turn) => !turn.interviewer);
  for (const turn of codable.slice(0, 3)) {
    await request.post("/api/interviews/interview-01/codings", {
      data: { turn: turn.number, start: 0, end: 40, category: "routine", text: turn.text.slice(0, 40), reviewed: true },
    });
  }

  const paper = await (await request.get("/api/export/sample.md?lang=de")).text();
  const row = paper.split("\n").find((line) => line.startsWith("| Interview 1"));
  // Splitting on the pipe leaves an empty cell at each end of the row.
  const cells = row.split("|").slice(1, -1).map((cell) => cell.trim());
  // Codable turns, then coding units — how much was said, and how much of it
  // has been worked.
  expect(cells.at(-2), "codable turns").toBe(String(codable.length));
  expect(cells.at(-1), "coding units").toBe("3");
});

test("a study that records nothing gets a short table and a way to say more", () => {
  /* Asked of the function rather than the server, because the fixtures do carry
     a date and a source — and mangling them to make a point about the empty
     case would be testing the fixture rather than the tool. */
  const bare = [
    {
      transcript: {
        id: "i1",
        title: "Interview 1: Vertrieb",
        department: "Vertrieb",
        meta: {},
        turns: [{ number: 2, text: "Etwas gesagt.", interviewer: false }],
      },
      codings: [],
      memo: "",
    },
  ];
  const paper = sampleMarkdown(bare, "de");
  expect(paper).toContain("# Stichprobe");
  // No invented columns, and a sentence saying how to have some.
  expect(paper).toContain("tragen bisher keine Angaben");
  expect(paper).toContain("- Rolle: Führungskraft");
  expect(paper).toContain("Interview 1: Vertrieb");
});

test("it is written in the language it was asked in", async ({ request }) => {
  record(FIRST, "- Rolle: Führungskraft");
  const english = await (await request.get("/api/export/sample.md?lang=en")).text();
  expect(english).toContain("# Sample");
  expect(english).toContain("Coding units");
  expect(english).not.toContain("Stichprobe");
  // The keys are the author's own words and are not translated.
  expect(english).toContain("Rolle");
});

test("the header of a transcript is shown, not only parsed", async ({ page }) => {
  /* It was read and dropped: the tool knew the role and never said so, and the
     reader had no way to tell whether writing it down had done anything. */
  record(FIRST, "- Rolle: Führungskraft");

  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  const about = page.locator("#interview-meta");
  await expect(about).toBeVisible();
  await expect(about).toContainText("Rolle");
  await expect(about).toContainText("Führungskraft");
});

test("a transcript that records nothing shows nothing", async ({ page }) => {
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  // The fixtures carry a date and a source, so something is shown; an empty
  // block would be furniture.
  const about = page.locator("#interview-meta");
  const shown = await about.isVisible();
  if (shown) expect((await about.innerText()).trim().length).toBeGreaterThan(0);
});

test("the export is offered where the others are", async ({ page }) => {
  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator(".exports a", { hasText: "Stichprobe" })).toBeVisible();
});
