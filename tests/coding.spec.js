import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const SANDBOX = join(fileURLToPath(new URL("..", import.meta.url)), ".sandbox");
const transcriptFile = (id) => join(SANDBOX, "transcripts", id, "final.md");

const FIRST = "interview-01";
const SECOND = "interview-02";

// Untouched state of the transcripts, to restore it after every run. Otherwise
// each correction would carry over into the next check.
const ORIGINAL = new Map(
  [FIRST, SECOND].map((id) => [id, readFileSync(transcriptFile(id), "utf8")]),
);

/** Correct the test transcript, the way it happens while listening again. */
function editTranscript(id, before, after) {
  const path = transcriptFile(id);
  const content = readFileSync(path, "utf8");
  if (!content.includes(before)) throw new Error(`Not found: ${before}`);
  writeFileSync(path, content.replace(before, after), "utf8");
}

/**
 * The grid table of the coding guide wraps cell contents onto the column width;
 * a wording can therefore be spread over several lines. For the check the
 * content counts, not the line layout — so flatten it.
 */
function flatGuide(text) {
  return text
    .split("\n")
    .map((line) =>
      line.startsWith("|")
        ? line
            .replace(/^\|/, "")
            .replace(/\|\s*$/, "")
            .split("|")
            .map((cell) => cell.trim())
            .join(" ")
        : line,
    )
    .join(" ")
    .replace(/\s+/g, " ");
}

/**
 * The checks follow the method, not the interface: select a coding unit, assign
 * it exactly one category, keep the location, record an anchor example and a
 * coding rule, and analyse at the end.
 */

/** Select characters of a speaker turn without bothering the mouse. */
async function selectText(page, turn, from, to) {
  await page.locator(`#turn-${turn}`).scrollIntoViewIfNeeded();
  await page.evaluate(
    ({ turn, from, to }) => {
      const field = document.querySelector(`.text[data-turn="${turn}"]`);
      const range = document.createRange();
      let counted = 0;
      let start = null;
      let end = null;
      const walk = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const length = node.nodeValue.length;
          if (start === null && counted + length >= from) start = [node, from - counted];
          if (end === null && counted + length >= to) end = [node, to - counted];
          counted += length;
          return;
        }
        if (node.classList?.contains("mark-sup")) return;
        for (const child of node.childNodes) walk(child);
      };
      walk(field);
      range.setStart(...start);
      range.setEnd(...end);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      field.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    },
    { turn, from, to },
  );
}

/** Select and expect the coding bar to open. */
async function mark(page, turn, from, to) {
  await selectText(page, turn, from, to);
  await expect(page.locator("#coding-bar")).toBeVisible();
}

/** Select and assign. Waits until the unit stands in the text. */
async function code(page, turn, from, to, category) {
  const before = await page.locator(`#turn-${turn} .segment`).count();
  await mark(page, turn, from, to);
  await page.locator(`.choice[data-category="${category}"]`).click();
  await expect(page.locator(`#turn-${turn} .segment`)).toHaveCount(before + 1);
}

/** Add an inductive category without going through the interface. */
async function addCategory(request, name, definition = "Am Material gebildet.") {
  await request.post("/api/categories", { data: { name, definition } });
}

/** A machine-suggested assignment, the way an import creates it. */
async function suggest(request, turn, from, to, category, text) {
  return request.post(`/api/interviews/${FIRST}/codings`, {
    data: { turn, start: from, end: to, category, text },
  });
}

/** Every run starts without codings and without inductive categories. */
test.beforeEach(async ({ page, request }) => {
  for (const [id, content] of ORIGINAL) {
    if (readFileSync(transcriptFile(id), "utf8") !== content) {
      writeFileSync(transcriptFile(id), content, "utf8");
    }
  }

  const interviews = await (await request.get("/api/interviews")).json();
  for (const interview of interviews) {
    const data = await (await request.get(`/api/interviews/${interview.id}`)).json();
    for (const coding of data.codings) {
      await request.delete(`/api/interviews/${interview.id}/codings/${coding.id}`);
    }
    if (data.memo) await request.patch(`/api/interviews/${interview.id}`, { data: { memo: "" } });
  }
  const { requirements } = await (await request.get("/api/requirements")).json();
  for (const requirement of requirements) {
    await request.delete(`/api/requirements/${requirement.id}`);
  }

  const { categories } = await (await request.get("/api/categories")).json();
  for (const category of categories.filter((c) => c.origin === "inductive")) {
    await request.delete(`/api/categories/${encodeURIComponent(category.id)}`);
  }
  // Definitions and coding rules of the deductive categories are maintainable
  // and therefore have to be reset just like the codings.
  for (const category of categories.filter((c) => c.origin === "deductive")) {
    const fields = {};
    if (category.initialDefinition) fields.definition = category.initialDefinition;
    if (category.codingRules?.length) fields.codingRules = [];
    if (category.memo) fields.memo = "";
    if (Object.keys(fields).length) {
      await request.patch(`/api/categories/${encodeURIComponent(category.id)}`, { data: fields });
    }
  }

  await page.goto("/");
  await expect(page.locator(".turn")).not.toHaveCount(0);
});

test("the transcript appears with sections, locations and voices", async ({ page }) => {
  await expect(page.locator(".turn")).toHaveCount(123);
  await expect(page.locator(".section-head")).toHaveCount(9);
  await expect(page.locator("#sections .section-entry")).toHaveCount(9);

  // The location is the turn number from the final version, gaps included.
  await expect(page.locator("#turn-10 .location")).toHaveText("10");
  await expect(page.locator("#turn-11")).toHaveCount(0);
  await expect(page.locator("#turn-13 .location")).toHaveText("13");

  // Interviewer turns are recognizably set off as context.
  await expect(page.locator('#turn-1[data-interviewer="true"]')).toHaveCount(1);
  await expect(page.locator('#turn-4[data-interviewer="false"]')).toHaveCount(1);
});

test("the deductive start category system stands ready in full", async ({ page }) => {
  const names = await page.locator("#categories .category .name").allInnerTexts();
  expect(names.map((name) => name.trim())).toEqual(["Arbeitsalltag", "Störungen", "Absprachen"]);
  await page.locator('.category[data-category="routine"]').click();
  await expect(page.locator('[data-detail="routine"]')).toContainText("wiederkehrende Abläufe");
});

test("a selection becomes a coding unit and appears in the apparatus", async ({ page }) => {
  await mark(page, 4, 0, 35);
  await expect(page.locator("#coding-bar-quote")).toContainText("Klar, ich bin seit dem Frühjahr");

  await page.locator('.choice[data-category="routine"]').click();
  await expect(page.locator("#coding-bar")).toBeHidden();

  const segment = page.locator("#turn-4 .segment");
  await expect(segment).toHaveCount(1);
  await expect(segment).toContainText("Klar, ich bin seit dem Frühjahr im");
  await expect(page.locator("#turn-4 .mark .what")).toContainText("Arbeitsalltag");
  await expect(page.locator("#turn-4 .mark .sign")).toHaveText("a");
  await expect(page.locator("#turn-4 .mark-sup")).toHaveText("a");
  await expect(page.locator('.category[data-category="routine"] .count')).toHaveText("1");
});

test("codings survive a reload at the same location", async ({ page }) => {
  await code(page, 6, 0, 30, "agreement");

  await page.reload();
  await expect(page.locator("#turn-6 .segment")).toHaveCount(1);
  await expect(page.locator("#turn-6 .mark .what")).toContainText("Absprachen");
});

test("a coding unit carries exactly one category", async ({ page }) => {
  await code(page, 8, 0, 40, "routine");

  await mark(page, 8, 20, 60);
  await page.locator('.choice[data-category="agreement"]').click();
  await expect(page.locator("#message")).toContainText("überschneidet");
  await expect(page.locator("#turn-8 .segment")).toHaveCount(1);
});

/* The interviewer's words are the instrument, not the material. Coded, they
   would come back as evidence attributed to the department that was asked. */

test("a turn of the interviewer cannot be coded", async ({ page }) => {
  // `mark` waits for the bar, which is exactly what must not appear here.
  await selectText(page, 1, 0, 30);

  // The bar does not even open: saying "this is the interviewer" and then
  // offering the categories anyway was an invitation, not a rule.
  await expect(page.locator("#message")).toContainText("Beitrag des Interviewers");
  await expect(page.locator("#coding-bar")).toBeHidden();
  await expect(page.locator("#turn-1 .segment")).toHaveCount(0);
});

test("the server refuses an interviewer turn, whatever asks", async ({ request }) => {
  const refused = await request.post(`/api/interviews/${FIRST}/codings`, {
    headers: { "accept-language": "de" },
    data: { turn: 1, start: 0, end: 25, category: "routine", text: "Vielen Dank" },
  });
  expect(refused.status()).toBe(409);
  expect((await refused.json()).code).toBe("errorInterviewerTurn");

  // A turn that is not in the transcript at all was never checked either.
  const missing = await request.post(`/api/interviews/${FIRST}/codings`, {
    data: { turn: 9999, start: 0, end: 25, category: "routine", text: "nowhere" },
  });
  expect(missing.status()).toBe(404);
  expect((await missing.json()).code).toBe("errorUnknownTurn");

  // Re-anchoring moves a unit to another turn and obeys the same rule.
  const made = await request.post(`/api/interviews/${FIRST}/codings`, {
    data: { turn: 4, start: 0, end: 25, category: "routine", text: "Klar, ich bin seit" },
  });
  expect(made.status()).toBe(201);
  const moved = await request.patch(
    `/api/interviews/${FIRST}/codings/${(await made.json()).id}`,
    { data: { turn: 1, start: 0, end: 20, text: "Vielen Dank" } },
  );
  expect(moved.status()).toBe(409);
});

test("a long category list stays reachable from the keyboard", async ({ page, request }) => {
  // A category system that has grown on the material: past nine there are no
  // more digits, and past a dozen the list scrolls.
  for (const name of ["Medienbruch", "Zugriffsrechte", "Wiederfinden", "Benennungschaos",
    "Doppelablage", "Übergabe", "Suchpfade", "Schattensysteme", "Rückfrageschleifen"]) {
    await addCategory(request, name);
  }
  await page.reload();
  await mark(page, 4, 0, 40);

  const choices = page.locator("#coding-bar-choices .choice");
  await expect(choices).toHaveCount(12);
  // Only the first nine carry a digit; the rest are reached by typing or by tab.
  const numbered = await page.locator("#coding-bar-choices .key").evaluateAll(
    (keys) => keys.filter((key) => key.textContent.trim()).length,
  );
  expect(numbered).toBe(9);

  // The list scrolls rather than pushing the bar off the screen — and what is
  // below the fold can still be reached and used.
  const last = choices.last();
  await last.focus();
  await expect(last).toBeFocused();
  await expect(last).toBeInViewport();

  await page.keyboard.press("Enter");
  await expect(page.locator("#turn-4 .segment")).toHaveCount(1);
  await expect(page.locator("#turn-4 .mark .what")).toContainText("Rückfrageschleifen");
});

test("typing brings a category out of reach back into reach", async ({ page, request }) => {
  for (const name of ["Medienbruch", "Zugriffsrechte", "Wiederfinden", "Benennungschaos",
    "Doppelablage", "Übergabe", "Suchpfade", "Schattensysteme", "Rückfrageschleifen"]) {
    await addCategory(request, name);
  }
  await page.reload();
  await mark(page, 4, 0, 40);

  // "Rückfrageschleifen" sits twelfth and has no digit; typing narrows the list
  // until it is the only one left, and then Enter takes it.
  await page.keyboard.type("schleif");
  await expect(page.locator("#coding-bar-choices .choice")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.locator("#turn-4 .mark .what")).toContainText("Rückfrageschleifen");
});

test("the filter takes umlauts, as a German keyboard sends them", async ({ page, request }) => {
  await addCategory(request, "Rückfrageschleifen");
  await addCategory(request, "Medienbruch");
  await page.reload();
  await mark(page, 4, 0, 40);

  /* Not `keyboard.type`: Playwright delivers characters outside the layout
     through `insertText`, which fires no keydown at all, so the umlaut would
     silently never reach the filter and the test would be measuring itself.
     A real German keyboard sends a keydown with `key` set to the letter. */
  for (const key of ["r", "ü", "c", "k"]) {
    await page.evaluate(
      // On the body, not on the document: a real keydown always targets an
      // element, and the handler asks its target what it is.
      (letter) =>
        document.body.dispatchEvent(new KeyboardEvent("keydown", { key: letter, bubbles: true })),
      key,
    );
  }
  await expect(page.locator("#coding-bar-filter")).toContainText("rück");
  await expect(page.locator("#coding-bar-choices .choice")).toHaveCount(1);
});

