import { expect, test } from "@playwright/test";

/**
 * The anchor example that is missing.
 *
 * Mayring asks every category for a definition, an anchor example and — where
 * the boundary to a neighbouring category is unclear — a coding rule. The
 * coding guide writes all three, and where a definition was missing it had
 * always written the gap in square brackets.
 *
 * The anchor example it simply left out. A category with no anchor produced no
 * field at all, so the appendix read as though that category needed none, and
 * the first person to notice was whoever reviews the submission. An omission
 * that looks like a decision is the worst kind of gap.
 *
 * A category nothing has been coded with yet is a different matter and stays
 * silent: there is nothing it could have been anchored in.
 */

const CODED = "routine";

async function clear(request) {
  for (const one of await (await request.get("/api/interviews")).json()) {
    const data = await (await request.get(`/api/interviews/${one.id}`)).json();
    for (const coding of data.codings) {
      await request.delete(`/api/interviews/${one.id}/codings/${coding.id}`);
    }
  }
}

async function codeSomething(request, category = CODED, anchor = false) {
  const data = await (await request.get("/api/interviews/interview-01")).json();
  const turn = data.turns.find(
    (one) => !one.interviewer && one.text.length > 60 && !data.codings.some((c) => c.turn === one.number),
  );
  const made = await (
    await request.post("/api/interviews/interview-01/codings", {
      data: {
        turn: turn.number,
        start: 0,
        end: 50,
        category,
        text: turn.text.slice(0, 50),
        reviewed: true,
      },
    })
  ).json();
  if (anchor) {
    await request.patch(`/api/interviews/interview-01/codings/${made.id}`, {
      data: { anchor: true },
    });
  }
  return made;
}

test.beforeEach(async ({ request }) => {
  await clear(request);
});

test("the guide writes the gap where an anchor example is missing", async ({ request }) => {
  await codeSomething(request);
  const guide = await (await request.get("/api/export/coding-guide.md?lang=de")).text();

  /* Written, not omitted. A field that is simply absent reads as "this
     category needs none", which the method does not allow. */
  expect(guide).toContain("FEHLT: Ankerbeispiel");
  // And it says what to do about it, in the place where it is noticed.
  expect(guide).toContain("als Anker markieren");
});

test("a category with an anchor example says nothing of the kind", async ({ request }) => {
  await codeSomething(request, CODED, true);
  const guide = await (await request.get("/api/export/coding-guide.md?lang=de")).text();
  expect(guide).not.toContain("FEHLT: Ankerbeispiel");
  expect(guide).toContain("Ankerbeispiel");
});

test("a category nothing has been coded with is left in peace", async ({ request }) => {
  /* Every category in the start system is uncoded here. Marking them all as
     lacking an anchor example would be a page of noise about work that has not
     started, and noise is how a real gap gets missed. */
  const guide = await (await request.get("/api/export/coding-guide.md?lang=de")).text();
  expect(guide).not.toContain("FEHLT: Ankerbeispiel");
});

test("the gap is named in the language the export was asked in", async ({ request }) => {
  await codeSomething(request);
  const english = await (await request.get("/api/export/coding-guide.md?lang=en")).text();
  expect(english).toContain("MISSING: anchor example");
  expect(english).not.toContain("FEHLT");
});

test("the analysis says it before the guide is exported, not after", async ({ page, request }) => {
  await codeSomething(request);

  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#matrix-table")).toBeVisible();

  /* Beside the export button, because the gap is far cheaper to close before
     the appendix is written than after a reviewer finds it — one line among
     whatever else is still open at that moment. */
  const said = page.locator(".exports-part .still-open li", { hasText: "Ankerbeispiel" });
  await expect(said).toBeVisible();
  // Named, so it can be acted on without hunting.
  await expect(said).toContainText("Arbeitsalltag");

  // The figure comes from the analysis, not from a count kept somewhere else.
  const rows = await page.evaluate(async () => {
    const data = await (await fetch("/api/analysis")).json();
    return data.rows.filter((row) => row.sum > 0 && !row.anchors).map((row) => row.name);
  });
  /* The figure comes from the analysis and not from a count kept elsewhere; at
     one it is the word rather than the digit, which the line names instead. */
  expect(rows).toEqual(["Arbeitsalltag"]);
  await expect(said).toContainText("Eine Kategorie");
});

test("marking one takes the notice away", async ({ page, request }) => {
  const made = await codeSomething(request);
  const line = page.locator(".exports-part .still-open li", { hasText: "Ankerbeispiel" });
  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(line).toBeVisible();

  await request.patch(`/api/interviews/interview-01/codings/${made.id}`, {
    data: { anchor: true },
  });
  await page.reload();
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#matrix-table")).toBeVisible();
  // That line goes; whatever else is still open is somebody else's business.
  await expect(line).toHaveCount(0);
});
