import { expect, test } from "@playwright/test";

/**
 * When the tool stops answering.
 *
 * This is a program people leave open. The laptop sleeps, the terminal running
 * `node server.js` gets closed, a reboot happens over lunch — and the next
 * thing anybody does is try to code a passage.
 *
 * What they got was „Failed to fetch": the browser's own words, in the
 * browser's own language, inside a tool that is otherwise bilingual to the last
 * file. It answers neither of the two questions actually being asked — was that
 * saved, and what do I do now — and it faded after six seconds, which for a
 * state rather than an event leaves the reader wondering whether they saw it.
 *
 * Nothing is retried automatically. A request that never reached the server is
 * safe to send again, and one that timed out on the way back is not; the tool
 * cannot tell those apart from here, and quietly writing a coding unit twice
 * would be a worse failure than the one it is recovering from.
 */

const cut = (page) => page.route("**/api/**", (route) => route.abort("connectionrefused"));

test.beforeEach(async ({ request }) => {
  // These share the sandbox with every other spec, and one of them below codes
  // a passage on purpose.
  for (const one of await (await request.get("/api/interviews")).json()) {
    const data = await (await request.get(`/api/interviews/${one.id}`)).json();
    for (const coding of data.codings) {
      await request.delete(`/api/interviews/${one.id}/codings/${coding.id}`);
    }
  }
});

test("a failed save says so in the language of the interface", async ({ page }) => {
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await cut(page);

  await page.keyboard.press("j");
  await page.keyboard.press("s");
  await expect(page.locator("#coding-bar")).toBeVisible();
  await page.keyboard.press("1");

  const message = page.locator("#message");
  await expect(message).toBeVisible();
  await expect(message).not.toContainText("Failed to fetch");
  // The two questions the reader has, answered in the order they ask them.
  await expect(message).toContainText("antwortet nicht");
  await expect(message).toContainText("Nichts von diesem Schritt wurde gespeichert");
  await expect(message).toContainText("node server.js");
});

test("and in English when the interface is English", async ({ page }) => {
  await page.goto("/?lang=en");
  await page.waitForSelector(".turn");
  await cut(page);

  await page.keyboard.press("j");
  await page.keyboard.press("s");
  await page.keyboard.press("1");
  const message = page.locator("#message");
  await expect(message).toContainText("is not answering");
  await expect(message).not.toContainText("antwortet nicht");
});

test("the notice stays put, because the state does", async ({ page }) => {
  /* Every next thing the reader tries will fail the same way. A notice that
     fades leaves them unsure it was ever there. */
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await cut(page);

  await page.keyboard.press("j");
  await page.keyboard.press("s");
  await page.keyboard.press("1");
  await expect(page.locator("#message")).toBeVisible();
  await page.waitForTimeout(7000);
  await expect(page.locator("#message"), "still there after it would have faded").toBeVisible();
});

test("what was typed is still in the field afterwards", async ({ page }) => {
  // The one thing that must not happen: the text goes and the tool cannot take
  // it back either.
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await page.locator("#note-shell summary").click();
  const written = "Auffällig: die Ablage wird als Ordnerfrage erzählt.";
  await page.locator("#note").fill(written);

  await cut(page);
  await page.locator("#note").blur();
  await expect(page.locator("#message")).toContainText("antwortet nicht");
  await expect(page.locator("#note")).toHaveValue(written);
});

test("an answer from the server keeps its own wording", async ({ page }) => {
  /* The new message is only for a request that never arrived. A server that
     answers with a refusal has already said something better than "not
     answering" — here, that a place carries exactly one category. */
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await page.keyboard.press("j");
  await page.keyboard.press("s");
  await page.keyboard.press("1");
  await expect(page.locator(".segment")).toHaveCount(1);

  // The same passage again: the server refuses it, in its own words.
  await page.keyboard.press("Escape");
  await page.keyboard.press("k");
  await page.keyboard.press("s");
  await page.keyboard.press("1");
  const message = page.locator("#message");
  await expect(message).toBeVisible();
  await expect(message).not.toContainText("antwortet nicht");
});

test("when it comes back, work goes on without a reload", async ({ page }) => {
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");

  // Down…
  let down = true;
  await page.route("**/api/**", (route) => (down ? route.abort("connectionrefused") : route.fallback()));
  await page.keyboard.press("j");
  await page.keyboard.press("s");
  await page.keyboard.press("1");
  await expect(page.locator("#message")).toContainText("antwortet nicht");
  await expect(page.locator(".segment")).toHaveCount(0);

  // …and up again. The passage is still selected, so the same keystroke saves.
  down = false;
  await page.keyboard.press("1");
  await expect(page.locator(".segment")).toHaveCount(1);
  await expect(page.locator("#message")).not.toContainText("antwortet nicht");
});
