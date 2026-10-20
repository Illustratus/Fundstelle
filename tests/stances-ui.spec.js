import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { sidePort } from "./sandbox.mjs";
import { code, startStudy, twoRounds } from "./evaluation-study.mjs";

/**
 * Stances per proposition, in the interface.
 *
 * The researcher codes the evaluation round in one pass: the category, then,
 * for every proposition a statement bears on, its stance. That has to stay
 * a keystroke where it was one — `p` and `c` on the proposition of the unit's
 * own category — and become two where it has to say more: a digit picks
 * another proposition. Colour says the proposition and nothing else.
 *
 * Then the Auswertung: stances counted in persons, the persons who said both,
 * and the persons a proposition cannot be checked with, marked with a reason
 * from the keyboard. And the criteria editor, which has to be able to say
 * what the thesis registered: by hand, among the checkable only, nobody, and
 * one criterion of several being enough.
 */

let study;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  study = await startStudy({ port: sidePort(4155) });
  await twoRounds(study);
  await code(study, "r2-marketing", 2, "routine");
  await code(study, "r2-marketing", 4, "agreement");
  await code(study, "r2-vertrieb", 2, "routine", { stances: { practice: "supports" } });
  await code(study, "r2-einkauf", 2, "routine");
});

test.afterAll(() => study?.stop());

const unitsOf = (interview) => JSON.parse(readFileSync(join(study.transcripts, interview, "coding.json"), "utf8")).codings;
const message = (page) => page.locator("#message");

async function openUnit(page, interview, turn, lang = "de") {
  await page.goto(`${study.base}/?lang=${lang}#/code/${interview}`);
  await expect(page.locator(".turn").first()).toBeVisible();
  await page.locator(`#turn-${turn} .mark`).first().click();
  await expect(page.locator("#detail .stances")).toBeVisible();
}

