import { expect, test } from "@playwright/test";

/**
 * What is still open, said where somebody thinks they are finished.
 *
 * Each of these signals already existed. Unreviewed units are counted in the
 * status bar; a category with no anchor example is named beside the export
 * button; an interview nobody has touched shows a zero in the progress table.
 * Three views, and the question they all answer is asked once — with a hand on
 * the button that writes the appendix.
 *
 * So they are said there, in one short list. Not repeated from the top of the
 * same page: what lost its place is already named above the figures it affects,
 * and saying it twice on one screen teaches the reader to skim both.
 *
 * The list is silent when there is nothing to say. A tool that always has a
 * warning is a tool whose warnings are furniture.
 */

const EXPORTS = ".exports-part .still-open li";

async function clear(request) {
  for (const one of await (await request.get("/api/interviews")).json()) {
    const data = await (await request.get(`/api/interviews/${one.id}`)).json();
    for (const coding of data.codings) {
      await request.delete(`/api/interviews/${one.id}/codings/${coding.id}`);
    }
  }
}

/** Code `howMany` units in an interview, all confirmed unless said otherwise. */
async function code(request, interview, howMany, { reviewed = true, anchor = false } = {}) {
  const data = await (await request.get(`/api/interviews/${interview}`)).json();
  const codable = data.turns.filter(
    (turn) => !turn.interviewer && turn.text.length > 70 && !data.codings.some((c) => c.turn === turn.number),
  );
  const made = [];
  for (const turn of codable.slice(0, howMany)) {
    const answer = await request.post(`/api/interviews/${interview}/codings`, {
      data: { turn: turn.number, start: 0, end: 60, category: "routine", text: turn.text.slice(0, 60), reviewed },
    });
    if (!answer.ok()) continue;
    const one = await answer.json();
    made.push(one);
    if (anchor && made.length === 1) {
      await request.patch(`/api/interviews/${interview}/codings/${one.id}`, { data: { anchor: true } });
    }
  }
  return made;
}

const analysis = async (page) => {
  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#matrix-table")).toBeVisible();
};

test.beforeEach(async ({ request }) => {
  await clear(request);
});

test("suggestions still open are counted before the exports are written", async ({
  page,
  request,
}) => {
  await code(request, "interview-01", 3, { reviewed: false, anchor: true });
  await code(request, "interview-02", 1, { reviewed: true });

  await analysis(page);
  const line = page.locator(EXPORTS, { hasText: "geprüft" });
  await expect(line).toBeVisible();
  await expect(line).toContainText("3");
  /* The exports do mark them, which is why this is a warning and not a refusal
     — but knowing the number before writing the appendix is the point. */
  await expect(line).toContainText("Ausgaben");
});

test("an interview nobody has touched is named, not just left at zero", async ({
  page,
  request,
}) => {
  await code(request, "interview-01", 2, { anchor: true });

  await analysis(page);
  const line = page.locator(EXPORTS, { hasText: "gar nicht kodiert" });
  await expect(line).toBeVisible();
  // Named, because "one interview" is a number and a title is somewhere to go.
  await expect(line).toContainText("Interview 2");
  // And it says what follows from it for the documents.
  await expect(line).toContainText("Kodiertabellen");
  /* One of a thing is not "1 things". The tool speaks two languages, and a
     number glued to a plural is the first place that shows. */
  await expect(line).toContainText("Ein Interview ist");
  await expect(line).not.toContainText("1 Interviews");
});

test("nothing to say means nothing said", async ({ page, request }) => {
  /* A tool that always shows a warning is a tool whose warnings are furniture,
     and the one real gap then goes unread. */
  await code(request, "interview-01", 2, { anchor: true });
  await code(request, "interview-02", 2, { anchor: true });

  await analysis(page);
  await expect(page.locator(".exports-part .still-open")).toHaveCount(0);
  await expect(page.locator(".exports")).toBeVisible();
});

test("the list is the language of the interface", async ({ page, request }) => {
  await code(request, "interview-01", 2, { reviewed: false, anchor: true });

  await page.goto("/?lang=en");
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#matrix-table")).toBeVisible();
  await expect(page.locator(EXPORTS, { hasText: "not reviewed yet" })).toBeVisible();
  await expect(page.locator(EXPORTS, { hasText: "geprüft" })).toHaveCount(0);
});

test("what lost its place is not said twice on one screen", async ({ page, request }) => {
  const made = await code(request, "interview-01", 2, { anchor: true });
  await code(request, "interview-02", 2, { anchor: true });
  await request.patch(`/api/interviews/interview-01/codings/${made[1].id}`, {
    data: { text: "Diesen Satz gibt es im Transkript nicht mehr." },
  });

  await analysis(page);
  // Named once, above the figures it changes.
  await expect(page.locator("#analysis > .drift-line")).toContainText("1");
  // And not again three screens down.
  await expect(page.locator(EXPORTS, { hasText: "Platz" })).toHaveCount(0);
});

test("every line names a number and a next step", async ({ page, request }) => {
  // A warning that says only that something is wrong leaves the reader hunting.
  await code(request, "interview-01", 2, { reviewed: false });

  await analysis(page);
  const lines = await page.locator(EXPORTS).allTextContents();
  expect(lines.length).toBeGreaterThan(1);
  for (const line of lines) {
    /* How many, as a figure or as the word for one — „Eine Kodiereinheit" is
       as exact as „3 Kodiereinheiten" and better German. */
    expect(line, `“${line}” says how many`).toMatch(/\d|^(Eine?|One) /);
    expect(line.length, `“${line}” says what follows`).toBeGreaterThan(60);
  }
});
