import { expect, test } from "@playwright/test";

/**
 * Room to read what is on the screen, and the place one was reading it from.
 *
 * Five separate ways the tool cut something off or lost it, each of which
 * looked like a small thing and each of which cost the same person the same
 * minute again and again:
 *
 * — the header of a transcript, laid out in two columns inside a sidebar too
 *   narrow for the longest label a transcript may carry, so the value column
 *   collapsed to nothing and „28. Juli 2026" came down the side one character
 *   per line;
 * — a working note shown two rows at a time, with the top halves of the third
 *   row showing through the padding under it;
 * — the number tables behind the figures, wider than their frame, scrolling
 *   without a mark to say so, so a table that ran to eleven categories looked
 *   like a table of nine;
 * — two arrows for stepping between search hits, offered before there was a
 *   search, and a jump to the next uncoded turn offered after the last one had
 *   been coded;
 * — and the catalog, the role profiles and the evaluation, all of which began
 *   at the top again after every reload while the coding view remembered.
 */

const box = (locator) => locator.evaluate((el) => el.getBoundingClientRect());

/* The transcript header ---------------------------------------------------- */

test("a line of the interview header gets the width of the column, however it is labelled", async ({
  page,
}) => {
  await page.goto("/");
  const meta = page.locator("#interview-meta");
  await expect(meta).toBeVisible();

  const room = (await box(meta)).width;
  const rows = meta.locator("> div");
  const count = await rows.count();
  expect(count, "the fixtures carry a header to lay out").toBeGreaterThan(0);

  for (let index = 0; index < count; index++) {
    const label = rows.nth(index).locator("span").first();
    const value = rows.nth(index).locator("span").last();
    const name = await label.textContent();

    // The value gets the whole column, not what the label leaves it.
    expect(Math.round((await box(value)).width), `„${name}" has room for its value`).toBe(
      Math.round(room),
    );
    // And every label starts on the same line as every other.
    expect(Math.round((await box(label)).left), `„${name}" starts at the column edge`).toBe(
      Math.round((await box(meta)).left),
    );
  }
});

test("a label longer than the column does not squeeze the value out of it", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#interview-meta")).toBeVisible();

  // A header line whose label alone is wider than the sidebar — the shape that
  // used to collapse the value to zero.
  const width = await page.evaluate(() => {
    const meta = document.querySelector("#interview-meta");
    const row = document.createElement("div");
    row.innerHTML =
      `<span class="field-label">Nachweis der maschinellen Eingriffe am Transkript</span>` +
      `<span>28. Juli 2026, Dauer 52:41</span>`;
    meta.append(row);
    const value = Math.round(row.lastElementChild.getBoundingClientRect().width);
    row.remove();
    return value;
  });

  // Wide enough for the words to break at spaces rather than between letters.
  expect(width).toBeGreaterThan(120);
});

/* Notes -------------------------------------------------------------------- */

/* Long enough to need more rows than the field is given, which is the length
   every working note in a real study reaches. */
const LONG =
  "Zusammenführung dreier Scheiterwege. Der eine Bereich externalisiert nicht, " +
  "der zweite externalisiert privat, der dritte überführt ohne einheitlichen Weg " +
  "und findet für kurze, noch nicht ausgearbeitete Themen gar keinen Ort. " +
  "Bestätigt am 03.08.2026 als Must, konstitutiv für die zweite Teilfrage.";

async function requirementWithNotes(request) {
  const { requirements } = await (await request.get("/api/requirements")).json();
  for (const one of requirements) await request.delete(`/api/requirements/${one.id}`);
  const answer = await request.post("/api/requirements", {
    data: { title: "Ein Ort, an dem die aktuelle Fassung steht" },
  });
  const body = await answer.json();
  const id = body.id ?? body.requirement?.id;
  await request.patch(`/api/requirements/${id}`, {
    data: { definition: LONG, description: LONG },
  });
  return id;
}

test("a note is as tall as what is written in it, in every place one is written", async ({
  page,
  request,
}) => {
  await requirementWithNotes(request);
  await page.goto("/#/catalog");
  await expect(page.locator(".requirement").first()).toBeVisible();

  const cut = await page.evaluate(() =>
    [...document.querySelectorAll("textarea")]
      .filter((field) => field.offsetParent && field.value.trim())
      .filter((field) => field.scrollHeight - field.clientHeight > 1)
      .map((field) => `${field.className || field.id}: ${field.value.slice(0, 40)}`),
  );
  expect(cut, "no note shows only part of itself").toEqual([]);
});

