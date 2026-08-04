import { expect, test } from "@playwright/test";

import { sentenceAt, sentences } from "../public/sentences.js";

/**
 * Coding without a mouse.
 *
 * The README has called this tool keyboard-first since the beginning, and for
 * the one act it exists for that was not true: a passage could only be chosen
 * by dragging over it. Everything after the choice — the digits, the filter,
 * the confirmation — had a key; the choice itself had none, and a text field in
 * a browser hands out no caret to select with. So the whole of coding was out
 * of reach for anyone who does not use a pointing device, and slower than it
 * needed to be for everyone else.
 *
 * The step size is the sentence, because a coding unit in a content analysis
 * usually is one. These tests hold the keyboard to the same standard as the
 * mouse: the same passage, the same stored citation, and never a turn that may
 * not be coded at all.
 */

const KEYBOARD = "s";

async function clear(request) {
  const interviews = await (await request.get("/api/interviews")).json();
  for (const interview of interviews) {
    const data = await (await request.get(`/api/interviews/${interview.id}`)).json();
    for (const coding of data.codings) {
      await request.delete(`/api/interviews/${interview.id}/codings/${coding.id}`);
    }
  }
}

/** The turn the selection currently lies in, read from the document itself. */
const selectedTurn = (page) =>
  page.evaluate(() => {
    const node = document.getSelection()?.anchorNode;
    const field = node?.parentElement?.closest(".text") ?? node?.closest?.(".text");
    return field ? Number(field.dataset.turn) : null;
  });

const quote = async (page) =>
  (await page.locator("#coding-bar-quote").innerText()).replace(/^[„"«]|[“"»]$/g, "").trim();

test.beforeEach(async ({ request }) => {
  await clear(request);
});

test("a passage is chosen, assigned and stored without a pointing device", async ({
  page,
  request,
}) => {
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await page.locator("#transcript").focus();

  await page.keyboard.press("j");
  await page.keyboard.press(KEYBOARD);
  await expect(page.locator("#coding-bar")).toBeVisible();

  const chosen = await quote(page);
  expect(chosen.length).toBeGreaterThan(2);
  await page.keyboard.press("1");
  await expect(page.locator("#coding-bar")).toBeVisible(); // the cursor walked on

  const id = await page.locator("#interview-choice").inputValue();
  const stored = (await (await request.get(`/api/interviews/${id}`)).json()).codings;
  expect(stored).toHaveLength(1);
  // What was shown in the bar is what went into the file, character for
  // character — the quotation later stands in the appendix under that name.
  expect(stored[0].text).toBe(chosen);
  expect(stored[0].reviewed).toBe(true);

  // And it is a sentence of that turn, not an arbitrary span.
  const turn = (await (await request.get(`/api/interviews/${id}`)).json()).turns.find(
    (one) => one.number === stored[0].turn,
  );
  expect(turn.interviewer).toBe(false);
  expect(turn.text).toContain(stored[0].text);
});

test("the arrows walk sentence by sentence and step over the interviewer", async ({
  page,
  request,
}) => {
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  const id = await page.locator("#interview-choice").inputValue();
  const turns = (await (await request.get(`/api/interviews/${id}`)).json()).turns;
  const asked = new Set(turns.filter((turn) => turn.interviewer).map((turn) => turn.number));
  expect(asked.size).toBeGreaterThan(0);

  await page.locator("#transcript").focus();
  await page.keyboard.press("j");
  await page.keyboard.press(KEYBOARD);

  const seen = [];
  const passages = [];
  for (let step = 0; step < 14; step++) {
    seen.push(await selectedTurn(page));
    passages.push(await quote(page));
    await page.keyboard.press("ArrowDown");
  }
  // It really moved, and it really crossed into further turns.
  expect(new Set(passages).size).toBeGreaterThan(6);
  expect(new Set(seen).size).toBeGreaterThan(1);
  // The interviewer's turns are not offered and then refused; they are skipped.
  for (const number of seen) expect(asked.has(number)).toBe(false);

  // Backwards lands on what was just left.
  const before = passages.at(-2);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  expect(await quote(page)).toBe(before);
});

