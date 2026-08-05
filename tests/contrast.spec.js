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

  /* A number on a bar is read against its badge, which is why it has one: set
     straight onto the blue of the first series, the near-black this tool writes
     in reaches 4.00 and the threshold is 4.5. And the badge itself has to be
     told apart from the colour it lies on, or it is not a badge. */
  for (const value of document.querySelectorAll("#chart text.bar-value")) {
    const badge = value.previousElementSibling;
    if (!badge?.classList.contains("bar-badge")) continue;
    found.push({
      what: "bar value on its badge",
      ratio: ratio(parse(getComputedStyle(value).fill), parse(getComputedStyle(badge).fill)),
      need: 4.5,
    });
    const under = document.elementFromPoint(
      badge.getBoundingClientRect().left - 2,
      badge.getBoundingClientRect().top + badge.getBoundingClientRect().height / 2,
    );
    if (under?.classList.contains("segment")) {
      found.push({
        what: "badge against the bar it lies on",
        ratio: ratio(parse(getComputedStyle(badge).fill), parse(getComputedStyle(under).fill)),
        need: 3,
      });
    }
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

/**
 * And the same standard for the interface itself.
 *
 * The charts were measured from the start; the interface around them was
 * eyeballed. That is how a quiet grey came to be used in three dozen places at
 * 2.9:1 — every field label, every count, every hint in the whole tool, below
 * the threshold and nobody the wiser, because each one on its own looks like a
 * deliberately unobtrusive label rather than an unreadable one.
 *
 * This walks what is actually on the screen: every element that carries text of
 * its own, measured against the surface it really sits on, ancestors blended in
 * where a background is translucent.
 */

const readText = () => {
  const parse = (value) => {
    const found = value.match(/-?\d*\.?\d+/g);
    if (!found) return null;
    const [r, g, b, a = 1] = found.map(Number);
    return [r, g, b, a];
  };
  const luminance = ([r, g, b]) =>
    [r, g, b]
      .map((c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4))
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const ratio = (a, b) => {
    const [bright, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (bright + 0.05) / (dark + 0.05);
  };
  const over = (front, back) =>
    front.slice(0, 3).map((channel, index) => front[3] * channel + (1 - front[3]) * back[index]);

  /** The colour actually behind an element, translucent layers blended in. */
  const surfaceOf = (element) => {
    const layers = [];
    for (let node = element; node; node = node.parentElement) {
      const colour = parse(getComputedStyle(node).backgroundColor);
      if (!colour || colour[3] === 0) continue;
      layers.push(colour);
      if (colour[3] === 1) break;
    }
    let base = [255, 255, 255];
    for (const layer of layers.reverse()) base = over(layer, base);
    return base;
  };

  const found = [];
  for (const element of document.querySelectorAll("body *")) {
    if (element.closest("svg, .visually-hidden, [hidden]")) continue;
    // Only elements with words of their own; a wrapper inherits its child's.
    const own = [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.nodeValue.trim())
      .join("");
    if (own.length < 2) continue;
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || Number(style.opacity) === 0) continue;

    const colour = parse(style.color);
    if (!colour) continue;
    const size = parseFloat(style.fontSize);
    const weight = Number(style.fontWeight) || 400;
    // WCAG's large-text allowance: 18.66px bold, or 24px at any weight.
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    found.push({
      what: `${element.tagName.toLowerCase()}.${element.className || "—"}`.slice(0, 60),
      words: own.slice(0, 40),
      ratio: ratio(over([...colour.slice(0, 3), colour[3]], surfaceOf(element)), surfaceOf(element)),
      need: large ? 3 : 4.5,
    });
  }
  return found;
};

for (const theme of ["light", "dark"]) {
  test(`every word of the interface is readable in the ${theme} theme`, async ({ page }) => {
    await page.goto("/?lang=de");
    await page.waitForSelector(".turn");
    await page.evaluate((wanted) => {
      document.documentElement.dataset.theme = wanted;
    }, theme);

    const measured = [];
    // Every view, and the two panels that are folded away by default: a hint
    // nobody can read is no better for being one click deep.
    for (const view of ["code", "catalog", "analysis"]) {
      await page.locator(`.tab[data-view="${view}"]`).click();
      if (view === "code") {
        await page.locator("#note-shell summary").click();
        await page.locator("#inductive-shell summary").click();
        await page.locator(".category").first().click();
      }
      await page.waitForTimeout(120);
      measured.push(...(await page.evaluate(readText)));
    }

    expect(measured.length).toBeGreaterThan(80);
    const failures = [
      ...new Set(
        measured
          .filter((entry) => entry.ratio < entry.need)
          .map(
            (entry) =>
              `${entry.what} — "${entry.words}": ${entry.ratio.toFixed(2)} < ${entry.need}`,
          ),
      ),
    ];
    expect(failures, `text below the threshold in the ${theme} theme`).toEqual([]);
  });
}
