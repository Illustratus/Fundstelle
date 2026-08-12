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
    // The links themselves, not the block they sit in: what is still open
    // shares that block and belongs on the page. See the check below.
    exports: [...document.querySelectorAll(".exports a")].some(
      (link) => link.offsetParent !== null,
    ),
    exportHeading: document.querySelector(".exports-part h3")?.offsetParent !== null,
  }));
  expect(left.controls, "nothing to press on paper").toBe(0);
  expect(left.header).toBe(false);
  expect(left.filter).toBe(false);
  expect(left.exports).toBe(false);
  expect(left.exportHeading, "a heading whose content is buttons is not a section").toBe(false);

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


/**
 * What is still missing from the study is printed, and is the one thing in the
 * export block that is.
 *
 * „A heading whose only content is buttons is not a section on paper" was the
 * reason the whole block was dropped — and the block held one thing that is not
 * a control: the study saying what is incomplete about it. „Three categories
 * have no anchor example yet." The supervisor never sees the screen; the
 * appendix is the only place that sentence reaches her, and it is the sentence
 * she is looking for.
 */
test("what is still open goes on the paper, the export buttons do not", async ({
  page,
  request,
}) => {
  // Coded, confirmed, and with no anchor example anywhere — the gap the list
  // is there to name.
  await withCodings(page, request);
  await expect(page.locator(".exports-part .still-open li").first()).toBeVisible();
  const said = await page.locator(".exports-part .still-open li").first().textContent();

  await page.emulateMedia({ media: "print" });

  const onPaper = await page.evaluate(() => {
    const part = document.querySelector(".exports-part");
    return {
      list: document.querySelector(".still-open")?.getClientRects().length > 0,
      shown: [...part.children]
        .filter((child) => child.getClientRects().length)
        .map((child) => child.tagName.toLowerCase()),
    };
  });
  expect(onPaper.list, "the gap is on the page").toBe(true);
  expect(onPaper.shown, "and nothing else out of that block is").toEqual(["ul"]);
  expect(said).toMatch(/\S/);
});

/**
 * Only the view standing in front of the reader is the document.
 *
 * The rule above that lets the scrolling views out to their full length names
 * them by id, and an id beats `.view[hidden]`. So every view that had been
 * *visited* came back for the printer: whoever looked at the catalog, then at
 * the role profiles, then printed the evaluation got the catalog and the
 * profiles printed in front of it. Nothing on screen suggested it, and what
 * comes out of this printer goes into an appendix.
 */
test("only the view on screen goes to the printer", async ({ page, request }) => {
  await withCodings(page, request);
  // The path that used to bring them back: visit them, then print another.
  await page.locator('.tab[data-view="catalog"]').click();
  await expect(page.locator("#catalog h2")).toBeVisible();
  await page.locator('.tab[data-view="roles"]').click();
  await expect(page.locator("#roles h2")).toBeVisible();
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#chart svg")).toBeVisible();

  await page.emulateMedia({ media: "print" });

  const printed = await page.evaluate(() =>
    ["view-code", "view-catalog", "view-roles", "view-analysis"]
      .filter((id) => document.getElementById(id).getClientRects().length > 0)
      .join(", "),
  );
  expect(printed, "the evaluation, and nothing standing behind it").toBe("view-analysis");
});

/**
 * A card that has been filled in must not print as the blank form for one.
 *
 * The panels that are nothing but controls are hidden for the printer. The
 * fields that carry the work were left dressed as fields, so a requirement
 * with a definition and a working note came off the printer as two framed
 * boxes with resize grips and a dropdown — the same ink a wholly empty card
 * would have made.
 */
test("a field that carries something written prints as what is written", async ({
  page,
  request,
}) => {
  const { requirements } = await (await request.get("/api/requirements")).json();
  for (const one of requirements) await request.delete(`/api/requirements/${one.id}`);
  const made = await (
    await request.post("/api/requirements", { data: { title: "Ein Ort für die aktuelle Fassung" } })
  ).json();
  const id = made.id ?? made.requirement?.id;
  await request.patch(`/api/requirements/${id}`, {
    data: { definition: "Die Zahl der Orte wird auf einen reduziert.", description: "Stand 07.08." },
  });

  await page.goto("/?lang=de#/catalog");
  const card = page.locator(".requirement").first();
  await expect(card).toBeVisible();
  await page.emulateMedia({ media: "print" });

  const note = card.locator("textarea.definition");
  // The words are still there …
  await expect(note).toHaveValue("Die Zahl der Orte wird auf einen reduziert.");
  // … and nothing around them says „type here".
  const dressed = await note.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { border: cs.borderTopWidth, resize: cs.resize, background: cs.backgroundColor };
  });
  expect(dressed.border).toBe("0px");
  expect(dressed.resize).toBe("none");

  // And a form nobody can fill in on paper is gone altogether.
  const forms = await page.evaluate(() =>
    ["#inductive-shell", "#codebook-shell", ".search-bar"].filter(
      (selector) => document.querySelector(selector)?.getClientRects().length,
    ),
  );
  expect(forms, "no empty form on paper").toEqual([]);
});
