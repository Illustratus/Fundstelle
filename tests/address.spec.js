import { expect, test } from "@playwright/test";

/**
 * Where you are, written in the address bar.
 *
 * The tool held its place only in memory. Somebody who had scrolled halfway
 * through the evaluation and reloaded — because a transcript had changed on
 * disk, because the browser had been restarted, because anything — landed back
 * in the coding view of whichever interview this browser happened to remember.
 * The back button led out of the tool altogether rather than to the view
 * before. And a second reader could not be pointed at a screen: every address
 * was the same address.
 *
 * So the view is in the hash, and where the view is about one interview, so is
 * the interview. What that has to hold up to is here: a reload lands where it
 * left, back and forward walk the views, and a pasted address opens the
 * interview it names rather than the one the recipient last had open.
 */

test("a reload lands in the view it was left in", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#interview-choice")).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toMatch(/^#\/code\//);

  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#view-analysis")).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe("#/analysis");

  await page.reload();
  await expect(page.locator("#view-analysis")).toBeVisible();
  await expect(page.locator("#view-code")).toBeHidden();
  await expect(page.locator('.tab[data-view="analysis"]')).toHaveAttribute(
    "aria-current",
    "true",
  );
});

test("back and forward walk the views rather than leaving the tool", async ({ page }) => {
  await page.goto("/");
  await page.locator('.tab[data-view="catalog"]').click();
  await expect(page.locator("#view-catalog")).toBeVisible();
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#view-analysis")).toBeVisible();

  await page.goBack();
  await expect(page.locator("#view-catalog")).toBeVisible();
  await page.goBack();
  await expect(page.locator("#view-code")).toBeVisible();
  await page.goForward();
  await expect(page.locator("#view-catalog")).toBeVisible();
});

test("an address that names an interview opens that one", async ({ page }) => {
  // What the last session left behind, so that the address has something to
  // outrank rather than agreeing with it by accident.
  await page.goto("/");
  await page.locator("#interview-choice").selectOption("interview-01");
  await expect(page.locator("#header-subtitle")).toContainText("Marketing");

  await page.goto("/#/code/interview-02");
  await expect(page.locator("#interview-choice")).toHaveValue("interview-02");

  // And switching by hand writes it back, so the address stays copyable.
  await page.locator("#interview-choice").selectOption("interview-01");
  await expect
    .poll(() => page.evaluate(() => location.hash))
    .toBe("#/code/interview-01");
});

test("an address nobody can honour falls back rather than opening the wrong thing", async ({
  page,
}) => {
  await page.goto("/#/code/interview-that-is-not-there");
  await expect(page.locator("#view-code")).toBeVisible();
  // Not the named one — it does not exist — but the address is corrected to
  // whatever was actually opened, so it never lies about what is on screen.
  await expect
    .poll(() => page.evaluate(() => location.hash))
    .toMatch(/^#\/code\/interview-0[12]$/);

  await page.goto("/#/nonsense");
  await expect(page.locator("#view-code")).toBeVisible();
  await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/code\//);
});

/**
 * The header carries three things that are only about one interview: the
 * picker, reading in a transcript, and the line naming department and date.
 * The catalog and the evaluation read the whole study. A picker sitting above
 * a study-wide cross table does not merely do nothing — it reads as the scope
 * of the table below it, which is the one misreading that turns a correct
 * figure into a wrong sentence in a thesis.
 */
test("the header offers only what the view standing in front of it can use", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#interview-choice")).toBeVisible();
  await expect(page.locator("#import")).toBeVisible();
  await expect(page.locator("#header-subtitle")).toContainText("Marketing");

  for (const view of ["catalog", "analysis"]) {
    await page.locator(`.tab[data-view="${view}"]`).click();
    await expect(page.locator(`#view-${view}`)).toBeVisible();
    await expect(page.locator("#interview-choice")).toBeHidden();
    await expect(page.locator("#import")).toBeHidden();
    await expect(page.locator("#header-subtitle")).not.toContainText("Marketing");
  }

  // What stays: the keys, the interface reference, the language and the
  // brightness are about the tool, not about the material.
  await expect(page.locator("#keys")).toBeVisible();
  await expect(page.locator("#api-docs")).toBeVisible();
  await expect(page.locator("#language")).toBeVisible();
  await expect(page.locator("#theme")).toBeVisible();

  await page.locator('.tab[data-view="code"]').click();
  await expect(page.locator("#interview-choice")).toBeVisible();
  await expect(page.locator("#header-subtitle")).toContainText("Marketing");
});

/** An address typed straight at a study-wide view opens it, without a detour
 *  through the coding view and without waiting for a transcript to load. */
test("a link leads straight into the view it names", async ({ page }) => {
  await page.goto("/#/analysis");
  await expect(page.locator("#view-analysis")).toBeVisible();
  await expect(page.locator("#view-code")).toBeHidden();
  expect(await page.evaluate(() => location.hash)).toBe("#/analysis");
});
