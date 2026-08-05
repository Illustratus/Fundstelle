import { expect, test } from "@playwright/test";

/**
 * The size a figure is drawn at.
 *
 * These charts are authored 720 units wide with 10 to 11.5px type, against a
 * page whose body text is 14px. The stylesheet stretched them to the width of
 * the column, which on a wide screen is 1312px — a scale of 1.64. Their labels
 * came out at 18.9px and their bars at 23px, so the figures read as a louder
 * document than the one they sit in, and a study of twenty coding units filled
 * a whole screen with three-unit bars.
 *
 * Nothing functional was wrong, which is why nothing caught it: every number was
 * right and every element was where it belonged. It is a question of proportion,
 * and proportion is checkable — the type inside a figure has to hold its
 * relationship to the type around it, whatever the window is doing.
 */

const CATEGORIES = ["routine", "routine.disruption", "agreement"];

async function coded(request) {
  for (const one of await (await request.get("/api/interviews")).json()) {
    const data = await (await request.get(`/api/interviews/${one.id}`)).json();
    for (const coding of data.codings) {
      await request.delete(`/api/interviews/${one.id}/codings/${coding.id}`);
    }
    const codable = data.turns.filter((turn) => !turn.interviewer && turn.text.length > 90);
    for (const [index, turn] of codable.slice(0, 4).entries()) {
      await request.post(`/api/interviews/${one.id}/codings`, {
        data: {
          turn: turn.number,
          start: 0,
          end: 60,
          category: CATEGORIES[index % CATEGORIES.length],
          text: turn.text.slice(0, 60),
          reviewed: true,
        },
      });
    }
  }
}

/** Every chart on screen, with what it was drawn at and what it is shown at. */
async function figures(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".chart svg")].map((svg) => {
      const box = svg.getBoundingClientRect();
      const drawnFor = Number((svg.getAttribute("viewBox") ?? "").split(/\s+/)[2] || svg.getAttribute("width"));
      const label = svg.querySelector(".row-label") ?? svg.querySelector("text");
      return {
        id: svg.closest("figure")?.id ?? "?",
        drawnFor,
        shownAt: box.width,
        scale: box.width / drawnFor,
        typeInside: label ? parseFloat(getComputedStyle(label).fontSize) : null,
      };
    }),
  );
}

test("a figure is never blown up past the size it was drawn at", async ({ page, request }) => {
  await coded(request);
  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#matrix-table")).toBeVisible();

  const drawn = await figures(page);
  expect(drawn.length, "there are figures to check").toBeGreaterThan(1);
  const body = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".lead")).fontSize));

  for (const figure of drawn) {
    expect(figure.scale, `${figure.id} is drawn for ${figure.drawnFor} and shown at ${Math.round(figure.shownAt)}`)
      .toBeLessThanOrEqual(1.02);
    /* And the point of that: a label inside the figure stays quieter than the
       prose around it, which is the relationship it was given. */
    expect(figure.typeInside * figure.scale, `${figure.id} type against the page`).toBeLessThan(body);
  }
});

test("on a narrow column it scales down rather than overflowing", async ({ page, request }) => {
  await coded(request);
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#matrix-table")).toBeVisible();

  for (const figure of await figures(page)) {
    expect(figure.scale, figure.id).toBeLessThanOrEqual(1.02);
    expect(figure.shownAt, `${figure.id} fits`).toBeLessThanOrEqual(900);
  }
  // The page itself must not scroll sideways to show them.
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
  ).toBe(true);
});

test("the button that saves a figure sits over the figure it saves", async ({ page, request }) => {
  await coded(request);
  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#matrix-table")).toBeVisible();

  /* This one held before the width was capped, because everything was full
     width together. It is here for the obvious next mistake: capping the chart
     and forgetting the head above it, which would leave a Save-as-SVG button
     stranded a long way from anything it could be saving. */
  const heads = page.locator(".chart-head");
  expect(await heads.count()).toBeGreaterThan(0);
  for (let index = 0; index < (await heads.count()); index += 1) {
    const head = await heads.nth(index).boundingBox();
    const chart = await page.locator(".chart").nth(index).boundingBox();
    expect(Math.round(head.width), `head ${index}`).toBeLessThanOrEqual(Math.round(chart.width) + 2);
  }
});
