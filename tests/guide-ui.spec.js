import { expect, test } from "@playwright/test";

import { sidePort } from "./sandbox.mjs";
import { SECOND_ROUND, startStudy } from "./evaluation-study.mjs";

/**
 * Rounds, the guide of a round, and the criteria of a proposition — on screen.
 *
 * The researcher writes the second round's guide in the tool, so that the
 * interview mode can show it and the appendix can be printed from it. That is
 * form work: every field saves when it is left and says so, the keyboard
 * reaches all of it, and what the material already refers to cannot be dropped
 * — with the reason in the reader's language rather than a field that quietly
 * springs back.
 */

let study;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  study = await startStudy({ port: sidePort(4162) });
});

test.afterAll(() => study?.stop());

const message = (page) => page.locator("#message");

async function openCatalog(page, lang = "de") {
  await page.goto(`${study.base}/?lang=${lang}#/catalog`);
  await page.locator("#guide-editor").waitFor();
  const shell = page.locator(".guide-shell");
  if (!(await shell.evaluate((element) => element.open))) await shell.locator("> summary").click();
}

const rounds = async () => (await study.get("/api/rounds")).json.rounds;
const guide = async (round = "evaluation") => (await study.get(`/api/rounds/${round}/guide`)).json.blocks;
const block = (page, name) =>
  page.locator(".guide-block").filter({ has: page.locator(`input[data-block-field="name"][value="${name}"]`) });

test("a study asked once shows no criteria, and offers to make its first round", async ({ page }) => {
  await page.goto(`${study.base}/?lang=de`);
  await page.locator("#propositions-shell > summary").click();
  await expect(page.locator(".proposition").first()).toBeVisible();
  await expect(page.locator("#propositions .criteria")).toHaveCount(0);

  await openCatalog(page);
  await expect(page.locator(".guide-shell > summary")).toHaveText("Erhebungsrunden und Leitfaden (0)");
  await expect(page.locator(".guide-rounds")).toContainText("Noch keine Erhebungsrunde.");
  expect(await rounds()).toEqual([]);
});

test("rounds are made, renamed and filled with the mouse, and each save says so", async ({ page }) => {
  await openCatalog(page);
  const add = page.locator('[data-form="round-new"]');
  await add.locator("input").fill("Anforderungserhebung");
  await add.locator("button").click();
  await expect(message(page)).toHaveText("Erhebungsrunde „Anforderungserhebung“ angelegt.");
  await add.locator("input").fill("Evaluation");
  await add.locator("button").click();
  await expect(message(page)).toHaveText("Erhebungsrunde „Evaluation“ angelegt.");
  await expect.poll(async () => (await rounds()).map((round) => round.id)).toEqual(["anforderungserhebung", "evaluation"]);

  const name = page.locator('[data-round="evaluation"] input[data-round-name]');
  await name.fill("Evaluationsrunde");
  await page.locator(".guide-note").click();
  await expect(message(page)).toHaveText("Die Erhebungsrunde heißt jetzt „Evaluationsrunde“.");
  await expect.poll(async () => (await rounds())[1].name).toBe("Evaluationsrunde");

  await page.locator(".guide-assign > summary").click();
  for (const folder of Object.keys(SECOND_ROUND)) {
    await page.locator(`select[data-assign="${folder}"]`).selectOption("evaluation");
    await expect(message(page)).toContainText("gehört jetzt zur Runde „Evaluationsrunde“.");
  }
  // The disclosure stayed open through every save.
  await expect(page.locator(".guide-assign")).toHaveAttribute("open", "");
  // Every save says the same sentence, so the last one is waited for in the file.
  await expect.poll(async () => (await rounds())[1].interviews.length).toBe(Object.keys(SECOND_ROUND).length);
  const [first, second] = await rounds();
  expect(first.interviews).toHaveLength(4);
  expect(second.interviews.sort()).toEqual(Object.keys(SECOND_ROUND).sort());
  await expect(page.locator('[data-round="evaluation"] .count')).toHaveText("3 Interviews · 0 geplant");

  // A round people belong to cannot go; the reason is given, the round stays.
  await page.locator('[data-round="anforderungserhebung"] [data-round-remove]').click();
  await expect(message(page)).toHaveText(
    "Zu dieser Erhebungsrunde gehören noch 4 Interviews. Erst anderen Runden zuordnen, dann entfernen.",
  );
  expect(await rounds()).toHaveLength(2);
});

