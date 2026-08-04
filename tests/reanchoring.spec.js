import { expect, test } from "@playwright/test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Re-anchoring, on a real file.
 *
 * "Codings hold their position by turn number and character range, are silently
 * re-anchored when the text shifts, and are loudly reported when they can't be"
 * is the tool's most distinctive claim and the place where being wrong costs
 * most: a unit put back in the wrong place becomes a citation in the paper that
 * the passage does not carry.
 *
 * The arithmetic of it was tested on invented data from the beginning. What was
 * not tested is the path it actually takes — a transcript edited on disk, read
 * back through the server, the moved ranges written into coding.json, and the
 * citation in the export quoting the new place. Every step of that is where the
 * damage would happen, and none of it was covered.
 *
 * Every check here edits the file the way a person would: correcting a typo,
 * inserting a sentence that was missed, deleting one that should not have been
 * transcribed.
 */

const SANDBOX = join(fileURLToPath(new URL("..", import.meta.url)), ".sandbox", "transcripts");
const FILE = join(SANDBOX, "interview-01", "final.md");
const CODING = join(SANDBOX, "interview-01", "coding.json");

let original;

test.beforeAll(() => {
  original = readFileSync(FILE, "utf8");
});

test.beforeEach(async ({ request }) => {
  writeFileSync(FILE, original, "utf8");
  /* Every interview, not just the one being edited: the analysis counts the
     whole study, so a leftover from another spec would be counted into the
     totals these checks are about. */
  for (const one of await (await request.get("/api/interviews")).json()) {
    const data = await (await request.get(`/api/interviews/${one.id}?lang=de`)).json();
    for (const coding of data.codings) {
      await request.delete(`/api/interviews/${one.id}/codings/${coding.id}`);
    }
  }
});

test.afterAll(() => {
  writeFileSync(FILE, original, "utf8");
});

/* Asked in German throughout, the way the interface asks: a bare request
   follows Accept-Language and falls back to English, and these checks are about
   the wording a reader is given. */

/** The turn as the file has it, and where a phrase sits inside it. */
async function place(request, number, phrase) {
  const data = await (await request.get("/api/interviews/interview-01?lang=de")).json();
  const turn = data.turns.find((one) => one.number === number);
  const start = turn.text.indexOf(phrase);
  expect(start, `“${phrase}” is in turn ${number}`).toBeGreaterThanOrEqual(0);
  return { turn, start, end: start + phrase.length };
}

const codeIt = (request, at, phrase, category = "routine") =>
  request.post("/api/interviews/interview-01/codings", {
    data: { turn: at.turn.number, start: at.start, end: at.end, text: phrase, category, reviewed: true },
  });

/** Put something in front of a phrase, inside the same turn. */
function insertBefore(phrase, inserted) {
  const text = readFileSync(FILE, "utf8");
  const at = text.indexOf(phrase);
  expect(at, `“${phrase}” is in the file`).toBeGreaterThan(0);
  writeFileSync(FILE, text.slice(0, at) + inserted + text.slice(at), "utf8");
}

test("a passage that shifted keeps its citation and its place is corrected on disk", async ({
  request,
}) => {
  const phrase = "Eigentlich will ich alles sofort ablegen";
  const at = await place(request, 10, phrase);
  const made = await (await codeIt(request, at, phrase)).json();

  // The interviewer noticed a missing sentence and typed it in.
  insertBefore(phrase, "Das ist eine gute Frage. ");

  const after = await (await request.get("/api/interviews/interview-01?lang=de")).json();
  expect(after.moved).toBe(1);
  expect(after.lost).toBe(0);

  const moved = after.codings.find((one) => one.id === made.id);
  // The citation is the same words, at the place they now sit.
  expect(moved.text).toBe(phrase);
  expect(moved.start).toBe(at.start + "Das ist eine gute Frage. ".length);
  const turn = after.turns.find((one) => one.number === 10);
  expect(turn.text.slice(moved.start, moved.end)).toBe(phrase);

  /* And written back, so the next read does not have to work it out again —
     and so a second process sharing the folder sees the corrected place. */
  const stored = JSON.parse(readFileSync(CODING, "utf8"));
  const onDisk = stored.codings.find((one) => one.id === made.id);
  expect(onDisk.start).toBe(moved.start);
  // Nothing of the check itself is written into the file.
  expect(onDisk.state).toBeUndefined();
  expect(onDisk.reasonKey).toBeUndefined();
});

