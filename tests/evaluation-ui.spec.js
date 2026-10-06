import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { sidePort } from "./sandbox.mjs";
import { code, startStudy, twoRounds } from "./evaluation-study.mjs";

/**
 * The second round in the interface: the round switcher of the Auswertung,
 * the stance and guide question on a unit, and the evaluation section.
 *
 * What is checked is what the researcher relies on without looking twice: the
 * analysis opens on the first round, so the numbers already in the thesis are
 * the numbers on screen; a number in the evaluation section is the number in
 * its export; a stance is set with one key and lands in the file; and the
 * department the second round did not reach appears nowhere in that section.
 */

let study;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  study = await startStudy({ port: sidePort(4153) });
  await twoRounds(study);
  await study.put("/api/rounds/evaluation/guide", {
    blocks: [
      {
        id: "systeme",
        name: "5 · Systemlandschaft",
        readout: { label: "Systeme", perDepartment: { Vertrieb: ["Postfach", "Laufwerk", "Telefon"], Lager: ["Zettelwand"] } },
      },
      {
        id: "schluss",
        name: "7 · Konkrete Fragen zum Schluss",
        mandatory: [
          { id: "m-aufwand", text: "Kostet das Ablegen Zeit?", tag: "Erwarteter Aufwand" },
          { id: "m-frei", text: "Sonst noch etwas?" },
        ],
      },
    ],
  });
  await code(study, "r1-vertrieb", 2, "routine");
  await code(study, "r1-lager", 2, "routine");
  await code(study, "r2-marketing", 2, "routine", { stance: "supports", question: "m-aufwand" });
  await code(study, "r2-marketing", 4, "routine", { stance: "supports" });
  await code(study, "r2-vertrieb", 2, "routine", { stance: "supports" });
  await code(study, "r2-einkauf", 2, "routine");
  await study.patch("/api/propositions/practice", {
    criteria: [
      {
        text: "Mindestens zwei Drittel schildern keinen Mehraufwand.",
        verdict: "supported",
        round: "evaluation",
        categories: ["routine"],
        stance: "supports",
        threshold: { fraction: "2/3" },
      },
    ],
  });
  await study.post("/api/sessions", { department: "Vertrieb", round: "evaluation", folder: "r2-vertrieb" });
  await study.patch("/api/sessions/r2-vertrieb", { op: "readout", block: "systeme", item: "Postfach", state: "still" });
});

test.afterAll(() => study?.stop());

const openAnalysis = async (page, lang = "de") => {
  await page.goto(`${study.base}/?lang=${lang}#/analysis`);
  await expect(page.locator("#matrix-table")).toBeVisible();
  await expect(page.locator("#panel-table")).toBeVisible();
};

const metric = (page, index) => page.locator(".metrics .metric .value").nth(index);

test("the analysis opens on the first round, and the whole study is one choice away", async ({ page }) => {
  await openAnalysis(page);
  const choice = page.locator("#analysis-round");
  await expect(choice).toHaveValue("requirements");
  await expect(choice.locator("option")).toHaveText(["Anforderungserhebung", "Evaluation", "Alle Runden zusammen"]);
  // Two units, four departments, four interviews: the first round, as before.
  await expect(metric(page, 0)).toHaveText("2");
  await expect(metric(page, 3)).toHaveText("4");
  // The exports carry the round they are counting.
  await expect(page.locator("#matrix-export")).toHaveAttribute("href", /round=requirements/);
  await expect(page.locator(".exports-part a", { hasText: "Stichprobe" }).first()).toHaveAttribute("href", /round=requirements/);

  await choice.selectOption("all");
  await expect(metric(page, 3)).toHaveText("7");
  await expect(metric(page, 0)).toHaveText("6");
  await expect(page.locator("#matrix-export")).toHaveAttribute("href", /round=all/);
  await expect(page.locator(".round-switch")).toContainText("zählt hier zweimal");

  await page.locator("#analysis-round").selectOption("evaluation");
  await expect(metric(page, 3)).toHaveText("3");
  // The screen and the export behind its button agree.
  const href = await page.locator("#matrix-export").getAttribute("href");
  const exported = await (await page.request.get(study.base + href)).text();
  expect(exported).not.toContain("Lager");
  await expect(page.locator("#matrix-table thead")).not.toContainText("Lager");
});