test("the selection ends at the speaker turn", async ({ page }) => {
  await page.evaluate(() => {
    const fields = document.querySelectorAll(".text");
    const range = document.createRange();
    range.setStart(fields[3].firstChild, 0);
    range.setEnd(fields[4].firstChild, 10);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    fields[4].dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await expect(page.locator("#message")).toContainText("innerhalb eines Redebeitrags");
});

test("the selection snaps onto word boundaries", async ({ page, request }) => {
  // Begun mid-word and ended mid-word, the way dragging goes.
  await mark(page, 4, 5, 17);
  await page.locator('.choice[data-category="routine"]').click();
  await expect(page.locator("#turn-4 .segment")).toHaveCount(1);

  const data = await (await request.get(`/api/interviews/${FIRST}`)).json();
  const citation = data.codings[0].text;
  expect(citation).toBe("ich bin seit");
  // The citation is exactly what stands at that place — otherwise the anchor
  // check would not find it again.
  const turn = data.turns.find((one) => one.number === 4);
  expect(turn.text.slice(data.codings[0].start, data.codings[0].end)).toBe(citation);
});

test("a timestamp at the edge does not belong to the citation", async ({ page, request }) => {
  const data = await (await request.get(`/api/interviews/${FIRST}`)).json();
  const withStamp = data.turns.find((turn) => /\[\d+:\d{2}\]/.test(turn.text) && !turn.interviewer);
  const at = withStamp.text.search(/\[\d+:\d{2}\]/);

  await mark(page, withStamp.number, at, at + 60);
  await page.locator('.choice[data-category="routine"]').click();
  await expect(page.locator(`#turn-${withStamp.number} .segment`)).toHaveCount(1);

  const after = await (await request.get(`/api/interviews/${FIRST}`)).json();
  expect(after.codings[0].text).not.toMatch(/^\s*\[\d+:\d{2}\]/);
});

test("a deleted coding unit can be brought back", async ({ page, request }) => {
  await code(page, 22, 0, 40, "agreement");
  await page.locator("#detail-memo").fill("Trägt die Rückfrage im Team.");
  await page.locator("#detail-memo").blur();
  await page.locator("#detail-anchor").check();
  await expect(page.locator("#turn-22 .mark .anchor")).toBeVisible();

  await page.locator("#detail-remove").click();
  await expect(page.locator("#turn-22 .segment")).toHaveCount(0);

  await page.locator("#message #message-action").click();

  await expect(page.locator("#turn-22 .segment")).toHaveCount(1);
  // Memo and anchor example come back too, not just the highlight.
  const data = await (await request.get(`/api/interviews/${FIRST}`)).json();
  expect(data.codings[0].memo).toBe("Trägt die Rückfrage im Team.");
  expect(data.codings[0].anchor).toBe(true);
});

test("the conflict message names the category and leads there", async ({ page }) => {
  await code(page, 4, 0, 60, "routine");
  await page.locator("#transcript").click({ position: { x: 5, y: 5 } });

  await mark(page, 4, 30, 90);
  await page.locator('.choice[data-category="agreement"]').click();

  await expect(page.locator("#message")).toContainText("überschneidet die Einheit „Arbeitsalltag“");
  await page.locator("#message #message-action").click();
  await expect(page.locator("#turn-4 .segment")).toHaveAttribute("data-selected", "true");
});

test("typed letters filter the coding bar", async ({ page, request }) => {
  await addCategory(request, "Medienbruch");
  await page.reload();

  await mark(page, 18, 0, 40);
  await expect(page.locator(".choice")).toHaveCount(4);

  await page.keyboard.type("medi");
  await expect(page.locator("#coding-bar-filter")).toHaveText("Filter: medi");
  await expect(page.locator(".choice")).toHaveCount(1);
  // The digit always means the n-th shown category, so now the fourth one.
  await page.keyboard.press("1");
  await expect(page.locator("#turn-18 .mark .what")).toContainText("Medienbruch");
});

test("Enter takes the only match, Escape only the filter", async ({ page }) => {
  await mark(page, 18, 0, 40);
  await page.keyboard.type("rungen");
  await expect(page.locator(".choice")).toHaveCount(1);

  await page.keyboard.press("Escape");
  // The filter goes first, the selection stays.
  await expect(page.locator("#coding-bar")).toBeVisible();
  await expect(page.locator(".choice")).toHaveCount(3);

  await page.keyboard.type("abspr");
  await page.keyboard.press("Enter");
  await expect(page.locator("#turn-18 .mark .what")).toContainText("Absprachen");
});

test("j and k filter instead of jumping while the bar is open", async ({ page }) => {
  await mark(page, 18, 0, 40);
  await page.keyboard.press("k");
  await expect(page.locator("#coding-bar-filter")).toHaveText("Filter: k");
  await expect(page.locator("#transcript .turn.focused")).toHaveCount(0);
});

test("two units in a row stay distinguishable in the text", async ({ page, request }) => {
  // Through the interface: the sharpened edges leave the word gap free, so the
  // boundary is already visible in the typography.
  await code(page, 4, 0, 40, "routine");
  await page.locator("#transcript").click({ position: { x: 5, y: 5 } });
  await mark(page, 4, 41, 80);
  await page.locator('.choice[data-category="routine"]').click();
  await expect(page.locator("#turn-4 .segment")).toHaveCount(2);
  const gap = await page
    .locator("#turn-4 .segment")
    .first()
    .evaluate(
      (element) =>
        element.nextSibling?.nodeType === Node.TEXT_NODE &&
        element.nextSibling.nodeValue.length > 0,
    );
  expect(gap).toBe(true);

  // Gapless adjacency can still occur, from an older state say. Then the second
  // unit carries the boundary itself.
  const data = await (await request.get(`/api/interviews/${FIRST}`)).json();
  for (const coding of data.codings) {
    await request.delete(`/api/interviews/${FIRST}/codings/${coding.id}`);
  }
  const text = data.turns.find((turn) => turn.number === 4).text;
  for (const [from, to] of [
    [0, 40],
    [40, 80],
  ]) {
    await request.post(`/api/interviews/${FIRST}/codings`, {
      data: { turn: 4, start: from, end: to, category: "routine", text: text.slice(from, to) },
    });
  }
  await page.reload();
  await expect(page.locator("#turn-4 .segment")).toHaveCount(2);
  await expect(page.locator("#turn-4 .segment").nth(1)).toHaveAttribute("data-adjacent", "true");
});

test("margin mark and segment light up together", async ({ page }) => {
  await code(page, 8, 0, 60, "routine");
  await code(page, 8, 100, 160, "agreement");
  const second = page.locator("#turn-8 .mark").nth(1);

  await second.hover();
  await expect(second).toHaveClass(/emphasized/);
  await expect(page.locator("#turn-8 .segment").nth(1)).toHaveClass(/emphasized/);
  // The other unit stays quiet.
  await expect(page.locator("#turn-8 .segment").first()).not.toHaveClass(/emphasized/);

  await page.locator("#turn-8 .voice").hover();
  await expect(page.locator("#turn-8 .segment.emphasized")).toHaveCount(0);
});

test("the coding bar stays on screen, even with many categories", async ({ page, request }) => {
  for (const name of [
    "Medienbruch",
    "Doppelpflege",
    "Zugriffsbeschränkung",
    "Wortwahl",
    "Ablageort",
    "Zuständigkeit",
  ]) {
    await addCategory(request, name);
  }
  await page.reload();
  await mark(page, 18, 0, 40);

  const bar = page.locator("#coding-bar");
  const box = await bar.boundingBox();
  const viewport = page.viewportSize();
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
});

test("digits assign without a mouse", async ({ page }) => {
  await mark(page, 14, 0, 25);
  await page.keyboard.press("3");
  await expect(page.locator("#turn-14 .mark .what")).toContainText("Absprachen");
});

test("a double click takes the sentence as a coding unit", async ({ page }) => {
  await page.locator("#turn-4 .text").dblclick({ position: { x: 60, y: 8 } });
  await expect(page.locator("#coding-bar")).toBeVisible();
  const quote = await page.locator("#coding-bar-quote").innerText();
  expect(quote.trim().endsWith(".“")).toBe(true);
});

test("change category, write a memo, set an anchor example, delete", async ({ page }) => {
  await code(page, 16, 0, 45, "routine");

  // The freshly created unit is already selected.
  await expect(page.locator("#detail")).toBeVisible();
  await page.locator("#detail-category").selectOption("agreement");
  await expect(page.locator("#turn-16 .mark .what")).toContainText("Absprachen");

  await page.locator("#detail-memo").fill("Zuschnitt, nicht Ablage: Hauptprädikat ist absprechen.");
  await page.locator("#detail-memo").blur();
  await page.locator("#detail-anchor").check();
  await expect(page.locator("#turn-16 .mark .anchor")).toBeVisible();

  // Select again and delete.
  await page.locator("#turn-16 .segment").click();
  await expect(page.locator("#detail")).toBeVisible();
  await page.locator("#detail-remove").click();
  await expect(page.locator("#turn-16 .segment")).toHaveCount(0);
});

test("inductive categories emerge on the material and can be assigned", async ({ page }) => {
  /* On the material: a category formed before a single unit has been coded is
     not an inductive one, and the panel builds the start system instead. So
     something is coded first, which is also the order the method has. */
  await code(page, 22, 0, 30, "agreement");
  await page.locator("#inductive-shell summary").click();
  await page.locator("#inductive-name").fill("Zugriffsbeschränkung");
  await page
    .locator("#inductive-definition")
    .fill("Aussagen über verweigerten oder eingeschränkten Zugriff.");
  await page.locator("#inductive-parent").selectOption("agreement");
  await page.locator("#inductive button[type=submit]").click();

  const created = page.locator('.category[data-category="ind.zugriffsbeschraenkung"]');
  await expect(created).toBeVisible();
  await expect(created).toHaveAttribute("data-inductive", "true");
  await expect(created).toHaveAttribute("data-child", "true");

  await code(page, 18, 0, 30, "ind.zugriffsbeschraenkung");
  await expect(page.locator("#turn-18 .mark .what")).toContainText("Zugriffsbeschränkung");
});

/** Order of the categories, as the list shows them. */
const order = (page) =>
  page.locator(".category").evaluateAll((buttons) => buttons.map((b) => b.dataset.category));

test("an inductive category drags under a start category and out again", async ({
  page,
  request,
}) => {
  await addCategory(request, "Medienbruch");
  await page.reload();
  const dragged = page.locator('.category[data-category="ind.medienbruch"]');
  await expect(dragged).toHaveAttribute("data-child", "false");

  await dragged.dragTo(page.locator('.category[data-category="agreement"]'));
  await expect(dragged).toHaveAttribute("data-child", "true");

  // Subordinated also means: directly behind the parent, otherwise the list
  // still reads as if they were two standalone categories.
  const sequence = await order(page);
  expect(sequence.indexOf("ind.medienbruch")).toBe(sequence.indexOf("agreement") + 1);

  // The anchoring comes from the parent category, as it does on creation.
  const { categories } = await (await request.get("/api/categories")).json();
  const byId = (id) => categories.find((category) => category.id === id);
  expect(byId("ind.medienbruch").proposition).toBe(byId("agreement").proposition);

  await dragged.click();
  await page.locator('[data-detail="ind.medienbruch"] [data-category-parent]').selectOption("");
  await expect(dragged).toHaveAttribute("data-child", "false");
});

test("the category system stays two-level and deductive stays put", async ({ request }) => {
  await addCategory(request, "Medienbruch");
  const under = (id, parent) => request.patch(`/api/categories/${id}`, { data: { parent } });

  expect((await under("ind.medienbruch", "routine.disruption")).status()).toBe(409);
  expect((await under("routine.disruption", "agreement")).status()).toBe(409);
  expect((await under("ind.medienbruch", "ind.medienbruch")).status()).toBe(400);
});

test("a deductive category stands once the material has been worked", async ({ page, request }) => {
  /* "Fixed before the survey" is a statement about a moment, and the tool can
     tell which side of it the study is on. Before the first coding the start
     system is still being written — which is the only way a fresh installation
     gets rid of the three categories of the bundled example. */
  await page.locator('.category[data-category="routine"]').click();
  await expect(page.locator('[data-detail="routine"] [data-category-remove]')).toHaveCount(1);

  await code(page, 22, 0, 30, "agreement");
  await page.locator('.category[data-category="routine"]').click();
  await expect(page.locator('[data-detail="routine"] [data-category-remove]')).toHaveCount(0);

  // And the server keeps the rule where it cannot be walked past.
  const refused = await request.delete("/api/categories/routine");
  expect(refused.status()).toBe(409);
});

test("the start system can be written before the first coding", async ({ page, request }) => {
  await page.locator("#inductive-shell summary").click();
  // The panel says which act it is: the same form, a different thing.
  await expect(page.locator("#inductive-summary")).toContainText("Startsystem");
  await page.locator("#inductive-name").fill("Zugriff auf Unterlagen");
  await page.locator("#inductive-definition").fill("Aussagen über den Zugang zu Dokumenten.");
  await page.locator("#inductive button[type=submit]").click();

  /* Deductive, and with an id that says so: the coding guide reports the origin
     of every category, and one built as the start system was not formed on the
     material. */
  const made = page.locator('.category[data-category="zugriff-auf-unterlagen"]');
  await expect(made).toBeVisible();
  await expect(made).toHaveAttribute("data-inductive", "false");

  const { categories } = await (await request.get("/api/categories")).json();
  expect(categories.find((one) => one.id === "zugriff-auf-unterlagen").origin).toBe("deductive");

  // Once anything is coded the panel is recording what the material demanded.
  await code(page, 22, 0, 30, "agreement");
  await expect(page.locator("#inductive-summary")).toContainText("Induktive");
});

test("coding rules are recorded at the doubtful case", async ({ page }) => {
  await page.locator('.category[data-category="agreement"]').click();
  await page
    .locator('[data-rule="agreement"] input')
    .fill("Weitergabe an Dritte zählt als Absprache, nicht als Alltag.");
  await page.locator('[data-rule="agreement"] button').click();
  await expect(page.locator('[data-detail="agreement"] [data-rule-text]')).toHaveValue(
    "Weitergabe an Dritte zählt als Absprache, nicht als Alltag.",
  );
  // The field is free for the next rule afterwards.
  await expect(page.locator('[data-rule="agreement"] input')).toHaveValue("");
});

test("a coding rule drawn too narrowly can be corrected", async ({ page, request }) => {
  await page.locator('.category[data-category="agreement"]').click();
  await page.locator('[data-rule="agreement"] input').fill("Nur die eigene Absprache zählt.");
  await page.locator('[data-rule="agreement"] button').click();

  const rule = page.locator('[data-detail="agreement"] [data-rule-text]');
  await expect(rule).toHaveValue("Nur die eigene Absprache zählt.");
  await rule.fill("Auch die Rückfrage bei Kolleginnen zählt als Absprache.");
  await rule.blur();

  await expect(page.locator('[data-detail="agreement"] [data-rule-text]')).toHaveValue(
    "Auch die Rückfrage bei Kolleginnen zählt als Absprache.",
  );
  const { categories } = await (await request.get("/api/categories")).json();
  expect(categories.find((category) => category.id === "agreement").codingRules).toEqual([
    "Auch die Rückfrage bei Kolleginnen zählt als Absprache.",
  ]);
});

test("an outdated coding rule can be removed", async ({ page }) => {
  await page.locator('.category[data-category="routine"]').click();
  for (const text of ["Erste Regel.", "Zweite Regel.", "Dritte Regel."]) {
    await page.locator('[data-rule="routine"] input').fill(text);
    await page.locator('[data-rule="routine"] button').click();
  }
  const rules = page.locator('[data-detail="routine"] .rules li');
  await expect(rules).toHaveCount(3);

  await page.locator('[data-detail="routine"] [data-rule-remove][data-index="1"]').click();

  await expect(rules).toHaveCount(2);
  await expect(
    page.locator('[data-detail="routine"] [data-rule-text]').first(),
  ).toHaveValue("Erste Regel.");
  await expect(
    page.locator('[data-detail="routine"] [data-rule-text]').last(),
  ).toHaveValue("Dritte Regel.");
});

test("a sharpened deductive definition names the wording before the field work", async ({
  page,
  request,
}) => {
  await page.locator('.category[data-category="agreement"]').click();
  const field = page.locator('[data-detail="agreement"] [data-definition]');
  const before = await field.inputValue();
  expect(before).toContain("gescheiterte Absprachen");

  await field.fill("Aussagen über Absprachen, Weiterleitungen eingeschlossen.");
  await field.blur();

  const note = page.locator('[data-detail="agreement"] .deviation');
  await expect(note).toContainText("Vor der Erhebung");
  await expect(note).toContainText("gescheiterte Absprachen");

  const flat = flatGuide(await (await request.get("/api/export/coding-guide.md?lang=de")).text());
  expect(flat).toContain("Vor der Erhebung");
  expect(flat).toContain("am Material geschärft");
  expect(flat).toContain("Weiterleitungen eingeschlossen");
  expect(flat).toContain("gescheiterte Absprachen");

  // Resetting takes the note away again.
  await page.locator('[data-detail="agreement"] [data-definition-reset]').click();
  await expect(page.locator('[data-detail="agreement"] .deviation')).toHaveCount(0);
  await expect(page.locator('[data-detail="agreement"] [data-definition]')).toHaveValue(before);
});

/**
 * An inductive category is formed on the material — and sharpened again on the
 * material afterwards. That second step has to be as reportable as the first,
 * so the wording it was created with is kept just as the deductive one is.
 */
test("a sharpened inductive definition names the wording it was created with", async ({
  page,
  request,
}) => {
  await code(page, 22, 0, 30, "agreement");
  await page.locator("#inductive-shell summary").click();
  await page.locator("#inductive-name").fill("Medienbruch");
  await page.locator("#inductive-definition").fill("Aussagen über den Wechsel des Mediums.");
  await page.locator("#inductive button[type=submit]").click();

  const detail = '[data-detail="ind.medienbruch"]';
  await page.locator('.category[data-category="ind.medienbruch"]').click();
  // Freshly created, nothing has been sharpened yet.
  await expect(page.locator(`${detail} .deviation`)).toHaveCount(0);

  const field = page.locator(`${detail} [data-definition]`);
  await field.fill("Aussagen über den Wechsel des Mediums, Kontowechsel eingeschlossen.");
  await field.blur();

  const note = page.locator(`${detail} .deviation`);
  await expect(note).toContainText("Beim Anlegen");
  await expect(note).toContainText("Wechsel des Mediums.");
  await expect(note).not.toContainText("Vor der Erhebung");

  const { categories } = await (await request.get("/api/categories")).json();
  expect(categories.find((c) => c.id === "ind.medienbruch").initialDefinition).toBe(
    "Aussagen über den Wechsel des Mediums.",
  );

  // Both exports report the change, so it can be written up.
  const flat = flatGuide(await (await request.get("/api/export/coding-guide.md?lang=de")).text());
  expect(flat).toContain("Beim Anlegen");
  expect(flat).toContain("Kontowechsel eingeschlossen");
  const notes = await (await request.get("/api/export/notes.md?lang=de")).text();
  expect(notes).toContain("Definition beim Anlegen: Aussagen über den Wechsel des Mediums.");

  // And the reset works the same way as for a deductive category.
  await page.locator(`${detail} [data-definition-reset]`).click();
  await expect(page.locator(`${detail} .deviation`)).toHaveCount(0);
  await expect(page.locator(`${detail} [data-definition]`)).toHaveValue(
    "Aussagen über den Wechsel des Mediums.",
  );
});

test("a category without a definition is rejected", async ({ page, request }) => {
  await page.locator('.category[data-category="routine"]').click();
  const field = page.locator('[data-detail="routine"] [data-definition]');
  const before = await field.inputValue();
  await field.fill("   ");
  await field.blur();

  await expect(page.locator(".message")).toContainText("ohne Definition");
  await expect(page.locator('[data-detail="routine"] [data-definition]')).toHaveValue(before);
  const { categories } = await (await request.get("/api/categories")).json();
  expect(categories.find((category) => category.id === "routine").definition).toBe(before);
});

test("an inductive category can be renamed, a deductive one cannot", async ({ page }) => {
  await code(page, 22, 0, 30, "agreement");
  await page.locator("#inductive-shell summary").click();
  await page.locator("#inductive-name").fill("Medienbruch");
  await page.locator("#inductive-definition").fill("Aussagen über den Wechsel des Mediums.");
  await page.locator("#inductive button[type=submit]").click();
  await code(page, 18, 0, 30, "ind.medienbruch");

  await page.locator('.category[data-category="ind.medienbruch"]').click();
  await page
    .locator('[data-detail="ind.medienbruch"] [data-category-name]')
    .fill("Medienbruch im Alltag");
  await page.locator('[data-detail="ind.medienbruch"] [data-category-name]').blur();

  // The name also stands at the margin mark in the transcript.
  await expect(page.locator("#turn-18 .mark .what")).toContainText("Medienbruch im Alltag");

  await page.locator('.category[data-category="routine"]').click();
  await expect(page.locator('[data-detail="routine"] [data-category-name]')).toHaveCount(0);
});

test("two inductive categories can be made into one", async ({ page, request }) => {
  await addCategory(request, "Medienbruch");
  await addCategory(request, "Systemwechsel");
  await page.reload();

  await code(page, 18, 0, 30, "ind.medienbruch");
  await code(page, 20, 0, 30, "ind.systemwechsel");
  await code(page, 22, 0, 30, "ind.systemwechsel");

  await page.locator('.category[data-category="ind.systemwechsel"]').click();
  await page
    .locator('[data-merge-target="ind.systemwechsel"]')
    .selectOption("ind.medienbruch");
  await page.locator('[data-merge="ind.systemwechsel"]').click();

  await expect(page.locator(".message")).toContainText("2 Fundstellen übernommen");
  await expect(page.locator('.category[data-category="ind.systemwechsel"]')).toHaveCount(0);
  // All three passages now carry the same category.
  await expect(page.locator('.category[data-category="ind.medienbruch"] .count')).toHaveText("3");
  for (const turn of [18, 20, 22]) {
    await expect(page.locator(`#turn-${turn} .mark .what`)).toContainText("Medienbruch");
  }
});

test("merging keeps the coding rules and notes of both sides", async ({ request }) => {
  await addCategory(request, "Medienbruch");
  await addCategory(request, "Systemwechsel");
  await request.patch("/api/categories/ind.medienbruch", {
    data: {
      codingRules: ["Nur beim Wechsel des Werkzeugs."],
      memo: "Aus Beitrag 18 entstanden.",
    },
  });
  await request.patch("/api/categories/ind.systemwechsel", {
    data: { codingRules: ["Auch beim Wechsel des Kontos."], memo: "Wirkt wie Medienbruch." },
  });

  await request.post("/api/categories/ind.systemwechsel/merge", {
    data: { target: "ind.medienbruch" },
  });

  const { categories } = await (await request.get("/api/categories")).json();
  const target = categories.find((category) => category.id === "ind.medienbruch");
  expect(target.codingRules).toEqual([
    "Nur beim Wechsel des Werkzeugs.",
    "Auch beim Wechsel des Kontos.",
  ]);
  expect(target.memo).toContain("Aus Beitrag 18 entstanden.");
  expect(target.memo).toContain("Wirkt wie Medienbruch.");
  expect(categories.some((category) => category.id === "ind.systemwechsel")).toBe(false);
});

test("a deductive category cannot be dissolved once the material has been worked", async ({
  page,
  request,
}) => {
  await code(page, 22, 0, 30, "agreement");
  await page.locator('.category[data-category="routine"]').click();
  await expect(page.locator('[data-merge="routine"]')).toHaveCount(0);

  const answer = await request.post("/api/categories/routine/merge", {
    data: { target: "agreement" },
  });
  expect(answer.status()).toBe(409);
});

test("the citation leads back to its place in the transcript", async ({ page }) => {
  await code(page, 22, 0, 40, "agreement");
  await page.locator('.tab[data-view="analysis"]').click();

  await page.locator(".citation [data-passage]").first().click();

  await expect(page.locator("#view-code")).toBeVisible();
  await expect(page.locator("#turn-22 .segment")).toHaveAttribute("data-selected", "true");
  await expect(page.locator("#detail h2")).toContainText("Beitrag 22");
});

test("the citation leads back across the interview too", async ({ page }) => {
  await code(page, 22, 0, 40, "agreement");
  await page.locator("#interview-choice").selectOption(SECOND);
  await expect(page.locator(".turn")).toHaveCount(4);
  await code(page, 4, 0, 40, "agreement");

  await page.locator('.tab[data-view="analysis"]').click();
  // The first citation of the category comes from the other interview.
  const first = page.locator(".citation [data-passage]").first();
  await expect(first).toHaveAttribute("data-interview", FIRST);
  await first.click();

  await expect(page.locator("#interview-choice")).toHaveValue(FIRST);
  await expect(page.locator("#turn-22 .segment")).toHaveAttribute("data-selected", "true");
});

test("the search names the locations in the other interviews", async ({ page }) => {
  await page.locator("#search").fill("SharePoint");
  const elsewhere = page.locator("#search-elsewhere .elsewhere");
  await expect(elsewhere).toHaveCount(1);
  await expect(elsewhere).toContainText("Vertrieb");
  await expect(elsewhere).toContainText("Fundstelle");

  await elsewhere.click();
  await expect(page.locator("#interview-choice")).toHaveValue(SECOND);
  // In the switched interview the matches stand highlighted, and the switched
  // interview no longer shows up as „elsewhere".
  await expect(page.locator("#transcript mark.match")).not.toHaveCount(0);
  await expect(page.locator("#search-elsewhere .elsewhere")).toContainText("Marketing");
});

test("a word only in the open interview reports no elsewhere", async ({ page }) => {
  await page.locator("#search").fill("Kampagnen");
  await expect(page.locator("#transcript mark.match")).not.toHaveCount(0);
  await expect(page.locator("#search-elsewhere")).toBeHidden();
});

test("notes on the interview and on the category flow into one export", async ({
  page,
  request,
}) => {
  await page.locator("#note-shell summary").click();
  await page.locator("#note").fill("Gespräch lief schleppend an, ab Block 2 offener.");
  await page.locator("#note").blur();
  await expect(page.locator(".message")).toContainText("Notiz zum Interview");

  /* Leaving a note field saves it, and the save is on its way while the test
     reads on. The interview note is waited for by its message; these two had
     nothing to wait for, so the export was occasionally fetched before they
     landed — the one flaky test in the suite. */
  await page.locator('.category[data-category="agreement"]').click();
  await page.locator('[data-category-memo="agreement"]').fill("Abgrenzung zum Alltag noch unklar.");
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes("/api/categories/agreement") &&
        response.request().method() === "PATCH",
    ),
    page.locator('[data-category-memo="agreement"]').blur(),
  ]);

  await code(page, 22, 0, 40, "agreement");
  await page.locator("#detail-memo").fill("Steht stellvertretend für die Rückfrage im Team.");
  await Promise.all([
    page.waitForResponse(
      (response) =>
        /\/api\/interviews\/[^/]+\/codings\/[^/]+$/.test(new URL(response.url()).pathname) &&
        response.request().method() === "PATCH",
    ),
    page.locator("#detail-memo").blur(),
  ]);

  const text = await (await request.get("/api/export/notes.md?lang=de")).text();
  expect(text).toContain("## Zu den Interviews");
  expect(text).toContain("Gespräch lief schleppend an");
  expect(text).toContain("## Zu den Kategorien");
  expect(text).toContain("Abgrenzung zum Alltag noch unklar.");
  expect(text).toContain("## Zu einzelnen Fundstellen");
  expect(text).toContain("Steht stellvertretend für die Rückfrage im Team.");
});

