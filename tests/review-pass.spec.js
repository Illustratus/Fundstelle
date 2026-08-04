import { expect, test } from "@playwright/test";

/**
 * The end of a review pass.
 *
 * Watching the pass rather than reasoning about it turned up two sentences that
 * said more than was true, on one screen, at the same moment.
 *
 * „Every coding unit is reviewed" is what the tool said when the last
 * suggestion in the interview on screen was confirmed — while the study still
 * carried suggestions in another interview. The status bar beside it had said
 * the honest thing for a while: this one is done, so many are open elsewhere.
 * The message did not, and the message is what is in the reader's eye at that
 * moment, because a pass is walked with the keyboard and the sidebar is not
 * where anybody is looking.
 *
 * And the picker went on offering „6 open" for the interview whose sixth and
 * last suggestion had just been confirmed. Its counts are loaded once from the
 * server and were never touched again.
 *
 * Both are the same mistake in the end: a figure that stopped being true and
 * nothing that noticed.
 */

const FIRST = "interview-01";
const SECOND = "interview-02";

/** A machine pre-coding: every unit a suggestion until somebody confirms it. */
async function suggest(request, interview, howMany) {
  const data = await (await request.get(`/api/interviews/${interview}`)).json();
  for (const coding of data.codings) {
    await request.delete(`/api/interviews/${interview}/codings/${coding.id}`);
  }
  const codable = data.turns.filter((turn) => !turn.interviewer && turn.text.length > 80);
  for (const turn of codable.slice(0, howMany)) {
    await request.post(`/api/interviews/${interview}/codings`, {
      data: { turn: turn.number, start: 0, end: 70, category: "routine", text: turn.text.slice(0, 70) },
    });
  }
}

test("the picker stops claiming units are open once they are confirmed", async ({
  page,
  request,
}) => {
  await suggest(request, FIRST, 3);
  await suggest(request, SECOND, 0);

  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  const picker = page.locator("#interview-choice");
  await expect(picker.locator("option", { hasText: "Interview 1" })).toContainText("3");

  await page.locator("#transcript").focus();
  await page.keyboard.press("Enter"); // into the pass
  await page.keyboard.press("Enter"); // confirm one
  await expect(picker.locator("option", { hasText: "Interview 1" })).toContainText("2");

  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  /* Nothing open, nothing said about it. A count that is only right until the
     next confirmation is worse than no count. */
  await expect(picker.locator("option", { hasText: "Interview 1" })).not.toContainText("offen");
});

test("the end of one interview is not the end of the study", async ({ page, request }) => {
  await suggest(request, FIRST, 2);
  await suggest(request, SECOND, 2);

  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await page.locator("#transcript").focus();
  for (let i = 0; i < 3; i += 1) await page.keyboard.press("Enter");

  const message = page.locator("#message");
  await expect(message).toBeVisible();
  // Which of the two it means, said where the reader is looking.
  await expect(message).toContainText("Dieses Interview ist durchgesehen");
  await expect(message).toContainText("2");
  await expect(message).not.toContainText("Jede Kodiereinheit ist geprüft");

  // And the sidebar says the same thing, with the way to get there.
  await expect(page.locator("#status")).toContainText("in anderen Interviews");
  await expect(page.locator("#review-elsewhere")).toBeVisible();
});

test("when the study really is done, it says so plainly", async ({ page, request }) => {
  await suggest(request, FIRST, 2);
  await suggest(request, SECOND, 0);

  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await page.locator("#transcript").focus();
  for (let i = 0; i < 3; i += 1) await page.keyboard.press("Enter");

  await expect(page.locator("#message")).toContainText("Jede Kodiereinheit ist geprüft");
  await expect(page.locator("#status")).not.toContainText("in anderen Interviews");
});

test("a unit that lost its place is not something left to review", async ({ page, request }) => {
  /* It cannot be confirmed, because there is nothing to confirm it against.
     Counting it would leave a pass that can never be finished. */
  await suggest(request, FIRST, 1);
  await suggest(request, SECOND, 0);
  const data = await (await request.get(`/api/interviews/${FIRST}`)).json();
  const one = data.codings[0];
  await request.patch(`/api/interviews/${FIRST}/codings/${one.id}`, {
    data: { text: "Diesen Satz gibt es im Transkript nicht mehr." },
  });

  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await page.locator("#transcript").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#message")).toContainText("Jede Kodiereinheit ist geprüft");
  await expect(page.locator("#interview-choice").locator("option", { hasText: "Interview 1" }))
    .not.toContainText("offen");
});
