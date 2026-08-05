import { expect, test } from "@playwright/test";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * The first five minutes, walked end to end.
 *
 * Every piece of this path was built in a different iteration — the empty
 * screen, the import, the start system, the coding — and nobody had ever walked
 * it in one go. Doing that on a genuinely empty folder showed two things a new
 * reader meets and nothing else in the tool would have caught.
 *
 * The screen a transcript lands on says nothing about how to make a coding.
 * Every key is in the sheet behind `?`, which is no use to somebody who does
 * not know there is a sheet, and the mouse gesture is written nowhere at all.
 *
 * And the column beside the transcript explained percentages per guide section
 * for a transcript that has none — a recording carries no guide sections, so a
 * file read in never does — then reported "0 blocks" as though something were
 * missing, leaving the reader to wonder what they had done wrong.
 */

const SANDBOX = join(fileURLToPath(new URL("..", import.meta.url)), ".sandbox", "transcripts");

const VTT = `WEBVTT

1
00:00:03.120 --> 00:00:08.400
<v Anna Berger>Vielen Dank, dass du dir die Zeit nimmst. Erzähl doch kurz, was du machst.</v>

2
00:00:09.500 --> 00:00:19.200
<v Jonas Klein>Ich betreue die Kampagnen und kümmere mich um die Inhalte auf der Webseite. Vieles läuft über Absprachen, die nirgendwo festgehalten werden.</v>

3
00:00:20.000 --> 00:00:24.000
<v Anna Berger>Und was stört dich daran am meisten?</v>

4
00:00:24.500 --> 00:00:36.000
<v Jonas Klein>Dass ich die aktuelle Fassung nie finde. Die Suche liefert Protokolle von vor zwei Jahren, aber nicht das, was ich brauche.</v>
`;

const IMPORTED = "interview-marketing";

test.afterEach(() => {
  rmSync(join(SANDBOX, IMPORTED), { recursive: true, force: true });
});

test.beforeEach(async ({ request }) => {
  /* A first run means nothing has been coded, and this shares the sandbox with
     every other spec — the start system is open or closed depending on that, so
     leaving it to chance would make the check about what ran before. */
  for (const one of await (await request.get("/api/interviews")).json()) {
    const data = await (await request.get(`/api/interviews/${one.id}`)).json();
    for (const coding of data.codings) {
      await request.delete(`/api/interviews/${one.id}/codings/${coding.id}`);
    }
  }
});

/** Bring a recording in the way the first screen offers. */
async function readIn(page) {
  await page.locator("#import").click();
  await page.locator("#import-file").setInputFiles({
    name: "Interview-Jonas.vtt",
    mimeType: "text/plain",
    buffer: Buffer.from(VTT, "utf8"),
  });
  await page.locator("#import-interviewer").selectOption("Anna Berger");
  await page.locator("#import-department").fill("Marketing");
  await page.locator("#import-title").fill("Interview: Marketing");
  await page.locator("#import-form button[type=submit]").click();
  await expect(page.locator("#import-sheet")).toBeHidden();
}

test("the screen a transcript lands on says how to code", async ({ page }) => {
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await readIn(page);
  await expect(page.locator("#interview-choice")).toHaveValue(IMPORTED);

  const how = page.locator("#how-to-code");
  await expect(how).toBeVisible();
  // Both ways in, because a reader who has not found the sheet has neither.
  await expect(how).toContainText("Maus");
  await expect(how.locator("kbd", { hasText: "s" }).first()).toBeVisible();
  await expect(how).toContainText("Ziffer");
});

test("and stops saying it once something is coded", async ({ page }) => {
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await readIn(page);
  await expect(page.locator("#how-to-code")).toBeVisible();

  await page.locator("#transcript").focus();
  await page.keyboard.press("j");
  await page.keyboard.press("s");
  await page.keyboard.press("1");
  await expect(page.locator(".segment")).toHaveCount(1);

  /* It has done its work. A hint that stays becomes furniture, and furniture is
     what the eye stops reading. */
  await expect(page.locator("#how-to-code")).toBeHidden();
});

test("a transcript without guide sections says why, not nothing", async ({ page }) => {
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await readIn(page);

  const note = page.locator("#sections-note");
  await expect(note).toContainText("keine Erzählanstöße");
  // Where they come from, and that nothing else depends on them.
  await expect(note).toContainText("Leitfaden");
  await expect(note).toContainText("## Erzählanstoß");
  // No list of nothing, and no percentages for a thing that does not exist.
  await expect(page.locator("#sections li")).toHaveCount(0);
  await expect(note).not.toContainText("Anteile je Block");
});

test("a transcript that has them keeps the explanation of its figures", async ({ page }) => {
  // The fixtures carry guide sections, so this is the other half of the same
  // decision rather than a separate feature.
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await expect(page.locator("#sections li").first()).toBeVisible();
  await expect(page.locator("#sections-note")).toContainText("keine Aufteilung");
});

test("the whole path leaves a codable interview and an honest column", async ({ page, request }) => {
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await readIn(page);

  // Four cues became four turns, the interviewer's among them.
  const made = await (await request.get(`/api/interviews/${IMPORTED}`)).json();
  expect(made.problems).toEqual([]);
  expect(made.turns).toHaveLength(4);
  expect(made.turns.filter((one) => one.interviewer)).toHaveLength(2);
  expect(made.department).toBe("Marketing");

  // And the panel offers what belongs at this moment: the start system, since
  // nothing has been coded yet.
  await expect(page.locator("#inductive-summary")).toContainText("Startsystem");
});