test("the interview note survives a reload and further codings", async ({ page }) => {
  await page.locator("#note-shell summary").click();
  await page.locator("#note").fill("Rückfrage an die Bereichsleitung offen.");
  await page.locator("#note").blur();
  await expect(page.locator(".message")).toContainText("Notiz zum Interview");

  await code(page, 22, 0, 40, "agreement");
  await page.reload();
  await page.locator("#note-shell summary").click();
  await expect(page.locator("#note")).toHaveValue("Rückfrage an die Bereichsleitung offen.");
});

test("the search finds passages in the transcript and steps through them", async ({ page }) => {
  await page.locator("#search").fill("SharePoint");
  const matches = page.locator("#transcript mark.match");
  await expect(matches.first()).toBeVisible();
  const count = await matches.count();
  expect(count).toBeGreaterThan(1);
  await expect(page.locator("#search-status")).toHaveText(`1 von ${count}`);
  await expect(matches.first()).toHaveClass(/current/);

  await page.locator("#search").press("Enter");
  await expect(page.locator("#search-status")).toHaveText(`2 von ${count}`);
  await expect(matches.nth(1)).toHaveClass(/current/);

  await page.locator("#search-previous").click();
  await expect(page.locator("#search-status")).toHaveText(`1 von ${count}`);

  await page.locator("#search").press("Escape");
  await expect(page.locator("#transcript mark.match")).toHaveCount(0);
  await expect(page.locator("#search-status")).toHaveText("");
});