test("shift takes one sentence more, and stops at the end of the turn", async ({
  page,
  request,
}) => {
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  const id = await page.locator("#interview-choice").inputValue();
  const turns = (await (await request.get(`/api/interviews/${id}`)).json()).turns;

  await page.locator("#transcript").focus();
  await page.keyboard.press("j");
  await page.keyboard.press(KEYBOARD);

  let grew = 0;
  for (let step = 0; step < 10; step++) {
    const number = await selectedTurn(page);
    const turn = turns.find((one) => one.number === number);
    const one = await quote(page);
    const all = sentences(turn.text);
    const onLast = sentenceAt(turn.text, turn.text.indexOf(one)) === all.length - 1;

    await page.keyboard.press("Shift+ArrowDown");
    const two = await quote(page);
    if (onLast) {
      // A coding unit lies inside one turn — the server refuses anything else —
      // so the last sentence is where stretching ends.
      expect(two, "the run stops at the end of the turn").toBe(one);
    } else {
      // A coding unit is often two or three sentences; picking them up one at a
      // time is what the shift key is for.
      expect(two.length).toBeGreaterThan(one.length);
      expect(two.startsWith(one)).toBe(true);
      expect(turn.text).toContain(two);
      await page.keyboard.press("Shift+ArrowUp");
      expect(await quote(page), "and one less gives it back").toBe(one);
      grew += 1;
    }
    await page.keyboard.press("ArrowDown");
  }
  expect(grew, "somewhere in the material a run did grow").toBeGreaterThan(0);
});

test("after assigning, the next sentence is already waiting", async ({ page, request }) => {
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await page.locator("#transcript").focus();
  await page.keyboard.press("j");
  await page.keyboard.press(KEYBOARD);

  const first = await quote(page);
  await page.keyboard.press("1");
  await expect(page.locator(".segment")).toHaveCount(1);
  const second = await quote(page);
  expect(second).not.toBe(first);
  // …and it is not part of what was just coded.
  expect(second.includes(first)).toBe(false);

  await page.keyboard.press("2");
  await expect(page.locator(".segment")).toHaveCount(2);

  const id = await page.locator("#interview-choice").inputValue();
  const stored = (await (await request.get(`/api/interviews/${id}`)).json()).codings;
  expect(stored).toHaveLength(2);
  expect(stored[0].category).not.toBe(stored[1].category);
  // Two units in a row, and they do not overlap.
  const [a, b] = stored.sort((one, other) => one.start - other.start);
  if (a.turn === b.turn) expect(a.end).toBeLessThanOrEqual(b.start);

  // Escape puts the cursor down; the material is not left in a coding state.
  await page.keyboard.press("Escape");
  await expect(page.locator("#coding-bar")).toBeHidden();
});

test("the keys are written down inside the tool, not only in the README", async ({ page }) => {
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await page.locator("#transcript").focus();

  await page.keyboard.press("?");
  const sheet = page.locator("#keys-sheet");
  await expect(sheet).toBeVisible();

  const listed = await sheet.locator("kbd").allTextContents();
  // Every key the coding view binds appears in the list.
  for (const key of ["j", "k", "/", "s", "↓", "↑", "⇧↓", "1", "9", "Enter", "Esc", "?"]) {
    expect(listed, `the sheet names ${key}`).toContain(key);
  }
  // No key stands there without saying what it does.
  const explained = await sheet.locator("dd").allTextContents();
  expect(explained.length).toBeGreaterThanOrEqual(12);
  for (const text of explained) expect(text.trim().length).toBeGreaterThan(3);

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // The button in the header opens the same sheet for whoever never guesses "?".
  await page.locator("#keys").click();
  await expect(sheet).toBeVisible();
});

