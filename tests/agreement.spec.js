import { expect, test } from "@playwright/test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { agreement, band, compare, kappa } from "../lib/agreement.js";

/**
 * Intercoder reliability.
 *
 * Every content analysis that goes into a paper is asked whether anyone else
 * coded the material and arrived at the same result. Until now the tool had no
 * answer, which is the one hole a supervisor is certain to find.
 *
 * Two things have to hold for the answer to be worth anything, and both are
 * tested here. The arithmetic has to be Cohen's kappa and not something that
 * resembles it — so it is checked against a table computed by hand, and at the
 * edges where the coefficient is not defined at all. And the unit has to be one
 * that survives two people segmenting differently, because they always do: the
 * comparison runs per turn and category, so marking a sentence where the other
 * marked the two sentences around it is agreement, not a difference.
 */

const SANDBOX = join(fileURLToPath(new URL("..", import.meta.url)), ".sandbox");
const transcripts = join(SANDBOX, "transcripts");

const CATEGORIES = [
  { id: "routine", name: "Arbeitsalltag" },
  { id: "trouble", name: "Störungen" },
];

/** A study of one interview with three codable turns. */
const study = (mine, yours) => [
  {
    transcript: {
      id: "i1",
      title: "Interview 1: Vertrieb",
      turns: [
        { number: 1, text: "Erzähl doch mal.", interviewer: true },
        { number: 2, text: "Der Alltag ist voll. Es kommt viel dazwischen.", interviewer: false },
        { number: 3, text: "Und die Ablage bleibt liegen.", interviewer: false },
        { number: 4, text: "Danach wird es ruhiger.", interviewer: false },
      ],
    },
    codings: mine,
    others: { anna: yours },
  },
];

const at = (turn, category, start = 0, end = 10) => ({ turn, category, start, end, id: `${turn}${category}${start}` });

test("the coefficient is Cohen's kappa, checked against a table done by hand", () => {
  // 20 both, 5 only the first, 10 only the second, 15 neither.
  // observed = 35/50 = .70; expected = ((25·30)/50 + (25·20)/50)/50 = .50
  // kappa = (.70 − .50) / (1 − .50) = .40
  expect(kappa({ both: 20, onlyFirst: 5, onlySecond: 10, neither: 15 })).toBeCloseTo(0.4, 10);
  expect(kappa({ both: 10, onlyFirst: 0, onlySecond: 0, neither: 30 })).toBe(1);
  // Perfect disagreement is not zero — zero is what chance would produce.
  expect(kappa({ both: 0, onlyFirst: 20, onlySecond: 20, neither: 0 })).toBeLessThan(0);
});

test("where the coefficient has no value it says so instead of saying nought", () => {
  /* Both coders used the category on every unit, or on none: chance alone
     explains the agreement and kappa is undefined. A zero would read as „they
     disagree", which is the exact opposite of what happened. */
  expect(kappa({ both: 40, onlyFirst: 0, onlySecond: 0, neither: 0 })).toBe(null);
  expect(kappa({ both: 0, onlyFirst: 0, onlySecond: 0, neither: 40 })).toBe(null);
  expect(kappa({ both: 0, onlyFirst: 0, onlySecond: 0, neither: 0 })).toBe(null);
  expect(band(null)).toBe(null);
});

test("the customary bands are the ones from the literature", () => {
  expect(band(-0.1)).toBe("none");
  expect(band(0.2)).toBe("slight");
  expect(band(0.4)).toBe("fair");
  expect(band(0.6)).toBe("moderate");
  expect(band(0.8)).toBe("substantial");
  expect(band(0.81)).toBe("almost");
  expect(band(1)).toBe("almost");
});

test("cutting a passage differently is agreement, not a difference", () => {
  /* This is the whole reason the unit is the turn. One marks a sentence, the
     other the two sentences around it — they read the same turn the same way,
     and a comparison of segments would call that a disagreement. */
  const mine = [at(2, "routine", 0, 20)];
  const yours = [at(2, "routine", 0, 46)];
  const one = compare(study(mine, yours), CATEGORIES, "anna");
  expect(one.disagreements).toEqual([]);
  expect(one.agreement).toBe(1);
  // Three codable turns × two categories.
  expect(one.units).toBe(6);
  expect(one.cells).toEqual({ both: 1, onlyFirst: 0, onlySecond: 0, neither: 5 });
});