test("the export quotes the passage where it now stands", async ({ request }) => {
  const phrase = "Eigentlich will ich alles sofort ablegen";
  const at = await place(request, 10, phrase);
  await codeIt(request, at, phrase);
  insertBefore(phrase, "Das ist eine gute Frage. ");

  const table = await (
    await request.get("/api/export/coding-table/interview-01.md?lang=de")
  ).text();
  /* The point of the whole mechanism: what the appendix quotes is what the
     transcript says, after the transcript was corrected. */
  expect(table).toContain(phrase);
  expect(table).not.toContain("Das ist eine gute Frage. Eigentlich");
});

test("a passage that now reads twice is handed over, not guessed at", async ({ page, request }) => {
  const phrase = "Eigentlich will ich alles sofort ablegen";
  const at = await place(request, 10, phrase);
  const made = await (await codeIt(request, at, phrase)).json();

  /* Both halves are needed, and the first attempt at this test only did one.
     Putting a second copy in front leaves the recorded range still holding
     exactly the coded words, so there is nothing to resolve and the tool
     rightly leaves it alone. The ambiguity only arises when the recorded place
     no longer reads that way *and* the words are now in the turn twice. */
  const text = readFileSync(FILE, "utf8");
  const at2 = text.indexOf(phrase);
  writeFileSync(
    FILE,
    text.slice(0, at2) +
      "Das ist eine gute Frage. " +
      phrase +
      ", und " +
      phrase +
      text.slice(at2 + phrase.length),
    "utf8",
  );

  const after = await (await request.get("/api/interviews/interview-01?lang=de")).json();
  expect(after.lost).toBe(1);
  const lost = after.codings.find((one) => one.id === made.id);
  expect(lost.state).toBe("lost");
  expect(lost.reason).toContain("mehrfach");
  // Its old range is left exactly as it was; guessing would be the one thing
  // worse than saying so.
  expect(lost.start).toBe(at.start);

  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  // And the reader is told, rather than finding out in the appendix.
  await expect(page.locator("#drift")).toBeVisible();
  await expect(page.locator("#drift")).toContainText("1");
});

test("a turn that is gone is told apart from a passage that is gone", async ({ request }) => {
  const phrase = "Eigentlich will ich alles sofort ablegen";
  const at = await place(request, 10, phrase);
  await codeIt(request, at, phrase);

  // The whole turn removed, header and text.
  const text = readFileSync(FILE, "utf8");
  const header = text.indexOf("**10 · ");
  const next = text.indexOf("**11 · ", header);
  writeFileSync(FILE, text.slice(0, header) + text.slice(next), "utf8");

  const after = await (await request.get("/api/interviews/interview-01?lang=de")).json();
  expect(after.lost).toBe(1);
  const lost = after.codings[0];
  expect(lost.reason).toContain("Beitrag 10");
  // Not "the citation no longer reads that way": the turn itself is gone, and
  // the difference is what tells the reader where to look.
  expect(lost.reason).not.toContain("steht so nicht mehr");
});

test("a passage that was deleted says so and keeps its wording", async ({ request }) => {
  const phrase = "Eigentlich will ich alles sofort ablegen";
  const at = await place(request, 10, phrase);
  await codeIt(request, at, phrase);

  const text = readFileSync(FILE, "utf8");
  writeFileSync(FILE, text.replace(phrase, "Ich lege es später ab"), "utf8");

  const after = await (await request.get("/api/interviews/interview-01?lang=de")).json();
  expect(after.lost).toBe(1);
  expect(after.codings[0].reason).toContain("steht so nicht mehr");
  // The wording is kept, because it is the only record of what was coded.
  expect(after.codings[0].text).toBe(phrase);
});

