import { expect, test } from "@playwright/test";

/**
 * What the analysis conveys to someone who cannot see it.
 *
 * A chart marked `role="img"` with nothing but a title announces itself and
 * stops: "Coding units per category, image". The picture is the whole content,
 * so none of it arrives. These tests hold every chart to a summary in numbers,
 * the cross table to headers that say which category and which department a
 * figure belongs to, and every control to a name.
 */

const FIRST = "interview-01";

/** Enough coding for every chart in both views to have something to show. */
async function fill(page) {
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await page.evaluate(async (id) => {
    const before = await (await fetch(`/api/interviews/${id}`)).json();
    for (const coding of before.codings) {
      await fetch(`/api/interviews/${id}/codings/${coding.id}`, { method: "DELETE" });
    }
    const categories = (await (await fetch("/api/categories")).json()).categories;
    const codable = before.turns.filter((turn) => !turn.interviewer && turn.text.length > 80);

    const requirement = await (
      await fetch("/api/requirements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Volltextsuche über alle Ablagen",
          moscow: "must",
          blockedOperations: ["retrieval", "transfer"],
        }),
      })
    ).json();

    for (const [index, turn] of codable.slice(0, 8).entries()) {
      const answer = await fetch(`/api/interviews/${id}/codings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          turn: turn.number,
          start: 0,
          end: 60,
          category: categories[index % categories.length].id,
          text: turn.text.slice(0, 60),
          reviewed: true,
          requirements: index < 3 ? [requirement.id] : [],
        }),
      });
      if (!answer.ok) throw new Error(`could not code turn ${turn.number}`);
    }
  }, FIRST);
  await page.reload();
  await page.waitForSelector(".turn");
}

test("every chart says in numbers what it draws", async ({ page }) => {
  await fill(page);

  for (const view of ["analysis", "catalog"]) {
    await page.locator(`.tab[data-view="${view}"]`).click();
    await expect(page.locator(`#view-${view} svg[role="img"]`).first()).toBeVisible();

    const charts = await page.locator(`#view-${view} svg[role="img"]`).evaluateAll((nodes) =>
      nodes.map((svg) => {
        const described = svg.getAttribute("aria-describedby");
        const target = described ? document.getElementById(described) : null;
        return {
          chart: svg.closest("figure")?.id ?? "?",
          labelled: Boolean(
            svg.getAttribute("aria-labelledby") &&
              document.getElementById(svg.getAttribute("aria-labelledby")),
          ),
          summary: target ? target.textContent.trim() : "",
        };
      }),
    );

    expect(charts.length).toBeGreaterThan(0);
    for (const chart of charts) {
      expect(chart.labelled, `${chart.chart} has a title`).toBe(true);
      // A summary that carries no figure is a caption, not an alternative.
      expect(chart.summary, `${chart.chart} is described`).toMatch(/\d/);
      expect(chart.summary.length, `${chart.chart} says something`).toBeGreaterThan(30);
    }
  }
});

test("the cross table names the category and the department of every figure", async ({ page }) => {
  await fill(page);
  await page.locator('.tab[data-view="analysis"]').click();

  const table = page.locator("#view-analysis table").first();
  await expect(table.locator("caption")).toHaveCount(1);

  // Column headers for every column, and a row header on every body row.
  const shape = await table.evaluate((element) => ({
    columns: element.querySelectorAll("thead th[scope='col']").length,
    headerCells: element.querySelectorAll("thead th").length,
    bodyRows: element.querySelectorAll("tbody tr").length,
    rowHeaders: element.querySelectorAll("tbody th[scope='row']").length,
  }));
  expect(shape.columns).toBe(shape.headerCells);
  expect(shape.rowHeaders).toBe(shape.bodyRows);
  expect(shape.bodyRows).toBeGreaterThan(0);
});

test("a cell that stands empty still says nought", async ({ page }) => {
  await fill(page);
  await page.locator('.tab[data-view="analysis"]').click();

  const empty = page.locator("#view-analysis td.empty").first();
  await expect(empty).toBeVisible();
  // The middle dot is drawn; the zero it stands for is what gets read out.
  await expect(empty).toHaveText("·0");
  expect(await empty.locator("[aria-hidden='true']").textContent()).toBe("·");
  expect(await empty.locator(".visually-hidden").textContent()).toBe("0");
});

test("every control carries a name", async ({ page }) => {
  await fill(page);

  for (const view of ["code", "analysis", "catalog"]) {
    await page.locator(`.tab[data-view="${view}"]`).click();
    await page.waitForTimeout(200);

    const nameless = await page.evaluate((current) => {
      const root = document.querySelector(`#view-${current}`);
      const controls = [...root.querySelectorAll("button, a[href], select, input, textarea")];
      return controls
        .filter((element) => element.offsetParent !== null)
        .filter((element) => {
          const labelled = element.getAttribute("aria-labelledby");
          const name =
            element.getAttribute("aria-label") ??
            (labelled ? document.getElementById(labelled)?.textContent : null) ??
            element.textContent.trim() ??
            "";
          const own =
            element.labels?.length || element.title || element.getAttribute("placeholder");
          return !name.trim() && !own;
        })
        .map((element) => element.outerHTML.slice(0, 90));
    }, view);

    expect(nameless, `unnamed controls in ${view}`).toEqual([]);
  }
});
