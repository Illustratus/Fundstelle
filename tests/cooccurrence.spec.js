import { expect, test } from "@playwright/test";

import { cooccurrence } from "../lib/analysis.js";

/**
 * Which categories keep turning up in the same breath.
 *
 * A category system is meant to separate things. Two categories almost never
 * used apart are a question about that system: either the material does not
 * make the distinction, or the coding rule that should keep them apart has not
 * been written. Mayring asks for such a rule exactly where a boundary is
 * unclear, and nothing in the tool said where that was.
 *
 * It is a weak signal and has to be reported as one — two categories that
 * belong together in the material look exactly like two that were never told
 * apart. So it counts and stops, the way the saturation curve does.
 */

const NAMED = [
  { id: "routine", name: "Arbeitsalltag" },
  { id: "trouble", name: "Störungen" },
  { id: "agreement", name: "Absprachen" },
];

/** An interview as `[turn, [categories]]` pairs. */
const study = (id, turns) => ({
  transcript: { id, title: `Interview ${id}`, department: "D", turns: [], sections: [] },
  codings: turns.flatMap(([turn, categories]) =>
    categories.map((category, index) => ({
      id: `${id}${turn}${index}`,
      turn,
      start: index * 10,
      end: index * 10 + 5,
      category,
    })),
  ),
  memo: "",
});

test("two categories in one turn are one shared turn", () => {
  const found = cooccurrence(
    [study("i1", [[2, ["routine", "trouble"]], [4, ["routine"]], [6, ["routine", "trouble"]]])],
    NAMED,
  );
  expect(found.pairs).toHaveLength(1);
  expect(found.pairs[0]).toMatchObject({ together: 2, aTurns: 3, bTurns: 2 });
  // Of the times the rarer of the two was used, how often the other was there:
  // the figure that makes a small count mean something.
  expect(found.pairs[0].share).toBe(1);
});

test("a turn is a turn however many units it holds", () => {
  /* Three units of one category in a turn is still one turn — otherwise a
     finely coded passage would outweigh a whole interview. */
  const found = cooccurrence(
    [study("i1", [[2, ["routine", "routine", "trouble"]]])],
    NAMED,
  );
  expect(found.pairs[0].together).toBe(1);
  expect(found.turns.routine).toBe(1);
});

test("the same turn number in two interviews is two turns", () => {
  // Turn 2 of one interview has nothing to do with turn 2 of another.
  const found = cooccurrence(
    [study("i1", [[2, ["routine", "trouble"]]]), study("i2", [[2, ["routine", "trouble"]]])],
    NAMED,
  );
  expect(found.pairs[0].together).toBe(2);
  expect(found.turns.routine).toBe(2);
});

test("categories that never share a turn are not a pair", () => {
  const found = cooccurrence(
    [study("i1", [[2, ["routine"]], [4, ["trouble"]], [6, ["agreement"]]])],
    NAMED,
  );
  expect(found.pairs).toEqual([]);
  expect(found.turns).toEqual({ routine: 1, trouble: 1, agreement: 1 });
});

test("a unit with no place is not a meeting", () => {
  // The same rule as everywhere else: a citation nobody can point to is not
  // evidence, and two of them are not evidence of a boundary problem.
  const one = study("i1", [[2, ["routine", "trouble"]]]);
  one.codings[1].state = "lost";
  const found = cooccurrence([one], NAMED);
  expect(found.pairs).toEqual([]);
  expect(found.turns).toEqual({ routine: 1 });
});

test("the ranking puts the tightest pair first, not the busiest", () => {
  /* Seven shared turns means one thing for a category used eight times and
     another for one used ninety. */
  const turns = [];
  // Arbeitsalltag and Absprachen meet seven times but each stands alone often:
  // 7 of the 22 turns the rarer of them is in.
  for (let n = 1; n <= 7; n += 1) turns.push([n * 2, ["routine", "agreement"]]);
  for (let n = 8; n <= 20; n += 1) turns.push([n * 2, ["routine"]]);
  for (let n = 21; n <= 40; n += 1) turns.push([n * 2, ["agreement"]]);
  // Störungen is used twice and never without Arbeitsalltag: 2 of 2.
  turns.push([100, ["routine", "trouble"]], [102, ["routine", "trouble"]]);
  const found = cooccurrence([study("i1", turns)], NAMED);

  const [first, second] = found.pairs;
  expect(first.share).toBe(1);
  expect(first.together).toBe(2);
  expect(second.together).toBe(7);
  // The tighter pair leads although the other is counted more often.
  expect(first.share).toBeGreaterThan(second.share);
  expect(second.together).toBeGreaterThan(first.together);
});

/* And in the analysis, where the caveat matters as much as the figure. */

test("the pairs are shown with what they are worth", async ({ page, request }) => {
  const data = await (await request.get("/api/interviews/interview-01")).json();
  for (const coding of data.codings) {
    await request.delete(`/api/interviews/interview-01/codings/${coding.id}`);
  }
  const second = await (await request.get("/api/interviews/interview-02")).json();
  for (const coding of second.codings) {
    await request.delete(`/api/interviews/interview-02/codings/${coding.id}`);
  }
  // Two categories in each of three turns, and a third category on its own.
  const codable = data.turns.filter((turn) => !turn.interviewer && turn.text.length > 90);
  for (const turn of codable.slice(0, 3)) {
    for (const [index, category] of ["routine", "routine.disruption"].entries()) {
      await request.post("/api/interviews/interview-01/codings", {
        data: {
          turn: turn.number,
          start: index * 40,
          end: index * 40 + 35,
          category,
          text: turn.text.slice(index * 40, index * 40 + 35),
          reviewed: true,
        },
      });
    }
  }

  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#meet-table")).toBeVisible();

  const row = page.locator("#meet-table tbody tr").first();
  await expect(row).toContainText("Arbeitsalltag");
  await expect(row).toContainText("Störungen");
  await expect(row).toContainText("3");
  await expect(row).toContainText("100 %");

  // What the figure is worth, said with it rather than left to be assumed.
  const note = page.locator("#analysis .column-note", { hasText: "schwaches Signal" });
  await expect(note).toBeVisible();
  await expect(note).toContainText("Kodierregel");
});

test("a system whose categories never meet is told so", async ({ page, request }) => {
  for (const one of ["interview-01", "interview-02"]) {
    const data = await (await request.get(`/api/interviews/${one}`)).json();
    for (const coding of data.codings) {
      await request.delete(`/api/interviews/${one}/codings/${coding.id}`);
    }
    const codable = data.turns.filter((turn) => !turn.interviewer && turn.text.length > 70);
    for (const [index, turn] of codable.slice(0, 2).entries()) {
      await request.post(`/api/interviews/${one}/codings`, {
        data: {
          turn: turn.number,
          start: 0,
          end: 50,
          category: index ? "agreement" : "routine",
          text: turn.text.slice(0, 50),
          reviewed: true,
        },
      });
    }
  }

  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#matrix-table")).toBeVisible();
  await expect(page.locator("#meet-table")).toHaveCount(0);
  // And it is named as the good result, not left as an absence.
  await expect(page.locator("#analysis", { hasText: "das gute Ergebnis" })).toBeVisible();
});