test("the wildcard bridges German inflection", async ({ page }) => {
  // Without a wildcard „ablegen" does not find the participle.
  await page.locator("#search").fill("ab*leg*");
  await expect(page.locator("#transcript mark.match").first()).toBeVisible();
  const forms = await page
    .locator("#transcript mark.match")
    .evaluateAll((all) => [...new Set(all.map((m) => m.textContent.toLowerCase()))]);
  expect(forms.length).toBeGreaterThan(1);
  expect(forms.some((form) => form.startsWith("abge"))).toBe(true);

  // The wildcard stays inside the word and does not span a space.
  for (const form of forms) expect(form).not.toMatch(/\s/);
});

test("if a word finds nothing, its ending is trimmed and that is said", async ({ page }) => {
  // „strukturieren" is not in the transcript, „strukturiert" is.
  await page.locator("#search").fill("strukturieren");
  await expect(page.locator("#search-status")).toContainText("von");
  // The status names what was actually searched for.
  await expect(page.locator("#search-status")).toContainText("strukturier");
  await expect(page.locator("#transcript mark.match").first()).toBeVisible();

  // A word that does not exist as a stem either stays without a match.
  await page.locator("#search").fill("Zeppelinwerften");
  await expect(page.locator("#search-status")).toHaveText("kein Treffer");
});

test("a word without a location is reported as such", async ({ page }) => {
  await page.locator("#search").fill("Zeppelinwerft");
  await expect(page.locator("#search-status")).toHaveText("kein Treffer");
  await expect(page.locator("#transcript mark.match")).toHaveCount(0);
});

test("the highlight leaves the coding locations untouched", async ({ page }) => {
  await code(page, 4, 0, 35, "routine");
  const citation = await page.locator("#turn-4 .segment").first().innerText();

  await page.locator("#search").fill("ich");
  await expect(page.locator("#turn-4 mark.match").first()).toBeVisible();

  // After the highlight a second passage is coded: the conversion from
  // selection to character range has to keep holding.
  await code(page, 4, 60, 100, "agreement");
  await page.reload();
  await expect(page.locator("#turn-4 .segment")).toHaveCount(2);
  expect(await page.locator("#turn-4 .segment").first().innerText()).toBe(citation);
});

test("j and k walk turn by turn through the material", async ({ page }) => {
  await page.locator("#transcript").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("j");
  const first = page.locator("#transcript .turn.focused");
  await expect(first).toHaveCount(1);
  // The first press grabs the turn on screen instead of skipping it.
  const topmost = await page.locator("#transcript .turn").first().getAttribute("data-turn");
  await expect(first).toHaveAttribute("data-turn", topmost);
  const number = Number(await first.getAttribute("data-turn"));

  await page.keyboard.press("j");
  await expect(page.locator("#transcript .turn.focused")).toHaveAttribute(
    "data-turn",
    String(number + 1),
  );

  await page.keyboard.press("k");
  await expect(page.locator("#transcript .turn.focused")).toHaveAttribute(
    "data-turn",
    String(number),
  );
});

test("the / key puts the caret into the search", async ({ page }) => {
  await page.locator("#transcript").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("/");
  await expect(page.locator("#search")).toBeFocused();
  // Inside the search field digits no longer assign.
  await page.keyboard.type("1");
  await expect(page.locator("#search")).toHaveValue("1");
});

test("the coverage of a section grows with the coding", async ({ page }) => {
  const entry = page.locator("#sections .section-entry").nth(1);
  const share = async () => {
    const text = (await entry.locator(".share").innerText()).trim();
    return text === "—" ? 0 : parseFloat(text);
  };
  expect(await share()).toBe(0);
  await expect(entry.locator(".coverage")).toHaveCount(0);

  await code(page, 4, 0, 120, "routine");

  await expect.poll(share).toBeGreaterThan(0);
  await expect(entry.locator(".coverage")).toHaveCount(1);
  /* A share within the block, not a slice of the codings: the one coding above
     covers a fraction of what was said there, never all of the study. */
  expect(await share()).toBeLessThanOrEqual(100);
});

test("the analysis counts departments and offers the exports", async ({ page }) => {
  await code(page, 4, 0, 35, "routine");
  await code(page, 6, 0, 35, "agreement");

  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#view-analysis")).toBeVisible();

  await expect(page.locator(".metric .value").first()).toHaveText("2");
  // Scoped to the cross table: the charts carry figure tables of their own now,
  // and an unscoped row would just as happily match one of those.
  const row = page.locator("#matrix-table tbody tr", { hasText: "Arbeitsalltag" }).first();
  await expect(row.locator("td.num").last()).toHaveText("1");

  await expect(page.locator(".exports a", { hasText: "Kodierleitfaden" })).toBeVisible();
  await expect(page.locator(".citation blockquote").first()).toContainText(
    "Klar, ich bin seit dem Frühjahr",
  );
});

/**
 * The cross table carries its own export, right next to the heading — that is
 * the table one wants in the manuscript, and it goes out as a grid table set to
 * a fixed line width, so that it looks in the paper the way it looks here.
 */
test("the cross table carries its own export as a grid table", async ({ page, request }) => {
  await code(page, 4, 0, 35, "routine");
  await page.locator("#interview-choice").selectOption(SECOND);
  await expect(page.locator(".turn")).toHaveCount(4);
  await code(page, 2, 0, 40, "routine");

  await page.locator('.tab[data-view="analysis"]').click();
  const button = page.locator("#matrix-export");
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute("href", "/api/export/matrix.md?lang=de");

  const text = await (await request.get("/api/export/matrix.md?lang=de")).text();
  expect(text).toContain("# Kategorien nach Bereich");
  // A Pandoc grid table: frame lines, a header rule, right-aligned numbers.
  expect(text).toContain("+===");
  expect(text).toMatch(/=:\+/);

  const tableLines = text.split("\n").filter((line) => line.startsWith("+") || line.startsWith("|"));
  expect(tableLines.length).toBeGreaterThan(5);
  for (const line of tableLines) expect(line.length).toBe(80);

  // Every department is a column, every category a row, and the numbers are
  // the ones the table on screen shows.
  const flat = tableLines.join(" ").replace(/\s+/g, " ");
  expect(flat).toContain("Kategorie");
  expect(flat).toContain("Marketing");
  expect(flat).toContain("Vertrieb");
  expect(flat).toContain("Arbeitsalltag");
  expect(flat).toContain("Absprachen");
  const routine = tableLines.find((line) => line.includes("Arbeitsalltag"));
  expect(routine.match(/\d+/g)).toEqual(["1", "1", "2", "2"]);
});

test("the citations can be sliced by department, anchor and note", async ({ page }) => {
  await code(page, 4, 0, 40, "routine");
  await page.locator("#detail-anchor").check();
  await expect(page.locator("#turn-4 .mark .anchor")).toBeVisible();
  await code(page, 6, 0, 40, "routine");
  await page.locator("#detail-memo").fill("Noch offen: gilt das auch für Angebote?");
  await page.locator("#detail-memo").blur();

  await page.locator("#interview-choice").selectOption(SECOND);
  await expect(page.locator(".turn")).toHaveCount(4);
  await code(page, 2, 0, 40, "routine");

  await page.locator('.tab[data-view="analysis"]').click();
  const citations = page.locator("#citations-part .citation");
  await expect(citations).toHaveCount(3);
  await expect(page.locator(".citation-filter .filter-status")).toHaveText("3 Belege");

  await page.locator('.citation-filter [data-filter="department"]').selectOption("Vertrieb");
  await expect(citations).toHaveCount(1);
  await expect(page.locator("#filter-clear")).toContainText("1 von 3");

  await page.locator("#filter-clear").click();
  await expect(citations).toHaveCount(3);

  await page.locator('.citation-filter [data-filter="anchor"]').check();
  await expect(citations).toHaveCount(1);
  await expect(citations).toContainText("Ankerbeispiel");

  await page.locator('.citation-filter [data-filter="anchor"]').uncheck();
  await page.locator('.citation-filter [data-filter="memo"]').check();
  await expect(citations).toHaveCount(1);
  await expect(citations).toContainText("gilt das auch für Angebote");
});

test("the citation slice searches the notes too and knows the wildcard", async ({ page }) => {
  await code(page, 4, 0, 40, "routine");
  await page.locator("#detail-memo").fill("Hier wird etwas abgelegt.");
  await page.locator("#detail-memo").blur();
  await code(page, 6, 0, 40, "routine");

  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#citations-part .citation")).toHaveCount(2);

  await page.locator('.citation-filter [data-filter="word"]').fill("ab*leg*");
  await expect(page.locator("#citations-part .citation")).toHaveCount(1);
  await expect(page.locator("#citations-part .citation")).toContainText("abgelegt");

  // The slice stays put while typing in the field.
  await expect(page.locator('.citation-filter [data-filter="word"]')).toBeFocused();
});

test("a slice without a match says so instead of staying empty", async ({ page }) => {
  await code(page, 4, 0, 40, "routine");
  await page.locator('.tab[data-view="analysis"]').click();
  await page.locator('.citation-filter [data-filter="word"]').fill("Zeppelinwerft");
  await expect(page.locator("#citations-part .empty-state")).toContainText("Kein Beleg passt");
});

test("coded by hand means reviewed, created programmatically means suggestion", async ({
  page,
  request,
}) => {
  await code(page, 4, 0, 40, "routine");
  const data = await (await request.get(`/api/interviews/${FIRST}`)).json();
  expect(data.codings[0].reviewed).toBe(true);
  await expect(page.locator("#turn-4 .segment")).not.toHaveAttribute("data-unreviewed", "true");

  const text = data.turns.find((turn) => turn.number === 6).text;
  await suggest(request, 6, 0, 40, "agreement", text.slice(0, 40));
  await page.reload();
  await expect(page.locator("#turn-6 .segment")).toHaveAttribute("data-unreviewed", "true");
  await expect(page.locator("#status .open-status")).toContainText("1 noch ungeprüft");
});

