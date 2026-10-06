import { expect, test } from "@playwright/test";

import { sidePort } from "./sandbox.mjs";
import { startStudy, twoRounds } from "./evaluation-study.mjs";

/**
 * Interview mode: the guide beside a live conversation.
 *
 * The researcher talks to somebody over a call and has this screen beside the
 * call window. Every check here is about one of the things that would hurt in
 * that moment: a key that does something else, a press that is not stored, a
 * reload that loses the place, a mandatory question that slips through, or a
 * planned conversation that shows up in the study's counts before a single
 * word of it has been transcribed.
 */

const BLOCKS = [
  {
    id: "warmfrage",
    name: "Warmfrage",
    prompt: "Wie war Ihre Woche?",
    checklist: [],
    mandatory: [{ id: "m-warm", text: "Seit wann sind Sie im Bereich?" }],
  },
  {
    id: "1-ablage",
    name: "1 · Ablage (Wissen festhalten)",
    prompt: "Erzählen Sie, wie Sie zuletzt etwas festgehalten haben.",
    checklist: [
      { id: "c-confirm", text: "Bestätigungsschritt", tag: "Erwarteter Aufwand" },
      { id: "c-where", text: "Ablageort" },
    ],
    mandatory: [{ id: "m-how", text: "Wie lief das?", condition: "falls abgelegt", tag: "Akzeptanz" }],
  },
  {
    id: "5-systeme",
    name: "5 · Systemlandschaft",
    prompt: "",
    checklist: [],
    mandatory: [],
    readout: {
      label: "Genannte Systeme",
      perDepartment: { Vertrieb: ["Postfach", "Laufwerk", "Chat"], Marketing: ["Wiki"] },
    },
  },
];

let study;
const FOLDER = "evaluation-vertrieb";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  study = await startStudy({ port: sidePort(4163) });
  await twoRounds(study);
  await study.put("/api/rounds/evaluation/guide", { blocks: BLOCKS });
});

test.afterAll(() => study?.stop());

test.beforeEach(async () => {
  for (const one of (await study.get("/api/sessions")).json.sessions) {
    if (!one.transcript) await study.del(`/api/sessions/${one.id}`);
  }
});

const log = async () => (await study.get(`/api/sessions/${FOLDER}`)).json;

async function plan() {
  const made = await study.post("/api/sessions", { department: "Vertrieb", round: "evaluation" });
  expect(made.status).toBe(201);
}

/** Opens the planned conversation the way the researcher does: header button, then the list. */
async function openPlanned(page, lang = "de") {
  await page.goto(`${study.base}/?lang=${lang}`);
  await page.locator("#live-open").click();
  await page.locator(`.live-session-open[data-id="${FOLDER}"]`).click();
  await expect(page.locator("#live-view")).toBeVisible();
}

test("a planned interview is created from the coding view and counts nowhere", async ({ page }) => {
  await page.goto(`${study.base}/?lang=de`);
  await page.waitForSelector(".turn");
  const button = page.locator("#live-open");
  await expect(button).toHaveText("Gespräch");
  await button.click();

  const sheet = page.locator("#live-sheet");
  await expect(sheet).toBeVisible();
  // The round being asked now is the one with a guide.
  await expect(page.locator("#live-round")).toHaveValue("evaluation");
  await page.locator("#live-department").fill("Vertrieb");
  await page.locator("#live-new button[type=submit]").click();

  await expect(page.locator("#live-view")).toBeVisible();
  await expect(page.locator("#view-code .edition")).toBeHidden();
  await expect(page.locator(".live-who b")).toHaveText("Vertrieb");
  await expect(page.locator(".live-block-name")).toHaveText("Warmfrage");

  // Not an interview: not in the list, not in the picker, not in a count.
  const interviews = (await study.get("/api/interviews")).json;
  expect(interviews.some((one) => one.id === FOLDER)).toBe(false);
  const options = await page.locator("#interview-choice option").evaluateAll((all) =>
    all.map((one) => one.value),
  );
  expect(options).not.toContain(FOLDER);
  const analysis = (await study.get("/api/analysis")).json;
  expect(JSON.stringify(analysis)).not.toContain(FOLDER);

  // It is listed as an open conversation instead.
  await page.locator("#live-close").click();
  await expect(page.locator("#view-code .edition")).toBeVisible();
  await expect(button).toHaveText("Gespräch · 1");
  await button.click();
  await expect(page.locator(`.live-session-open[data-id="${FOLDER}"]`)).toContainText("geplant");
});