test("a guide is written with the mouse: blocks, items, tags, read-out lists", async ({ page }) => {
  await openCatalog(page);
  await expect(page.locator("select[data-guide-round]")).toHaveValue("evaluation");
  await expect(page.locator(".guide-shell")).toContainText("Dieser Leitfaden hat noch keinen Block.");

  const newBlock = page.locator('[data-form="block-new"]');
  await newBlock.locator("input").fill("1 · Ablage");
  await newBlock.locator("button").click();
  await expect(message(page)).toHaveText("Block „1 · Ablage“ angelegt.");
  await newBlock.locator("input").fill("Warmfrage");
  await newBlock.locator("button").click();
  await expect(message(page)).toHaveText("Block „Warmfrage“ angelegt.");

  const ablage = block(page, "1 · Ablage");
  await ablage.locator('textarea[data-block-field="prompt"]').fill("Erzähl vom letzten Mal.");
  await page.locator(".guide-note").click();
  await expect(message(page)).toHaveText("Leitfaden gespeichert.");

  const checklist = ablage.locator('[data-form="item-new"][data-kind="checklist"]');
  await checklist.locator("input").fill("Bestätigungsschritt");
  await checklist.locator("button").click();
  await expect(ablage.locator('[data-kind="checklist"] input[data-item-field="text"]')).toHaveValue(
    "Bestätigungsschritt",
  );
  const mandatory = ablage.locator('[data-form="item-new"][data-kind="mandatory"]');
  await mandatory.locator("input").fill("Stand da etwas, das du nicht gesagt hast?");
  await mandatory.locator("button").click();
  const question = ablage.locator('[data-kind="mandatory"]').first();
  await expect(question.locator('input[data-item-field="text"]')).toHaveValue(
    "Stand da etwas, das du nicht gesagt hast?",
  );
  await question.locator('input[data-item-field="condition"]').fill("wenn festgehalten");
  await question.locator('input[data-item-field="tag"]').fill("Gegenprobe");
  await page.locator(".guide-note").click();
  await expect(message(page)).toHaveText("Leitfaden gespeichert.");

  // The warm-up goes first.
  await block(page, "Warmfrage").locator('[data-block-move="-1"]').click();
  await expect(page.locator('.guide-block input[data-block-field="name"]').first()).toHaveValue("Warmfrage");

  const warm = block(page, "Warmfrage");
  await warm.locator("[data-readout-create]").click();
  await expect(warm.locator("input[data-readout-label]")).toBeVisible();
  await warm.locator("input[data-readout-label]").fill("Genannte Systeme");
  const department = warm.locator('[data-form="readout-department-new"]');
  await department.locator("input").fill("Vertrieb");
  await department.locator("button").click();
  await warm.locator('[data-department="Vertrieb"] textarea').fill("Postfach\nLaufwerk\n");
  await page.locator(".guide-note").click();
  await expect(message(page)).toHaveText("Leitfaden gespeichert.");

  await expect.poll(async () => (await guide())[0].readout?.perDepartment.Vertrieb).toEqual(["Postfach", "Laufwerk"]);
  const blocks = await guide();
  expect(blocks.map((one) => one.name)).toEqual(["Warmfrage", "1 · Ablage"]);
  expect(blocks[0].readout).toEqual({ label: "Genannte Systeme", perDepartment: { Vertrieb: ["Postfach", "Laufwerk"] } });
  expect(blocks[1].prompt).toBe("Erzähl vom letzten Mal.");
  expect(blocks[1].checklist.map((item) => item.text)).toEqual(["Bestätigungsschritt"]);
  expect(blocks[1].mandatory).toEqual([
    {
      id: expect.stringMatching(/^m-/),
      text: "Stand da etwas, das du nicht gesagt hast?",
      condition: "wenn festgehalten",
      tag: "Gegenprobe",
    },
  ]);

  // The export the appendix takes is offered right there.
  await expect(page.locator("#guide-export")).toHaveAttribute(
    "href",
    "/api/export/guide.md?round=evaluation&lang=de",
  );
});

