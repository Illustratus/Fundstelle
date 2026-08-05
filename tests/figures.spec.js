import { expect, test } from "@playwright/test";

/**
 * The size a figure is drawn at.
 *
 * These charts are authored 720 units wide with 10 to 11.5px type. They were
 * held to that size for a while, and this file used to check it: stretched to a
 * 1312px column they come out at 1.64×, labels at 18.9px against a 15px page,
 * and a figure whose type is louder than the type around it makes the page two
 * documents.
 *
 * That is still true and is the accepted cost. Held to 720 the labels are the
 * same width on a 27-inch screen as on a laptop — a category name cut at 30
 * characters, a heatmap column 57 units wide — with the rest of the column left
 * white, and reading the figure was the thing being paid for. So the figures
 * take the column now.
 *
 * What is checked here is what taking the column must not cost. The drawing is
 * a viewBox, so scaling can reflow nothing and cut nothing off: the figure fills
 * its column exactly, it never makes the page scroll sideways, and the head with
 * the save button stays over the figure it belongs to.
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
        // The room inside the column, not the column: the container has padding,
        // and a figure filling that too would be a figure in the margin.
        column: (() => {
          const holder = svg.closest("figure").parentElement;
          const style = getComputedStyle(holder);
          return (
            holder.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
          );
        })(),
        typeInside: label ? parseFloat(getComputedStyle(label).fontSize) : null,
      };
    }),
  );
}

test("a figure fills the column it is in, and no more", async ({ page, request }) => {
  await coded(request);
  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#matrix-table")).toBeVisible();

  const drawn = await figures(page);
  expect(drawn.length, "there are figures to check").toBeGreaterThan(1);

  for (const figure of drawn) {
    /* Exactly the column: a figure narrower than its column is the width cap
       come back by accident, and one wider is a figure hanging out of the page.
       Half a pixel of slack, because a column width is rarely a round number. */
    expect(
      Math.abs(figure.shownAt - figure.column),
      `${figure.id} is ${Math.round(figure.shownAt)} wide in a ${Math.round(figure.column)} column`,
    ).toBeLessThan(1);
  }
});

test("on a narrow column it scales down rather than overflowing", async ({ page, request }) => {
  await coded(request);
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#matrix-table")).toBeVisible();

  for (const figure of await figures(page)) {
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

  /* Here for the obvious mistake in either direction: giving the chart a width
     the head above it does not have, which leaves a Save-as-SVG button stranded
     a long way from anything it could be saving. */
  const heads = page.locator(".chart-head");
  expect(await heads.count()).toBeGreaterThan(0);
  for (let index = 0; index < (await heads.count()); index += 1) {
    const head = await heads.nth(index).boundingBox();
    const chart = await page.locator(".chart").nth(index).boundingBox();
    expect(Math.round(head.width), `head ${index}`).toBeLessThanOrEqual(Math.round(chart.width) + 2);
  }
});

/**
 * The tip that follows the pointer.
 *
 * Two things changed at once and met here. The figures take the whole column
 * now, so the last cell of a heatmap is a few pixels from the right edge of the
 * window rather than a few hundred — hovering there is the ordinary case. And a
 * tip is not always short: a saturation point names every category that first
 * turned up at that interview, and a heatmap cell carries a category name in
 * full where the row label beside it was cut to thirty characters.
 *
 * Set `nowrap` and placed to the right of the pointer, the two together put the
 * end of the sentence outside the window — and the end is the part somebody
 * hovered to read.
 */
async function tipFor(page, mark) {
  await mark.hover();
  const tip = page.locator(".chart-tip:not([hidden])").first();
  await expect(tip).toBeVisible();
  return {
    box: await tip.boundingBox(),
    text: await tip.textContent(),
    window: await page.evaluate(() => document.documentElement.clientWidth),
  };
}

test("a tip stays inside the window, wherever it is called up", async ({ page, request }) => {
  await coded(request);
  /* A name long enough that its tip cannot fit beside a pointer at the right
     edge — real, because a category named for the distinction it draws is how
     long names get, not a string invented to break something. */
  const long = "Zusammenarbeit über Bereiche hinweg und was sie im Alltag aufhält";
  await request.post("/api/categories", { data: { name: long } });
  const { categories } = await (await request.get("/api/categories")).json();
  const made = categories.find((one) => one.name === long);

  const interviews = await (await request.get("/api/interviews")).json();
  const data = await (await request.get(`/api/interviews/${interviews[0].id}`)).json();
  const turn = data.turns.filter((one) => !one.interviewer && one.text.length > 90).at(-1);
  const coding = await (
    await request.post(`/api/interviews/${interviews[0].id}/codings`, {
      data: {
        turn: turn.number,
        start: 0,
        end: 60,
        category: made.id,
        text: turn.text.slice(0, 60),
        reviewed: true,
      },
    })
  ).json();

  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#matrix-table")).toBeVisible();

  const marks = page.locator("#chart .segment, #heatmap .cell");
  const count = await marks.count();
  expect(count, "there is something to hover").toBeGreaterThan(1);

  for (let index = 0; index < count; index += 1) {
    const { box, text, window: width } = await tipFor(page, marks.nth(index));
    expect(box.x, `"${text}" starts inside the window`).toBeGreaterThanOrEqual(0);
    expect(
      Math.round(box.x + box.width),
      `"${text}" ends inside the window (${width})`,
    ).toBeLessThanOrEqual(width);
  }

  /* On a full window the long one is simply put on the other side of the
     pointer, which is better than wrapping and is what happens. Wrapping is the
     floor under that, and the floor is only reached where the sentence is wider
     than the whole window — so the window is made narrow enough to reach it.
     Not a contrived case: it is a laptop beside another window. */
  await page.setViewportSize({ width: 460, height: 900 });
  await expect(page.locator("#chart svg")).toBeVisible();
  const narrow = page.locator("#chart .segment").last();
  const { box, text, window: width } = await tipFor(page, narrow);
  expect(Math.round(box.x + box.width), `"${text}" ends inside ${width}`).toBeLessThanOrEqual(width);
  expect(box.x, "and starts inside it").toBeGreaterThanOrEqual(0);
  // Broken across lines rather than cut off: one line of this type is ~22px.
  expect(box.height, `"${text}" wrapped`).toBeGreaterThan(28);

  /* Put back, in the order the tool allows: a category still carrying a unit
     cannot be deleted, so the unit goes first. Without this the long name stays
     in the shared sandbox and turns up much later as a Pandoc grid table seven
     characters too wide — a failure with nothing in it pointing back here. */
  await request.delete(`/api/interviews/${interviews[0].id}/codings/${coding.id}`);
  const gone = await request.delete(`/api/categories/${encodeURIComponent(made.id)}`);
  expect(gone.status(), "the category this check made is put back").toBe(204);
});
