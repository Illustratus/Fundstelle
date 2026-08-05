import { expect, test } from "@playwright/test";

/**
 * Which categories a requirement reaches.
 *
 * The catalog could say how *many* categories a requirement rests on and never
 * which ones, and the number is the less useful half: "touches four categories"
 * does not tell anybody what changes if the requirement is met.
 *
 * The figure has to hold up read both ways, so both are checked. Across a row:
 * these are the categories this requirement speaks to. Down a column: these are
 * the requirements that would answer what was said here — and a column with
 * nothing in it is a category the catalog has not turned into anything, which is
 * the finding the figure exists for and the one that cannot be faked by drawing
 * something plausible.
 */

const TITLES = [
  "Eine Suche, die über alle Interviews geht",
  "Ein Ort, an dem die aktuelle Fassung steht",
  "Übergaben schriftlich festhalten",
];

/**
 * A study where the links are known, so the picture can be checked against them
 * rather than against itself. `links` maps a requirement to the categories it
 * is to rest on; a category left out of every entry is the gap.
 */
async function study(request, links) {
  const { requirements } = await (await request.get("/api/requirements")).json();
  for (const one of requirements) await request.delete(`/api/requirements/${one.id}`);
  const made = [];
  for (const title of TITLES) {
    const body = await (await request.post("/api/requirements", { data: { title } })).json();
    made.push(body.id ?? body.requirement?.id);
  }
  await request.patch(`/api/requirements/${made[0]}`, { data: { moscow: "must" } });

  const { categories } = await (await request.get("/api/categories")).json();
  const interviews = await (await request.get("/api/interviews")).json();
  const wanted = new Map();

  let at = 0;
  for (const one of interviews) {
    const data = await (await request.get(`/api/interviews/${one.id}`)).json();
    for (const coding of data.codings) {
      await request.delete(`/api/interviews/${one.id}/codings/${coding.id}`);
    }
    const codable = data.turns.filter((turn) => !turn.interviewer && turn.text.length > 70);
    for (const turn of codable) {
      const plan = links[at % links.length];
      at += 1;
      const category = categories[plan.category];
      const answer = await request.post(`/api/interviews/${one.id}/codings`, {
        data: {
          turn: turn.number,
          start: 0,
          end: 60,
          category: category.id,
          text: turn.text.slice(0, 60),
          reviewed: true,
          requirements: plan.requirement === null ? [] : [made[plan.requirement]],
        },
      });
      expect(answer.ok(), `${one.id} turn ${turn.number}`).toBe(true);
      if (plan.requirement !== null) {
        const key = `${TITLES[plan.requirement]}|${category.name}`;
        wanted.set(key, (wanted.get(key) ?? 0) + 1);
      }
    }
  }
  return { made, categories, wanted };
}

/** The figure read back off the screen: every dot, and every column tally. */
async function drawn(page) {
  return page.evaluate(() => ({
    dots: [...document.querySelectorAll("#reach circle.reach")].map((one) => ({
      row: one.dataset.row,
      category: one.dataset.category,
      value: Number(one.dataset.value),
      level: [...one.classList].find((name) => name.startsWith("moscow-")),
      radius: Number(one.getAttribute("r")),
      cx: Number(one.getAttribute("cx")),
      cy: Number(one.getAttribute("cy")),
    })),
    headings: [...document.querySelectorAll("#reach text.heading")].map((one) => ({
      name: one.querySelector("title").textContent,
      unmet: one.classList.contains("unmet"),
      x: Number(one.getAttribute("x")),
    })),
  }));
}

/**
 * Put the study back before leaving.
 *
 * The last check here empties it on purpose — that is the case it is about —
 * and the sandbox is shared. A spec that walks away from an empty study makes
 * some later spec fail for a reason nothing in it points at, which is a morning
 * spent in the wrong file.
 */
test.afterAll(async ({ playwright, baseURL }) => {
  const request = await playwright.request.newContext({ baseURL });
  await study(request, [
    { requirement: 0, category: 0 },
    { requirement: 1, category: 1 },
    { requirement: 2, category: 2 },
  ]);
  await request.dispose();
});

async function catalog(page) {
  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="catalog"]').click();
  await expect(page.locator("#reach svg")).toBeVisible();
}

test("a dot stands where a requirement and a category actually meet", async ({ page, request }) => {
  const { wanted } = await study(request, [
    { requirement: 0, category: 0 },
    { requirement: 0, category: 1 },
    { requirement: 1, category: 1 },
    { requirement: 2, category: 2 },
  ]);
  await catalog(page);

  const { dots } = await drawn(page);
  const found = new Map(dots.map((one) => [`${one.row}|${one.category}`, one.value]));
  expect(
    [...found.entries()].map(([key, n]) => `${key}=${n}`).sort(),
    "every dot on the figure is a link in the study",
  ).toEqual([...wanted.entries()].map(([key, n]) => `${key}=${n}`).sort());

  // More citations, bigger dot — by area, which is what the eye compares.
  const bySize = [...dots].sort((a, b) => a.value - b.value);
  for (let index = 1; index < bySize.length; index += 1) {
    if (bySize[index].value > bySize[index - 1].value) {
      expect(bySize[index].radius, `${bySize[index].row}`).toBeGreaterThan(
        bySize[index - 1].radius,
      );
    }
  }
});