test("the review walks from passage to passage with Enter", async ({ page, request }) => {
  const data = await (await request.get(`/api/interviews/${FIRST}`)).json();
  for (const number of [4, 6, 8]) {
    const text = data.turns.find((turn) => turn.number === number).text;
    await suggest(request, number, 0, 40, "routine", text.slice(0, 40));
  }
  await page.reload();
  await expect(page.locator("#status .open-status")).toContainText("3 noch ungeprüft");

  // Without a chosen passage, Enter starts at the first unreviewed one.
  await page.locator("#transcript").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Enter");
  await expect(page.locator("#turn-4 .segment")).toHaveAttribute("data-selected", "true");
  await expect(page.locator("#detail-reviewed")).not.toBeChecked();

  // After that Enter confirms and moves on.
  await page.keyboard.press("Enter");
  await expect(page.locator("#turn-6 .segment")).toHaveAttribute("data-selected", "true");
  await expect(page.locator("#turn-4 .segment")).not.toHaveAttribute("data-unreviewed", "true");
  await expect(page.locator("#status .open-status")).toContainText("2 noch ungeprüft");

  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(page.locator("#status .open-status")).toHaveText("alle geprüft");
  await expect(page.locator("#transcript [data-unreviewed]")).toHaveCount(0);
});

test("whoever changes the category has reviewed it by that", async ({ page, request }) => {
  const data = await (await request.get(`/api/interviews/${FIRST}`)).json();
  const text = data.turns.find((turn) => turn.number === 4).text;
  await suggest(request, 4, 0, 40, "routine", text.slice(0, 40));
  await page.reload();

  await page.locator("#turn-4 .segment").click();
  await expect(page.locator("#detail-reviewed")).not.toBeChecked();
  await page.locator("#detail-category").selectOption("agreement");

  await expect(page.locator("#turn-4 .segment")).not.toHaveAttribute("data-unreviewed", "true");
  await expect(page.locator("#status .open-status")).toHaveText("alle geprüft");
});

test("the exports flag what has not been reviewed", async ({ page, request }) => {
  const data = await (await request.get(`/api/interviews/${FIRST}`)).json();
  const text = data.turns.find((turn) => turn.number === 4).text;
  await suggest(request, 4, 0, 40, "routine", text.slice(0, 40));
  await page.reload();
  // An anchor example can be unconfirmed too — and there it weighs most,
  // because it travels into the appendix.
  await page.locator("#turn-4 .segment").click();
  await page.locator("#detail-anchor").check();

  const table = await (await request.get(`/api/export/coding-table/${FIRST}.md?lang=de`)).text();
  expect(table).toContain("0 geprüft");
  expect(table).toContain("**ungeprüft**");
  expect(table).toContain("Eine ungeprüfte Zuordnung ist ein Vorschlag und belegt nichts.");

  const guide = await (await request.get("/api/export/coding-guide.md?lang=de")).text();
  expect(flatGuide(guide)).toContain("ungeprüft)");

  const citations = await (await request.get("/api/export/citations.md?unreviewed=1&lang=de")).text();
  expect(citations).toContain("Schnitt: nur ungeprüfte.");
  expect(citations).toContain("**[ungeprüft]**");
});

test("the slice shows the unreviewed passages", async ({ page, request }) => {
  await code(page, 4, 0, 40, "routine");
  const data = await (await request.get(`/api/interviews/${FIRST}`)).json();
  const text = data.turns.find((turn) => turn.number === 6).text;
  await suggest(request, 6, 0, 40, "agreement", text.slice(0, 40));

  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#citations-part .citation")).toHaveCount(2);
  await page.locator('.citation-filter [data-filter="unreviewed"]').check();
  await expect(page.locator("#citations-part .citation")).toHaveCount(1);
  await expect(page.locator("#filter-clear")).toContainText("1 von 2");
});

test("a requirement emerges from a citation without switching the view", async ({ page }) => {
  await code(page, 4, 0, 40, "routine");
  await page.locator("#detail-memo").fill("Die Ablage benachrichtigt nicht von selbst.");
  /* The memo saves on blur and the answer redraws the transcript. Reading on
     without waiting for it meant the next selection occasionally reached for a
     turn that had just been replaced — the same flake as above. */
  await Promise.all([
    page.waitForResponse(
      (response) =>
        /\/api\/interviews\/[^/]+\/codings\/[^/]+$/.test(new URL(response.url()).pathname) &&
        response.request().method() === "PATCH",
    ),
    page.locator("#detail-memo").blur(),
  ]);
  await code(page, 6, 0, 40, "routine");

  await page.locator('.tab[data-view="analysis"]').click();
  const first = page.locator("#citations-part .citation").first();

  // The note is the title suggestion, not the citation.
  await first.locator(".requirement-choice").selectOption("new");
  await expect(page.locator(".message")).toContainText(
    "Die Ablage benachrichtigt nicht von selbst.",
  );
  await expect(first.locator(".requirement-tag")).toContainText("Die Ablage benachrichtigt nicht");

  // The second passage can be assigned to the same requirement.
  const second = page.locator("#citations-part .citation").nth(1);
  await second.locator(".requirement-choice").selectOption({ index: 1 });
  await expect(second.locator(".requirement-tag")).toContainText("Die Ablage benachrichtigt nicht");

  // The catalog counts both citations.
  await page.locator('.tab[data-view="catalog"]').click();
  await expect(page.locator(".requirement .numbers")).toContainText("2");

  // And the assignment can be released again at the citation.
  await page.locator('.tab[data-view="analysis"]').click();
  await page.locator("#citations-part .citation").nth(1).locator("[data-unlink]").click();
  await expect(
    page.locator("#citations-part .citation").nth(1).locator(".requirement-tag"),
  ).toHaveCount(0);
});

test("the title suggestion leaves the marker word out of the note", async ({ page, request }) => {
  await code(page, 4, 0, 40, "routine");
  await page
    .locator("#detail-memo")
    .fill(
      "Ablegen und Bekanntmachen sind getrennte Akte. Anforderungskandidat: Die Ablage benachrichtigt nicht von selbst.",
    );
  await page.locator("#detail-memo").blur();
  await code(page, 6, 0, 40, "agreement");
  await page.locator("#detail-memo").fill("Automatische Erschließung. Anforderungskandidat.");
  await page.locator("#detail-memo").blur();

  await page.locator('.tab[data-view="analysis"]').click();
  for (const index of [0, 1]) {
    await page
      .locator("#citations-part .citation")
      .nth(index)
      .locator(".requirement-choice")
      .selectOption("new");
    await expect(
      page.locator("#citations-part .citation").nth(index).locator(".requirement-tag"),
    ).toHaveCount(1);
  }

  const { requirements } = await (await request.get("/api/requirements")).json();
  const titles = requirements.map((requirement) => requirement.title).sort();
  // Behind the colon stands the demand, otherwise in front of it — the marker
  // word itself never.
  expect(titles).toEqual([
    "Automatische Erschließung.",
    "Die Ablage benachrichtigt nicht von selbst.",
  ]);
});

test("the slice shows which citations carry no requirement yet", async ({ page }) => {
  await code(page, 4, 0, 40, "routine");
  await code(page, 6, 0, 40, "agreement");
  await code(page, 8, 0, 40, "routine");

  await page.locator('.tab[data-view="analysis"]').click();
  const citations = page.locator("#citations-part .citation");
  await expect(citations).toHaveCount(3);

  await page.locator('.citation-filter [data-filter="withoutRequirement"]').check();
  await expect(citations).toHaveCount(3);

  await citations.first().locator(".requirement-choice").selectOption("new");
  // The passage drops out of the slice, because it now carries a requirement.
  await expect(citations).toHaveCount(2);
  await expect(page.locator("#filter-clear")).toContainText("2 von 3");

  // The export carries the same slice.
  const target = await page.locator("#slice-export").getAttribute("href");
  expect(target).toContain("open=1");
});

test("the set slice can be exported", async ({ page, request }) => {
  await code(page, 4, 0, 40, "routine");
  await code(page, 6, 0, 40, "agreement");
  await page.locator("#interview-choice").selectOption(SECOND);
  await expect(page.locator(".turn")).toHaveCount(4);
  await code(page, 2, 0, 40, "routine");

  await page.locator('.tab[data-view="analysis"]').click();
  await page.locator('.citation-filter [data-filter="department"]').selectOption("Vertrieb");

  // The export link carries the slice along.
  const target = await page.locator("#slice-export").getAttribute("href");
  expect(target).toContain("department=Vertrieb");

  const text = await (await request.get(target)).text();
  expect(text).toContain("Schnitt: Bereich Vertrieb.");
  expect(text).toContain("## Arbeitsalltag · 1");
  expect(text).not.toContain("Marketing");

  // Without a slice everything comes.
  const everything = await (await request.get("/api/export/citations.md?lang=de")).text();
  expect(everything).toContain("Alle Kodiereinheiten, ohne Einschränkung.");
  expect(everything).toContain("Marketing");
});

test("all notes stand together and are searchable", async ({ page }) => {
  /* Leaving a note field saves it, and the save is in flight while the test
     reads on — the analysis is fetched next and would be a note short. Each one
     therefore waits for its own save, the same way the notes export test does. */
  const saved = (match) =>
    page.waitForResponse(
      (response) => match(new URL(response.url()).pathname) && response.request().method() === "PATCH",
    );

  await page.locator("#note-shell summary").click();
  await page.locator("#note").fill("Gespräch lief schleppend an.");
  await Promise.all([
    saved((path) => /^\/api\/interviews\/[^/]+$/.test(path)),
    page.locator("#note").blur(),
  ]);

  await page.locator('.category[data-category="agreement"]').click();
  await page.locator('[data-category-memo="agreement"]').fill("Abgrenzung zum Alltag offen.");
  await Promise.all([
    saved((path) => path.includes("/api/categories/agreement")),
    page.locator('[data-category-memo="agreement"]').blur(),
  ]);

  await code(page, 22, 0, 40, "agreement");
  await page.locator("#detail-memo").fill("Hier wird etwas abgelegt.");
  await Promise.all([
    saved((path) => /^\/api\/interviews\/[^/]+\/codings\/[^/]+$/.test(path)),
    page.locator("#detail-memo").blur(),
  ]);

  await page.locator('.tab[data-view="analysis"]').click();
  const entries = page.locator("#notes-part .note-entry");
  await expect(entries).toHaveCount(3);
  // The kind stands as a heading, not on every one of the entries.
  const heads = page.locator("#notes-part .citation-head");
  await expect(heads).toHaveText([
    "Zu den Interviews · 1",
    "Zu den Kategorien · 1",
    "Zu den Fundstellen · 1",
  ]);

  await page.locator("#note-kind").selectOption("passage");
  await expect(entries).toHaveCount(1);
  await expect(heads).toHaveText(["Zu den Fundstellen · 1"]);
  await page.locator("#note-kind").selectOption("");

  await page.locator("#note-category").selectOption("routine");
  await expect(page.locator("#notes-part .empty-state")).toContainText("Keine Notiz passt");
  await page.locator("#note-category").selectOption("");
  await expect(entries).toHaveCount(3);

  // The search knows the same wildcard as the transcript search.
  await page.locator("#note-filter").fill("ab*leg*");
  await expect(entries).toHaveCount(1);
  await expect(entries).toContainText("Hier wird etwas abgelegt");
  await expect(page.locator("#note-filter")).toBeFocused();

  // And the passage note leads back to its place.
  await entries.locator("[data-passage]").click();
  await expect(page.locator("#turn-22 .segment")).toHaveAttribute("data-selected", "true");
});

test("the coding guide carries definition, anchor example and coding rule", async ({
  page,
  request,
}) => {
  await code(page, 20, 0, 40, "routine.disruption");
  await page.locator("#detail-anchor").check();
  await expect(page.locator("#turn-20 .mark .anchor")).toBeVisible();

  await page.locator('.category[data-category="routine.disruption"]').click();
  await page
    .locator('[data-rule="routine.disruption"] input')
    .fill("Nur Aussagen über Unterbrechungen, nicht über Kollegen.");
  await page.locator('[data-rule="routine.disruption"] button').click();
  await expect(
    page.locator('[data-detail="routine.disruption"] [data-rule-text]'),
  ).toHaveCount(1);

  const flat = flatGuide(await (await request.get("/api/export/coding-guide.md?lang=de")).text());
  expect(flat).toContain("↳ Störungen [deduktiv]{.art}");
  expect(flat).toContain("Definition Aussagen über Unterbrechungen");
  expect(flat).toContain("Ankerbeispiel „");
  expect(flat).toContain("Kodierregel Nur Aussagen über Unterbrechungen, nicht über Kollegen.");
});

test("the coding table names location, section and citation", async ({ page, request }) => {
  await code(page, 22, 0, 40, "agreement");

  const text = await (await request.get(`/api/export/coding-table/${FIRST}.md?lang=de`)).text();
  expect(text).toContain("| Fundstelle | Block | Kategorie | Stand | Beleg |");
  expect(text).toMatch(/\| 22 \| Störungen \| Absprachen \|/);
});

