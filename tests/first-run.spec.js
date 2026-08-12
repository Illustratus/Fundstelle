import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SANDBOX = join(ROOT, ".sandbox", "transcripts");

/* The screen an empty folder opens on cannot be reached through the suite's own
   server, which has fixtures in it — so these two drive one of their own, on a
   folder with nothing in it. The same shape the git-history checks use, and the
   reason is the same: the state under test is the absence of everything. */
const BARE_PORT = 4184;
const BARE = `http://127.0.0.1:${BARE_PORT}`;
let bareServer;
let bareFolder;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test.beforeAll(async () => {
  bareFolder = mkdtempSync(join(tmpdir(), "fundstelle-bare-"));
  bareServer = spawn(process.execPath, [join(ROOT, "server.js")], {
    env: {
      ...process.env,
      PORT: String(BARE_PORT),
      TRANSCRIPTS: join(bareFolder, "transcripts"),
      CATEGORIES: join(bareFolder, "categories.json"),
      START_LANGUAGE: "de",
    },
    stdio: "ignore",
  });
  for (let tries = 0; tries < 60; tries += 1) {
    const up = await fetch(`${BARE}/api/interviews`).then(
      (answer) => answer.ok,
      () => false,
    );
    if (up) break;
    await wait(200);
  }
});

test.afterAll(() => {
  bareServer?.kill();
  rmSync(bareFolder, { recursive: true, force: true });
});

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

/* And the screen before all of it: the one an empty folder opens on. */

test("the first screen leads with what to do, not with a file format", async ({ page }) => {
  const bare = await page.context().newPage();
  await bare.goto(`${BARE}/?lang=de`);
  await bare.waitForSelector(".onboarding");

  /* It used to open with a folder path, fourteen lines of Markdown and a
     paragraph about asterisks and middle dots, with the buttons underneath all
     of it — a lesson about a format the tool will write for you, standing
     between you and the thing that does it. */
  const heading = bare.locator(".onboarding h2");
  const lead = bare.locator(".onboarding-lead");
  await expect(lead).toBeVisible();
  await expect(lead).toContainText("WebVTT");
  await expect(bare.locator("#onboarding-import")).toBeVisible();

  // The format is one click away rather than gone: somebody writing files by
  // hand still needs it.
  const format = bare.locator(".onboarding-format");
  await expect(format).toBeVisible();
  await expect(bare.locator(".onboarding-sample")).toBeHidden();
  await format.locator("summary").click();
  await expect(bare.locator(".onboarding-sample")).toBeVisible();
  await expect(bare.locator(".onboarding-sample")).toContainText("## Section:");

  // The action comes before the lesson on the page, not only in the markup.
  const order = await bare.evaluate(() => {
    const button = document.querySelector("#onboarding-import");
    const details = document.querySelector(".onboarding-format");
    return button.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING;
  });
  expect(order, "the format sits after the buttons").toBeTruthy();
  await bare.close();
});

test("nothing on the first screen is a control over nothing", async ({ page }) => {
  const bare = await page.context().newPage();
  await bare.goto(`${BARE}/?lang=de`);
  await bare.waitForSelector(".onboarding");

  /* A dropdown with no interviews in it, a search over a transcript that is not
     there, and a column explaining percentages per guide section: furniture
     around nothing, teaching the reader that parts of this screen mean nothing.
     A poor first lesson. */
  await expect(bare.locator("#interview-choice")).toBeHidden();
  await expect(bare.locator(".search-bar")).toBeHidden();
  await expect(bare.locator("#sections-note")).toBeHidden();
  await expect(bare.locator("#note-shell")).toBeHidden();

  // What does belong here stays: the category system can be built before any
  // transcript exists.
  await expect(bare.locator("#inductive-summary")).toBeVisible();
  await bare.close();
});

/**
 * And the column those controls were in goes with them.
 *
 * Emptying it left it standing: 240 pixels of nothing with a rule down the
 * side of the very first screen anybody sees, and the panel that screen is
 * made of pushed off centre by exactly that much.
 */
test("an empty column takes no room on the first screen", async ({ page }) => {
  const bare = await page.context().newPage();
  await bare.goto(`${BARE}/?lang=de`);
  await bare.waitForSelector(".onboarding");

  const column = bare.locator(".column-left");
  expect(await column.evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(0);

  // The panel stands in the middle of what is left, not beside a hole.
  const centred = await bare.evaluate(() => {
    const panel = document.querySelector(".onboarding").getBoundingClientRect();
    const room = document.querySelector(".edition").getBoundingClientRect();
    return Math.abs(panel.left - room.left - (room.right - panel.right));
  });
  expect(centred, "the same air on both sides").toBeLessThan(4);
  await bare.close();
});

/**
 * A share of nothing is not a hundred per cent.
 *
 * The evaluation of a study with no coding in it opened on „100 % reviewed"
 * over „0 coding units" — the one number in this tool that is a judgement, and
 * it read as a finished check rather than as work not begun. Beside it, five
 * column headings stood over a table with no rows.
 */
test("an evaluation with nothing in it claims nothing", async ({ page }) => {
  const bare = await page.context().newPage();
  await bare.goto(`${BARE}/?lang=de#/analysis`);
  await bare.waitForSelector("#analysis .metrics");

  const reviewed = bare.locator(".metric", { hasText: /geprüft|reviewed/i }).first();
  await expect(reviewed.locator(".value")).toHaveText("—");

  /* The table of interviews says it has none rather than standing there as
     five headings over nothing. The cross table beside it keeps its rows: the
     start system exists before any coding does, and a category with a zero
     against it is the point of that one. */
  const under = await bare.evaluate(() => {
    const heading = [...document.querySelectorAll("#analysis h3")].find((one) =>
      /Stand je Interview|Progress per interview/i.test(one.textContent),
    );
    const next = heading?.nextElementSibling;
    return { tag: next?.tagName.toLowerCase(), text: next?.textContent.trim() };
  });
  expect(under.tag, "no empty table under the heading").toBe("p");
  expect(under.text).toMatch(/Noch kein Interview/);
  await bare.close();
});