test("one unit stands towards two propositions, set with the keys and with the mouse", async ({ page }) => {
  await openUnit(page, "r2-marketing", 4);
  const practice = page.locator('.stance-row[data-proposition="practice"]');
  const coordination = page.locator('.stance-row[data-proposition="coordination"]');
  await expect(page.locator("#detail .stances legend")).toHaveText("Stufe je Proposition");
  // Coded under Absprachen: the keys act on its proposition first.
  await expect(coordination).toHaveAttribute("data-aimed", "true");
  await expect(practice).not.toHaveAttribute("data-aimed", "true");
  await expect(page.locator(".stance-name kbd")).toHaveText(["1", "2"]);

  await page.keyboard.press("p");
  await expect(coordination.locator('[data-stance-value="supports"]')).toHaveAttribute("aria-pressed", "true");
  await expect(message(page)).toHaveText("Proposition 2: Absprachen bleiben informell: stützt.");
  await expect.poll(() => unitsOf("r2-marketing")[1].stances).toEqual({ coordination: "supports" });

  // A digit picks another proposition; `c` then speaks to that one.
  await page.keyboard.press("1");
  await expect(practice).toHaveAttribute("data-aimed", "true");
  await expect(message(page)).toContainText("Proposition 1: Werkzeuge prägen den Arbeitsalltag gewählt");
  await page.keyboard.press("c");
  await expect.poll(() => unitsOf("r2-marketing")[1].stances).toEqual({ coordination: "supports", practice: "contradicts" });
  // The choice holds for this unit while it is in hand.
  await expect(practice).toHaveAttribute("data-aimed", "true");

  // In the margin: one sign per proposition, its dot in the proposition's colour.
  const marks = page.locator("#turn-4 .mark .stance-mark");
  await expect(marks).toHaveCount(2);
  await expect(marks.nth(0)).toHaveAttribute("data-proposition", "practice");
  await expect(marks.nth(0)).toHaveAttribute("style", /--stance-color:#6c8ebf/i);
  await expect(marks.nth(0)).toHaveAttribute("data-stance-mark", "contradicts");
  await expect(marks.nth(1)).toHaveAttribute("style", /--stance-color:#d79b00/i);
  await expect(marks.nth(1)).toHaveAttribute("title", "Proposition 2: Absprachen bleiben informell: stützt");
  // The stance itself is ink, never a colour of its own.
  const colours = await marks.evaluateAll((all) => all.map((one) => getComputedStyle(one).color));
  expect(new Set(colours).size).toBe(1);

  // The mouse: "kein Bezug" on one row takes that stance alone away.
  await practice.locator('[data-stance-value="none"]').click();
  await expect.poll(() => unitsOf("r2-marketing")[1].stances).toEqual({ coordination: "supports" });
  await expect(message(page)).toHaveText("Proposition 1: Werkzeuge prägen den Arbeitsalltag: kein Bezug.");

  // Another unit in hand: the keys are back on its own category's proposition.
  await page.locator("#turn-2 .mark").first().click();
  await expect(practice).toHaveAttribute("data-aimed", "true");
  await expect(coordination).not.toHaveAttribute("data-aimed", "true");

  // The key sheet says so.
  await page.keyboard.press("?");
  await expect(page.locator("#keys-sheet")).toContainText("Proposition wählen, auf die p und c wirken");
  await page.keyboard.press("Escape");
});

test("a unit whose category argues nothing waits for a digit before p or c", async ({ page }) => {
  const made = await study.post("/api/categories", { name: "Nebenbei", definition: "Was sonst gesagt wird." });
  expect(made.json.proposition).toBe("none");
  await code(study, "r2-vertrieb", 4, made.json.id);
  await openUnit(page, "r2-vertrieb", 4);
  await expect(page.locator('.stance-row[data-aimed="true"]')).toHaveCount(0);

  await page.keyboard.press("p");
  await expect(message(page)).toHaveText(
    "Die Kategorie dieser Einheit hängt an keiner Proposition. Erst mit einer Ziffer die Proposition wählen, dann p oder c.",
  );
  expect(unitsOf("r2-vertrieb")[1]).not.toHaveProperty("stances");

  await page.keyboard.press("2");
  await page.keyboard.press("p");
  await expect.poll(() => unitsOf("r2-vertrieb")[1].stances).toEqual({ coordination: "supports" });
});

test("a heading that claims nothing has no row, and cannot be declared so while units stand towards it", async ({ page }) => {
  await page.goto(`${study.base}/?lang=de`);
  await page.locator("#propositions-shell > summary").click();
  const shell = page.locator('[data-criteria-for="coordination"]');
  await shell.locator("> summary").click();
  const claim = shell.locator("[data-claim]");
  await expect(claim).toBeChecked();

  // Two units stand towards it: refused, with the count.
  await claim.uncheck();
  await expect(message(page)).toHaveText("2 Kodiereinheiten nehmen zu dieser Proposition Stellung. Erst ihre Stufen entfernen.");
  await expect(shell.locator("[data-claim]")).toBeChecked();

  for (const [interview, unit] of [["r2-marketing", unitsOf("r2-marketing")[1]], ["r2-vertrieb", unitsOf("r2-vertrieb")[1]]]) {
    await study.patch(`/api/interviews/${interview}/codings/${unit.id}`, { stances: null });
  }
  await shell.locator("[data-claim]").uncheck();
  await expect(message(page)).toHaveText("„Proposition 2: Absprachen bleiben informell“ trägt keine eigene Aussage mehr.");
  await expect(shell.locator("> summary")).toHaveText("Ohne eigene Aussage");
  await expect(shell.locator("[data-criterion-add]")).toHaveCount(0);
  expect(JSON.parse(readFileSync(join(study.folder, "categories.json"), "utf8")).propositions.coordination.claim).toBe(false);

  // In the unit detail only the proposition with a claim is left, without digits.
  await openUnit(page, "r2-marketing", 4);
  await expect(page.locator(".stance-row")).toHaveCount(1);
  await expect(page.locator(".stance-name kbd")).toHaveCount(0);
  await expect(page.locator(".stance-hint")).toHaveText("p stützt, c widerspricht, dieselbe Taste nimmt die Stufe zurück.");

  await study.patch("/api/propositions/coordination", { claim: true });
});

test("the board counts stances in persons, shows who said both, and marks the not checkable from the keyboard", async ({ page }) => {
  const marketing = unitsOf("r2-marketing");
  await study.patch(`/api/interviews/r2-marketing/codings/${marketing[0].id}`, { stances: { practice: "supports" } });
  await study.patch(`/api/interviews/r2-marketing/codings/${marketing[1].id}`, { stances: { practice: "contradicts" } });

  await page.goto(`${study.base}/?lang=de#/analysis`);
  const board = page.locator('.proposition-board[data-proposition="practice"]');
  await expect(board).toBeVisible();
  await expect(board.locator('[data-stance-tally="supports"] dd')).toHaveText("2 · Marketing, Vertrieb");
  await expect(board.locator('[data-stance-tally="contradicts"] dd')).toHaveText("1 · Marketing");
  await expect(board.locator('[data-stance-tally="neither"] dd')).toHaveText("1 · Einkauf");
  await expect(board.locator(".split summary")).toHaveText("Marketing · widerspricht 1, stützt 1");
  await expect(board.locator(".split")).toContainText("Abweichende Fälle: stützt und widerspricht");
  // Under one proposition a quotation carries its stance towards that one.
  await board.locator(".split summary").click();
  await expect(board.locator(".split .stance-tag")).toHaveText(["widerspricht", "stützt"]);

  // Marking without a reason is refused, and nothing is written.
  const form = board.locator(".untestable-new");
  await form.locator('[name="department"]').selectOption("Einkauf");
  await form.locator('[name="reason"]').focus();
  await page.keyboard.press("Enter");
  await expect(message(page)).toHaveText("Ohne Begründung wird niemand ausgenommen.");
  expect(readFileSync(join(study.folder, "study.json"), "utf8")).not.toContain("untestable");

  await page.keyboard.type("Hat in der Nutzungsphase nichts abgelegt.");
  await page.keyboard.press("Enter");
  await expect(message(page)).toHaveText("Einkauf ist für diese Proposition nicht prüfbar.");
  await expect(board.locator(".untestable-list li")).toHaveText(/Einkauf Hat in der Nutzungsphase nichts abgelegt\./);
  await expect(board.locator(".round-status")).toContainText("davon prüfbar: 2");
  expect(JSON.parse(readFileSync(join(study.folder, "study.json"), "utf8")).rounds[1].untestable).toEqual({
    practice: { Einkauf: "Hat in der Nutzungsphase nichts abgelegt." },
  });
  // Einkauf is no longer offered for a second mark.
  await expect(board.locator('.untestable-new [name="department"] option')).toHaveText(["Marketing", "Vertrieb"]);

  // Taken back with the button beside it.
  await board.locator("[data-untestable-remove]").click();
  await expect(message(page)).toHaveText("Einkauf zählt für diese Proposition wieder mit.");
  await expect(board.locator(".untestable-list")).toHaveCount(0);
  expect(readFileSync(join(study.folder, "study.json"), "utf8")).not.toContain("untestable");
});

test("the criteria editor says by hand, among the checkable, nobody, and one criterion of several", async ({ page }) => {
  await page.goto(`${study.base}/?lang=de`);
  await page.locator("#propositions-shell > summary").click();
  const shell = page.locator('[data-criteria-for="practice"]');
  await shell.locator("> summary").click();
  const criteria = async () => (await study.get("/api/categories")).json.propositions.practice;

  // A criterion decided by hand: no threshold to give.
  await shell.locator("[data-criterion-add]").click();
  const draft = shell.locator("[data-draft]");
  await draft.locator('select[data-c="verdict"]').selectOption("falsified");
  await draft.locator('select[data-c="kind"]').selectOption("manual");
  await expect(draft.locator('input[data-c="threshold"]')).toBeDisabled();
  await draft.locator('input[data-c="text"]').fill("Die Unkenntnis der Ablage ist die häufigste Ursache.");
  await draft.locator("[data-criterion-keep]").click();
  await expect(message(page)).toContainText("festgehalten");
  await expect.poll(async () => (await criteria()).criteria).toEqual([
    { id: "falsified-1", text: "Die Unkenntnis der Ablage ist die häufigste Ursache.", verdict: "falsified", round: "evaluation", kind: "manual" },
  ]);

  // Its evidence: the units that contradict.
  const saved = shell.locator('[data-criterion="falsified-1"]');
  await saved.locator('select[data-c="stance"]').selectOption("contradicts");
  await expect.poll(async () => (await criteria()).criteria[0].stance).toBe("contradicts");

  // To counted: the switch waits for a threshold, and is saved with it.
  await saved.locator('select[data-c="kind"]').selectOption("count");
  await expect(shell.locator('[data-criterion="falsified-1"] [role="status"]')).toHaveText(
    "Erst die Schwelle eintragen, mit ihr wird das Kriterium als gezähltes gespeichert.",
  );
  await expect(shell.locator('[data-criterion="falsified-1"] input[data-c="threshold"]')).toBeFocused();
  expect((await criteria()).criteria[0].kind).toBe("manual");
  await page.keyboard.type("0");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await criteria()).criteria[0]).toEqual({
    id: "falsified-1",
    text: "Die Unkenntnis der Ablage ist die häufigste Ursache.",
    verdict: "falsified",
    round: "evaluation",
    stance: "contradicts",
    threshold: { none: true },
  });
  await expect(shell.locator('[data-criterion="falsified-1"] input[data-c="threshold"]')).toHaveValue("0");

  // Among the checkable only.
  await shell.locator('[data-criterion="falsified-1"] select[data-c="base"]').selectOption("testable");
  await expect.poll(async () => (await criteria()).criteria[0].base).toBe("testable");

  // One criterion of the falsification is enough.
  await shell.locator('select[data-combine="falsified"]').selectOption("any");
  await expect(message(page)).toHaveText("Verknüpfung der Kriterien von „Proposition 1: Werkzeuge prägen den Arbeitsalltag“ gespeichert.");
  await expect.poll(async () => (await criteria()).combine).toEqual({ falsified: "any" });

  // And the board reads it as registered.
  await page.goto(`${study.base}/?lang=de#/analysis`);
  const criterion = page.locator('.proposition-board[data-proposition="practice"] [data-criterion="falsified-1"]');
  await expect(criterion).toHaveAttribute("data-kind", "none");
  await expect(criterion.locator(".count")).toHaveText("1 von 3 Personen nennen es");
  await expect(criterion.locator(".criterion-count")).toContainText("erlaubt: niemand");
  await expect(criterion).toContainText("Bezugsgröße nur prüfbare Befragte");
});

