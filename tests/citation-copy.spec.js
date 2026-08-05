import { expect, test } from "@playwright/test";

/**
 * A citation on the clipboard.
 *
 * The citations screen is where a results chapter gets written, and the most
 * repeated act there is putting a passage into the text with its source
 * attached. The tool did nothing for it: the quotation marks belong to the
 * rendered line, the source sits on a separate line above it, so every
 * quotation was selected by hand and reassembled — thirty times over a chapter,
 * each one a chance to attribute a sentence to the wrong interview.
 *
 * The string it writes is the one the exports write. A quotation copied from
 * the screen and one lifted from the appendix have to be the same string, or
 * the finished document disagrees with itself.
 */

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test.beforeEach(async ({ request }) => {
  for (const one of await (await request.get("/api/interviews")).json()) {
    const data = await (await request.get(`/api/interviews/${one.id}`)).json();
    for (const coding of data.codings) {
      await request.delete(`/api/interviews/${one.id}/codings/${coding.id}`);
    }
  }
  const data = await (await request.get("/api/interviews/interview-01")).json();
  const turn = data.turns.find((one) => !one.interviewer && one.text.length > 80);
  await request.post("/api/interviews/interview-01/codings", {
    data: { turn: turn.number, start: 0, end: 60, category: "routine", text: turn.text.slice(0, 60), reviewed: true },
  });
});

const clipboard = (page) => page.evaluate(() => navigator.clipboard.readText());

test("the quotation and where it is from land on the clipboard together", async ({
  page,
  request,
}) => {
  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator(".citation")).toHaveCount(1);

  await page.locator(".citation [data-copy]").click();
  await expect(page.locator("#message")).toContainText("Zwischenablage");

  const data = await (await request.get("/api/analysis")).json();
  const citation = Object.values(data.citations).flat()[0];
  const written = await clipboard(page);

  expect(written).toContain(citation.text);
  // The source, so a sentence cannot end up attributed to the wrong interview.
  expect(written).toContain(citation.department);
  expect(written).toContain(String(citation.turn));
  // German quotation marks, because the interface is German.
  expect(written.startsWith("„")).toBe(true);
});

test("it is the same string the appendix carries", async ({ page, request }) => {
  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="analysis"]').click();
  await page.locator(".citation [data-copy]").click();
  const written = await clipboard(page);

  const table = await (
    await request.get("/api/export/coding-table/interview-01.md?lang=de")
  ).text();
  /* Both quote the same passage with the same marks. A document that quotes one
     way in the text and another in the appendix looks like two documents. */
  const quotation = written.slice(0, written.lastIndexOf(" ("));
  expect(table).toContain(quotation.slice(1, -1));
  expect(quotation.startsWith("„") && quotation.endsWith("“")).toBe(true);
});

test("the English interface quotes the English way", async ({ page }) => {
  await page.goto("/?lang=en");
  await page.locator('.tab[data-view="analysis"]').click();
  await page.locator(".citation [data-copy]").click();
  const written = await clipboard(page);
  expect(written.startsWith("“")).toBe(true);
  expect(written).toContain("Turn");
  expect(written).not.toContain("Beitrag");
});

test("a browser that refuses the clipboard is not left looking successful", async ({ page }) => {
  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="analysis"]').click();
  // What a plain-HTTP page on another host gives you.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("denied")) },
      configurable: true,
    });
  });
  await page.locator(".citation [data-copy]").click();
  const message = page.locator("#message");
  await expect(message).toContainText("verweigert");
  await expect(message).toHaveAttribute("data-kind", "error");
});
