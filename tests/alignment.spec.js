import { expect, test } from "@playwright/test";

/**
 * The edges the eye follows down a page.
 *
 * A reader scanning the evaluation follows one line down the right-hand side.
 * There were three: the metric row and the figures ran to 78rem, the tables
 * stopped at 64rem, and the prose at 46rem. Two of those are a decision — text
 * cannot be read at 78rem — and one was a stray number, so the cross table
 * ended 92 pixels short of the heading printed above it and the legend printed
 * below it, and the page read as three pages that had failed to line up.
 *
 * These checks hold the two remaining widths apart on purpose: everything that
 * carries data ends on one line, and running text is visibly and deliberately
 * narrower. What they catch is the third width creeping back.
 */

const edge = (locator) => locator.evaluate((el) => Math.round(el.getBoundingClientRect().right));
const start = (locator) => locator.evaluate((el) => Math.round(el.getBoundingClientRect().left));

test("everything in the evaluation that carries data ends on one line", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.goto("/#/analysis");
  await expect(page.locator("#matrix-table")).toBeVisible();

  const analysis = page.locator("#analysis");
  const right = await edge(analysis.locator("h2").first());

  for (const selector of [".metrics", ".chart-head", ".table-frame", ".legend"]) {
    const block = analysis.locator(selector).first();
    expect(await edge(block), `${selector} ends where the heading ends`).toBe(right);
    expect(await start(block), `${selector} begins where the heading begins`).toBe(
      await start(analysis.locator("h2").first()),
    );
  }

  // And the running text keeps its own measure rather than joining them.
  expect(await edge(analysis.locator("p.lead").first())).toBeLessThan(right - 100);
});

/**
 * The left column, where a number belongs to a name and a label belongs to a
 * value. Both pairs used to come apart as soon as the longer half wrapped.
 */
test("a block number sits on the first line of its name", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.goto("/");
  await expect(page.locator(".section-entry").first()).toBeVisible();

  // The one whose name runs to two lines in this column. Its number has to sit
  // on the first of them, not floating between the two.
  const wrapped = page.locator(".section-entry").filter({ hasText: "Werkzeuge und Ablage" });
  const rows = await wrapped.evaluate((entry) => {
    const num = entry.querySelector(".num").getBoundingClientRect();
    const name = entry.querySelector(".name").getBoundingClientRect();
    return {
      wrapped: name.height > num.height * 1.6,
      numTop: Math.round(num.top),
      nameTop: Math.round(name.top),
    };
  });
  expect(rows.wrapped, "the name does wrap in this column").toBe(true);
  expect(Math.abs(rows.numTop - rows.nameTop)).toBeLessThanOrEqual(4);
});

test("the interview's own header lines up in two columns, not four", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.goto("/");
  const meta = page.locator("#interview-meta");
  await expect(meta).toBeVisible();

  const columns = await meta.evaluate((el) => {
    const rows = [...el.querySelectorAll(":scope > div")];
    return rows.map((row) => {
      const [label, value] = row.querySelectorAll("span");
      return {
        labelLeft: Math.round(label.getBoundingClientRect().left),
        valueLeft: Math.round(value.getBoundingClientRect().left),
      };
    });
  });
  expect(columns.length).toBeGreaterThan(1);
  // Every label on one edge, every value on one edge — including the value
  // long enough to wrap, whose second line then falls under its own first.
  expect(new Set(columns.map((c) => c.labelLeft)).size).toBe(1);
  expect(new Set(columns.map((c) => c.valueLeft)).size).toBe(1);
});

/**
 * A heading in the right-hand column carries a plus or a minus saying whether
 * it is open. That is a sign standing beside the heading, and a heading long
 * enough to wrap used to set its second line underneath the sign — marker and
 * text sharing one column, which is the one thing a marker must not do.
 */
test("a wrapped disclosure heading hangs its marker outside the text", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.goto("/");
  const summary = page.locator("#codebook-shell > summary");
  await expect(summary).toBeVisible();

  const lines = await summary.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const boxes = [...range.getClientRects()].filter((box) => box.width > 1);
    return boxes.map((box) => Math.round(box.left));
  });
  expect(lines.length, "the heading does wrap in this column").toBeGreaterThan(1);
  expect(new Set(lines).size, "every line of it starts on one edge").toBe(1);
});

/**
 * The button under the status count. It inherited the column's 1.7 line
 * spacing, which is right for a running count and turns a three-line label
 * into a slab.
 */
test("the jump button is a label, not a paragraph", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.goto("/");
  const jump = page.locator("#jump");
  await expect(jump).toBeVisible();
  const spacing = await jump.evaluate((el) => {
    const style = getComputedStyle(el);
    return parseFloat(style.lineHeight) / parseFloat(style.fontSize);
  });
  expect(spacing).toBeLessThan(1.5);
});