test("the sheet speaks the language of the interface", async ({ page }) => {
  await page.goto("/?lang=en");
  await page.waitForSelector(".turn");
  await page.locator("#keys").click();
  const sheet = page.locator("#keys-sheet");
  await expect(sheet).toContainText("Keyboard");
  await expect(sheet).toContainText("sentence");

  const shown = await sheet.innerText();
  // A missing translation would leave the key name standing in the interface.
  expect(shown).not.toMatch(/\bkeys[A-Z]|\bkey[A-Z][a-zA-Z]+\b/);
  expect(shown).not.toContain("Tastatur");
});

/* Where a sentence ends is a question the mouse and the keyboard used to answer
   separately. It is now one function, and these are the cases that made naive
   splitting on every full stop wrong in both languages. */

test("an abbreviation does not end a sentence", () => {
  const german = "Wir legen das z. B. im Laufwerk ab. Danach ist Schluss.";
  expect(sentences(german)).toHaveLength(2);
  expect(german.slice(...sentences(german)[0]).trim()).toBe(
    "Wir legen das z. B. im Laufwerk ab.",
  );

  const english = "We store it e. g. on the drive. Then we are done.";
  expect(sentences(english)).toHaveLength(2);

  // A date, and a longer abbreviation from the list.
  expect(sentences("Am 1. Januar ging es los. Dann kam der Rest.")).toHaveLength(2);
  expect(sentences("Das war ca. drei Wochen später. Danach nicht mehr.")).toHaveLength(2);
});

test("a text without a full stop is still one sentence", () => {
  expect(sentences("Ohne Punkt")).toEqual([[0, 10]]);
  expect(sentences("")).toEqual([[0, 0]]);
  // Questions and exclamations end just as well.
  expect(sentences("Wirklich? Ja! Gut.")).toHaveLength(3);
});

test("every position in a text belongs to exactly one sentence", () => {
  const text = "Der erste Satz. Der zweite Satz folgt. Und der dritte.";
  const all = sentences(text);
  expect(all).toHaveLength(3);
  for (let at = 0; at < text.length; at++) {
    const index = sentenceAt(text, at);
    const [from, to] = all[index];
    expect(at >= from && at < to, `position ${at} sits in sentence ${index}`).toBe(true);
  }
  // The sentences cover the text without a gap and without an overlap.
  expect(all[0][0]).toBe(0);
  expect(all.at(-1)[1]).toBe(text.length);
  for (let i = 1; i < all.length; i++) expect(all[i][0]).toBe(all[i - 1][1]);
});

/* The sheet is the one place the tool explains itself in full, so it is held to
   the same contrast thresholds as everything else — in both themes, because a
   quiet grey that reads on white can disappear on near-black. */

for (const theme of ["light", "dark"]) {
  test(`the keyboard sheet stays readable in the ${theme} theme`, async ({ page }) => {
    await page.goto("/?lang=de");
    await page.waitForSelector(".turn");
    await page.evaluate((wanted) => {
      document.documentElement.dataset.theme = wanted;
    }, theme);
    await page.locator("#keys").click();

    const measured = await page.evaluate(() => {
      const parse = (value) => value.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
      const luminance = ([r, g, b]) =>
        [r, g, b]
          .map((c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4))
          .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
      const ratio = (a, b) => {
        const [bright, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (bright + 0.05) / (dark + 0.05);
      };
      const sheet = parse(getComputedStyle(document.querySelector("#keys-sheet")).backgroundColor);
      return [".keys-groups h3", ".keys-groups dd", ".keys-note", ".keys-after", "kbd"].map(
        (selector) => {
          const element = document.querySelector(`#keys-sheet ${selector}`);
          const style = getComputedStyle(element);
          const behind =
            style.backgroundColor.includes("rgba(0, 0, 0, 0)") || !style.backgroundColor
              ? sheet
              : parse(style.backgroundColor);
          return { what: selector, ratio: ratio(parse(style.color), behind) };
        },
      );
    });

    expect(measured).toHaveLength(5);
    const failures = measured
      .filter((entry) => entry.ratio < 4.5)
      .map((entry) => `${entry.what}: ${entry.ratio.toFixed(2)} < 4.5`);
    expect(failures, `contrast in the ${theme} theme`).toEqual([]);
  });
}
