import { expect, test } from "@playwright/test";

/**
 * The screen you land on after making a requirement.
 *
 * The catalog is a whole view that only exists once somebody has built
 * requirements out of citations, which is why it had never been looked at with
 * anything in it. Built out — six requirements, each carried by citations from
 * a couple of departments — it opened on three figures, and the first
 * requirement card began at 1438 pixels on a 1000 pixel screen. So the answer to
 * "I have just made six requirements, where are they" was: below three figures
 * about work you have not done yet.
 *
 * Two of the three need a judgment that is made on the single requirement — the
 * MoSCoW level and which operations its absence blocks — and neither had been
 * made. Drawn anyway they were not empty but misleading: six requirements with
 * no level came out as one grey bar labelled 6, which reads as a finding.
 *
 * So those two wait until there is a judgment to draw, and say what would fill
 * them and where it is entered. The third counts citations, which exist from the
 * first requirement onwards, and stays.
 */

const TITLES = [
  "Eine Suche, die über alle Interviews geht",
  "Ein Ort, an dem die aktuelle Fassung steht",
  "Übergaben schriftlich festhalten",
];

async function catalogWith(request, { judged = false } = {}) {
  const { requirements } = await (await request.get("/api/requirements")).json();
  for (const one of requirements) await request.delete(`/api/requirements/${one.id}`);

  const made = [];
  for (const title of TITLES) {
    const answer = await request.post("/api/requirements", { data: { title } });
    const body = await answer.json();
    made.push(body.id ?? body.requirement?.id);
  }
  /* Citations of its own, so the one figure that needs no judgment has
     something to draw. The sandbox is shared and other checks clear it, so
     relying on whatever coding happens to be lying there makes this check about
     the order the suite ran in. */
  const interviews = await (await request.get("/api/interviews")).json();
  for (const [index, one] of interviews.entries()) {
    const data = await (await request.get(`/api/interviews/${one.id}`)).json();
    for (const coding of data.codings) {
      await request.delete(`/api/interviews/${one.id}/codings/${coding.id}`);
    }
    const codable = data.turns.filter((turn) => !turn.interviewer && turn.text.length > 90);
    for (const [k, turn] of codable.slice(0, made.length).entries()) {
      const answer = await request.post(`/api/interviews/${one.id}/codings`, {
        data: {
          turn: turn.number,
          start: 0,
          end: 60,
          category: "routine",
          text: turn.text.slice(0, 60),
          reviewed: true,
          requirements: [made[(k + index) % made.length]],
        },
      });
      expect(answer.ok(), `${one.id} turn ${turn.number}`).toBe(true);
    }
  }
  if (judged) {
    await request.patch(`/api/requirements/${made[0]}`, { data: { moscow: "must" } });
  }
  return made;
}

async function catalog(page) {
  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="catalog"]').click();
  await expect(page.locator(".requirement").first()).toBeVisible();
}

test("a figure that needs a judgment nobody has made is not drawn", async ({ page, request }) => {
  await catalogWith(request);
  await catalog(page);

  await expect(page.locator("#moscow")).toHaveCount(0);
  await expect(page.locator("#priority")).toHaveCount(0);
  /* Not silence: it says which two are missing, what they need, and that it is
     entered on the card rather than up here. */
  const note = page.locator("#catalog-charts .column-note", { hasText: "fehlen hier noch" });
  await expect(note).toBeVisible();
  await expect(note).toContainText("MoSCoW");
  await expect(note).toContainText("blockierte Operationen");

  // The one that counts citations does not need a judgment and stays.
  await expect(page.locator("#coverage")).toBeVisible();
});

test("the requirements are on the screen they were just made on", async ({ page, request }) => {
  await catalogWith(request);
  await catalog(page);

  /* The whole point, said in the unit the problem was in: a card the reader can
     see without scrolling past figures about work they have not done. */
  const card = await page.locator(".requirement").first().boundingBox();
  const viewport = page.viewportSize().height;
  expect(Math.round(card.y), `first card at ${Math.round(card.y)}px in ${viewport}px`).toBeLessThan(viewport);
});

test("the first judgment brings both figures back", async ({ page, request }) => {
  await catalogWith(request, { judged: true });
  await catalog(page);

  await expect(page.locator("#moscow")).toBeVisible();
  await expect(page.locator("#priority")).toBeVisible();
  // And the note that stood in for them goes, rather than sitting beside them.
  await expect(page.locator("#catalog-charts .column-note", { hasText: "fehlen hier noch" })).toHaveCount(0);
});

test("setting a level on the screen brings them back without a reload", async ({ page, request }) => {
  await catalogWith(request);
  await catalog(page);
  await expect(page.locator("#moscow")).toHaveCount(0);

  await page.locator(".requirement select.level").first().selectOption({ index: 1 });
  await expect(page.locator("#moscow")).toBeVisible();
  await expect(page.locator("#priority")).toBeVisible();
});

test("blocked operations count as a judgment too, without a level", async ({ page, request }) => {
  const made = await catalogWith(request);
  // The other half of the same decision: the priority field needs this axis,
  // and somebody may fill it in before they are ready to name a level.
  await request.patch(`/api/requirements/${made[0]}`, { data: { blockedOperations: ["filing"] } });
  await catalog(page);
  await expect(page.locator("#priority")).toBeVisible();
  await expect(page.locator("#moscow")).toBeVisible();
});

test("a catalog with nothing in it still says what a requirement is for", async ({ page, request }) => {
  const { requirements } = await (await request.get("/api/requirements")).json();
  for (const one of requirements) await request.delete(`/api/requirements/${one.id}`);

  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="catalog"]').click();
  await expect(page.locator("#catalog")).toContainText("Anforderung");
  // No figures, and no note about figures either: there is nothing to be about.
  await expect(page.locator("#moscow")).toHaveCount(0);
  await expect(page.locator("#catalog-charts .column-note", { hasText: "fehlen hier noch" })).toHaveCount(0);
});