test("a move that would land on a neighbour is refused on the real file", async ({ request }) => {
  /* Two units in one turn, and an edit that would slide the first onto the
     second. One place carries exactly one category, so the move is refused
     rather than quietly breaking that. */
  const first = await place(request, 8, "Wichtige Unterlagen werden bei uns in SharePoint abgelegt");
  await codeIt(request, first, "Wichtige Unterlagen werden bei uns in SharePoint abgelegt");
  const second = await place(request, 8, "Für Verträge gibt es zusätzlich einen Ordner");
  await codeIt(request, second, "Für Verträge gibt es zusätzlich einen Ordner", "agreement");

  // The first passage is repeated further along, where the second one sits.
  const text = readFileSync(FILE, "utf8");
  writeFileSync(
    FILE,
    text.replace(
      "Für Verträge gibt es zusätzlich einen Ordner",
      "Wichtige Unterlagen werden bei uns in SharePoint abgelegt und für Verträge gibt es zusätzlich einen Ordner",
    ),
    "utf8",
  );

  const after = await (await request.get("/api/interviews/interview-01?lang=de")).json();
  const overlapping = after.codings.filter((one) => one.state === "lost");
  expect(overlapping.length).toBeGreaterThan(0);
  for (const one of after.codings.filter((each) => each.state !== "lost")) {
    for (const other of after.codings.filter((each) => each.state !== "lost")) {
      if (one.id === other.id || one.turn !== other.turn) continue;
      const apart = one.end <= other.start || other.end <= one.start;
      expect(apart, "no two units end up on top of each other").toBe(true);
    }
  }
});

test("an untouched transcript moves nothing and rewrites nothing", async ({ request }) => {
  const phrase = "Eigentlich will ich alles sofort ablegen";
  const at = await place(request, 10, phrase);
  await codeIt(request, at, phrase);
  const before = readFileSync(CODING, "utf8");

  const after = await (await request.get("/api/interviews/interview-01?lang=de")).json();
  expect(after.moved).toBe(0);
  expect(after.lost).toBe(0);
  // A read is a read: nothing is written when nothing shifted.
  expect(readFileSync(CODING, "utf8")).toBe(before);
});

/* A unit with no place is not evidence yet. */

test("a unit that lost its place counts in nothing and is quoted nowhere", async ({
  page,
  request,
}) => {
  const phrase = "Eigentlich will ich alles sofort ablegen";
  const at = await place(request, 10, phrase);
  await codeIt(request, at, phrase);
  const before = await (await request.get("/api/analysis")).json();
  expect(before.total).toBe(1);
  expect(before.displaced).toBe(0);

  // The passage is edited away: the tool hands the unit over rather than
  // guessing, which it always did — and then went on counting it.
  const text = readFileSync(FILE, "utf8");
  writeFileSync(FILE, text.replace(phrase, "Ich lege es später ab"), "utf8");
  expect((await (await request.get("/api/interviews/interview-01?lang=de")).json()).lost).toBe(1);

  const after = await (await request.get("/api/analysis")).json();
  /* This is the failure the whole anchoring machinery exists to prevent: a
     citation in the paper that the passage does not carry. It was counted in
     the cross table, listed among the citations and quoted in the appendix. */
  expect(after.total).toBe(0);
  expect(Object.values(after.citations).flat()).toHaveLength(0);
  expect(after.progress[0].codings).toBe(0);

  const table = await (
    await request.get("/api/export/coding-table/interview-01.md?lang=de")
  ).text();
  expect(table).not.toContain(phrase);
  // And the appendix says how many it left out; a silent subtraction would be
  // worse than the line about it.
  expect(table).toContain("stehen hier nicht");

  // Nothing disappears without a word: the analysis names the number too.
  expect(after.displaced).toBe(1);
  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#analysis .drift-line")).toContainText("1");
});

test("a unit that only moved still counts, and counts once", async ({ request }) => {
  // The distinction that matters: shifted is not lost.
  const phrase = "Eigentlich will ich alles sofort ablegen";
  const at = await place(request, 10, phrase);
  await codeIt(request, at, phrase);
  insertBefore(phrase, "Das ist eine gute Frage. ");

  const after = await (await request.get("/api/analysis")).json();
  expect(after.total).toBe(1);
  expect(after.displaced).toBe(0);
  expect(Object.values(after.citations).flat()).toHaveLength(1);
});

/**
 * And nowhere means nowhere.
 *
 * The last one of these was found one surface at a time — the cross table, then
 * the citations, then the appendix. That is a poor way to find them, because
 * the next surface added inherits the same hole in silence. So the rule is
 * asserted once, across everything that reads a coding: a unit with no place is
 * not evidence, wherever the question is asked.
 */