test("the whole guide can be worked without the mouse", async ({ page }) => {
  await openCatalog(page);
  const newBlock = page.locator('[data-form="block-new"] input');
  await newBlock.focus();
  await page.keyboard.type("Abschluss");
  await page.keyboard.press("Enter");
  await expect(message(page)).toHaveText("Block „Abschluss“ angelegt.");
  // The field stays in hand for the next block.
  await expect(newBlock).toBeFocused();
  await expect(newBlock).toHaveValue("");

  // Alt+↑ moves the block whose name holds the focus, and the focus goes with it.
  const name = block(page, "Abschluss").locator('input[data-block-field="name"]');
  await name.focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(page.locator('.guide-block input[data-block-field="name"]').nth(1)).toHaveValue("Abschluss");
  await expect(page.locator('.guide-block input[data-block-field="name"]').nth(1)).toBeFocused();
  await expect.poll(async () => (await guide()).map((one) => one.name)).toEqual(["Warmfrage", "Abschluss", "1 · Ablage"]);

  // Renamed by typing and Enter.
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Abschluss und Ausblick");
  await page.keyboard.press("Enter");
  await expect(message(page)).toHaveText("Leitfaden gespeichert.");
  await expect.poll(async () => (await guide())[1].name).toBe("Abschluss und Ausblick");

  // Items: added with Enter, moved with Alt+↑, removed from the keyboard.
  const closing = page.locator(".guide-block").nth(1);
  const add = closing.locator('[data-form="item-new"][data-kind="checklist"] input');
  await add.focus();
  for (const text of ["Offenes", "Wünsche"]) {
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
    await expect(closing.locator(`input[data-item-field="text"][value="${text}"]`)).toHaveCount(1);
    await expect(add).toBeFocused();
  }
  await closing.locator('input[data-item-field="text"][value="Wünsche"]').focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(closing.locator('input[data-item-field="text"]').first()).toHaveValue("Wünsche");
  await expect(closing.locator('input[data-item-field="text"]').first()).toBeFocused();
  await expect.poll(async () => (await guide())[1].checklist.map((item) => item.text)).toEqual(["Wünsche", "Offenes"]);

  await closing.locator('[data-item="' + (await guide())[1].checklist[1].id + '"] [data-item-remove]').focus();
  await page.keyboard.press("Enter");
  await expect(message(page)).toHaveText("Leitfaden gespeichert.");
  await expect.poll(async () => (await guide())[1].checklist.map((item) => item.text)).toEqual(["Wünsche"]);

  // A block goes the same way.
  await block(page, "Abschluss und Ausblick").locator("[data-block-remove]").focus();
  await page.keyboard.press("Enter");
  await expect(message(page)).toHaveText("Block „Abschluss und Ausblick“ entfernt.");
  await expect.poll(async () => (await guide()).map((one) => one.name)).toEqual(["Warmfrage", "1 · Ablage"]);
});

test("what an interview already refers to cannot be dropped, and the reason is given", async ({ page }) => {
  const [, ablage] = await guide();
  const item = ablage.checklist[0];
  const log = await study.post("/api/sessions", { department: "Lager", round: "evaluation" });
  expect(log.status).toBe(201);
  const op = (body) => study.patch(`/api/sessions/${log.json.id}`, body);
  await op({ op: "start" });
  await op({ op: "block", block: ablage.id });
  await op({ op: "tick", item: item.id });

  await openCatalog(page);
  const row = page.locator(`[data-item="${item.id}"]`);
  await row.locator("[data-item-remove]").click();
  await expect(message(page)).toHaveText(
    "„Bestätigungsschritt“ ist in einem Gespräch abgehakt oder einer Kodiereinheit zugeordnet und kann nicht entfallen.",
  );
  await expect(message(page)).toHaveAttribute("data-kind", "error");
  await expect(row).toHaveCount(1);
  expect((await guide())[1].checklist.map((one) => one.id)).toEqual([item.id]);

  // Rewording it is fine: it stays the same item.
  await row.locator('input[data-item-field="text"]').fill("Bestätigung des Entwurfs");
  await row.locator('input[data-item-field="text"]').press("Enter");
  await expect(message(page)).toHaveText("Leitfaden gespeichert.");
  await expect.poll(async () => (await guide())[1].checklist).toEqual([{ id: item.id, text: "Bestätigung des Entwurfs" }]);

  // The block the conversation started cannot go either — in English too.
  await openCatalog(page, "en");
  await block(page, "1 · Ablage").locator("[data-block-remove]").click();
  await expect(message(page)).toContainText("has already been started in 1");
  await expect(block(page, "1 · Ablage")).toHaveCount(1);

  await study.del(`/api/sessions/${log.json.id}`);
});