test("the appearance switches between light and dark", async ({ page }) => {
  await page.locator("#theme").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator("#theme").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("the page stays usable down to a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  expect(fits).toBe(true);
});

/* Requirements catalog -----------------------------------------------------
   The prioritization counts departments per requirement, not per category. The
   following checks hold on to the fact that the number arises from the
   citations and is not typed in. */

test("a requirement emerges out of the coded passage", async ({ page }) => {
  await code(page, 22, 0, 60, "agreement");

  await page.locator("#detail-new-requirement input").fill("Volltextsuche über Bereichsgrenzen");
  await page.locator("#detail-new-requirement button").click();

  const box = page.locator("#detail [data-requirement]");
  await expect(box).toHaveCount(1);
  await expect(box).toBeChecked();

  await page.locator('.tab[data-view="catalog"]').click();
  const card = page.locator(".requirement").first();
  await expect(card.locator(".title")).toHaveValue("Volltextsuche über Bereichsgrenzen");
  await expect(card.locator(".numbers")).toContainText("1 Bereich");
  await expect(card.locator(".numbers")).toContainText("1 Beleg");
  await expect(card.locator(".category-tags")).toContainText("Absprachen");
});

test("the number of departments is counted, not typed in", async ({ page }) => {
  await page.locator('.tab[data-view="catalog"]').click();
  await page.locator("#new-requirement-title").fill("Dokumente bleiben aktuell");
  await page.locator("#new-requirement button").click();

  const card = page.locator(".requirement").first();
  await expect(card.locator(".numbers")).toContainText("0 Bereiche");
  await expect(card).toContainText("Noch ohne Beleg");

  // Two citations from the same interview count as one department.
  await page.locator('.tab[data-view="code"]').click();
  for (const [number, from, to] of [
    [24, 0, 50],
    [26, 0, 50],
  ]) {
    await code(page, number, from, to, "routine");
    await page.locator("#detail [data-requirement]").check();
  }

  await page.locator('.tab[data-view="catalog"]').click();
  await expect(page.locator(".requirement .numbers")).toContainText("1 Bereich");
  await expect(page.locator(".requirement .numbers")).toContainText("2 Belege");
});

test("MoSCoW level and blocked operation can be recorded", async ({ page }) => {
  await page.locator('.tab[data-view="catalog"]').click();
  await page.locator("#new-requirement-title").fill("Ablage ohne eigenen Arbeitsschritt");
  await page.locator("#new-requirement button").click();

  const card = page.locator(".requirement").first();
  await card.locator(".level").selectOption("must");
  await card.locator('[data-blocked="filing"]').check();
  await card.locator(".description").fill("Dokumentation fällt als Nebenprodukt an.");
  await card.locator(".description").blur();

  await page.reload();
  await page.locator('.tab[data-view="catalog"]').click();
  const again = page.locator(".requirement").first();
  await expect(again.locator(".level")).toHaveValue("must");
  await expect(again.locator('[data-blocked="filing"]')).toBeChecked();
  await expect(again.locator(".description")).toHaveValue(
    "Dokumentation fällt als Nebenprodukt an.",
  );
});

test("the catalog orders by level and names the citations", async ({ page, request }) => {
  await page.locator('.tab[data-view="catalog"]').click();
  for (const title of ["Zweitrangig", "Vorrangig"]) {
    await page.locator("#new-requirement-title").fill(title);
    await page.locator("#new-requirement button").click();
    await expect(page.locator(`.requirement[data-title="${title}"]`)).toHaveCount(1);
  }
  await page.locator('.requirement[data-title="Vorrangig"] .level').selectOption("must");
  await page.locator('.requirement[data-title="Zweitrangig"] .level').selectOption("could");

  await expect(page.locator(".requirement .title").first()).toHaveValue("Vorrangig");

  const text = await (await request.get("/api/export/requirements-catalog.md?lang=de")).text();
  expect(text).toContain("| Anforderung | MoSCoW | Bereiche | Belege | blockiert |");
  expect(text.indexOf("Vorrangig")).toBeLessThan(text.indexOf("Zweitrangig"));
});

test("two requirements can be made into one", async ({ page, request }) => {
  await code(page, 4, 0, 40, "routine");
  await page.locator("#detail-memo").fill("Die Ablage benachrichtigt nicht von selbst.");
  await page.locator("#detail-memo").blur();
  await code(page, 6, 0, 40, "agreement");
  await page.locator("#detail-memo").fill("Niemand erfährt von neuen Ablagen.");
  await page.locator("#detail-memo").blur();

  await page.locator('.tab[data-view="analysis"]').click();
  for (const index of [0, 1]) {
    await page
      .locator("#citations-part .citation")
      .nth(index)
      .locator(".requirement-choice")
      .selectOption("new");
    await expect(
      page.locator("#citations-part .citation").nth(index).locator(".requirement-tag"),
    ).toHaveCount(1);
  }

  await page.locator('.tab[data-view="catalog"]').click();
  await expect(page.locator(".requirement")).toHaveCount(2);
  const first = page.locator(".requirement").first();
  await first.locator('[data-blocked="filing"]').check();
  await expect(first.locator('[data-blocked="filing"]')).toBeChecked();

  /* Folded away until it is wanted: dissolving one requirement into another is
     done once, when two turn out to be one, and it used to stand open on every
     card in the catalog. */
  await expect(first.locator(".requirement-target")).toBeHidden();
  await first.locator(".requirement-merge > summary").click();
  await first.locator(".requirement-target").selectOption({ index: 1 });
  await first.locator("[data-requirement-merge]").click();

  await expect(page.locator(".message")).toContainText("1 Beleg übernommen");
  await expect(page.locator(".requirement")).toHaveCount(1);
  // Both citations hang off the remaining requirement, the operation came along.
  await expect(page.locator(".requirement .numbers")).toContainText("2");
  await expect(page.locator('.requirement [data-blocked="filing"]')).toBeChecked();

  // The coding units themselves stay untouched.
  const data = await (await request.get(`/api/interviews/${FIRST}`)).json();
  expect(data.codings).toHaveLength(2);
  const ids = new Set(data.codings.flatMap((coding) => coding.requirements));
  expect(ids.size).toBe(1);
});

test("a removed requirement leaves the coding units standing", async ({ page }) => {
  await code(page, 28, 0, 50, "agreement");
  await page.locator("#detail-new-requirement input").fill("Wird gleich wieder entfernt");
  await page.locator("#detail-new-requirement button").click();

  await page.locator('.tab[data-view="catalog"]').click();
  await page.locator(".requirement [data-remove]").click();
  await expect(page.locator(".requirement")).toHaveCount(0);

  await page.locator('.tab[data-view="code"]').click();
  await expect(page.locator("#turn-28 .segment")).toHaveCount(1);
  await expect(page.locator("#turn-28 .mark .what")).toContainText("Absprachen");
});

/**
 * The catalog is worked up graphically before it is worked through row by row:
 * how the levels are distributed, where each requirement sits between naming
 * departments and blocked operations, and which department carries it.
 */
test("the catalog works the requirements up graphically", async ({ page, request }) => {
  // One requirement from both interviews, one from a single one.
  await code(page, 4, 0, 40, "routine");
  await page.locator("#detail-new-requirement input").fill("Auffindbarkeit ohne Rückfrage");
  await page.locator("#detail-new-requirement button").click();
  await expect(page.locator("#detail [data-requirement]")).toHaveCount(1);

  await code(page, 6, 0, 40, "agreement");
  await page.locator("#detail-new-requirement input").fill("Absprachen an einer Stelle");
  await page.locator("#detail-new-requirement button").click();
  await expect(page.locator("#detail [data-requirement]")).toHaveCount(2);

  await page.locator("#interview-choice").selectOption(SECOND);
  await expect(page.locator(".turn")).toHaveCount(4);
  await code(page, 4, 0, 45, "routine");
  await page
    .locator("#detail li", { hasText: "Auffindbarkeit ohne Rückfrage" })
    .locator("input")
    .check();
  // The second department only counts once the assignment has been written.
  await expect
    .poll(async () => {
      const { requirements } = await (await request.get("/api/requirements")).json();
      return requirements.find((r) => r.title.startsWith("Auffindbarkeit")).departments.length;
    })
    .toBe(2);

  await page.locator('.tab[data-view="catalog"]').click();

  // Four numbers up front: requirements, cited, prioritized, citations.
  await expect(page.locator("#catalog-metrics .metric")).toHaveCount(4);
  await expect(page.locator("#catalog-metrics .metric .value").first()).toHaveText("2");

  /* Nothing has a level yet, so the two figures that are about levels are not
     drawn — a band labelled "2 open" and a field with both points on the floor
     say nothing and read like a finding. What stands there instead says what
     they need. */
  await expect(page.locator("#moscow")).toHaveCount(0);
  await expect(page.locator("#priority")).toHaveCount(0);
  await expect(page.locator("#catalog-charts .column-note", { hasText: "fehlen hier noch" })).toBeVisible();

  // The judgment, on the card where it is made, brings them both.
  const card = page.locator('.requirement[data-title="Auffindbarkeit ohne Rückfrage"]');
  await card.locator(".level").selectOption("must");
  await card.locator('[data-blocked="retrieval"]').check();
  // One point per requirement, coloured by level and placed by departments and
  // blocked operations; one band per level in use, the other still open.
  await expect(page.locator("#priority .point")).toHaveCount(2);
  await expect(page.locator("#priority .point.moscow-must")).toHaveCount(1);
  await expect(page.locator("#moscow .moscow-band")).toHaveCount(2);

  // The coverage chart stacks the citations by department, like the analysis.
  await expect(page.locator("#coverage .segment")).toHaveCount(3);
  await expect(page.locator(".chart-legend:not(.moscow) span")).toHaveText([
    "Marketing",
    "Vertrieb",
  ]);

  // Hovering names the requirement with both its numbers.
  await page.locator("#priority .point.moscow-must").hover();
  const tip = page.locator("#priority .chart-tip");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("Auffindbarkeit ohne Rückfrage");
  await expect(tip).toContainText("2 Bereiche");

  // And every chart of the catalog saves as a standalone SVG.
  const download = page.waitForEvent("download");
  await page.locator('[data-svg="priority"]').click();
  expect((await download).suggestedFilename()).toBe("prioritization.svg");
});

/* Several interviews -------------------------------------------------------
   Department count and cross table only carry once more than one transcript is
   present. */

test("both interviews stand to be chosen and can be switched", async ({ page }) => {
  const choice = page.locator("#interview-choice option");
  await expect(choice).toHaveCount(2);
  await expect(choice.nth(1)).toHaveText("Interview 2: Vertrieb");

  await page.locator("#interview-choice").selectOption(SECOND);
  await expect(page.locator(".turn")).toHaveCount(4);
  await expect(page.locator("#header-subtitle")).toContainText("Vertrieb");
  await expect(page.locator("#sections .section-entry")).toHaveCount(2);
});

test("the chosen interview survives a reload", async ({ page }) => {
  await page.locator("#interview-choice").selectOption(SECOND);
  await expect(page.locator(".turn")).toHaveCount(4);
  await page.reload();
  await expect(page.locator("#interview-choice")).toHaveValue(SECOND);
  await expect(page.locator(".turn")).toHaveCount(4);
});

test("the cross table carries one column per department", async ({ page }) => {
  await code(page, 4, 0, 35, "routine");
  await page.locator("#interview-choice").selectOption(SECOND);
  await expect(page.locator(".turn")).toHaveCount(4);
  await code(page, 2, 0, 40, "routine");

  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#matrix-table thead th")).toContainText([
    "Kategorie",
    "Marketing",
    "Vertrieb",
    "Summe",
    "Bereiche",
  ]);

  const row = page.locator("#matrix-table tbody tr", { hasText: "Arbeitsalltag" }).first();
  await expect(row.locator("td.num").last()).toHaveText("2");
});

/* "All reviewed" is the sentence somebody reads just before they start writing
   up, so it has to say which of the two it means: this interview, or the study. */

test("all reviewed here does not claim the study is done", async ({ page, request }) => {
  // A suggestion in the other interview, the way a machine pre-coding leaves it.
  // The wording is taken from the transcript: an invented citation counts as
  // lost rather than open, and would never show up as something to review.
  const other = await (await request.get(`/api/interviews/${SECOND}`)).json();
  const turn = other.turns.find((one) => !one.interviewer && one.text.length > 40);
  await suggest(request, 4, 0, 40, "routine", "Klar, ich bin seit dem Frühjahr im Team");
  await request.post(`/api/interviews/${SECOND}/codings`, {
    data: {
      turn: turn.number,
      start: 0,
      end: 40,
      category: "routine",
      text: turn.text.slice(0, 40),
    },
  });
  // Everything in the interview on screen is confirmed by hand.
  await page.reload();
  await page.locator("#review").click();
  await page.keyboard.press("Enter");
  await expect(page.locator(".open-status.reviewed")).toBeVisible();

  // …but the study is not, and the status says so instead of stopping at
  // "all reviewed".
  await expect(page.locator("#status")).toContainText("alle geprüft");
  await expect(page.locator("#status")).toContainText("in anderen Interviews");
  // The interview that still holds them is marked in the list.
  await expect(page.locator("#interview-choice")).toContainText("1 offen");

  // And the way there is one click, landing on the suggestion itself.
  await page.locator("#review-elsewhere").click();
  await expect(page.locator("#interview-choice")).toHaveValue(SECOND);
  await expect(page.locator(".segment[data-selected='true']")).toHaveCount(1);
});

test("with nothing open elsewhere the status keeps quiet", async ({ page }) => {
  await code(page, 4, 0, 40, "routine");
  await expect(page.locator(".open-status.reviewed")).toBeVisible();
  await expect(page.locator("#status")).not.toContainText("in anderen Interviews");
  await expect(page.locator("#review-elsewhere")).toHaveCount(0);
  await expect(page.locator("#interview-choice")).not.toContainText("offen");
});