test("recording start, block start and ticks are kept with times, all from the keyboard", async ({
  page,
}) => {
  await plan();
  await openPlanned(page);

  await expect(page.locator("#live-record")).toBeVisible();
  await page.keyboard.press(" ");
  await expect(page.locator("#live-clock")).toBeVisible();
  await expect(page.locator("#live-saved")).toContainText("gespeichert");
  expect((await log()).t0).toBeTruthy();

  await page.keyboard.press("b");
  await expect(page.locator(".live-started")).toContainText("begonnen bei");
  expect((await log()).blockStarts.map((one) => one.block)).toEqual(["warmfrage"]);

  // The mandatory question is item 1 and stays loud until it is ticked.
  const warm = page.locator('.live-item[data-item="m-warm"]');
  await expect(warm).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("1");
  await expect(warm).toHaveAttribute("aria-pressed", "true");
  const first = await log();
  expect(typeof first.ticks["m-warm"]).toBe("number");

  // Untick is the same key.
  await page.keyboard.press("1");
  await expect(warm).toHaveAttribute("aria-pressed", "false");
  expect((await log()).ticks).toEqual({});
  await page.keyboard.press("1");

  // Next block; mandatory first, then the keywords in the guide's order.
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".live-block-name")).toHaveText("1 · Ablage (Wissen festhalten)");
  await expect(page.locator(".live-prompt")).toHaveText(BLOCKS[1].prompt);
  await expect(page.locator('.live-item[data-item="m-how"] .live-condition')).toHaveText("falls abgelegt");
  await expect(page.locator('.live-item[data-item="c-confirm"] .live-tag')).toHaveText("Erwarteter Aufwand");
  await page.keyboard.press("b");
  await page.keyboard.press("3");
  await expect(page.locator('.live-item[data-item="c-where"]')).toHaveAttribute("aria-pressed", "true");
  const now = await log();
  expect(now.current).toBe("1-ablage");
  expect(Object.keys(now.ticks).sort()).toEqual(["c-where", "m-warm"]);

  // A start pressed by mistake is taken back.
  await page.keyboard.press("Shift+B");
  await expect(page.locator(".live-started")).toHaveCount(0);
  expect((await log()).blockStarts.map((one) => one.block)).toEqual(["warmfrage"]);

  // The overview says which mandatory questions are still open.
  await expect(page.locator('.live-overview button[data-show="1-ablage"]')).toContainText("1 Pflicht offen");
  await expect(page.locator('.live-overview button[data-show="warmfrage"]')).not.toContainText("offen");
});

test("the keys stay with the guide and never reach the transcript behind it", async ({ page }) => {
  await plan();
  await openPlanned(page);
  for (const key of ["j", "s", "Enter", "/"]) await page.keyboard.press(key);
  await expect(page.locator("#coding-bar")).toBeHidden();
  await expect(page.locator("#search")).not.toBeFocused();
  await expect(page.locator("#keys-sheet")).toBeHidden();
  // „?" is the key list of this screen.
  await page.keyboard.press("?");
  await expect(page.locator("#live-keys")).toHaveAttribute("open", "");
  await expect(page.locator("#keys-sheet")).toBeHidden();
});

test("the read-out list shows this department's systems and marks still, no longer and open", async ({
  page,
}) => {
  await plan();
  await openPlanned(page);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".live-block-name")).toHaveText("5 · Systemlandschaft");
  await expect(page.locator(".live-readout-item")).toHaveText(["Postfach", "Laufwerk", "Chat"]);
  // Marketing's list is not this conversation's.
  await expect(page.locator(".live-readout")).not.toContainText("Wiki");

  await page.keyboard.press("r");
  await expect(page.locator('[data-focus="readout-0-still"]')).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-focus="readout-0-still"]')).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab");
  await expect(page.locator('[data-focus="readout-1-no-longer"]')).toBeFocused();
  await page.keyboard.press(" ");
  await expect(page.locator(".live-readout-count")).toHaveText("3 genannt · 1 noch · 1 nicht mehr · 1 offen");
  expect((await log()).readout).toEqual({ "5-systeme": { Postfach: "still", Laufwerk: "no-longer" } });

  // The pressed one again: back to open.
  await page.locator('[data-focus="readout-0-still"]').click();
  await expect(page.locator('[data-focus="readout-0-still"]')).toHaveAttribute("aria-pressed", "false");
  expect((await log()).readout).toEqual({ "5-systeme": { Laufwerk: "no-longer" } });
});

