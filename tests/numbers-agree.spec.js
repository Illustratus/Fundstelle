import { expect, test } from "@playwright/test";

/**
 * The numbers on the screen say what the data says.
 *
 * This is a tool for counting where evidence sits, so a count that quietly
 * drifts from what is stored is its worst possible defect: nothing looks wrong,
 * and the figure walks into the paper. The exports are already read back and
 * compared; this does the same for the screen, which is where the figure is
 * first believed.
 *
 * Every check reads both sides — the rendered text and the API the view is
 * drawn from — and compares. Nothing here asserts a literal number, because a
 * literal would only pin this fixture rather than the agreement itself.
 */

const FIRST = "interview-01";
const SECOND = "interview-02";

test.beforeEach(async ({ request }) => {
  for (const interview of [FIRST, SECOND]) {
    const data = await (await request.get(`/api/interviews/${interview}`)).json();
    for (const coding of data.codings) {
      await request.delete(`/api/interviews/${interview}/codings/${coding.id}`);
    }
  }
  // A study with something in it, and some of it left as suggestions.
  const categories = (await (await request.get("/api/categories")).json()).categories;
  for (const interview of [FIRST, SECOND]) {
    const transcript = await (await request.get(`/api/interviews/${interview}`)).json();
    const codable = transcript.turns.filter(
      (turn) => !turn.interviewer && turn.text.length > 60,
    );
    for (const [index, turn] of codable.entries()) {
      await request.post(`/api/interviews/${interview}/codings`, {
        data: {
          turn: turn.number,
          start: 0,
          end: 45,
          category: categories[index % categories.length].id,
          text: turn.text.slice(0, 45),
          reviewed: index % 3 !== 0,
        },
      });
    }
  }
});

test("the status bar counts what the interview holds", async ({ page }) => {
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");

  const current = await page.locator("#interview-choice").inputValue();
  const data = await page.evaluate(async (id) => {
    const interview = await (await fetch(`/api/interviews/${id}`)).json();
    const codable = interview.turns.filter((turn) => !turn.interviewer);
    const touched = new Set(interview.codings.map((coding) => coding.turn));
    return {
      codings: interview.codings.length,
      codable: codable.length,
      touched: codable.filter((turn) => touched.has(turn.number)).length,
      sections: interview.sections.length,
      open: interview.codings.filter(
        (coding) => coding.reviewed !== true && coding.state !== "lost",
      ).length,
    };
  }, current);

  const status = await page.locator("#status").innerText();
  expect(status).toContain(`${data.codings} Kodiereinheiten`);
  expect(status).toContain(`${data.touched} von ${data.codable} Beiträgen`);
  expect(status).toContain(`${data.sections} Blöcke`);
  expect(data.open).toBeGreaterThan(0);
  expect(status).toContain(`${data.open} noch ungeprüft`);
});

test("the category panel counts the codings of the interview on screen", async ({ page }) => {
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");

  const current = await page.locator("#interview-choice").inputValue();
  const stored = await page.evaluate(async (id) => {
    const interview = await (await fetch(`/api/interviews/${id}`)).json();
    const counted = {};
    for (const coding of interview.codings) {
      counted[coding.category] = (counted[coding.category] ?? 0) + 1;
    }
    return counted;
  }, current);

  const shown = await page.evaluate(() =>
    [...document.querySelectorAll(".category")].map((element) => ({
      id: element.dataset.category,
      count: Number(element.querySelector(".count")?.textContent ?? -1),
    })),
  );
  expect(shown.length).toBeGreaterThan(0);
  for (const entry of shown) {
    expect(entry.count, `panel count for ${entry.id}`).toBe(stored[entry.id] ?? 0);
  }
});

test("the metrics of the analysis count the whole study", async ({ page }) => {
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#chart svg")).toBeVisible();

  const data = await page.evaluate(async () => {
    const analysis = await (await fetch("/api/analysis")).json();
    const all = Object.values(analysis.citations).flat();
    return {
      total: analysis.total,
      departments: analysis.departments.length,
      interviews: analysis.progress.length,
      reviewed: Math.round((all.filter((one) => one.reviewed).length / all.length) * 100),
      inductive: analysis.categories.filter((one) => one.origin === "inductive").length,
    };
  });

  const shown = await page.locator(".metric .value").allTextContents();
  expect(shown[0].trim()).toBe(String(data.total));
  expect(shown[1].trim()).toBe(`${data.reviewed} %`);
  expect(shown[2].trim()).toBe(String(data.departments));
  expect(shown[3].trim()).toBe(String(data.interviews));
  expect(shown[4].trim()).toBe(String(data.inductive));
});

test("the cross table and the citation headings agree with the analysis", async ({ page }) => {
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#matrix-table")).toBeVisible();

  const rows = await page.evaluate(async () => {
    const analysis = await (await fetch("/api/analysis")).json();
    return analysis.rows.map((row) => ({
      name: row.name,
      sum: row.sum,
      naming: row.departmentsNaming,
      values: row.values,
    }));
  });

  const table = await page.evaluate(() =>
    [...document.querySelectorAll("#matrix-table tbody tr")].map((tr) => ({
      name: tr.querySelector("th").textContent.trim(),
      numbers: [...tr.querySelectorAll("td.num")].map((cell) => cell.textContent.trim()),
    })),
  );
  expect(table).toHaveLength(rows.length);

  for (const printed of table) {
    const row = rows.find((one) => one.name === printed.name.replace(/^…\s*/, ""));
    expect(row, `the analysis knows ${printed.name}`).toBeTruthy();
    // Every department column, then the total, then the count of departments.
    const numbers = printed.numbers.map((value) => (value === "·0" ? "0" : value));
    expect(numbers).toEqual([
      ...row.values.map(String),
      String(row.sum),
      String(row.naming),
    ]);
  }

  /* Each citation group says how many the category holds, not how many are
     drawn. Scoped to the citations: the notes below use the same heading class
     for their own groups, and those are not categories. */
  const headings = await page.locator("#citations-part .citation-head").allTextContents();
  expect(headings.length).toBeGreaterThan(0);
  for (const heading of headings) {
    const [name, count] = heading.trim().split(" · ");
    const row = rows.find((one) => one.name === name);
    expect(row, `the analysis knows ${name}`).toBeTruthy();
    expect(Number(count)).toBe(row.sum);
  }
});

test("the progress table counts each interview as the interview does", async ({ page }) => {
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await page.locator('.tab[data-view="analysis"]').click();

  const progress = await page.evaluate(async () => {
    const analysis = await (await fetch("/api/analysis")).json();
    return analysis.progress.map((entry) => ({
      title: entry.title,
      codings: entry.codings,
      turnsCoded: entry.turnsCoded,
      turns: entry.turns,
    }));
  });

  for (const entry of progress) {
    const row = page.locator("tbody tr", { hasText: entry.title }).last();
    await expect(row).toContainText(String(entry.codings));
    await expect(row).toContainText(`${entry.turnsCoded} / ${entry.turns}`);
  }
});