test("the definition and the note beside it are framed alike", async ({ page, request }) => {
  await requirementWithNotes(request);
  await page.goto("/#/catalog");
  const card = page.locator(".requirement").first();
  await expect(card).toBeVisible();

  const style = (locator) =>
    locator.evaluate((el) => {
      const cs = getComputedStyle(el);
      return `${cs.paddingLeft}|${cs.borderLeftWidth}|${cs.fontSize}|${cs.fontFamily}`;
    });

  expect(await style(card.locator("textarea.definition"))).toBe(
    await style(card.locator("textarea.description")),
  );
  expect(Math.round((await box(card.locator("textarea.definition"))).left)).toBe(
    Math.round((await box(card.locator("textarea.description"))).left),
  );
});

/* Tables wider than their frame -------------------------------------------- */

test("a table wider than its frame says that it goes on", async ({ page }) => {
  await page.goto("/#/analysis");
  await expect(page.locator("#matrix-table")).toBeVisible();

  // The frame is what scrolls, and the shade that says so is painted on it —
  // a `scroll` layer the content cannot cover once it has been moved.
  const painted = await page.locator(".table-frame").first().evaluate((el) => {
    const image = getComputedStyle(el).backgroundImage;
    return { scrolls: el.scrollWidth > el.clientWidth + 1, image };
  });
  expect(painted.image, "the frame carries the scroll shade").toContain("radial-gradient");
});

test("a column of numbers and the heading over it are set to the same edge", async ({ page }) => {
  for (const view of ["analysis", "roles", "catalog"]) {
    await page.goto(`/#/${view}`);
    await expect(page.locator(`#view-${view} h2`).first()).toBeVisible();
    // Every table this view has, including the figures folded away under them.
    await page.evaluate(() => {
      document.querySelectorAll("details").forEach((one) => {
        one.open = true;
      });
    });
    await page.waitForTimeout(200);

    const apart = await page.evaluate((view) => {
      const out = [];
      for (const table of document.querySelectorAll(`#view-${view} table`)) {
        const heads = [...table.querySelectorAll("thead th")];
        const first = table.querySelector("tbody tr");
        if (!first) continue;
        const cells = [...first.children];
        heads.forEach((head, index) => {
          const cell = cells[index];
          if (!cell) return;
          if (getComputedStyle(head).textAlign !== getComputedStyle(cell).textAlign) {
            out.push(`${view}: „${head.textContent.trim()}"`);
          }
        });
      }
      return out;
    }, view);
    expect(apart, "no heading stands over the column beside it").toEqual([]);
  }
});

/* Controls that have something to do ---------------------------------------- */

test("the arrows between hits appear when there is a second hit to step to", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#transcript .turn").first()).toBeVisible();

  await expect(page.locator("#search-next")).toBeHidden();
  await expect(page.locator("#search-previous")).toBeHidden();

  await page.fill("#search", "zzzqqq");
  await expect(page.locator("#search-status")).not.toBeEmpty();
  await expect(page.locator("#search-next"), "nothing found, nowhere to step").toBeHidden();

  // A word the fixtures say more than once.
  await page.fill("#search", "und");
  await expect(page.locator("#search-next")).toBeVisible();
  await expect(page.locator("#search-previous")).toBeVisible();

  await page.fill("#search", "");
  await expect(page.locator("#search-next")).toBeHidden();
});

/* The place one was reading from -------------------------------------------- */

for (const view of ["catalog", "roles", "analysis"]) {
  test(`the ${view} comes back to where it was being read`, async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 700 });
    await page.goto(`/#/${view}`);
    const container = page.locator(`#view-${view}`);
    await expect(container.locator("h2").first()).toBeVisible();

    const reach = await container.evaluate((el) => el.scrollHeight - el.clientHeight);
    test.skip(reach < 200, "this fixture study does not fill the view");

    const wanted = Math.round(reach * 0.6);
    await container.evaluate((el, top) => el.scrollTo({ top, behavior: "instant" }), wanted);
    // The place is written down once the scrolling settles, not on every pixel.
    await page.waitForTimeout(400);

    await page.reload();
    await expect(container.locator("h2").first()).toBeVisible();
    await expect
      .poll(async () => container.evaluate((el) => Math.round(el.scrollTop)), {
        message: "the view opens where it was left",
      })
      .toBeGreaterThan(wanted - 200);
  });
}

test("the coding view still keeps its own place", async ({ page }) => {
  await page.goto("/#/analysis");
  await expect(page.locator("#view-analysis h2").first()).toBeVisible();
  await page.locator('.tab[data-view="code"]').click();

  const edition = page.locator(".edition");
  await edition.evaluate((el) => el.scrollTo({ top: 600, behavior: "instant" }));
  await page.waitForTimeout(400);

  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#view-analysis h2").first()).toBeVisible();
  await page.locator('.tab[data-view="code"]').click();

  expect(await edition.evaluate((el) => Math.round(el.scrollTop))).toBeGreaterThan(400);
});
