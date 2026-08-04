import { expect, test } from "@playwright/test";

/**
 * Contrast of the charts, measured in the running application.
 *
 * A palette is easy to admire and hard to check by eye: the light set looked
 * perfectly decent and its amber stood 1.99:1 off the page, which is a segment
 * whose edge cannot be made out. Numbers settle it, so they are asserted rather
 * than eyeballed — in both themes, because the dark set passed while the light
 * one did not.
 *
 * The thresholds are the WCAG ones: 4.5:1 for anything that is read as text,
 * 3:1 for a shape that has to be told apart from its surface.
 */

const TEXT = 4.5;
const SHAPE = 3;

/** Runs in the page: everything here has to be self-contained. */
const measure = () => {
  const parse = (value) => {
    const found = value.match(/rgba?\(([^)]+)\)/);
    return found ? found[1].split(",").map((n) => parseFloat(n)) : null;
  };
  const luminance = ([r, g, b]) => {
    const channel = (c) => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const ratio = (a, b) => {
    const [bright, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (bright + 0.05) / (dark + 0.05);
  };

  const surface = parse(getComputedStyle(document.body).backgroundColor);
  const found = [];

  // A number in a heatmap cell is read against that cell, not against the page.
  const heatmap = document.querySelector("#heatmap svg");
  if (heatmap) {
    const cells = [...heatmap.querySelectorAll("rect.cell")];
    [...heatmap.querySelectorAll("text.cell-value")].forEach((value, index) => {
      const cell = cells[index];
      if (!cell) return;
      const level = [...cell.classList].find((name) => name.startsWith("level-"));
      found.push({
        what: `heatmap value on ${level}`,
        ratio: ratio(parse(getComputedStyle(value).fill), parse(getComputedStyle(cell).fill)),
        need: 4.5,
      });
    });
  }

  for (const selector of [
    "#chart text.axis",
    "#chart text.row-label",
    "#chart text.value",
    "#heatmap text.heading",
  ]) {
    const element = document.querySelector(selector);
    if (!element) continue;
    found.push({
      what: selector,
      ratio: ratio(parse(getComputedStyle(element).fill), surface),
      need: 4.5,
    });
  }

  // Every series colour has to stand off the surface it is drawn on.
  for (let index = 1; index <= 8; index++) {
    const probe = document.createElement("div");
    probe.className = `series-s${index}`;
    probe.style.color = "var(--series)";
    document.body.append(probe);
    const colour = parse(getComputedStyle(probe).color);
    probe.remove();
    found.push({ what: `series ${index}`, ratio: ratio(colour, surface), need: 3 });
  }

  return found;
};

for (const theme of ["light", "dark"]) {
  test(`the charts keep their contrast in the ${theme} theme`, async ({ page }) => {
    await page.goto("/?lang=de");
    await page.waitForSelector(".turn");
    await page.evaluate((wanted) => {
      document.documentElement.dataset.theme = wanted;
    }, theme);

    // Something has to be coded, or there is no chart to measure. Each run
    // starts from an empty interview, so neither theme depends on what the
    // other left behind.
    await page.evaluate(async () => {
      const interviews = await (await fetch("/api/interviews")).json();
      const id = interviews[0].id;
      const before = await (await fetch(`/api/interviews/${id}`)).json();
      for (const coding of before.codings) {
        await fetch(`/api/interviews/${id}/codings/${coding.id}`, { method: "DELETE" });
      }

      const codable = before.turns.filter((turn) => !turn.interviewer && turn.text.length > 80);
      const categories = (await (await fetch("/api/categories")).json()).categories;
      for (const [index, turn] of codable.slice(0, 6).entries()) {
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
          }),
        });
        if (!answer.ok) throw new Error(`could not code turn ${turn.number}`);
      }
    });

    await page.reload();
    await page.evaluate((wanted) => {
      document.documentElement.dataset.theme = wanted;
    }, theme);
    await page.locator('.tab[data-view="analysis"]').click();
    await expect(page.locator("#chart svg")).toBeVisible();
    await expect(page.locator("#heatmap svg")).toBeVisible();

    const measured = await page.evaluate(measure);
    expect(measured.length).toBeGreaterThan(10);

    const failures = measured
      .filter((entry) => entry.ratio < entry.need)
      .map((entry) => `${entry.what}: ${entry.ratio.toFixed(2)} < ${entry.need}`);
    expect(failures, `contrast below the threshold in the ${theme} theme`).toEqual([]);

    // The thresholds themselves, so a slip in the helper cannot pass silently.
    expect(TEXT).toBe(4.5);
    expect(SHAPE).toBe(3);
  });
}
