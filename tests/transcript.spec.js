import { expect, test } from "@playwright/test";

import { parseTranscript, withProblemText } from "../lib/transcript.js";
import { translator } from "../lib/texts.js";

/**
 * What the reader gets handed a transcript that does not keep the format.
 *
 * A tool that is given away is given files it did not make: exported from Word
 * with the timestamps stripped, a turn number pasted twice, a heading written
 * by hand. The strict form is what keeps a citation citable, so none of it is
 * guessed at — but it used to pass in silence, and an interview that comes out
 * short with nothing said about why is worse than one that refuses.
 */

const WELL_FORMED =
  "# Interview 1: Sales\n\n## Section: 1 · Filing\n\n" +
  "**1 · Interviewer [0:05]**\n\nHow do you record knowledge?\n\n" +
  "**2 · Sales [0:15]**\n\nMostly in notes I never find again.\n";

test("a transcript that keeps the format reports nothing", () => {
  const parsed = parseTranscript(WELL_FORMED, "x");
  expect(parsed.problems).toEqual([]);
  expect(parsed.turns).toHaveLength(2);
});

test("the shapes a file arrives in are read rather than refused", () => {
  // Windows line endings, and a byte order mark from an editor that adds one.
  for (const [label, text] of [
    ["CRLF", WELL_FORMED.replace(/\n/g, "\r\n")],
    ["BOM", "﻿" + WELL_FORMED],
  ]) {
    const parsed = parseTranscript(text, "x");
    expect(parsed.turns, label).toHaveLength(2);
    expect(parsed.turns[1].text, label).toBe("Mostly in notes I never find again.");
  }
});

/* An answer is not always one paragraph. A turn used to run to the next blank
   line, so everything after the first paragraph was dropped — out of the
   reading surface, out of the search, out of every count, and silently. */

test("an answer written in two paragraphs arrives whole", () => {
  const parsed = parseTranscript(
    "# Interview 1: Sales\n\n**1 · Sales [0:05]**\n\nFirst paragraph.\n\n" +
      "Second paragraph.\n\n**2 · Sales [0:30]**\n\nNext turn.\n",
    "x",
  );
  expect(parsed.turns).toHaveLength(2);
  expect(parsed.turns[0].text).toBe("First paragraph. Second paragraph.");
  expect(parsed.turns[1].text).toBe("Next turn.");
  expect(parsed.problems).toEqual([]);
});

test("a turn ends where something else begins", () => {
  // A rule across the page, a heading, the next turn: each ends the one before
  // it, so nothing that is not speech is taken into a citation.
  const afterRule = parseTranscript(
    "# Interview 1: Sales\n\n**1 · Sales [0:05]**\n\nThe answer.\n\n---\n\nAn appendix nobody said.\n",
    "x",
  );
  expect(afterRule.turns[0].text).toBe("The answer.");

  const afterHeading = parseTranscript(
    "# Interview 1: Sales\n\n**1 · Sales [0:05]**\n\nThe answer.\n\n" +
      "## Section: 2 · Next\n\n**2 · Sales [1:00]**\n\nAfter.\n",
    "x",
  );
  expect(afterHeading.turns.map((turn) => turn.text)).toEqual(["The answer.", "After."]);
  expect(afterHeading.sections).toHaveLength(1);
});

test("a turn number used twice is called out", () => {
  const twice =
    "# Interview 1: Sales\n\n**5 · Sales [0:05]**\n\nFirst.\n\n**5 · Sales [0:15]**\n\nSecond.\n";
  const { problems, turns } = parseTranscript(twice, "x");

  // Both turns are kept — the file is the author's, not the tool's to correct.
  expect(turns).toHaveLength(2);
  expect(problems).toHaveLength(1);
  expect(problems[0].key).toBe("transcriptDuplicateTurn");
  expect(problems[0].params.turn).toBe(5);
  expect(problems[0].params.line).toBe(7);
});

test("a line shaped like a turn that was not read is named with its line", () => {
  const missing = "# Interview 1: Sales\n\n**1 · Sales**\n\nThis text goes missing.\n";
  const { problems, turns } = parseTranscript(missing, "x");

  expect(turns).toHaveLength(0);
  const unread = problems.find((one) => one.key === "transcriptUnreadTurn");
  expect(unread).toBeTruthy();
  expect(unread.params.line).toBe(3);
  expect(unread.params.text).toBe("**1 · Sales**");
  // And the file as a whole is reported as yielding nothing.
  expect(problems.some((one) => one.key === "transcriptNoTurns")).toBe(true);
});

test("a file with nothing in it says so instead of showing an empty screen", () => {
  const { problems, turns } = parseTranscript("", "x");
  expect(turns).toHaveLength(0);
  expect(problems.map((one) => one.key)).toEqual(["transcriptNoTurns"]);
});

test("the problems are worded in the language that asked", () => {
  const twice =
    "# Interview 1: Sales\n\n**5 · Sales [0:05]**\n\nFirst.\n\n**5 · Sales [0:15]**\n\nSecond.\n";
  const { problems } = parseTranscript(twice, "x");

  const german = withProblemText(problems, translator("de"))[0].text;
  const english = withProblemText(problems, translator("en"))[0].text;
  expect(german).toContain("Beitrag 5 kommt mehrfach vor");
  expect(english).toContain("Turn 5 occurs more than once");
  // Both name the line, because that is what makes it fixable.
  expect(german).toContain("7");
  expect(english).toContain("7");
});

