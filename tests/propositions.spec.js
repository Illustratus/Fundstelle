import { expect, test } from "@playwright/test";

/**
 * The propositions, which the study makes and the tool used to.
 *
 * A proposition is what a branch of the category system argues, and it is the
 * colour every figure of the study is drawn in — the key beside the bar chart,
 * the dots in the reach figure, the tags on a requirement card. Two of them
 * arrive with the seed, worded for the bundled example: „Werkzeuge prägen den
 * Arbeitsalltag" and „Absprachen bleiben informell".
 *
 * They could not be touched. A study about something else carried two claims it
 * never made — into its own coding guide, into its own appendix — and the only
 * way out was to edit `categories.json` by hand, which is the file every
 * citation hangs on and the last file anybody should be opening in an editor.
 *
 * So they are the author's now: worded, coloured, added and dissolved like the
 * categories under them. What must not move is the identifier, because that is
 * what a category points at; and one of them cannot go at all — the fallback
 * everything lands on when a heading is taken away.
 */

const seeded = async (request) => (await (await request.get("/api/categories")).json()).propositions;

/** Take the study back to the two the seed brings, plus the fallback. */
test.beforeEach(async ({ request }) => {
  for (const id of Object.keys(await seeded(request))) {
    if (!["practice", "coordination", "none"].includes(id)) {
      await request.delete(`/api/propositions/${id}`);
    }
  }
  await request.patch("/api/categories/agreement", { data: { proposition: "coordination" } });
});

test("a proposition can be added, worded and coloured", async ({ request }) => {
  const made = await request.post("/api/propositions", {
    data: { name: "Proposition 3: Wissen wandert mit Personen", color: "#2E7D32" },
  });
  expect(made.status()).toBe(201);
  const one = await made.json();
  expect(one.id).toBe("proposition-3-wissen-wandert-mit-personen");
  expect(one.color).toBe("#2e7d32");

  const renamed = await (
    await request.patch(`/api/propositions/${one.id}`, {
      data: { name: "Proposition 3: Wissen wandert" },
    })
  ).json();
  expect(renamed.name).toBe("Proposition 3: Wissen wandert");
  // The wording changed and the identifier did not: the categories point at it.
  expect(renamed.id).toBe(one.id);
});

test("a colour is a colour, or the figures do not get it", async ({ request }) => {
  /* It is written straight into the SVG of every figure and into a custom
     property of the interface, so the shape is checked rather than trusted. */
  const refused = await request.post("/api/propositions", {
    data: { name: "Kaputt", color: "red; background: url(x)" },
  });
  expect(refused.status()).toBe(400);
  expect((await refused.json()).code).toBe("errorColorShape");
});

test("a category argues the proposition it is put on, and its subcategories follow", async ({
  request,
}) => {
  const one = await (
    await request.post("/api/propositions", {
      data: { name: "Proposition 3: Wissen wandert", color: "#2E7D32" },
    })
  ).json();

  await request.patch("/api/categories/routine", { data: { proposition: one.id } });
  const categories = (await (await request.get("/api/categories")).json()).categories;
  const byId = (id) => categories.find((category) => category.id === id);
  expect(byId("routine").proposition).toBe(one.id);
  // The distinction is drawn under the proposition standing above it, so the
  // subcategory is carried along rather than left arguing something else.
  expect(byId("routine.disruption").proposition).toBe(one.id);

  const refused = await request.patch("/api/categories/routine.disruption", {
    data: { proposition: "coordination" },
  });
  expect(refused.status()).toBe(409);
  expect((await refused.json()).code).toBe("errorPropositionFollowsParent");
});

test("dissolving one leaves its categories on the fallback", async ({ request }) => {
  const one = await (
    await request.post("/api/propositions", {
      data: { name: "Proposition 3: Wissen wandert", color: "#2E7D32" },
    })
  ).json();
  await request.patch("/api/categories/agreement", { data: { proposition: one.id } });

  expect((await request.delete(`/api/propositions/${one.id}`)).status()).toBe(204);
  const after = await (await request.get("/api/categories")).json();
  expect(after.propositions[one.id]).toBeUndefined();
  // Not deleted, not pointing at a ghost: derived from the research interest.
  expect(after.categories.find((category) => category.id === "agreement").proposition).toBe("none");
});

test("the fallback stays, because it is what everything falls to", async ({ request }) => {
  const refused = await request.delete("/api/propositions/none");
  expect(refused.status()).toBe(409);
  expect((await refused.json()).code).toBe("errorPropositionStays");
  // Worded and coloured like any other, though.
  const changed = await request.patch("/api/propositions/none", { data: { color: "#8a9299" } });
  expect(changed.status()).toBe(200);
});

test("the panel words, colours and dissolves them", async ({ page, request }) => {
  await page.goto("/?lang=de");
  await page.waitForSelector(".category");
  await page.locator("#propositions-shell > summary").click();

  const field = page.locator('.proposition[data-proposition="practice"] input[type="text"]');
  await field.fill("Proposition 1: Werkzeuge prägen den Tag");
  await field.blur();
  await expect(page.locator("#message")).toContainText("Proposition lautet jetzt");

  await page.locator("#proposition-name").fill("Proposition 3: Wissen wandert");
  await page.locator("#proposition-new button").click();
  await expect(page.locator("#message")).toContainText("angelegt");
  const row = page.locator('.proposition[data-proposition="proposition-3-wissen-wandert"]');
  await expect(row).toBeVisible();
  // Nothing carries it yet, and the count beside it says so before anybody
  // dissolves it again.
  await expect(row.locator(".count")).toHaveText("0");

  await row.locator("[data-proposition-remove]").click();
  await expect(page.locator("#message")).toContainText("aufgelöst");
  await expect(row).toHaveCount(0);

  // The one that cannot go is offered no button to try it with.
  await expect(
    page.locator('.proposition[data-proposition="none"] [data-proposition-remove]'),
  ).toHaveCount(0);

  await request.patch("/api/propositions/practice", {
    data: { name: "Proposition 1: Werkzeuge prägen den Arbeitsalltag" },
  });
});

test("a category is put on a proposition where the category is worked on", async ({
  page,
  request,
}) => {
  await page.goto("/?lang=de");
  await page.waitForSelector(".category");
  await page.locator('.category[data-category="routine"]').click();

  const choice = page.locator('[data-category-proposition="routine"]');
  await expect(choice).toBeVisible();
  await choice.selectOption("coordination");
  await expect(page.locator("#message")).toContainText("trägt jetzt");

  const after = (await (await request.get("/api/categories")).json()).categories;
  expect(after.find((category) => category.id === "routine").proposition).toBe("coordination");

  // A subcategory says whose proposition it carries instead of offering a
  // choice that would be refused.
  await page.locator('.category[data-category="routine.disruption"]').click();
  await expect(page.locator('[data-category-proposition="routine.disruption"]')).toHaveCount(0);
  await expect(page.locator('[data-detail="routine.disruption"]')).toContainText(
    "Proposition der Oberkategorie",
  );

  await request.patch("/api/categories/routine", { data: { proposition: "practice" } });
});