test("criteria are recorded beside their proposition, and every change is saved", async ({ page }) => {
  await page.goto(`${study.base}/?lang=de`);
  await page.locator("#propositions-shell > summary").click();
  const shell = page.locator('[data-criteria-for="practice"]');
  await expect(shell.locator("> summary")).toHaveText("Kriterien (0)");
  await shell.locator("> summary").click();

  // From the keyboard: the button opens a draft and hands the focus to it.
  await shell.locator("[data-criterion-add]").focus();
  await page.keyboard.press("Enter");
  const draft = shell.locator("[data-draft]");
  await expect(draft.locator('select[data-c="verdict"]')).toBeFocused();
  await draft.locator('select[data-c="verdict"]').selectOption("falsified");
  await draft.locator('select[data-c="round"]').selectOption("evaluation");
  await draft.locator('input[data-c="threshold"]').fill("2/3");
  await draft.locator('select[data-c="stance"]').selectOption("contradicts");
  await draft.getByLabel("Arbeitsalltag").check();
  await draft.locator('input[data-c="text"]').fill("Zwei Drittel widersprechen.");
  // Nothing is written until the draft is recorded.
  expect((await study.get("/api/categories")).json.propositions.practice.criteria).toBeUndefined();
  await draft.locator("[data-criterion-keep]").click();
  await expect(message(page)).toHaveText(
    "Kriterium für „Proposition 1: Werkzeuge prägen den Arbeitsalltag“ festgehalten.",
  );
  await expect(shell.locator("> summary")).toHaveText("Kriterien (1)");
  const criteria = async () => (await study.get("/api/categories")).json.propositions.practice.criteria;
  await expect.poll(criteria).toEqual([
    {
      id: "falsified-1",
      text: "Zwei Drittel widersprechen.",
      verdict: "falsified",
      round: "evaluation",
      categories: ["routine"],
      stance: "contradicts",
      threshold: { fraction: "2/3" },
    },
  ]);

  const saved = shell.locator('[data-criterion="falsified-1"]');
  await saved.locator('input[data-c="threshold"]').fill("3");
  await saved.locator('input[data-c="threshold"]').press("Enter");
  await expect(message(page)).toHaveText(
    "Kriterien von „Proposition 1: Werkzeuge prägen den Arbeitsalltag“ gespeichert.",
  );
  await saved.getByLabel("Störungen").check();
  await expect(message(page)).toContainText("gespeichert");
  await saved.locator('select[data-c="stance"]').selectOption("");
  await expect.poll(async () => (await criteria())[0].stance).toBeUndefined();
  await expect.poll(async () => (await criteria())[0]).toMatchObject({ threshold: { atLeast: 3 }, categories: ["routine", "routine.disruption"] });

  // A threshold that is none is refused with the reason, and the field shows what holds.
  await saved.locator('input[data-c="threshold"]').fill("viele");
  await saved.locator('input[data-c="threshold"]').press("Enter");
  await expect(message(page)).toHaveText(
    "Die Schwelle wird als atLeast (ganze Zahl ab 1), fraction (etwa 2/3) oder none (niemand) erwartet.",
  );
  await expect(saved.locator('input[data-c="threshold"]')).toHaveValue("3");

  await saved.locator("[data-criterion-remove]").click();
  await expect(message(page)).toHaveText(
    "Kriterium von „Proposition 1: Werkzeuge prägen den Arbeitsalltag“ entfernt.",
  );
  await expect(shell.locator("> summary")).toHaveText("Kriterien (0)");
  await expect.poll(criteria).toBeUndefined();
});

test("the guide is offered with the other appendix exports, in the reader's language", async ({ page }) => {
  await page.goto(`${study.base}/?lang=en#/analysis`);
  const link = page.locator('a[href^="/api/export/guide.md"]');
  await expect(link).toHaveText("Interview guide · Evaluationsrunde");
  await expect(link).toHaveAttribute("href", "/api/export/guide.md?round=evaluation&lang=en");
  // A round without a guide has nothing to offer.
  await expect(link).toHaveCount(1);
});
