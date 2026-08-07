import { expect, test } from "@playwright/test";

/**
 * Every mark that carries a tooltip shows it.
 *
 * The tip is written where the mark is drawn, in `charts.js`, and the mouse is
 * wired to it three hundred lines away in `app.js` — by a list of class names.
 * So a figure could be finished, carry a `data-tip` on every mark, light up
 * under the mouse because it has a `:hover` rule, and say nothing: the reach
 * dots and the towers of the city did exactly that, and a mark that reacts to
 * the mouse and then withholds the number is worse than one that ignores it.
 *
 * Checked as a rule rather than figure by figure: whatever carries a tip is
 * hoverable. That is one assertion the next figure cannot fall out of.
 */

async function clear(request) {
  for (const one of await (await request.get("/api/interviews")).json()) {
    const data = await (await request.get(`/api/interviews/${one.id}`)).json();
    for (const coding of data.codings) {
      await request.delete(`/api/interviews/${one.id}/codings/${coding.id}`);
    }
  }
  for (const requirement of (await (await request.get("/api/requirements")).json()).requirements) {
    await request.delete(`/api/requirements/${requirement.id}`);
  }
}

/** A catalog with two requirements, cited across both interviews. */
async function study(request) {
  const requirements = [];
  for (const title of ["Eine Suche über alle Interviews", "Ablage nach Vorgang"]) {
    requirements.push(
      await (await request.post("/api/requirements", { data: { title } })).json(),
    );
  }
  let made = 0;
  for (const one of ["interview-01", "interview-02"]) {
    const data = await (await request.get(`/api/interviews/${one}`)).json();
    const codable = data.turns.filter((turn) => !turn.interviewer && turn.text.length > 80);
    for (const turn of codable.slice(0, 3)) {
      const answer = await request.post(`/api/interviews/${one}/codings`, {
        data: {
          turn: turn.number,
          start: 0,
          end: 60,
          category: made % 2 ? "agreement" : "routine",
          text: turn.text.slice(0, 60),
          reviewed: true,
        },
      });
      if (!answer.ok()) continue;
      const unit = await answer.json();
      await request.patch(`/api/interviews/${one}/codings/${unit.id}`, {
        data: { requirements: [requirements[made % 2].id] },
      });
      made += 1;
    }
  }
  await request.patch(`/api/requirements/${requirements[0].id}`, { data: { moscow: "must" } });
  return requirements;
}

test.beforeEach(async ({ request }) => {
  await clear(request);
  await study(request);
});

for (const [where, tab] of [
  ["the analysis", "analysis"],
  ["the catalog", "catalog"],
]) {
  test(`every mark in ${where} that carries a tooltip shows it`, async ({ page }) => {
    await page.goto("/?lang=de");
    await page.locator(`.tab[data-view="${tab}"]`).click();
    await expect(page.locator(".chart svg").first()).toBeVisible();
    // Open the disclosures too, so nothing is skipped for being folded away.
    for (const summary of await page.locator("details.figures > summary").all()) {
      await summary.click();
    }

    const marks = page.locator(".chart [data-tip]");
    const count = await marks.count();
    expect(count, "there is something to hover in the first place").toBeGreaterThan(0);

    /* One of each kind rather than all of them: what can go wrong here is a
       class nobody wired up, and that is a property of the kind. */
    const kinds = new Map();
    for (let index = 0; index < count; index += 1) {
      const mark = marks.nth(index);
      const kind = await mark.evaluate((node) => node.getAttribute("class") ?? node.tagName);
      if (!kinds.has(kind)) kinds.set(kind, mark);
    }

    for (const [kind, mark] of kinds) {
      await mark.hover({ force: true });
      // The tip belongs to the figure the mark is drawn in, not to the page.
      const shown = mark.locator("xpath=ancestor::figure[1]").locator(".chart-tip");
      await expect(shown, `${kind} shows its tooltip`).toBeVisible();
      await expect(shown, `${kind} says something`).not.toBeEmpty();
    }
  });
}