test("a category one used and the other did not is named with its turn", () => {
  const mine = [at(2, "routine"), at(3, "trouble")];
  const yours = [at(2, "routine"), at(3, "routine")];
  const one = compare(study(mine, yours), CATEGORIES, "anna");

  expect(one.cells).toEqual({ both: 1, onlyFirst: 1, onlySecond: 1, neither: 3 });
  expect(one.apartCells).toBe(2);
  /* Two judgements differ, but they are one passage to talk about: the same
     turn listed twice — once as „only here", once as „only theirs" — would make
     one disagreement look like two and print the quotation twice in a row. */
  expect(one.disagreements).toHaveLength(1);
  expect(one.disagreements[0]).toMatchObject({
    turn: 3,
    first: ["Störungen"],
    second: ["Arbeitsalltag"],
  });
  // The passage travels with it: the consensus round reads the turn, not an id.
  expect(one.disagreements[0].text).toContain("Ablage");

  // Per category, so it is visible where the two part company.
  const trouble = one.byCategory.find((row) => row.id === "trouble");
  expect(trouble.disagreed).toBe(1);
});

test("the interviewer's turns are no part of the comparison", () => {
  // Nobody may code them, so counting them would inflate every agreement with
  // units on which no decision was ever possible.
  const one = compare(study([], []), CATEGORIES, "anna");
  expect(one.units).toBe(6);
  expect(one.turns).toBe(3);
});

test("an interview the second coder never saw is left out and named", () => {
  const both = study([at(2, "routine")], [at(2, "routine")]);
  const alone = {
    transcript: {
      id: "i2",
      title: "Interview 2: Marketing",
      turns: [{ number: 2, text: "Ganz anders bei uns.", interviewer: false }],
    },
    codings: [at(2, "trouble")],
    others: {},
  };
  const one = compare([...both, alone], CATEGORIES, "anna");

  /* Counting it would read every turn the second coder never had in front of
     them as a difference — a statement about a person who was not asked. */
  expect(one.covered.map((entry) => entry.id)).toEqual(["i1"]);
  expect(one.skipped.map((entry) => entry.id)).toEqual(["i2"]);
  expect(one.units).toBe(6);
  expect(one.disagreements).toEqual([]);
});

test("several second coders are compared each on their own", () => {
  const interviews = [
    {
      ...study([at(2, "routine")], [at(2, "routine")])[0],
      others: { anna: [at(2, "routine")], bo: [at(2, "trouble")] },
    },
  ];
  const all = agreement(interviews, CATEGORIES);
  expect(all.coders).toEqual(["anna", "bo"]);
  expect(all.comparisons.find((one) => one.coder === "anna").agreement).toBe(1);
  const bo = all.comparisons.find((one) => one.coder === "bo");
  expect(bo.disagreements).toHaveLength(1);
  expect(bo.apartCells).toBe(2);
});

/* And the same thing through the running server, from a file on disk. */

const secondFile = (interview) => join(transcripts, interview, "coding.anna.json");

test.afterEach(() => {
  for (const interview of ["interview-01", "interview-02"]) {
    rmSync(secondFile(interview), { force: true });
    rmSync(join(transcripts, interview, "coding.broken.json"), { force: true });
  }
});

test("a second coding put beside the first is found and compared", async ({ page, request }) => {
  // The first coder's work, through the API the interface uses.
  const data = await (await request.get("/api/interviews/interview-01")).json();
  for (const coding of data.codings) {
    await request.delete(`/api/interviews/interview-01/codings/${coding.id}`);
  }
  const codable = data.turns.filter((turn) => !turn.interviewer).slice(0, 4);
  for (const [index, turn] of codable.entries()) {
    await request.post("/api/interviews/interview-01/codings", {
      data: {
        turn: turn.number,
        start: 0,
        end: 40,
        category: index === 3 ? "agreement" : "routine",
        text: turn.text.slice(0, 40),
        reviewed: true,
      },
    });
  }

  // The second coder's file, exactly as their own Fundstelle would have written
  // it: same shape, cut at different places, one category read differently.
  writeFileSync(
    secondFile("interview-01"),
    JSON.stringify({
      version: 3,
      interview: "interview-01",
      codings: codable.map((turn, index) => ({
        id: `second-${turn.number}`,
        turn: turn.number,
        start: 5,
        end: 55,
        category: "routine",
        text: turn.text.slice(5, 55),
        reviewed: true,
      })),
    }),
  );

  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await page.locator('.tab[data-view="analysis"]').click();
  const part = page.locator("#agreement-part");
  await expect(part).toContainText("anna");

  // The numbers on the screen are the numbers the API computed.
  const computed = await page.evaluate(async () => {
    const data = await (await fetch("/api/agreement")).json();
    const one = data.comparisons[0];
    return {
      kappa: one.kappa,
      agreement: one.agreement,
      units: one.units,
      apart: one.disagreements.length,
    };
  });
  await expect(part.locator(".metric .value").first()).toHaveText(computed.kappa.toFixed(2));
  await expect(part.locator(".metric .value").nth(1)).toHaveText(
    `${(computed.agreement * 100).toFixed(0)} %`,
  );
  await expect(part.locator(".metric .value").nth(2)).toHaveText(String(computed.units));

  // The one turn they read differently is listed with its passage.
  expect(computed.apart).toBe(1);
  await part.locator(".agreement-apart summary").click();
  await expect(part.locator(".apart-list li")).toHaveCount(1);
  // Both readings stand side by side; that is the question the round settles.
  await expect(part.locator(".apart-list .apart-what")).toContainText("Absprachen");
  await expect(part.locator(".apart-list .apart-what")).toContainText("anna");

  // The unit is stated where the number is, not in a footnote.
  await expect(part).toContainText("je Beitrag und Kategorie");
});