test("before and after shows the compared departments only, with the export's numbers", async ({ page }) => {
  await openAnalysis(page);
  const part = page.locator("#evaluation-part");
  await expect(part.locator("h3")).toHaveText("Evaluation: dieselben Personen, zweimal befragt");
  await expect(page.locator("#panel-table tbody tr")).toHaveCount(3);
  await expect(page.locator("#panel-table tbody th")).toHaveText(["Einkauf", "Marketing", "Vertrieb"]);
  const marketing = page.locator('#panel-table tr[data-department="Marketing"]');
  await expect(marketing.locator("td").nth(0)).toContainText("Kodiereinheiten: 0");
  await expect(marketing.locator("td").nth(1)).toContainText("Kodiereinheiten: 2");
  await expect(marketing.locator("td").nth(1).locator(".stance-tag")).toHaveText(["stützt", "stützt"]);

  const sum = await page.locator("#panel-sum").textContent();
  expect(sum).toBe("Arbeitsalltag · 1 → 4");
  const href = await page.locator("#panel-export").getAttribute("href");
  expect(href).toContain("category=routine");
  const exported = await (await page.request.get(study.base + href)).text();
  expect(exported).toContain(`## ${sum}`);

  // Nothing in the whole section names the department the second round did not reach.
  await expect(part).not.toContainText("Lager");
  await expect(part).not.toContainText("Zettelwand");

  // Another category, another comparison.
  await page.locator("#panel-category").selectOption("agreement");
  await expect(page.locator("#panel-sum")).toHaveText("Absprachen · 0 → 0");
  await expect(page.locator("#panel-export")).toHaveAttribute("href", /category=agreement/);
});

test("the propositions board counts persons and lists the deviant case with its evidence", async ({ page }) => {
  await openAnalysis(page);
  const board = page.locator('.proposition-board[data-proposition="practice"]');
  await expect(board.locator('.round-status[data-round="evaluation"]')).toContainText("gestützt");
  const criterion = board.locator(".criterion").first();
  // Marketing said it twice; it is one person: two of three, not three.
  await expect(criterion.locator(".count")).toHaveText("2 von 3 Personen");
  await expect(criterion.locator(".criterion-count")).toContainText("nötig: 2");
  await expect(criterion.locator("details.person summary")).toHaveText(["Marketing · 2", "Vertrieb · 1", "Einkauf · 1"]);
  const deviant = criterion.locator("details.person").nth(2);
  await deviant.locator("summary").click();
  await expect(deviant.locator("blockquote")).toContainText("Ich lege Verträge jetzt dort ab");

  const href = await page.locator("#propositions-export").getAttribute("href");
  const exported = await (await page.request.get(study.base + href)).text();
  expect(exported).toContain("#### Erfüllt: 2 von 3 Personen");
});

test("the guide-question report and the read-out list stand in the same section", async ({ page }) => {
  await openAnalysis(page);
  const tag = page.locator('.tag-group[data-tag="Erwarteter Aufwand"]');
  await expect(tag.locator("summary")).toContainText("Erwarteter Aufwand · 1");
  await expect(tag).toContainText("„Kostet das Ablegen Zeit?“");
  await expect(page.locator("#tags-unassigned")).toHaveText(
    "Keiner Leitfadenfrage zugeordnet: 3 von 4 Kodiereinheiten dieser Runde.",
  );
  const row = page.locator('#readout-table tr[data-department="Vertrieb"] td');
  await expect(row.locator("summary")).toHaveText("Systeme");
  await expect(row.nth(1)).toHaveText("3");
  await expect(row.nth(2)).toHaveText("1");
  await expect(row.nth(3)).toHaveText("0");
  await expect(row.nth(4)).toHaveText("2");
  await expect(page.locator("#readout-table")).not.toContainText("Lager");
});

