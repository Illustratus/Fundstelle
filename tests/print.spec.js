import { expect, test } from "@playwright/test";

/**
 * What comes out of a printer.
 *
 * A cross table or a coding guide goes to a supervisor on paper, so this is a
 * real step of the work rather than an afterthought. Printing turned out to
 * work without any help — the browser expands the scrolling column and the
 * analysis flows across pages. What it printed was the application, though: a
 * navigation bar, a Save-as-SVG button beside every chart, the whole citation
 * filter with its dropdowns, a button on every card. None of that can be
 * pressed on paper.
 */

const FIRST = "interview-01";

async function withCodings(page, request) {
  const transcript = await (await request.get(`/api/interviews/${FIRST}`)).json();
  for (const coding of transcript.codings) {
    await request.delete(`/api/interviews/${FIRST}/codings/${coding.id}`);
  }
  const categories = (await (await request.get("/api/categories")).json()).categories;
  const codable = transcript.turns
    .filter((turn) => !turn.interviewer && turn.text.length > 60)
    .slice(0, 8);
  for (const [index, turn] of codable.entries()) {
    await request.post(`/api/interviews/${FIRST}/codings`, {
      data: {
        turn: turn.number,
        start: 0,
        end: 45,
        category: categories[index % categories.length].id,
        text: turn.text.slice(0, 45),
        reviewed: true,
      },
    });
  }
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#chart svg")).toBeVisible();
}

test("the paper carries the document, not the controls", async ({ page, request }) => {
  await withCodings(page, request);
  await page.emulateMedia({ media: "print" });

  const left = await page.evaluate(() => ({
    controls: [...document.querySelectorAll("button, select, input")].filter(
      (element) => element.offsetParent !== null,
    ).length,
    header: document.querySelector(".header")?.offsetParent !== null,
    filter: document.querySelector(".citation-filter")?.offsetParent !== null,
    exports: document.querySelector(".exports-part")?.offsetParent !== null,
  }));
  expect(left.controls, "nothing to press on paper").toBe(0);
  expect(left.header).toBe(false);
  expect(left.filter).toBe(false);
  expect(left.exports).toBe(false);

  // What is meant to be read is still there.
  await expect(page.locator("#matrix-table")).toBeVisible();
  await expect(page.locator("#chart svg")).toBeVisible();
  await expect(page.locator(".citation").first()).toBeVisible();
});

test("what is folded away is printed open", async ({ page, request }) => {
  await withCodings(page, request);
  // A disclosure cannot be clicked on paper, so a number inside one would
  // simply not be printed.
  await expect(page.locator("#heatmap-figures")).toHaveJSProperty("open", false);

  await page.emulateMedia({ media: "print" });
  const visible = await page
    .locator("#heatmap-figures table")
    .evaluate((table) => table.offsetParent !== null);
  expect(visible).toBe(true);
});

test("a page printed from the dark theme is not a page of ink", async ({ page, request }) => {
  await withCodings(page, request);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.emulateMedia({ media: "print" });

  const brightness = (colour) => {
    const [r, g, b] = colour.match(/\d+/g).map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  const paper = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(brightness(paper)).toBeGreaterThan(240);

  /* And the heatmap ramp runs the right way. Its dark steps go from dark to
     light, so a heatmap printed from the dark theme showed its largest cell as
     the palest one — on paper that is a wrong reading, not a different look. */
  const ramp = await page.evaluate(() =>
    [...document.querySelectorAll(".chart-legend.ramp i")].map(
      (swatch) => getComputedStyle(swatch).backgroundColor,
    ),
  );
  expect(ramp.length).toBeGreaterThan(2);
  expect(brightness(ramp[0])).toBeGreaterThan(brightness(ramp.at(-1)));
});