test("the file is only ever read, never written", async ({ request }) => {
  const before = JSON.stringify({
    version: 3,
    interview: "interview-01",
    codings: [{ id: "x", turn: 2, start: 0, end: 20, category: "routine", text: "egal" }],
  });
  writeFileSync(secondFile("interview-01"), before);
  await (await request.get("/api/agreement")).json();
  // Independence is the entire point: a second coding the tool could touch
  // would no longer be independent of it.
  expect(readFileSync(secondFile("interview-01"), "utf8")).toBe(before);
});

test("a second coding that cannot be read is named rather than skipped in silence", async ({
  request,
}) => {
  writeFileSync(join(transcripts, "interview-01", "coding.broken.json"), "{ not json");
  const data = await (await request.get("/api/agreement")).json();
  expect(data.problems).toHaveLength(1);
  expect(data.problems[0].coder).toBe("broken");
  /* Silently missing it would say the second coder did not code that
     interview — a statement about a person, made up by a parse error. */
  expect(data.problems[0].text).toContain("coding.broken.json");
  expect(data.problems[0].text).toContain("interview-01");
});

test("with no second coding the panel says how to make one", async ({ page }) => {
  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");
  await page.locator('.tab[data-view="analysis"]').click();
  const part = page.locator("#agreement-part");
  await expect(part).toContainText("keine Zweitkodierung");
  // The instruction is the feature: nobody guesses a file-naming convention.
  await expect(part).toContainText("coding.NAME.json");

  await page.goto("/?lang=en");
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#agreement-part")).toContainText("no second coding");
});

test("the export carries the figures the screen shows", async ({ request }) => {
  const data = await (await request.get("/api/interviews/interview-01")).json();
  for (const coding of data.codings) {
    await request.delete(`/api/interviews/interview-01/codings/${coding.id}`);
  }
  const codable = data.turns.filter((turn) => !turn.interviewer).slice(0, 4);
  for (const [index, turn] of codable.entries()) {
    await request.post("/api/interviews/interview-01/codings", {
      data: {
        turn: turn.number,
        start: 0,
        end: 40,
        category: index === 3 ? "agreement" : "routine",
        text: turn.text.slice(0, 40),
        reviewed: true,
      },
    });
  }
  writeFileSync(
    secondFile("interview-01"),
    JSON.stringify({
      version: 3,
      interview: "interview-01",
      codings: codable.map((turn) => ({
        id: `second-${turn.number}`,
        turn: turn.number,
        start: 5,
        end: 55,
        category: "routine",
        text: turn.text.slice(5, 55),
        reviewed: true,
      })),
    }),
  );

  const computed = (await (await request.get("/api/agreement")).json()).comparisons[0];
  const paper = await (await request.get("/api/export/agreement.md?lang=de")).text();

  /* A reliability figure that reads differently in the appendix than on the
     screen is worse than none: the paper is what gets defended. */
  expect(paper).toContain(computed.kappa.toFixed(2));
  expect(paper).toContain(`${(computed.agreement * 100).toFixed(0)} %`);
  expect(paper).toContain(String(computed.units));
  expect(paper).toContain(String(computed.cells.both));
  expect(paper).toContain("anna");
  // The unit is in the document, because the figure means nothing without it.
  expect(paper).toContain("je Beitrag und Kategorie");
  // Every disagreement, not the sixty the screen shows.
  for (const entry of computed.disagreements) {
    expect(paper).toContain(`Beitrag ${entry.turn}`);
  }

  // And it is written in the language that asked.
  const english = await (await request.get("/api/export/agreement.md?lang=en")).text();
  expect(english).toContain("Intercoder reliability");
  expect(english).toContain("per turn and category");
  expect(english).not.toContain("Beitrag");
});

test("the export says so when there is nothing to compare", async ({ request }) => {
  const paper = await (await request.get("/api/export/agreement.md?lang=de")).text();
  expect(paper).toContain("keine Zweitkodierung");
  expect(paper).toContain("coding.NAME.json");
});
