import { expect, test } from "@playwright/test";

import { WIDTH, categoryAxis, standalone } from "../public/charts.js";

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
    labels: [...document.querySelectorAll("#reach text.row-label")].map((one) =>
      [...one.querySelectorAll("tspan")].map((line) => line.textContent).join(" "),
    ),
    rings: [...document.querySelectorAll("#reach circle.reach-sole")].map((one) => ({
      cx: Number(one.getAttribute("cx")),
      cy: Number(one.getAttribute("cy")),
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

/**
 * The size, in the key, at the size it means.
 *
 * "Punktgröße = Belege" stood in the caption and was three words for something
 * that had to be asked about to be understood: which citations, counted how,
 * against what largest. And the scale is relative to the largest cell of this
 * one figure, so a number written into prose would be wrong the moment anything
 * is coded. The key therefore carries the two ends of the scale as two dots at
 * the radius they stand for — something a reader can hold against the picture.
 */
test("the key carries the scale the dots are drawn on", async ({ page, request }) => {
  await study(request, [
    { requirement: 0, category: 0 },
    { requirement: 0, category: 1 },
    { requirement: 1, category: 1 },
  ]);
  await catalog(page);

  const key = page
    .locator("#reach")
    .locator("xpath=preceding-sibling::div[contains(@class,'chart-legend')][1]");
  await expect(key).toContainText("Punktgröße");

  const dots = key.locator(".dot-key");
  await expect(dots, "the two ends of the scale").toHaveCount(2);
  await expect(dots.first(), "the small end is one citation").toContainText("1");

  const { dots: drawnDots } = await drawn(page);
  const biggest = Math.max(...drawnDots.map((one) => one.radius));
  const most = Math.max(...drawnDots.map((one) => one.value));
  await expect(dots.last(), "the large end is the largest cell of this figure").toContainText(
    String(most),
  );

  const radii = await dots.evaluateAll((nodes) =>
    nodes.map((node) => Number(node.querySelector("circle").getAttribute("r"))),
  );
  // Drawn at the size they mean, in the figure's own scale — the whole point of
  // a key for a size rather than a sentence about one.
  expect(radii[1]).toBeCloseTo(biggest, 1);
  expect(radii[1]).toBeGreaterThan(radii[0]);
});

/**
 * A key entry for something not drawn is worse than none.
 *
 * The band of the MoSCoW distribution has dropped its empty levels from the
 * beginning — it is built from counts and could hardly do otherwise. The three
 * figures that draw one mark per requirement listed all five whatever they
 * held, so a catalog in which nothing has been postponed still carried „Won't
 * have" in its key: a colour to hunt for that is not on the picture, and a
 * quiet suggestion that something has been postponed.
 */
test("the key holds the levels the figure draws, and no others", async ({ page, request }) => {
  // Only the first requirement carries a level; the others stay open.
  await study(request, [
    { requirement: 0, category: 0 },
    { requirement: 1, category: 1 },
  ]);
  await catalog(page);

  const key = page
    .locator("#reach")
    .locator("xpath=preceding-sibling::div[contains(@class,'chart-legend')][1]");
  await expect(key).toContainText("Must have");
  await expect(key).toContainText("offen");
  await expect(key, "nothing is postponed, so nothing says so").not.toContainText("Won't have");
  await expect(key).not.toContainText("Should have");
  await expect(key).not.toContainText("Could have");
});

/**
 * The column headings, written whole and broken over lines.
 *
 * They run down and to the left at forty-five degrees, so a heading costs
 * height by its width and the longest category name in a study decided how much
 * white space every other column stood in. It was answered by cutting: measured
 * once for the narrowest place, applied to every column, and a
 * thirty-four-character ceiling on top — so „Erwartung & Vertrauen in KI-Inhal…"
 * was cut in a column with room for twice that.
 *
 * A name is what a category *is*. It is wrapped now rather than shortened: what
 * is cut is the length of a line, not the name.
 */

/** Each heading as it stands on the axis: its lines, and the name behind it. */
async function axisHeadings(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("#reach text.heading")].map((one) => ({
      full: one.querySelector("title").textContent,
      lines: [...one.querySelectorAll("tspan")].map((line) => line.textContent),
    })),
  );
}

test("a column heading is written whole, over as many lines as it needs", async ({
  page,
  request,
}) => {
  const { categories } = await study(request, [
    { requirement: 0, category: 0 },
    { requirement: 1, category: 1 },
    { requirement: 2, category: 2 },
  ]);
  await catalog(page);

  for (const one of await axisHeadings(page)) {
    expect(one.lines.join(" "), `${one.full} stands whole`).toBe(one.full);
  }

  /* A name far too long for one line is broken rather than cut off — and into
     two, not three. Three short lines are a stack rather than a label, they are
     harder to read than two long ones, and they save almost no height: every
     line after the first is offset down the slope again. The line is widened
     until two are enough. */
  const long = "Erwartung und Vertrauen in KI-Inhalte";
  await request.patch(`/api/categories/${categories[0].id}`, { data: { name: long } });
  await catalog(page);

  const wrapped = (await axisHeadings(page)).find((one) => one.full === long);
  expect(wrapped, "the long name is on the axis").toBeTruthy();
  expect(wrapped.lines.length, "in two lines, not three").toBe(2);
  expect(wrapped.lines.join(" "), "and nothing of it is given up").toBe(long);
  // Each line shorter than what the old single line was cut to, or the wrap
  // bought nothing.
  for (const line of wrapped.lines) expect(line.length).toBeLessThan(34);

  /* Three lines is the last resort before shortening, and shortening the last
     resort of all: the figure belongs to every column, and one very long name
     may not decide how much white space the others stand in. Whatever happens,
     the name itself stays in the picture as the heading's title. */
  const absurd = `${long} über alle Bereiche der Organisation hinweg, ausführlich`;
  await request.patch(`/api/categories/${categories[0].id}`, { data: { name: absurd } });
  await catalog(page);
  const cut = (await axisHeadings(page)).find((one) => one.full === absurd);
  expect(cut.lines.length).toBeLessThanOrEqual(3);
  const kept = cut.lines.join(" ");
  if (kept !== absurd) expect(kept.endsWith("…")).toBe(true);

  await request.patch(`/api/categories/${categories[0].id}`, {
    data: { name: categories[0].name },
  });
});

/**
 * The saved file lays its own key out, and used to break it in the wrong place.
 *
 * On screen the key is HTML and the browser wraps it; in the file there is
 * nobody to ask, so `charts.js` measures by estimate and wraps by arithmetic.
 * With a full key — the levels, the ring, and the size scale — that arithmetic
 * put the small dot at the right edge of the first line and the large one alone
 * at the left of the second: the two ends of one scale, read as two scales,
 * which is not a wrapping decision but a mistake.
 *
 * Checked on a key built to overflow rather than on whatever the sandbox
 * happens to hold — a key that fits proves nothing about one that does not, and
 * this is the case that was reported.
 */
/**
 * A key that fits is not broken onto two lines.
 *
 * The estimate the file lays its key out with runs wide on purpose — for
 * reserving room, where too wide is a little unused white and too narrow is a
 * word cut in half. For deciding a wrap it is the wrong side of the truth, and
 * this key proved it: four levels, the ring and the size scale came to 722
 * reckoned pixels of a 720-pixel line and went onto two, while the same words
 * measure 640. The interface, which has room to spare, showed them on one — so
 * the same figure said two different things about its own key depending on
 * where it was looked at.
 *
 * The wordings are the real ones, because that is the case that was reported.
 */
test("a key that fits on one line is not broken onto two", () => {
  const spec = {
    id: "reach",
    title: "Welche Kategorien eine Anforderung berührt",
    summary: "…",
    width: WIDTH,
    height: 200,
    body: "",
    legend: {
      kind: "moscow",
      entries: [
        { paint: "moscow-must", label: "Must have" },
        { paint: "moscow-should", label: "Should have" },
        { paint: "moscow-could", label: "Could have" },
        { paint: "sole", shape: "ring", label: "einzige Anforderung für diese Kategorie" },
        { label: "Punktgröße in Belegen:" },
        { shape: "dot", radius: 4.19, label: "1", keepWith: true },
        { shape: "dot", radius: 7.5, label: "19", keepWith: true },
      ],
    },
  };

  const svg = standalone(spec, { theme: "light" });
  const key = svg.slice(0, svg.indexOf("<g transform"));
  const labels = [...key.matchAll(/<text class="key-label" x="([\d.]+)" y="([\d.]+)">/g)];
  expect(new Set(labels.map((one) => one[2])).size, "all of it on one line").toBe(1);
  // And inside the picture: the tighter reckoning must not push it off the edge
  // instead of wrapping it.
  expect(Math.max(...labels.map((one) => Number(one[1])))).toBeLessThan(WIDTH);
});

test("the key of the saved file wraps a run whole or not at all", () => {
  const long = "einzige Anforderung für diese Kategorie";
  const spec = {
    id: "reach",
    title: "Welche Kategorien eine Anforderung berührt",
    summary: "…",
    width: WIDTH,
    height: 200,
    body: "",
    legend: {
      kind: "moscow",
      entries: [
        { paint: "moscow-must", label: "Must have" },
        { paint: "moscow-should", label: "Should have" },
        { paint: "moscow-could", label: "Could have" },
        { paint: "moscow-open", label: "offen" },
        { paint: "sole", shape: "ring", label: long },
        { label: "Punktgröße in Belegen:" },
        { shape: "dot", radius: 4.19, label: "1", keepWith: true },
        { shape: "dot", radius: 7.5, label: "19", keepWith: true },
      ],
    },
  };

  const svg = standalone(spec, { theme: "light" });
  const key = svg.slice(0, svg.indexOf("<g transform"));
  const lineOf = (pattern) =>
    [...key.matchAll(pattern)].map((one) => Number(one[1]));

  const dots = lineOf(/<circle class="key-dot"[^>]*cy="([\d.]+)"/g);
  const labels = [
    ...key.matchAll(/<text class="key-label" x="[\d.]+" y="([\d.]+)">([^<]*)</g),
  ];
  const lines = new Set(labels.map((one) => one[1]));

  // The key is longer than the figure is wide, so it does wrap — otherwise this
  // would pass without touching the thing it is about.
  expect(lines.size, "the key really does run onto a second line").toBeGreaterThan(1);
  expect(dots.length).toBe(2);
  expect(dots[0], "both ends of the scale stand on one line").toBe(dots[1]);
  const said = labels.find((one) => one[2].startsWith("Punktgröße"));
  expect(Number(said[1]), "and so does the label that says what it is").toBe(
    Number(labels.find((one) => one[2] === "1")[1]),
  );
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

/**
 * The order, which is the whole difference between a picture of the links and a
 * picture of the structure.
 *
 * A matrix holds what it holds whatever order it is in, and shows *shape* only
 * in one of them. Left in catalog order this figure was a scatter of correct
 * dots in which nothing was legible at a glance: which requirements carry a lot
 * of the study and which touch one corner of it, and which of them keep turning
 * up in the same company.
 */
/**
 * The order, and why it is not this figure's own.
 *
 * It used to sort itself: rows by how many categories they reach, columns by
 * where their topmost dot sat. That made a staircase one could read groups off,
 * and it cost more than it was worth — the same twenty requirements stood in
 * one order in the catalog list, in another in the figure and in a third in the
 * export, so finding a requirement in the list and then in the picture was a
 * hunt. Both axes take an order that already exists elsewhere in the tool.
 */
test("the rows stand in the order the catalog stands in", async ({ page, request }) => {
  /* Built so the two orders disagree: the third requirement reaches most, and
     the first is the one carrying a MoSCoW level — so sorting by reach would
     put the third at the top and the catalog puts the first there. */
  await study(request, [
    { requirement: 2, category: 0 },
    { requirement: 2, category: 1 },
    { requirement: 2, category: 2 },
    { requirement: 1, category: 0 },
    { requirement: 1, category: 1 },
    { requirement: 0, category: 0 },
  ]);
  await catalog(page);

  const { requirements } = await (await request.get("/api/requirements")).json();
  const wanted = requirements.filter((one) => one.citations.length).map((one) => one.title);
  const { labels } = await drawn(page);
  expect(labels, "the rows are what /api/requirements answers, in that order").toEqual(wanted);

  // And the two orders really did disagree, or this proves nothing: the one
  // reaching furthest is not the one at the top.
  expect(labels[0]).toBe(TITLES[0]);
});

/**
 * The rule itself, on a system the API cannot build.
 *
 * Adding a category always appends it, so in a file the tool wrote a standalone
 * inductive category is last anyway — which means the check through the
 * interface cannot tell "appended by the rule" from "appended by accident". A
 * hand-edited `categories.json` can put one anywhere, and then the rule has to
 * hold on its own.
 */
test("what stands on its own goes behind; what sits under a start category stays", () => {
  const system = [
    { id: "ind.vertrauen", origin: "inductive", parent: null },
    { id: "routine", origin: "deductive", parent: null },
    { id: "routine.disruption", origin: "deductive", parent: "routine" },
    { id: "ind.medienbruch", origin: "inductive", parent: "routine" },
    { id: "agreement", origin: "deductive", parent: null },
    { id: "ind.vertrauen.auskunft", origin: "inductive", parent: "ind.vertrauen" },
  ];
  expect(categoryAxis(system).map((one) => one.id)).toEqual([
    "routine",
    "routine.disruption",
    // Under a start category, so it belongs to that branch and stays in it.
    "ind.medienbruch",
    "agreement",
    // Standing on its own, so behind everything the study went in with — and
    // its own subcategory travels with it rather than being judged alone.
    "ind.vertrauen",
    "ind.vertrauen.auskunft",
  ]);
});

test("the columns stand in the order of the guide, what stands on its own behind", async ({
  page,
  request,
}) => {
  await study(request, [
    { requirement: 2, category: 0 },
    { requirement: 1, category: 1 },
    { requirement: 0, category: 2 },
  ]);

  /* Two categories from the material, and they are not treated alike.
     „Medienbruch" is subordinated to a start category: a distinction inside that
     branch, which belongs where the branch is — the file splices it directly
     behind its parent and the axis leaves it there. „Vertrauen" stands on its
     own: a heading the start system does not have, and putting it among them
     would say the study went in with it. */
  await request.post("/api/categories", {
    data: { name: "Medienbruch", definition: "Aussagen über den Wechsel des Mediums." },
  });
  await request.patch("/api/categories/ind.medienbruch", { data: { parent: "routine" } });
  await request.post("/api/categories", {
    data: { name: "Vertrauen", definition: "Aussagen über Vertrauen in die Auskunft." },
  });

  // Every codable turn already carries a unit, so two of them are moved into the
  // new categories rather than places being found for more.
  const data = await (await request.get("/api/interviews/interview-01")).json();
  const [one, other] = data.codings;
  for (const [unit, category] of [
    [one, "ind.medienbruch"],
    [other, "ind.vertrauen"],
  ]) {
    await request.patch(`/api/interviews/interview-01/codings/${unit.id}`, { data: { category } });
  }

  const { categories } = await (await request.get("/api/categories")).json();
  const inFile = categories.map((each) => each.id);
  expect(
    inFile.indexOf("ind.medienbruch"),
    "the file keeps the subordinated one with its parent",
  ).toBeLessThan(inFile.indexOf("agreement"));

  await catalog(page);
  const { headings } = await drawn(page);
  const drawnOrder = [...headings].sort((a, b) => a.x - b.x).map((each) => each.name);

  // The one under a start category keeps the place the file gives it …
  expect(drawnOrder.indexOf("Medienbruch")).toBeLessThan(drawnOrder.indexOf("Absprachen"));
  // … and the one standing on its own is behind everything the study went in
  // with, whatever the file's order.
  expect(drawnOrder.at(-1)).toBe("Vertrauen");

  for (const [unit] of [[one], [other]]) {
    await request.patch(`/api/interviews/interview-01/codings/${unit.id}`, {
      data: { category: unit.category },
    });
  }
  await request.delete("/api/categories/ind.medienbruch");
  await request.delete("/api/categories/ind.vertrauen");
});

/**
 * The city and the flat figure are one matrix drawn twice.
 *
 * They are offered side by side in the catalog, and a reader who takes them for
 * the same thing is right. So nothing may be in one and not in the other: the
 * same cells with the same numbers, the same order on both axes, the same
 * counts beside the rows and the columns, the same mark on a category only one
 * requirement answers, and the same table underneath. What differs is how a
 * number is drawn — an area against a height — and what that costs: a tower
 * hides what stands behind it, and the caption of the city says so.
 *
 * Without this the two drift apart at the next change to either, which is how
 * the figures came to disagree about their own axis in the first place.
 */
test("the city carries what the flat figure carries", async ({ page, request }) => {
  await study(request, [
    { requirement: 0, category: 0 },
    { requirement: 0, category: 1 },
    { requirement: 1, category: 1 },
    { requirement: 2, category: 2 },
  ]);
  await catalog(page);

  const both = await page.evaluate(() => {
    const cells = (selector) =>
      [...document.querySelectorAll(selector)]
        .map((one) => `${one.dataset.row}|${one.dataset.category}=${one.dataset.value}`)
        .sort();
    const table = (id) =>
      [...document.querySelectorAll(`#${id}-figures table tr`)].map((tr) =>
        [...tr.children].map((cell) => cell.textContent.trim()).join("|"),
      );
    const axis = (selector, read) => [...document.querySelectorAll(selector)].map(read);
    return {
      reach: {
        cells: cells("#reach circle.reach"),
        table: table("reach"),
        rows: axis("#reach text.row-label", (one) =>
          [...one.querySelectorAll("tspan")].map((line) => line.textContent).join(" "),
        ),
        columns: axis("#reach text.heading", (one) => one.querySelector("title").textContent),
        rings: document.querySelectorAll("#reach circle.reach-sole").length,
      },
      city: {
        cells: cells("#city .tower"),
        table: table("city"),
        // Along the two near edges, in the order they are drawn.
        names: axis("#city text.axis.city", (one) => one.querySelector("title").textContent),
        rings: document.querySelectorAll("#city circle.reach-sole").length,
      },
    };
  });

  expect(both.city.cells, "the same cells with the same numbers").toEqual(both.reach.cells);
  expect(both.city.table, "the same table underneath").toEqual(both.reach.table);
  expect(both.city.rings, "the same category marked as carried by one").toBe(both.reach.rings);
  // Both axes in the same order, whichever edge they are written on.
  expect(both.city.names).toEqual([...both.reach.columns, ...both.reach.rows]);
});

test("the only requirement carrying a category is circled", async ({ page, request }) => {
  /* Reach is not importance on its own: a requirement touching one category can
     be the only thing in the catalog that answers it, and dropping it would
     leave what people said there unanswered. */
  const { categories } = await study(request, [
    { requirement: 0, category: 0 },
    { requirement: 1, category: 0 },
    { requirement: 2, category: 1 },
  ]);
  await catalog(page);

  const { dots, rings } = await drawn(page);
  const shared = categories[0].name;
  const alone = categories[1].name;

  const circled = dots.filter((dot) =>
    rings.some((ring) => Math.abs(ring.cx - dot.cx) < 0.5 && Math.abs(ring.cy - dot.cy) < 0.5),
  );
  expect(circled.map((one) => one.category), "only the category with one answer").toEqual([alone]);
  expect(circled[0].row).toBe(TITLES[2]);
  // Two requirements answer the other one, so neither of them is circled.
  expect(dots.filter((one) => one.category === shared)).toHaveLength(2);
  expect(rings).toHaveLength(1);

  // And the dot says so where a mouse asks, not only where the eye can see it.
  const said = await page.evaluate(
    () => document.querySelector("#reach circle.reach[data-sole='true']")?.dataset.tip,
  );
  expect(said).toContain(alone);
  expect(said, "the tip names what the ring means").toMatch(/einzige/i);
});
