import { expect, test } from "@playwright/test";

import { removeProfiles, writeProfiles } from "./role-profiles.mjs";

/**
 * The role profiles, and what they are shown to stand on.
 *
 * A requirement is built in the tool; a profile is not. It is written while
 * reading a department's citations, in the study's own document, and it arrives
 * here as a file of paraphrases with locators behind them. Prose like that can
 * be wrong in two ways no reader of the chapter would catch: it can cite a turn
 * nobody spoke, and it can be a self-portrait — everything a department says
 * about itself, nothing anybody else says about it — while reading exactly like
 * a profile carried by four interviews.
 *
 * Both are what this view exists to make visible, so both are what is checked.
 * A profile without a voice of its own says so; a locator without a turn is
 * marked rather than quietly dropped; a pillar the material says nothing about
 * stands there as "open" instead of being left out, because a pillar left out
 * and a pillar shown to be empty read the same and are not the same finding.
 *
 * And the way back: every citation is a button into the transcript. That is the
 * whole point of keeping the profiles here rather than in the document they are
 * written in — a bracketed key nobody follows becomes a passage one click away.
 */

test.beforeAll(() => writeProfiles());

/* The file is the study's, not the tool's: what the sandbox had before these
   checks ran is nothing, and that is what it goes back to. */
test.afterAll(() => removeProfiles());

test("every profile says what it rests on, and every locator leads back", async ({ page }) => {
  await page.goto("/?lang=de#/roles");

  const marketing = page.locator('.role[data-id="marketing"]');
  await expect(marketing.locator("h3")).toHaveText("Marketing");
  // Four citations: two of its own turns behind one paraphrase, one turn behind
  // another, and one from the other interview.
  await expect(marketing.locator(".numbers")).toContainText("4");
  await expect(marketing.locator(".numbers")).toContainText("3 aus eigener Stimme, 1 von anderen");

  /* A pillar the material says nothing about is shown to be empty rather than
     left out — otherwise a reader cannot tell "nobody said anything" from "not
     written yet". */
  const structure = marketing.locator(".pillar", { hasText: "Struktur" });
  await expect(structure).toHaveClass(/empty/);
  await expect(structure.locator(".open-mark")).toHaveText("offen");

  // The way back into the transcript, which is why the profiles are kept here.
  await marketing.locator(".citation-chip").first().click();
  await expect(page).toHaveURL(/#\/code\/interview-01/);
  await expect(page.locator("#transcript .turn.focused")).toHaveAttribute("data-turn", "2");
});

test("a profile nobody but others speaks about says so", async ({ page }) => {
  await page.goto("/?lang=de#/roles");

  const einkauf = page.locator('.role[data-id="einkauf"]');
  await expect(einkauf.locator(".numbers")).toContainText("0 aus eigener Stimme");
  await expect(einkauf.locator(".numbers .open-mark").first()).toHaveText("kein eigenes Interview");

  /* The other half of the same claim, drawn: the bar of a department that was
     interviewed carries its own colour, and this one cannot. */
  const inFigure = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#role-charts .chart")]
      .at(0)
      .querySelectorAll("[data-row]");
    return [...rows].map((one) => ({
      row: one.getAttribute("data-row"),
      department: one.getAttribute("data-department"),
      value: Number(one.getAttribute("data-value")),
    }));
  });
  const own = inFigure.filter((one) => one.row === one.department);
  expect(own.map((one) => one.row)).toEqual(expect.arrayContaining(["Marketing", "Vertrieb"]));
  expect(own.some((one) => one.row === "Einkauf")).toBe(false);
});

test("a locator without a turn is marked rather than dropped", async ({ page }) => {
  await page.goto("/?lang=de#/roles");

  const einkauf = page.locator('.role[data-id="einkauf"]');
  await expect(einkauf.locator(".numbers")).toContainText("1 Belege ohne Beitrag im Transkript");
  const missing = einkauf.locator(".citation-chip.missing");
  await expect(missing).toHaveCount(1);
  await expect(missing).toHaveText(/9999/);
});

test("the counts on screen are the counts in the answer", async ({ page, request }) => {
  const data = await (await request.get("/api/roles?lang=de")).json();

  /* The one thing that must not drift: the figure, the head of a card and the
     number the study would quote all come from one join, so they can only
     disagree if somebody counts twice. */
  const evidence = data.roles.reduce((n, role) => n + role.evidence, 0);
  expect(data.voices.reduce((n, row) => n + row.sum, 0)).toBe(evidence);
  expect(data.evidencePerPillar.reduce((n, row) => n + row.sum, 0)).toBe(evidence);
  expect(data.roles.find((role) => role.id === "einkauf").own).toBe(0);

  await page.goto("/?lang=de#/roles");
  await expect(page.locator(".metrics .metric").nth(2).locator(".value")).toHaveText(
    String(evidence),
  );
  await expect(page.locator(".metrics .metric").nth(3).locator(".value")).toHaveText(
    String(data.roles.reduce((n, role) => n + role.others, 0)),
  );
});

test("the profiles come back out as the section they were written as", async ({ request }) => {
  const written = await (await request.get("/api/export/role-profiles.md?lang=de")).text();

  /* The way back. The section in the study's document was the source of the
     file, so the file has to be able to produce it again — verbatim, citation
     markers and all, or the document and the file drift apart the first time
     one of them is edited. */
  expect(written).toContain("**Marketing**");
  expect(written).toContain("- *Aufgaben:*");
  expect(written).toContain(
    "  - hält die Unterlagen für die Kampagnen bereit [@interview1{Beitrag 2}]",
  );
  // A pillar nobody said anything about is written out as open, not left away.
  expect(written).toContain("- *Struktur:* offen");
});

test("no profiles is not an error", async ({ page }) => {
  removeProfiles();
  await page.goto("/?lang=de#/roles");
  await expect(page.locator("#roles .empty-state")).toBeVisible();
  await expect(page.locator("#roles h2")).toHaveText("Rollenprofile der Bereiche");
  writeProfiles();
});