test("notes are written with their time, changed and deleted, and a deletion can be undone", async ({
  page,
}) => {
  await plan();
  await openPlanned(page);
  await page.keyboard.press(" ");
  await expect(page.locator("#live-clock")).toBeVisible();

  await page.keyboard.press("n");
  await expect(page.locator("#live-note")).toBeFocused();
  await page.keyboard.type("Zögert beim Bestätigungsschritt.");
  await page.keyboard.press("Enter");
  const note = page.locator(".live-note");
  await expect(note).toHaveCount(1);
  await expect(note.locator(".live-note-text")).toHaveText("Zögert beim Bestätigungsschritt.");
  await expect(note.locator("time")).toHaveText(/^\d+:\d{2}$/);
  // The field is empty and still has the caret, for the next one.
  await expect(page.locator("#live-note")).toHaveValue("");
  await expect(page.locator("#live-note")).toBeFocused();
  const [stored] = (await log()).notes;
  expect(stored).toMatchObject({ block: "warmfrage", text: "Zögert beim Bestätigungsschritt." });
  expect(typeof stored.at).toBe("number");

  // Esc leaves the field; the keys belong to the screen again.
  await page.keyboard.press("Escape");
  await expect(page.locator("#live-note")).not.toBeFocused();

  await note.locator(".live-note-edit").click();
  const edit = page.locator(".live-note-input");
  await expect(edit).toBeFocused();
  await edit.fill("Zögert lange beim Bestätigungsschritt.");
  await page.keyboard.press("Enter");
  await expect(note.locator(".live-note-text")).toHaveText("Zögert lange beim Bestätigungsschritt.");
  expect((await log()).notes[0]).toMatchObject({ id: stored.id, at: stored.at, text: "Zögert lange beim Bestätigungsschritt." });

  await note.locator(".live-note-delete").click();
  await expect(page.locator(".live-note")).toHaveCount(0);
  expect((await log()).notes).toEqual([]);
  await page.locator("#message-action").click();
  await expect(page.locator(".live-note")).toHaveCount(1);
  expect((await log()).notes[0]).toMatchObject({ block: "warmfrage", at: stored.at, text: "Zögert lange beim Bestätigungsschritt." });

  // A note half typed in one block is still there after looking at another.
  await page.keyboard.press("n");
  await page.keyboard.type("halb");
  await page.keyboard.press("Escape");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#live-note")).toHaveValue("");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#live-note")).toHaveValue("halb");
});

