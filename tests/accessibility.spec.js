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

test("every chart can be read as figures without a mouse", async ({ page }) => {
  await fill(page);

  for (const view of ["analysis", "catalog"]) {
    await page.locator(`.tab[data-view="${view}"]`).click();
    await expect(page.locator(`#view-${view} figure.chart`).first()).toBeVisible();

    // A tooltip that answers only a hovering mouse answers nobody else, so
    // every chart needs its numbers in a table — its own, or one right beside
    // it, as the category chart has in the cross table.
    const uncovered = await page.evaluate((current) => {
      const root = document.querySelector(`#view-${current}`);
      return [...root.querySelectorAll("figure.chart")]
        .filter((figure) => {
          // Either its own figures, or the table it names — nothing vaguer:
          // "some table nearby" would let one chart cover for another.
          const own = document.getElementById(`${figure.id}-figures`);
          const named = figure.dataset.figures
            ? document.getElementById(figure.dataset.figures)
            : null;
          return !own && !named;
        })
        .map((figure) => figure.id);
    }, view);
    expect(uncovered, `charts without figures in ${view}`).toEqual([]);
  }
});

test("the figures open from the keyboard and match the chart", async ({ page }) => {
  await fill(page);
  await page.locator('.tab[data-view="analysis"]').click();

  const disclosure = page.locator("#heatmap-figures");
  await expect(disclosure).toBeVisible();
  // Closed to begin with: the picture is the point, the figures are the recourse.
  expect(await disclosure.evaluate((element) => element.open)).toBe(false);

  await disclosure.locator("summary").focus();
  await page.keyboard.press("Enter");
  expect(await disclosure.evaluate((element) => element.open)).toBe(true);

  // The same numbers the picture draws: every cell of the heatmap appears.
  const agree = await page.evaluate(() => {
    const cells = [...document.querySelectorAll("#heatmap svg rect.cell")];
    const drawn = cells
      .map((cell) => Number(cell.getAttribute("data-value")))
      .sort((a, b) => a - b);
    const listed = [...document.querySelectorAll("#heatmap-figures tbody td")]
      .map((cell) => Number(cell.textContent))
      .filter((value) => value > 0)
      .sort((a, b) => a - b);
    return { drawn, listed };
  });
  expect(agree.drawn.length).toBeGreaterThan(0);
  expect(agree.listed).toEqual(agree.drawn);
});

test("a table wider than its frame can be scrolled from the keyboard", async ({ page }) => {
  await fill(page);
  await page.locator('.tab[data-view="analysis"]').click();
  await page.locator("#heatmap-figures summary").click();

  const frames = await page.evaluate(() =>
    [...document.querySelectorAll("#view-analysis .table-frame")].map((frame) => ({
      overflows: frame.scrollWidth > frame.clientWidth + 1,
      focusable: frame.tabIndex === 0,
      named: Boolean(frame.getAttribute("aria-label")),
    })),
  );
  expect(frames.length).toBeGreaterThan(0);
  for (const frame of frames) {
    // Focusable exactly when there is something out of sight to scroll to; a
    // tab stop that leads nowhere is its own nuisance.
    expect(frame.focusable).toBe(frame.overflows);
    if (frame.overflows) expect(frame.named).toBe(true);
  }
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

test("a citation that is only a suggestion says so where it is read", async ({ page }) => {
  /* The citation list is what a requirement gets built from, one citation at a
     time — the dropdown for that sits on each card. Evidence nobody has
     confirmed looked exactly like evidence here, which is the one decision it
     must not be mistaken in. The export and the catalog cards already said it. */
  await fill(page);
  // `fill` confirms everything it codes, so a couple are put back to suggestions
  // — otherwise there is nothing for the mark to be right or wrong about.
  await page.evaluate(async (id) => {
    const data = await (await fetch(`/api/interviews/${id}`)).json();
    for (const coding of data.codings.slice(0, 2)) {
      await fetch(`/api/interviews/${id}/codings/${coding.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reviewed: false }),
      });
    }
  }, FIRST);
  await page.reload();
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator(".citation").first()).toBeVisible();

  const agreement = await page.evaluate(async () => {
    const data = await (await fetch("/api/analysis")).json();
    return {
      unreviewed: Object.values(data.citations).flat().filter((one) => !one.reviewed).length,
      marked: document.querySelectorAll(".citation .open-mark").length,
      cards: document.querySelectorAll(".citation").length,
    };
  });
  expect(agreement.cards).toBeGreaterThan(0);
  expect(agreement.unreviewed).toBeGreaterThan(0);
  // Exactly the ones that are, and no others.
  expect(agreement.marked).toBe(agreement.unreviewed);

  // The mark sits in the head row, beside where the passage is placed.
  const marked = page.locator(".citation").filter({ has: page.locator(".open-mark") }).first();
  await expect(marked.locator(".head-row .open-mark")).toHaveText("ungeprüft");
});