test("a row is one requirement and a column is one category", async ({ page, request }) => {
  await study(request, [
    { requirement: 0, category: 0 },
    { requirement: 0, category: 1 },
    { requirement: 1, category: 1 },
    { requirement: 2, category: 2 },
  ]);
  await catalog(page);
  const { dots } = await drawn(page);

  // The two readings the figure promises: a row holds one requirement, a column
  // one category. If either ever stops holding, the picture is lying quietly.
  for (const [row, group] of Object.entries(Object.groupBy(dots, (one) => one.row))) {
    expect(new Set(group.map((one) => Math.round(one.cy))).size, `row ${row}`).toBe(1);
  }
  for (const [name, group] of Object.entries(Object.groupBy(dots, (one) => one.category))) {
    expect(new Set(group.map((one) => Math.round(one.cx))).size, `column ${name}`).toBe(1);
  }
});

test("a category no requirement reaches is drawn and said to be empty", async ({ page, request }) => {
  /* The finding the figure is for. The third category is coded — so it is a
     column — but every coding of it is left without a requirement. */
  const { categories } = await study(request, [
    { requirement: 0, category: 0 },
    { requirement: 1, category: 1 },
    { requirement: null, category: 2 },
  ]);
  await catalog(page);

  const { dots, headings } = await drawn(page);
  const gap = categories[2].name;
  expect(headings.map((one) => one.name), "the column is there").toContain(gap);
  expect(dots.some((one) => one.category === gap), "and it is empty").toBe(false);
  expect(
    headings.find((one) => one.name === gap).unmet,
    "and its name is set quietly, so the eye finds it",
  ).toBe(true);
  // The others are not marked, or the marking says nothing.
  expect(headings.filter((one) => one.unmet)).toHaveLength(1);

  // And the number under the column says it in a figure rather than an absence.
  const tally = await page.evaluate(() =>
    [...document.querySelectorAll("#reach text.value.empty")].map((one) => one.textContent),
  );
  expect(tally).toContain("0");
});

test("a dot carries the level of its requirement", async ({ page, request }) => {
  await study(request, [
    { requirement: 0, category: 0 },
    { requirement: 1, category: 1 },
  ]);
  await catalog(page);
  const { dots } = await drawn(page);

  // The first requirement is the only one with a level; the rest stay open.
  const first = dots.filter((one) => one.row === TITLES[0]);
  expect(first.length).toBeGreaterThan(0);
  for (const dot of first) expect(dot.level).toBe("moscow-must");
  for (const dot of dots.filter((one) => one.row !== TITLES[0])) {
    expect(dot.level).toBe("moscow-open");
  }
});

test("the figure comes back from the API as well, in both themes", async ({ request }) => {
  await study(request, [
    { requirement: 0, category: 0 },
    { requirement: 1, category: 1 },
  ]);

  const light = await request.get("/api/figures/requirement-reach.svg");
  expect(light.status()).toBe(200);
  const dark = await request.get("/api/figures/requirement-reach.svg?theme=dark");
  expect(dark.status()).toBe(200);

  const one = await light.text();
  const other = await dark.text();
  expect(one, "nothing points at a stylesheet that is not there").not.toContain("var(--");
  expect(one).toContain("circle");
  expect(one === other, "the themes are two different files").toBe(false);

  // It is the one figure drawn from both bodies of data; the route has to fetch
  // both for it, and fetching only the catalog would leave it without columns.
  expect(one).toContain("class=\"reach");

  const index = await (await request.get("/api/figures?lang=de")).json();
  const listed = index.figures.find((figure) => figure.name === "requirement-reach");
  expect(listed, "it is offered in the index too").toBeTruthy();
  expect(listed.view).toBe("catalog");
  expect(listed.title).toBeTruthy();
});

test("with no citations anywhere it is not drawn, and the endpoint says why", async ({
  page,
  request,
}) => {
  const { requirements } = await (await request.get("/api/requirements")).json();
  for (const one of requirements) await request.delete(`/api/requirements/${one.id}`);
  const interviews = await (await request.get("/api/interviews")).json();
  for (const one of interviews) {
    const data = await (await request.get(`/api/interviews/${one.id}`)).json();
    for (const coding of data.codings) {
      await request.delete(`/api/interviews/${one.id}/codings/${coding.id}`);
    }
  }
  await request.post("/api/requirements", { data: { title: "Noch ohne Beleg" } });

  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="catalog"]').click();
  await expect(page.locator(".requirement").first()).toBeVisible();
  // Nothing to draw is not the same as something to draw badly.
  await expect(page.locator("#reach")).toHaveCount(0);

  const answer = await request.get("/api/figures/requirement-reach.svg");
  expect(answer.status(), "the address is right, the study is not there yet").toBe(409);
  expect((await answer.json()).error.length, "and it says which condition").toBeGreaterThan(10);
});