test("a stance is one key on the chosen unit, lands in the file, and a second press takes it back", async ({ page }) => {
  const file = join(study.transcripts, "r2-einkauf", "coding.json");
  await page.goto(`${study.base}/?lang=de#/code/r2-einkauf`);
  await expect(page.locator(".turn").first()).toBeVisible();
  await page.locator(".mark").first().click();
  const supports = page.locator('.stance-choice[data-stance-value="supports"]');
  await expect(supports).toHaveAttribute("aria-pressed", "false");

  await page.keyboard.press("p");
  await expect(supports).toHaveAttribute("aria-pressed", "true");
  expect(JSON.parse(readFileSync(file, "utf8")).codings[0].stance).toBe("supports");
  await expect(page.locator(".mark .stance-mark")).toHaveText("+");

  await page.keyboard.press("c");
  await expect(page.locator('.stance-choice[data-stance-value="contradicts"]')).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("c");
  await expect(page.locator('.stance-choice[data-stance-value="none"]')).toHaveAttribute("aria-pressed", "true");
  expect(JSON.parse(readFileSync(file, "utf8")).codings[0]).not.toHaveProperty("stance");

  // The guide question: `q` goes there, and the choice is written.
  await page.keyboard.press("q");
  const question = page.locator("#detail-question");
  await expect(question).toBeFocused();
  await expect(question.locator("optgroup")).toHaveCount(1);
  await question.selectOption("m-aufwand");
  await expect.poll(() => JSON.parse(readFileSync(file, "utf8")).codings[0].question).toBe("m-aufwand");
  await question.selectOption("");
  await expect.poll(() => "question" in JSON.parse(readFileSync(file, "utf8")).codings[0]).toBe(false);
});

test("a unit of the first round has no stance to give", async ({ page }) => {
  await page.goto(`${study.base}/?lang=de#/code/r1-vertrieb`);
  await expect(page.locator(".turn").first()).toBeVisible();
  await page.locator(".mark").first().click();
  await expect(page.locator("#detail")).toBeVisible();
  await expect(page.locator("#detail .stance")).toHaveCount(0);
  await expect(page.locator("#detail-question")).toHaveCount(0);
  await page.keyboard.press("p");
  expect(readFileSync(join(study.transcripts, "r1-vertrieb", "coding.json"), "utf8")).not.toContain("stance");
});

test("the section and the unit detail speak English", async ({ page }) => {
  await openAnalysis(page, "en");
  await expect(page.locator(".round-switch .field-label")).toHaveText("Round");
  await expect(page.locator("#analysis-round option").last()).toHaveText("All rounds together");
  await expect(page.locator("#evaluation-part h3")).toHaveText("Evaluation: the same persons, asked twice");
  await expect(page.locator(".criterion .count").first()).toHaveText("2 of 3 persons");
  await expect(page.locator("#panel-table thead th").first()).toHaveText("Department");
  const text = await page.locator("#evaluation-part").innerText();
  expect(text).not.toMatch(/\bev[A-Z][A-Za-z]+\b/);
  expect(text).not.toContain("Kodiereinheiten");

  await page.goto(`${study.base}/?lang=en#/code/r2-marketing`);
  await page.locator(".mark").first().click();
  await expect(page.locator("#detail .stance")).toContainText("Stance");
  await expect(page.locator('.stance-choice[data-stance-value="supports"]')).toContainText("supports");
  await page.keyboard.press("?");
  await expect(page.locator("#keys-sheet")).toContainText("Evaluation round");
});

test("a study without rounds shows neither the switcher nor the section", async ({ page }) => {
  // The suite's own sandbox: two interviews, no study.json.
  await page.goto("/?lang=de#/analysis");
  await expect(page.locator("#matrix-table")).toBeVisible();
  await expect(page.locator("#analysis-round")).toHaveCount(0);
  await expect(page.locator("#evaluation-part")).toBeEmpty();
  await expect(page.locator("#matrix-export")).not.toHaveAttribute("href", /round=/);
});