test("what could not be read is put in front of the reader", async ({ page }) => {
  // The interview the suite works on keeps the format, so nothing is shown.
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await expect(page.locator("#transcript-problems")).toBeHidden();

  // With a file that does not, the panel names each place.
  await page.route("**/api/interviews/interview-01", async (route) => {
    const answer = await route.fetch();
    const data = await answer.json();
    data.problems = [
      { key: "transcriptDuplicateTurn", text: "Beitrag 5 kommt mehrfach vor (Zeile 7)." },
      { key: "transcriptUnreadTurn", text: "Zeile 17 sieht aus wie ein Beitrag." },
    ];
    await route.fulfill({ json: data });
  });
  await page.reload();
  await expect(page.locator("#transcript-problems")).toBeVisible();
  await expect(page.locator("#transcript-problems h2")).toContainText("2 Stellen");
  await expect(page.locator("#transcript-problems li")).toHaveCount(2);
  await expect(page.locator("#transcript-problems")).toContainText("Beitrag 5 kommt mehrfach vor");
});

/* The first screen ---------------------------------------------------------
   The empty state explains the format exactly and then leaves the reader to
   type it out: make a folder, make a file, get the asterisks and the middle dot
   right. That is where a tool gets put aside, and the tool knows the folder and
   is showing the format already. */

test("the empty screen can write the example it is describing", async ({ page, request }) => {
  await page.route("**/api/interviews", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ json: [] });
  });
  await page.goto("/?lang=de");
  await expect(page.locator(".onboarding")).toBeVisible();

  const write = page.locator("#onboarding-example");
  await expect(write).toBeVisible();
  // It says plainly what it will do before it does it.
  await expect(page.locator(".onboarding")).toContainText("vorhandene Dateien werden nicht angerührt");
  // Three interviews, not one — and none of them coded.
  await expect(page.locator(".onboarding")).toContainText("drei erfundene Interviews");
  await expect(page.locator(".onboarding")).toContainText("Kodiert wird nichts");

  // The suite's folder already holds interviews, so the tool declines rather
  // than writing into a study that is under way.
  const refused = await request.post("/api/example");
  expect(refused.status()).toBe(409);
  expect((await refused.json()).code).toBe("errorExampleNotEmpty");
});

test("what gets written is a study the tool can read", async () => {
  const { exampleStudy, EXAMPLE_FOLDER } = await import("../lib/example.js");
  expect(EXAMPLE_FOLDER).toBe("example-interview");

  for (const language of ["de", "en"]) {
    const study = exampleStudy(language);
    /* Three, not one. With a single interview the analysis has a cross table of
       one column, no saturation curve — it needs three — and nothing for the
       categories to meet in, which is most of what the tool is worth choosing
       for. Somebody trying it out would see a bar chart of one department. */
    expect(study.length, language).toBeGreaterThanOrEqual(3);
    expect(study[0].folder).toBe(EXAMPLE_FOLDER);
    expect(new Set(study.map((one) => one.folder)).size, "each in its own folder").toBe(study.length);

    const departments = new Set();
    for (const one of study) {
      const parsed = parseTranscript(one.text, one.folder);
      // Nothing it could not read, or the first screen would open on a complaint.
      expect(parsed.problems, `${language} ${one.folder}`).toEqual([]);
      // Enough to code, to search and for the analysis to show something.
      expect(parsed.turns.length, one.folder).toBeGreaterThanOrEqual(6);
      expect(parsed.sections.length, one.folder).toBeGreaterThanOrEqual(2);
      expect(parsed.turns.filter((turn) => !turn.interviewer).length, one.folder).toBeGreaterThan(2);
      expect(parsed.department, one.folder).toBeTruthy();
      departments.add(parsed.department);
      // And each says of itself that it is invented.
      expect(Object.values(parsed.meta).join(" "), one.folder).toMatch(/Beispiel|example|Example/);
    }
    // Three departments, so the cross table has a shape to it.
    expect(departments.size, language).toBeGreaterThanOrEqual(3);
  }
});

test("the example study is written whole, and never over anything", async () => {
  const { exampleStudy } = await import("../lib/example.js");
  const { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawn } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");

  const root = fileURLToPath(new URL("..", import.meta.url));
  const work = mkdtempSync(join(tmpdir(), "fundstelle-example-"));
  const transcripts = join(work, "transcripts");
  const study = exampleStudy("de");
  // A folder of one of them already there, with something in it.
  mkdirSync(join(transcripts, study[1].folder), { recursive: true });
  writeFileSync(join(transcripts, study[1].folder, "final.md"), "# Nicht anfassen\n");

  const server = spawn(process.execPath, [join(root, "server.js")], {
    env: { ...process.env, PORT: "4183", TRANSCRIPTS: transcripts, CATEGORIES: join(work, "categories.json"), START_LANGUAGE: "de" },
    stdio: "ignore",
  });
  try {
    for (let tries = 0; tries < 60; tries += 1) {
      const up = await fetch("http://127.0.0.1:4183/api/interviews").then((a) => a.ok, () => false);
      if (up) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    /* The folder is not empty — it holds that one file — so the tool declines,
       which is the rule it has always kept. */
    const refused = await fetch("http://127.0.0.1:4183/api/example", { method: "POST" });
    expect(refused.status).toBe(409);
    expect(readFileSync(join(transcripts, study[1].folder, "final.md"), "utf8")).toBe("# Nicht anfassen\n");
  } finally {
    server.kill();
  }
});