test("a unit with no place is evidence on no surface at all", async ({ request }) => {
  const phrase = "Eigentlich will ich alles sofort ablegen";
  const at = await place(request, 10, phrase);
  const made = await (await codeIt(request, at, phrase)).json();

  // It stands for a requirement, too — the catalog counts departments from it.
  const wanted = await (
    await request.post("/api/requirements", { data: { title: "Ablage beschreiben" } })
  ).json();
  await request.patch(`/api/interviews/interview-01/codings/${made.id}`, {
    data: { requirements: [wanted.id] },
  });

  // A second coding of the same interview, so the agreement panel has something
  // to compare — it reads the first coder's units just like everything else.
  writeFileSync(
    join(SANDBOX, "interview-01", "coding.zweit.json"),
    JSON.stringify({
      version: 3,
      interview: "interview-01",
      codings: [{ id: "z1", turn: 10, start: at.start, end: at.end, category: "routine", text: phrase }],
    }),
  );

  const before = await (await request.get("/api/agreement")).json();
  expect(before.comparisons[0].cells.both, "they agree while the passage is there").toBe(1);

  // The passage is edited away.
  const text = readFileSync(FILE, "utf8");
  writeFileSync(FILE, text.replace(phrase, "Ich lege es später ab"), "utf8");
  expect((await (await request.get("/api/interviews/interview-01?lang=de")).json()).lost).toBe(1);

  const analysis = await (await request.get("/api/analysis")).json();
  expect(analysis.total, "the cross table").toBe(0);
  expect(Object.values(analysis.citations).flat(), "the citations").toHaveLength(0);
  expect(analysis.saturation.at(-1).total, "the saturation curve").toBe(0);
  expect(analysis.rows.every((row) => row.sum === 0), "every category row").toBe(true);

  const catalog = await (await request.get("/api/requirements")).json();
  const entry = catalog.requirements.find((one) => one.id === wanted.id);
  expect(entry.citations, "the requirements catalog").toHaveLength(0);
  expect(entry.departments, "and the departments it counts from them").toHaveLength(0);

  const agreement = await (await request.get("/api/agreement")).json();
  /* The comparison rests on "did this coder use this category in this turn".
     A unit with no place answers that question about a place that is gone. */
  expect(agreement.comparisons[0].cells.both, "the intercoder comparison").toBe(0);

  for (const [what, url] of [
    ["the coding guide", "/api/export/coding-guide.md?lang=de"],
    ["the citations", "/api/export/citations.md?lang=de"],
    ["the coding table", "/api/export/coding-table/interview-01.md?lang=de"],
    ["the cross table", "/api/export/matrix.md?lang=de"],
    ["the requirements catalog", "/api/export/requirements-catalog.md?lang=de"],
    ["the reliability report", "/api/export/agreement.md?lang=de"],
  ]) {
    const written = await (await request.get(url)).text();
    expect(written, `${what} does not quote it`).not.toContain(phrase);
  }
});

test.afterEach(() => {
  rmSync(join(SANDBOX, "interview-01", "coding.zweit.json"), { force: true });
});

test("a deleted passage does not become a disagreement between two coders", async ({ request }) => {
  /* The second coding is read from a file and never had its anchors checked
     against the transcript. Dropping only the first coder's unit would leave
     the second one standing alone — turning a passage nobody can point to into
     a difference between two people who never disagreed about anything. */
  const phrase = "Eigentlich will ich alles sofort ablegen";
  const at = await place(request, 10, phrase);
  await codeIt(request, at, phrase);
  writeFileSync(
    join(SANDBOX, "interview-01", "coding.zweit.json"),
    JSON.stringify({
      version: 3,
      interview: "interview-01",
      codings: [{ id: "z1", turn: 10, start: at.start, end: at.end, category: "routine", text: phrase }],
    }),
  );

  const text = readFileSync(FILE, "utf8");
  writeFileSync(FILE, text.replace(phrase, "Ich lege es später ab"), "utf8");

  const { comparisons } = await (await request.get("/api/agreement")).json();
  expect(comparisons[0].cells).toMatchObject({ both: 0, onlyFirst: 0, onlySecond: 0 });
  expect(comparisons[0].disagreements).toEqual([]);
});