test("confirmations keep up with the keyboard", async ({ page, request }) => {
  /* Reviewing a long pass, Enter is pressed faster than the save answers. The
     confirmations are chained for that reason; without the chain the second
     keystroke confirms the same unit again and one is skipped — unnoticed,
     because the count drops either way. */
  // The citation has to be the real wording: a suggestion whose text is not in
  // the turn counts as lost, not as open, and would never enter the queue.
  const transcript = await (await request.get(`/api/interviews/${FIRST}`)).json();
  const turns = transcript.turns
    .filter((turn) => !turn.interviewer && turn.text.length > 40)
    .slice(0, 10);
  for (const turn of turns) {
    await suggest(request, turn.number, 0, 30, "routine", turn.text.slice(0, 30));
  }
  await page.reload();
  const open = () =>
    page.evaluate(async (id) => {
      const data = await (await fetch(`/api/interviews/${id}`)).json();
      return data.codings.filter((coding) => coding.reviewed !== true).length;
    }, FIRST);
  expect(await open()).toBe(turns.length);

  await page.locator("#review").click();
  for (let press = 0; press < turns.length + 3; press++) {
    await page.keyboard.press("Enter");
    await page.waitForTimeout(10);
  }
  await expect.poll(open, { timeout: 10000 }).toBe(0);
  await expect(page.locator(".open-status.reviewed")).toBeVisible();
});

test("a requirement counts departments across interviews", async ({ page }) => {
  await code(page, 6, 0, 40, "agreement");
  await page.locator("#detail-new-requirement input").fill("Auffindbarkeit ohne Rückfrage");
  await page.locator("#detail-new-requirement button").click();
  await expect(page.locator("#detail [data-requirement]")).toBeChecked();

  await page.locator("#interview-choice").selectOption(SECOND);
  await expect(page.locator(".turn")).toHaveCount(4);
  await code(page, 4, 0, 45, "agreement");
  await page.locator("#detail [data-requirement]").check();

  await page.locator('.tab[data-view="catalog"]').click();
  const card = page.locator(".requirement").first();
  await expect(card.locator(".numbers")).toContainText("2 Bereiche");
  await expect(card.locator(".numbers")).toContainText("2 Belege");
  await expect(card.locator(".numbers")).toContainText("Marketing, Vertrieb");

  /* The priority field waits for a judgment to draw — a field where everything
     sits at zero because nobody has decided anything yet is not a picture of a
     study. So this makes the decision the figure is about. */
  await card.locator("select.level").selectOption({ index: 1 });
  await expect(page.locator("#priority")).toBeVisible();

  /* A requirement every department named sits on the last gridline — the
     ordinary case for anything important, not an edge case. It has to be drawn
     inside the picture rather than half over its own axis label. */
  const strays = await page.locator("#priority svg").evaluate((svg) => {
    const [, , width, height] = svg.getAttribute("viewBox").split(/\s+/).map(Number);
    return [...svg.querySelectorAll("circle.point")]
      .map((point) => ({
        cx: Number(point.getAttribute("cx")),
        cy: Number(point.getAttribute("cy")),
        r: Number(point.getAttribute("r")),
      }))
      .filter(
        ({ cx, cy, r }) => cx - r < 0 || cx + r > width || cy - r < 0 || cy + r > height,
      );
  });
  expect(strays).toEqual([]);
});

/* Anchoring -----------------------------------------------------------------
   Codings hold their place through character positions. When the transcript is
   corrected they have to move along or show up — silently marking the wrong
   passage would be the worst outcome. */

test("a shifted passage is moved along silently", async ({ page }) => {
  await code(page, 4, 0, 35, "routine");
  await page.locator("#interview-choice").selectOption(SECOND);

  editTranscript(
    FIRST,
    "Klar, ich bin seit dem Frühjahr im Team dabei.",
    "Also. Klar, ich bin seit dem Frühjahr im Team dabei.",
  );

  await page.locator("#interview-choice").selectOption(FIRST);
  await expect(page.locator("#message")).toContainText("nachgeführt");
  await expect(page.locator("#drift")).toBeHidden();

  const segment = page.locator("#turn-4 .segment");
  await expect(segment).toHaveCount(1);
  await expect(segment).toContainText("Klar, ich bin seit dem Frühjahr");
});

test("an unfindable passage is reported and not displayed", async ({ page }) => {
  await code(page, 4, 0, 35, "routine");
  await page.locator("#interview-choice").selectOption(SECOND);

  editTranscript(
    FIRST,
    "Klar, ich bin seit dem Frühjahr im Team dabei. Ich betreue unsere Kampagnen",
    "Ich arbeite hier seit dem Frühjahr und betreue die Werbung",
  );

  await page.locator("#interview-choice").selectOption(FIRST);
  await expect(page.locator("#drift")).toBeVisible();
  await expect(page.locator("#drift h2")).toContainText("findet ihre Stelle nicht mehr");
  await expect(page.locator("#drift blockquote")).toContainText("Klar, ich bin seit dem Frühjahr");
  await expect(page.locator("#turn-4 .segment")).toHaveCount(0);
});

test("a coding unit that lost its place can be re-anchored", async ({ page }) => {
  await code(page, 4, 0, 35, "routine");
  await page.locator("#interview-choice").selectOption(SECOND);
  editTranscript(
    FIRST,
    "Klar, ich bin seit dem Frühjahr im Team dabei.",
    "Ich arbeite hier seit 2024.",
  );
  await page.locator("#interview-choice").selectOption(FIRST);
  await expect(page.locator("#drift")).toBeVisible();

  await page.locator("[data-reanchor]").click();
  await expect(page.locator("body")).toHaveClass(/anchoring/);
  // In re-anchoring mode the selection sets the place directly; the coding bar
  // stays shut, because the category is already settled.
  await selectText(page, 4, 0, 27);
  await expect(page.locator("#coding-bar")).toBeHidden();

  await expect(page.locator("#drift")).toBeHidden();
  const segment = page.locator("#turn-4 .segment");
  await expect(segment).toHaveCount(1);
  await expect(segment).toContainText("Ich arbeite hier seit 2024.");
  await expect(page.locator("#turn-4 .mark .what")).toContainText("Arbeitsalltag");
});

test("a coding unit that lost its place can be discarded", async ({ page }) => {
  await code(page, 4, 0, 35, "routine");
  await page.locator("#interview-choice").selectOption(SECOND);
  editTranscript(FIRST, "Klar, ich bin seit dem Frühjahr im Team dabei.", "Anders.");
  await page.locator("#interview-choice").selectOption(FIRST);

  await page.locator("[data-drift-remove]").click();
  await expect(page.locator("#drift")).toBeHidden();
  await expect(page.locator("#turn-4 .segment")).toHaveCount(0);
});

test("the reading position survives a reload", async ({ page }) => {
  const container = page.locator(".edition");
  await container.evaluate((element) => element.scrollTo({ top: 900 }));
  await expect.poll(() => container.evaluate((el) => el.scrollTop)).toBeGreaterThan(500);
  const before = await container.evaluate((element) => element.scrollTop);
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("fundstelle.readingPosition.interview-01")),
    )
    .not.toBeNull();

  await page.reload();
  await expect(page.locator(".turn").first()).toBeVisible();
  // Not to the pixel: what is remembered is the topmost turn plus an offset,
  // and the height may differ by one margin mark.
  await expect.poll(() => container.evaluate((el) => el.scrollTop)).toBeGreaterThan(before - 80);
  await expect(page.locator(".turn.focused")).toHaveCount(1);
});

test("every interview remembers its own reading position", async ({ page }) => {
  const container = page.locator(".edition");
  await container.evaluate((element) => element.scrollTo({ top: 900 }));
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("fundstelle.readingPosition.interview-01")),
    )
    .not.toBeNull();

  await page.locator("#interview-choice").selectOption(SECOND);
  await expect(page.locator(".turn")).toHaveCount(4);
  expect(await container.evaluate((element) => element.scrollTop)).toBe(0);

  await page.locator("#interview-choice").selectOption(FIRST);
  await expect.poll(() => container.evaluate((el) => el.scrollTop)).toBeGreaterThan(500);
});

/* Language -------------------------------------------------------------------
   German is the default and complete; English follows the browser or an
   explicit wish. */

test("the interface speaks English on request, German stays the default", async ({ page }) => {
  await page.goto("/?lang=en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator('.tab[data-view="code"]')).toHaveText("Code");
  await expect(page.locator(".column-left .column-title")).toHaveText("Sections");
  await expect(page.locator("#search")).toHaveAttribute("placeholder", /Search the transcript/);

  // Dynamically drawn parts speak English too: status bar and detail field.
  await expect(page.locator("#status")).toContainText("coding units");
  await code(page, 4, 0, 40, "routine");
  await expect(page.locator("#detail h2")).toContainText("Coding unit · Turn 4");
  await expect(page.locator("#status .open-status")).toHaveText("all reviewed");

  // And the analysis with its metrics, chart and exports.
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#view-analysis h2")).toHaveText("Analysis");
  await expect(page.locator(".metric .label").first()).toHaveText("Coding units");
  await expect(page.locator("#chart-title")).toHaveText("Coding units per category");
  await expect(page.locator("#matrix-export")).toHaveText("Table as Markdown");
  await expect(page.locator(".exports a", { hasText: "Coding guide" })).toBeVisible();
  await expect(page.locator("#citations-part h3")).toHaveText("Citations");

  // And the catalog.
  await page.locator('.tab[data-view="catalog"]').click();
  await expect(page.locator("#view-catalog h2")).toHaveText("Requirements catalog");
  await expect(page.locator("#new-requirement .button")).toHaveText("Add");

  // Without an explicit wish everything stays German — no browser detection.
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.locator('.tab[data-view="code"]')).toHaveText("Kodieren");
});

