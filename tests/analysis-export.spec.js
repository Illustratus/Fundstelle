import { expect, test } from "@playwright/test";

/**
 * The analysis as a document, and the documents sorted by where they go.
 *
 * Three of the figures on the analysis screen could not leave the tool. The
 * cross table has had its own export from the beginning; the saturation curve
 * and the pairs of categories that keep meeting were readable only on screen —
 * and both are things a methods chapter argues from rather than decoration. A
 * figure that cannot be quoted is a figure that gets retyped, and a retyped
 * figure is one that can be wrong.
 *
 * The other half is the list of exports itself. Eight buttons in a row said
 * nothing about which of them belong in the methods chapter and which in the
 * appendix, so a first-time author had to open each one to find out — and the
 * two that describe how the study was done are exactly the ones they would not
 * know to look for.
 */

async function study(request, { unreviewed = 0 } = {}) {
  const categories = ["routine", "routine.disruption", "agreement"];
  for (const one of await (await request.get("/api/interviews")).json()) {
    const data = await (await request.get(`/api/interviews/${one.id}`)).json();
    for (const coding of data.codings) {
      await request.delete(`/api/interviews/${one.id}/codings/${coding.id}`);
    }
    const codable = data.turns.filter((turn) => !turn.interviewer && turn.text.length > 100);
    for (const [index, turn] of codable.slice(0, 4).entries()) {
      // Two categories in the same turn, so the pairs have something to report.
      for (const [k, category] of [categories[index % 3], categories[(index + 1) % 3]].entries()) {
        await request.post(`/api/interviews/${one.id}/codings`, {
          data: {
            turn: turn.number,
            start: k * 45,
            end: k * 45 + 40,
            category,
            text: turn.text.slice(k * 45, k * 45 + 40),
            reviewed: index >= unreviewed,
          },
        });
      }
    }
  }
}

test("the analysis leaves the tool with the figures the screen draws", async ({ page, request }) => {
  await study(request);
  const paper = await (await request.get("/api/export/analysis.md?lang=de")).text();
  const data = await (await request.get("/api/analysis")).json();

  expect(paper).toContain("# Auswertung");
  // The head figures, from the same computation the screen uses.
  expect(paper).toContain(String(data.total));
  expect(paper).toContain(String(data.progress.length));

  // Every interview's line, with the counts the progress table shows.
  for (const entry of data.progress) {
    expect(paper, `${entry.title} is in it`).toContain(entry.title);
    expect(paper).toContain(`${entry.turnsCoded} / ${entry.turns}`);
  }

  /* And the two that could not be quoted before. Pairs are always present as a
     heading; the saturation table needs three interviews to mean anything. */
  expect(paper).toContain("Kategorien, die zusammen auftreten");
  for (const pair of data.cooccurrence.pairs) {
    expect(paper).toContain(`${pair.aName} · ${pair.bName}`);
  }

  // On screen and on paper are the same numbers, not two arithmetics.
  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator(".metric .value").first()).toHaveText(String(data.total));
});

test("what has no place is named there too, not silently missing", async ({ request }) => {
  await study(request);
  const data = await (await request.get("/api/interviews/interview-01")).json();
  await request.patch(`/api/interviews/interview-01/codings/${data.codings[0].id}`, {
    data: { text: "Diesen Satz gibt es im Transkript nicht mehr." },
  });

  const paper = await (await request.get("/api/export/analysis.md?lang=de")).text();
  /* The figures leave it out — that rule holds everywhere — so the document has
     to say it does, or the total is quietly smaller than the study. */
  expect(paper).toContain("ihren Platz im Transkript verloren");
});

test("a system whose categories never meet says so in the document", async ({ request }) => {
  for (const one of await (await request.get("/api/interviews")).json()) {
    const data = await (await request.get(`/api/interviews/${one.id}`)).json();
    for (const coding of data.codings) {
      await request.delete(`/api/interviews/${one.id}/codings/${coding.id}`);
    }
    const turn = data.turns.find((each) => !each.interviewer && each.text.length > 70);
    await request.post(`/api/interviews/${one.id}/codings`, {
      data: { turn: turn.number, start: 0, end: 50, category: "routine", text: turn.text.slice(0, 50), reviewed: true },
    });
  }
  const paper = await (await request.get("/api/export/analysis.md?lang=de")).text();
  expect(paper).toContain("das gute Ergebnis");
});

test("it is written in the language it was asked in", async ({ request }) => {
  await study(request);
  const english = await (await request.get("/api/export/analysis.md?lang=en")).text();
  expect(english).toContain("# Analysis");
  expect(english).toContain("Categories that turn up together");
  expect(english).not.toContain("Auswertung");
});

test("the documents are offered by where each of them goes", async ({ page, request }) => {
  await study(request);
  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#matrix-table")).toBeVisible();

  const groups = page.locator(".exports-part .exports-where");
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toContainText("Methodenkapitel");
  await expect(groups.nth(1)).toContainText("Anhang");

  /* What describes the study goes in the first group, what quotes the material
     in the second — which is the distinction the flat row could not make. */
  const method = page.locator(".exports").nth(0);
  for (const name of ["Stichprobe", "Kodierleitfaden", "Auswertung", "Intercoderreliabilität"]) {
    await expect(method.locator("a", { hasText: name })).toBeVisible();
  }
  const appendix = page.locator(".exports").nth(1);
  await expect(appendix.locator("a", { hasText: "Kodiertabelle" }).first()).toBeVisible();
  await expect(appendix.locator("a", { hasText: "Notizen" })).toBeVisible();
});

test("every offered document actually answers", async ({ page, request }) => {
  // A button that downloads a 404 is worse than no button.
  await study(request);
  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#matrix-table")).toBeVisible();

  const links = await page.locator(".exports-part a").evaluateAll((all) =>
    all.map((one) => one.getAttribute("href")),
  );
  expect(links.length).toBeGreaterThan(5);
  for (const href of links) {
    const answer = await request.get(href);
    expect(answer.status(), `${href} answers`).toBe(200);
    expect((await answer.text()).length, `${href} has content`).toBeGreaterThan(40);
  }
});