test("the new parts speak English", async ({ page }) => {
  await page.goto(`${study.base}/?lang=en#/analysis`);
  const board = page.locator('.proposition-board[data-proposition="practice"]');
  await expect(board.locator('[data-stance-tally="neither"] dt')).toHaveText("no bearing");
  await expect(board.locator(".untestable h6")).toHaveText("Not checkable");
  await expect(board.locator('.untestable-new button[type="submit"]')).toHaveText("Mark as not checkable");
  await expect(board.locator(".split h6")).toHaveText("Deviant cases: supports and contradicts");
  const text = await page.locator("#evaluation-part").innerText();
  expect(text).not.toMatch(/\bev[A-Z][A-Za-z]+\b/);
  expect(text).not.toMatch(/stützt|Bezugsgröße|prüfbar/);

  await openUnit(page, "r2-marketing", 4, "en");
  await expect(page.locator(".stance-hint")).toHaveText(
    "A digit picks the proposition, p supports, c contradicts, the same key takes the stance back.",
  );
  await page.locator("#propositions-shell > summary").click();
  await page.locator('[data-criteria-for="practice"] > summary').click();
  await expect(page.locator('[data-criteria-for="practice"] .criterion-claim')).toHaveText("Makes a claim of its own");
  await expect(page.locator('[data-criteria-for="practice"] select[data-c="kind"] option')).toHaveText(["counted", "by hand"]);
});
