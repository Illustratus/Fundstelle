import { expect, test } from "@playwright/test";

/**
 * Two things found by sitting in the screen a coder sits in for hours.
 *
 * The first is a dead end. The search covers what people said, which is right: a
 * guide prompt is the question rather than the answer, and a category name is
 * the tool's word rather than the respondent's. But the method makes those two
 * share their vocabulary with the material — that is what a deductive category
 * *is* — so searching a study whose first guide prompt is called "Ablage" for
 * the word Ablage gives "kein Treffer" while the word stands on the screen three
 * times. Correct, and it reads like a broken search. It says where the word does
 * turn up now, which is the difference between a dead end and an answer.
 *
 * The second is smaller and plainer: a placeholder that did not fit its field
 * and was cut off mid-word — "Neue Anforderung aus dieser Stel". One field, 14
 * pixels, and exactly the kind of thing that makes a careful tool look careless.
 * Both languages are checked, because a translation is where this comes back.
 */

const CATEGORIES = ["routine", "routine.disruption", "agreement"];

async function coded(request) {
  const interviews = await (await request.get("/api/interviews")).json();
  for (const one of interviews) {
    const data = await (await request.get(`/api/interviews/${one.id}`)).json();
    for (const coding of data.codings) {
      await request.delete(`/api/interviews/${one.id}/codings/${coding.id}`);
    }
    const codable = data.turns.filter((turn) => !turn.interviewer && turn.text.length > 90);
    for (const [index, turn] of codable.slice(0, 3).entries()) {
      await request.post(`/api/interviews/${one.id}/codings`, {
        data: {
          turn: turn.number,
          start: 0,
          end: 60,
          category: CATEGORIES[index % CATEGORIES.length],
          text: turn.text.slice(0, 60),
          reviewed: true,
        },
      });
    }
  }
  return interviews;
}

/**
 * Every visible single-line field whose placeholder does not fit in it.
 *
 * With room to spare, and that is the point. „The proposition in one sentence"
 * needed 220 of its 225 pixels here and 241 of them on the build server, where
 * the fonts are the distribution's rather than this machine's: the same build
 * was fine on one and cut a word in half on the other, and the check that let it
 * through had measured it correctly on both. A placeholder that fits by five
 * pixels does not fit; it is a placeholder waiting for the next machine.
 *
 * A twentieth of the field is the margin, and the number is measured rather than
 * felt. The build server draws these fonts about a tenth wider than this machine
 * does, so what is asked for here is what is left *after* that tenth: the
 * tightest honest wording in the interface — the English requirement field, at
 * 19% spare here — keeps 12% there, and the two search fields, the widest text
 * anywhere near a boundary, keep 21%. A wording written to fit exactly, like
 * that proposition placeholder at 2%, is the only kind this refuses.
 *
 * Which is the point: this is not a check that everything is roomy. It is a
 * check that nothing was written to the edge of the field it stands in, because
 * that edge moves from machine to machine and the wording does not.
 */
const SPARE = 0.05;

async function clipped(page) {
  return page.evaluate((spare) =>
    [...document.querySelectorAll("input[placeholder]")]
      .filter((field) => field.offsetParent)
      .map((field) => {
        const style = getComputedStyle(field);
        const probe = document.createElement("span");
        probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${style.font}`;
        probe.textContent = field.placeholder;
        document.body.append(probe);
        const needed = probe.getBoundingClientRect().width;
        probe.remove();
        const room =
          field.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        return { text: field.placeholder, needed: Math.round(needed), room: Math.round(room) };
      })
      // A textarea wraps its placeholder; a single-line field cuts it off.
      .filter((field) => field.needed > field.room * (1 - spare)),
    SPARE,
  );
}

test("a word nobody said, but which is on the screen, is accounted for", async ({ page, request }) => {
  const interviews = await coded(request);
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await page.locator("#interview-choice").selectOption(interviews[0].id);
  await expect(page.locator(".turn").first()).toBeVisible();

  /* A word that is on the screen and in nobody's mouth. Found rather than
     assumed: whether a fixture happens to say a category's own name out loud is
     not something this check should depend on, and skipping when it does would
     leave the check hollow exactly when it passes. */
  const { categories } = await (await request.get("/api/categories")).json();
  const data = await (await request.get(`/api/interviews/${interviews[0].id}`)).json();
  const spoken = data.turns.map((turn) => turn.text.toLowerCase()).join(" ");
  const onScreen = [
    ...data.sections.map((section) => section.short || section.name),
    ...categories.map((category) => category.name),
  ];
  const named = onScreen.find(
    (word) => word.length > 3 && !spoken.includes(word.toLowerCase()),
  );
  expect(named, `something on screen that nobody said, among ${onScreen.join(" / ")}`).toBeTruthy();

  await page.locator(".search-bar input").fill(named);
  await expect(page.locator("#search-status")).toHaveText("kein Treffer");
  /* Not a shrug: the rule it followed, and where the word actually is. */
  const note = page.locator("#search-elsewhere");
  await expect(note).toBeVisible();
  await expect(note).toContainText("was gesagt wurde");
  await expect(note).toContainText(named);
});

test("a word nobody said anywhere at all stays quiet", async ({ page, request }) => {
  await coded(request);
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await page.locator(".search-bar input").fill("xyzzykein");
  await expect(page.locator("#search-status")).toHaveText("kein Treffer");
  // Nothing to say is not the same as something to say, and furniture around
  // nothing is the mistake this tool keeps not making.
  await expect(page.locator("#search-elsewhere")).toBeHidden();
});

test("a word said in another interview still offers that interview", async ({ page, request }) => {
  const interviews = await coded(request);
  test.skip(interviews.length < 2, "needs a second interview to point at");
  const other = await (await request.get(`/api/interviews/${interviews[1].id}`)).json();
  const word = other.turns.find((turn) => !turn.interviewer).text.split(/\s+/).find((one) => one.length > 7);

  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await page.locator("#interview-choice").selectOption(interviews[0].id);
  await expect(page.locator(".turn").first()).toBeVisible();
  await page.locator(".search-bar input").fill(word);
  // The study-wide offer is the older behaviour and must not have been replaced
  // by the explanation added beside it.
  const field = page.locator("#search-elsewhere");
  await expect(field).toBeVisible();
  await expect(field.locator(".elsewhere").first()).toBeVisible();
});

test("no placeholder is cut off in either language", async ({ page, request }) => {
  await coded(request);
  for (const language of ["de", "en"]) {
    await page.goto(`/?lang=${language}`);
    await page.waitForSelector(".turn");
    expect(await clipped(page), `${language}: the transcript screen`).toEqual([]);

    // The detail panel, which is where the one that was cut off lived.
    await page.locator(".segment").first().click();
    await expect(page.locator("#detail")).toBeVisible();
    expect(await clipped(page), `${language}: a coding selected`).toEqual([]);

    await page.locator('.tab[data-view="catalog"]').click();
    await expect(page.locator("#catalog")).toBeVisible();
    expect(await clipped(page), `${language}: the catalog`).toEqual([]);
  }
});