test("a reload in the middle of the conversation lands back on the same block with everything kept", async ({
  page,
}) => {
  await plan();
  await openPlanned(page);
  await page.keyboard.press(" ");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("b");
  await page.keyboard.press("2");
  await expect(page.locator('.live-item[data-item="c-confirm"]')).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(page.locator("#live-view")).toBeVisible();
  await expect(page.locator(".live-block-name")).toHaveText("1 · Ablage (Wissen festhalten)");
  await expect(page.locator('.live-item[data-item="c-confirm"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".live-started")).toContainText("begonnen bei");
  // The clock runs from the stored start, not from the reload.
  await expect(page.locator("#live-clock")).not.toHaveText("—");

  // And the keys work straight away.
  await page.keyboard.press("1");
  await expect(page.locator('.live-item[data-item="m-how"]')).toHaveAttribute("aria-pressed", "true");
});

test("correcting the recording start moves every time with it", async ({ page }) => {
  await plan();
  await openPlanned(page);
  await page.keyboard.press(" ");
  await page.keyboard.press("b");
  await expect(page.locator(".live-started")).toBeVisible();
  const before = await log();

  await page.keyboard.press("t");
  await expect(page.locator("#live-correct-seconds")).toBeFocused();
  await page.keyboard.type("5");
  await page.keyboard.press("Enter");
  await expect(page.locator("#live-correct")).toHaveCount(0);

  const after = await log();
  expect(Date.parse(before.t0) - Date.parse(after.t0)).toBe(5000);
  expect(after.blockStarts[0].at).toBeCloseTo(before.blockStarts[0].at + 5, 1);
});

test("the summary names what was not asked and says where the transcript goes", async ({ page }) => {
  await plan();
  await openPlanned(page);
  await page.keyboard.press(" ");
  await page.keyboard.press("b");
  await page.keyboard.press("1");
  await page.keyboard.press("n");
  await page.keyboard.type("Gute Stimmung.");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");

  await page.keyboard.press("e");
  const summary = page.locator("#live-summary");
  await expect(summary).toBeVisible();
  await expect(page.locator("#live-body")).toBeHidden();
  await expect(summary.locator(".live-summary-open li")).toHaveCount(1);
  await expect(summary.locator(".live-summary-open")).toContainText("Wie lief das?");
  await expect(summary).toContainText("1 · Ablage (Wissen festhalten) · 5 · Systemlandschaft");
  await expect(summary).toContainText("3 genannt · 0 noch · 0 nicht mehr · 3 offen");
  await expect(summary).toContainText("Gute Stimmung.");
  await expect(summary.locator(".live-import-hint")).toContainText(FOLDER);

  // From the open question straight to its block.
  await summary.locator(".live-summary-goto").first().click();
  await expect(summary).toBeHidden();
  await expect(page.locator(".live-block-name")).toHaveText("1 · Ablage (Wissen festhalten)");

  await page.keyboard.press("e");
  await expect(summary).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(summary).toBeHidden();
});

test("the screen speaks English when the interface does", async ({ page }) => {
  await plan();
  await page.goto(`${study.base}/?lang=en`);
  await expect(page.locator("#live-open")).toHaveText("Interview · 1");
  await page.locator("#live-open").click();
  await expect(page.locator("#live-sheet h2")).toHaveText("Conduct an interview");
  await expect(page.locator(".live-session-open")).toContainText("planned");
  await page.locator(".live-session-open").click();
  await expect(page.locator("#live-record")).toContainText("Recording");
  await page.keyboard.press(" ");
  await page.keyboard.press("b");
  await expect(page.locator(".live-started")).toContainText("began at");
  await expect(page.locator("#live-saved")).toContainText("saved");
  await expect(page.locator("#live-block-start")).toContainText("Running");
  await expect(page.locator(".live-label").first()).toHaveText("Mandatory questions");
  await page.keyboard.press("e");
  await expect(page.locator(".live-summary-title")).toHaveText("After the interview");
  await expect(page.locator(".live-import-hint")).toContainText("Fundstelle puts the blocks in");
});

test("a failed save says so and leaves the note in its field", async ({ page }) => {
  await plan();
  await openPlanned(page);
  await page.route("**/api/sessions/**", (route) =>
    route.request().method() === "PATCH" ? route.abort("connectionrefused") : route.continue(),
  );
  await page.keyboard.press("n");
  await page.keyboard.type("Wichtig.");
  await page.keyboard.press("Enter");
  await expect(page.locator("#live-saved")).toHaveText("nicht gespeichert");
  await expect(page.locator("#message")).toContainText("antwortet nicht");
  await expect(page.locator("#live-note")).toHaveValue("Wichtig.");
});

test("an empty planned interview can be discarded, its folder with it", async ({ page }) => {
  await plan();
  await page.goto(`${study.base}/?lang=de`);
  await page.locator("#live-open").click();
  await page.locator(`.live-session-discard[data-id="${FOLDER}"]`).click();
  await expect(page.locator(`.live-session-open[data-id="${FOLDER}"]`)).toHaveCount(0);
  expect((await study.get("/api/sessions")).json.sessions.some((one) => one.id === FOLDER)).toBe(false);
});

test("a study asked once never sees the button", async ({ page }) => {
  // The shared sandbox has no rounds.
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await expect(page.locator("#live-open")).toBeAttached();
  await expect(page.locator("#live-open")).toBeHidden();
});