test.describe("english browser", () => {
  test.use({ locale: "en-US" });
  test("gets the English interface by itself", async ({ page }) => {
    await expect(page.locator('.tab[data-view="code"]')).toHaveText("Code");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});

test("the exports follow the language the tool is operated in", async ({ page, request }) => {
  await code(page, 4, 0, 40, "routine");
  await page.goto("/?lang=en");
  await page.locator('.tab[data-view="analysis"]').click();

  // The link carries the wish: a download is a plain navigation and would
  // otherwise arrive in whatever language the browser prefers.
  const guideLink = page.locator(".exports a", { hasText: "Coding guide" });
  await expect(guideLink).toHaveAttribute("href", "/api/export/coding-guide.md?lang=en");

  const guide = await (await request.get("/api/export/coding-guide.md?lang=en")).text();
  expect(guide).toContain("# Coding guide");
  expect(guide).toContain("[deductive]{.art}");
  expect(guide).not.toContain("deduktiv");

  const matrix = await (await request.get("/api/export/matrix.md?lang=en")).text();
  expect(matrix).toContain("# Categories by department");
  expect(matrix).toContain("Total");
  // The grid table keeps its fixed width whatever the headings are called.
  for (const line of matrix.split("\n").filter((l) => l.startsWith("+") || l.startsWith("|"))) {
    expect(line.length).toBe(80);
  }

  const citations = await (await request.get("/api/export/citations.md?lang=en")).text();
  expect(citations).toContain("# Citations");
  expect(citations).toContain("All coding units, without restriction.");
  // Quotation marks belong to the language too.
  expect(citations).toContain("“");
  expect(citations).not.toContain("„");

  const table = await (await request.get(`/api/export/coding-table/${FIRST}.md?lang=en`)).text();
  expect(table).toContain("| Passage | Section | Category | State | Citation |");
  expect(table).toContain("reviewed");
  expect(table).not.toContain("geprüft");

  const catalogText = await (
    await request.get("/api/export/requirements-catalog.md?lang=en")
  ).text();
  expect(catalogText).toContain("| Requirement | MoSCoW | Departments | Citations | blocks |");

  const notes = await (await request.get("/api/export/notes.md?lang=en")).text();
  expect(notes).toContain("# Notes on the coding process");
});

test("without a stated wish the exports follow the browser", async ({ request }) => {
  const german = await (
    await request.get("/api/export/matrix.md", { headers: { "accept-language": "de-DE,de;q=0.9" } })
  ).text();
  expect(german).toContain("# Kategorien nach Bereich");

  // A preference order is read as one: the higher quality wins, not the first.
  const english = await (
    await request.get("/api/export/matrix.md", {
      headers: { "accept-language": "de;q=0.4,en;q=0.9" },
    })
  ).text();
  expect(english).toContain("# Categories by department");

  // An explicit wish beats the browser.
  const asked = await (
    await request.get("/api/export/matrix.md?lang=de", {
      headers: { "accept-language": "en-US" },
    })
  ).text();
  expect(asked).toContain("# Kategorien nach Bereich");
});

test("a refusal from the server explains itself in the interface language", async ({
  page,
  request,
}) => {
  // The message travels from the server verbatim, so it has to be written in
  // the language the interface is set to — not the browser's.
  await addCategory(request, "Medienbruch");
  await page.goto("/?lang=en");
  await code(page, 18, 0, 30, "ind.medienbruch");

  await page.locator('.category[data-category="ind.medienbruch"]').click();
  await page.locator('[data-detail="ind.medienbruch"] [data-category-remove]').click();
  await expect(page.locator("#message")).toContainText("carries 1 codings and cannot be dropped");

  await page.goto("/?lang=de");
  await page.locator('.category[data-category="ind.medienbruch"]').click();
  await page.locator('[data-detail="ind.medienbruch"] [data-category-remove]').click();
  await expect(page.locator("#message")).toContainText("trägt 1 Kodierungen");
});

test("the error language is negotiated like everything else", async ({ request }) => {
  const missing = "/api/categories/does-not-exist";
  const english = await request.delete(missing, { headers: { "accept-language": "en" } });
  expect((await english.json()).error).toBe("Unknown category");

  const german = await (
    await request.delete(missing, { headers: { "accept-language": "de-DE" } })
  ).json();
  expect(german.error).toBe("Unbekannte Kategorie");
  // The key travels along, so a caller can react to the case and not to wording.
  expect(german.code).toBe("errorUnknownCategory");
});

test("the coding guide carries a class name templates can select on", async ({ request }) => {
  const guide = await (await request.get("/api/export/coding-guide.md?lang=de")).text();
  // The English name leads; the German one stays so that typesetting written
  // for an earlier version keeps working.
  expect(guide).toContain("::: {.coding-guide .leitfaden}");
});

test("the language switch in the header changes permanently and back", async ({ page }) => {
  await expect(page.locator("#language")).toHaveText("EN");
  await page.locator("#language").click();
  await expect(page.locator('.tab[data-view="code"]')).toHaveText("Code");
  await expect(page.locator("#language")).toHaveText("DE");

  // The choice survives a reload — and the way back stands open.
  await page.reload();
  await expect(page.locator('.tab[data-view="code"]')).toHaveText("Code");
  await page.locator("#language").click();
  await expect(page.locator('.tab[data-view="code"]')).toHaveText("Kodieren");
});

/* Onboarding -----------------------------------------------------------------
   Without transcripts the empty screen is the instruction: it names the
   expected folder, shows the file format and the way to a category system of
   one's own. */

test("without transcripts the first start becomes the instruction", async ({ page }) => {
  await page.route("**/api/interviews", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.goto("/");

  const onboarding = page.locator(".onboarding");
  await expect(onboarding).toBeVisible();
  await expect(onboarding).toContainText("final.md");
  // The real path comes from the server, not a placeholder.
  await expect(onboarding.locator("#onboarding-path")).toContainText("transcripts");
  await expect(onboarding.locator(".onboarding-sample")).toContainText("## Section:");
  await expect(onboarding.locator("#onboarding-reload")).toBeVisible();
  await expect(onboarding).toContainText("START_SYSTEM");
});

/* Charts ---------------------------------------------------------------------
   The analysis shows the cross table as a stacked bar chart too. The table
   stays the citable number, the chart the overview — both have to carry the
   same values. */

test("the chart stacks coding units per category by department", async ({ page }) => {
  await code(page, 4, 0, 40, "routine");
  await code(page, 6, 0, 40, "routine");
  await code(page, 22, 0, 40, "agreement");
  await page.locator("#interview-choice").selectOption(SECOND);
  await expect(page.locator(".turn")).toHaveCount(4);
  await code(page, 2, 0, 30, "routine");

  await page.locator('.tab[data-view="analysis"]').click();
  const chart = page.locator("#chart");
  // Arbeitsalltag carries two segments (two departments), Absprachen one.
  await expect(chart.locator(".segment")).toHaveCount(3);
  await expect(chart.locator('.segment[data-row="Arbeitsalltag"]')).toHaveCount(2);
  await expect(
    chart.locator('.segment[data-row="Arbeitsalltag"][data-department="Vertrieb"]'),
  ).toHaveAttribute("data-value", "1");

  // The legend names the departments in a fixed order.
  await expect(page.locator(".chart-legend:not(.ramp) span")).toHaveText([
    "Marketing",
    "Vertrieb",
  ]);

  // Hovering names row, department and number.
  await chart.locator('.segment[data-row="Absprachen"]').hover();
  const tip = chart.locator(".chart-tip");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("Absprachen");
  await expect(tip).toContainText("Marketing: 1");
});

test("categories without a coding stay visible in the chart", async ({ page }) => {
  await code(page, 4, 0, 40, "routine");
  await page.locator('.tab[data-view="analysis"]').click();
  // An empty category does not disappear — it shows a muted zero.
  await expect(page.locator("#chart .segment")).toHaveCount(1);
  await expect(page.locator("#chart .value.empty").first()).toHaveText("0");
  // The row order is that of the category system, not that of size.
  await expect(page.locator("#chart .row-label").first()).toHaveText("Arbeitsalltag");
});

test("the heatmap spreads the categories across the guide sections", async ({ page }) => {
  await code(page, 4, 0, 40, "routine");
  await code(page, 22, 0, 40, "agreement");

  await page.locator('.tab[data-view="analysis"]').click();
  const heatmap = page.locator("#heatmap");
  await expect(heatmap).toBeVisible();
  // Only occupied cells carry a value; empty ones show the grid.
  await expect(heatmap.locator(".cell")).toHaveCount(2);
  await expect(heatmap.locator(".cell-value")).toHaveText(["1", "1"]);
  expect(await heatmap.locator(".cell-empty").count()).toBeGreaterThan(10);

  // Hovering names category, section and number.
  await heatmap.locator(".cell").first().hover();
  const tip = heatmap.locator(".chart-tip");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("Arbeitsalltag");

  // The heatmap saves as an SVG too.
  const download = page.waitForEvent("download");
  await page.locator('[data-svg="heatmap"]').click();
  expect((await download).suggestedFilename()).toBe("distribution-across-sections.svg");
});

test("the section headings are readable, not cut down to an ellipsis", async ({ page }) => {
  await code(page, 4, 0, 40, "routine");
  await page.locator('.tab[data-view="analysis"]').click();

  const headings = page.locator("#heatmap text.heading");
  await expect(headings).toHaveCount(9);

  // Set upright, a column is about eight characters wide and every name but
  // the shortest was an ellipsis — legible on hover, which the exported file
  // and the printed page do not have.
  const joined = (await headings.allTextContents()).join("|");
  expect(joined).toContain("Zusammenarbeit über Bereiche");
  expect(joined).toContain("Wünsche an ein Werkzeug");
  expect(joined).not.toContain("…");
});

test("the drawing grows until the angled headings fit inside it", async ({ page }) => {
  await code(page, 4, 0, 40, "routine");
  await page.locator('.tab[data-view="analysis"]').click();

  // How wide a heading really is depends on the font, so it is measured rather
  // than guessed. Guessing let the two longest names run through the caption.
  const fit = await page.locator("#heatmap svg").evaluate((svg) => {
    const angle = (Number(svg.dataset.angle) * Math.PI) / 180;
    const widest = Math.max(
      ...[...svg.querySelectorAll("text.heading")].map((text) => text.getBBox().width),
    );
    return {
      height: Number(svg.getAttribute("viewBox").split(/\s+/)[3]),
      needed: Number(svg.dataset.baseline) + widest * Math.sin(angle),
    };
  });
  expect(fit.needed).toBeGreaterThan(0);
  expect(fit.height).toBeGreaterThanOrEqual(fit.needed);
});

test("the chart saves as a standalone SVG file", async ({ page }) => {
  await code(page, 4, 0, 40, "routine");
  await page.locator('.tab[data-view="analysis"]').click();

  const download = page.waitForEvent("download");
  await page.locator('[data-svg="chart"]').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("coding-units-per-category.svg");

  /* The file carries its colours itself, not through custom properties. Which
     is the property, not the mechanism: this used to insist on an inline
     `fill: rgb(…)` per element, because that was how the file was made — by
     asking the laid-out page what colour everything had come out. It is now
     one declared stylesheet travelling with the picture, and a check written
     against the old mechanism failed a file that was in every way better.
     What actually has to hold is that no colour is left to be looked up
     somewhere the file cannot reach, and that a segment does get one. */
  const content = readFileSync(await file.path(), "utf8");
  expect(content).toContain("xmlns");
  expect(content).not.toContain("var(--");
  expect(content).toMatch(/\.segment\.series-s1\s*\{\s*fill:\s*#[0-9a-f]{6}/i);
  expect(content).toMatch(/class="segment series-s1"/);
});

/* At twenty requirements the catalog runs to several screens. The counts say
   what is unfinished; naming that without a way to reach it is half the job. */

test("the catalog can be cut down to what is still unfinished", async ({ page, request }) => {
  // Three requirements, each unfinished in its own way, and one that is done.
  const done = await (
    await request.post("/api/requirements", { data: { title: "Fertig", moscow: "must" } })
  ).json();
  await request.post("/api/requirements", { data: { title: "Ohne Stufe" } });
  await request.post("/api/requirements", { data: { title: "Ohne Beleg", moscow: "should" } });
  const shaky = await (
    await request.post("/api/requirements", { data: { title: "Nur Vorschläge", moscow: "could" } })
  ).json();

  const transcript = await (await request.get(`/api/interviews/${FIRST}`)).json();
  const turns = transcript.turns.filter((t) => !t.interviewer && t.text.length > 60).slice(0, 2);
  for (const [index, turn] of turns.entries()) {
    const coding = await (
      await request.post(`/api/interviews/${FIRST}/codings`, {
        data: {
          turn: turn.number,
          start: 0,
          end: 45,
          category: "routine",
          text: turn.text.slice(0, 45),
          reviewed: index === 0,
          requirements: [index === 0 ? done.id : shaky.id],
        },
      })
    ).json();
    expect(coding.id).toBeTruthy();
  }

  await page.reload();
  await page.locator('.tab[data-view="catalog"]').click();
  await expect(page.locator(".requirement")).toHaveCount(4);

  // Without a level.
  await page.locator('[data-catalog-filter="open"]').check();
  await expect(page.locator(".requirement")).toHaveCount(1);
  await expect(page.locator(".requirement .title")).toHaveValue("Ohne Stufe");
  await expect(page.locator("#catalog-filter-clear")).toContainText("1 von 4");
  await page.locator("#catalog-filter-clear").click();
  await expect(page.locator(".requirement")).toHaveCount(4);

  // Without any citation at all — two of them, since "Ohne Stufe" has none either.
  await page.locator('[data-catalog-filter="unsupported"]').check();
  await expect(page.locator(".requirement")).toHaveCount(2);
  await page.locator("#catalog-filter-clear").click();

  // Resting on evidence nobody has confirmed.
  await page.locator('[data-catalog-filter="unreviewed"]').check();
  await expect(page.locator(".requirement")).toHaveCount(1);
  await expect(page.locator(".requirement .title")).toHaveValue("Nur Vorschläge");

  // Two cuts at once narrow further rather than widening.
  await page.locator('[data-catalog-filter="unsupported"]').check();
  await expect(page.locator(".requirement")).toHaveCount(0);
  await expect(page.locator("#view-catalog .empty-state")).toContainText("Keine Anforderung");
});

/* A study of twenty interviews reaches a thousand citations, and drawn in full
   that list is a hundred and thirty metres of scrolling with a select on every
   card. Each category shows its first few — but the count in its heading, and
   everything the export writes, must stay the whole truth. */

test("a long citation list shows its first few and says how many there are", async ({
  page,
  request,
}) => {
  const transcript = await (await request.get(`/api/interviews/${FIRST}`)).json();
  const codable = transcript.turns
    .filter((turn) => !turn.interviewer && turn.text.length > 60)
    .slice(0, 20);
  expect(codable.length).toBe(20);
  for (const turn of codable) {
    await request.post(`/api/interviews/${FIRST}/codings`, {
      data: {
        turn: turn.number,
        start: 0,
        end: 45,
        category: "routine",
        text: turn.text.slice(0, 45),
        reviewed: true,
      },
    });
  }

  await page.reload();
  await page.locator('.tab[data-view="analysis"]').click();

  const group = page.locator(".citations").first();
  await expect(group.locator(".citation")).toHaveCount(12);
  // The heading counts them all, whatever is drawn.
  await expect(page.locator(".citation-head").first()).toContainText("· 20");
  await expect(page.locator(".show-rest").first()).toContainText("alle 20 Belege zeigen");

  // The export writes the slice, not what happens to be on screen.
  const markdown = await (
    await request.get("/api/export/citations.md?lang=de")
  ).text();
  expect((markdown.match(/^- /gm) ?? []).length).toBe(20);

  // Opening the category shows the whole of it, and it stays open.
  await page.locator(".show-rest").first().click();
  await expect(group.locator(".citation")).toHaveCount(20);
  await expect(page.locator(".show-rest")).toHaveCount(0);
  await expect(page.locator(".citation-head").first()).toContainText("· 20");
});

test("a short citation list is simply shown", async ({ page }) => {
  await code(page, 4, 0, 40, "routine");
  await code(page, 6, 0, 40, "routine");
  await page.locator('.tab[data-view="analysis"]').click();

  await expect(page.locator(".citation")).toHaveCount(2);
  // Nothing is held back, so nothing offers to show more.
  await expect(page.locator(".show-rest")).toHaveCount(0);
});
