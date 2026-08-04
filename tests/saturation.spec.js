import { expect, test } from "@playwright/test";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { saturation } from "../lib/analysis.js";

/**
 * When the material stopped producing anything new.
 *
 * Every qualitative study is asked how it knows it had enough interviews, and
 * the answer expected is that the categories stopped arriving. That is a claim
 * about the coding, and the coding sits right here — so the tool can show it
 * instead of leaving it to be asserted in a sentence nobody can check.
 *
 * It shows and stops. Where a curve has flattened far enough is a judgement
 * about the material; a tool that printed "saturated" would be putting words in
 * a supervisor's mouth. These tests hold it to that: the arithmetic, the
 * caveats it states about itself, and the refusal to draw a curve on two
 * points, which would suggest a shape that two points cannot have.
 */

const SANDBOX = join(fileURLToPath(new URL("..", import.meta.url)), ".sandbox", "transcripts");

const interview = (id, categories) => ({
  transcript: { id, title: `Interview ${id}`, department: id.toUpperCase(), turns: [] },
  codings: categories.map((category, index) => ({ id: `${id}${index}`, category })),
  memo: "",
});

const NAMED = [
  { id: "a", name: "Arbeitsalltag" },
  { id: "b", name: "Störungen" },
  { id: "c", name: "Absprachen" },
];

test("a category counts at the interview it first turns up in", () => {
  const found = saturation(
    [interview("i1", ["a", "b", "a"]), interview("i2", ["b", "c"]), interview("i3", ["a", "c"])],
    NAMED,
  );
  expect(found.map((one) => one.fresh)).toEqual([2, 1, 0]);
  expect(found.map((one) => one.total)).toEqual([2, 3, 3]);
  // Named, because "one new category" is a number and "Absprachen" is an answer.
  expect(found[1].names).toEqual(["Absprachen"]);
  expect(found[2].names).toEqual([]);
});

test("an interview that was not coded adds nothing and takes nothing away", () => {
  const found = saturation([interview("i1", ["a"]), interview("i2", []), interview("i3", ["b"])], NAMED);
  expect(found.map((one) => one.fresh)).toEqual([1, 0, 1]);
  expect(found.map((one) => one.total)).toEqual([1, 1, 2]);
});

test("a category the system no longer holds is still counted by its id", () => {
  // A merged-away category can still sit in an old coding; dropping it silently
  // would make the curve claim the material was quieter than it was.
  const found = saturation([interview("i1", ["gone"])], NAMED);
  expect(found[0].fresh).toBe(1);
  expect(found[0].names).toEqual(["gone"]);
});

/* And in the interface, where the caveats matter as much as the figures. */

test.describe("in the analysis", () => {
  const third = join(SANDBOX, "interview-3-produktion");
  test.afterEach(() => rmSync(third, { recursive: true, force: true }));

  test("two interviews draw no curve at all", async ({ page, request }) => {
    for (const one of ["interview-01", "interview-02"]) {
      const data = await (await request.get(`/api/interviews/${one}`)).json();
      for (const coding of data.codings) {
        await request.delete(`/api/interviews/${one}/codings/${coding.id}`);
      }
      const turn = data.turns.find((each) => !each.interviewer);
      await request.post(`/api/interviews/${one}/codings`, {
        data: { turn: turn.number, start: 0, end: 30, category: "routine", text: turn.text.slice(0, 30), reviewed: true },
      });
    }
    await page.goto("/?lang=de");
    await page.locator('.tab[data-view="analysis"]').click();
    await expect(page.locator("#matrix-table")).toBeVisible();
    /* A curve flattening cannot be shown on two points, and a chart that
       suggests one invites a claim the material does not carry. */
    await expect(page.locator("#saturation")).toHaveCount(0);
  });

  test("three interviews show where the new categories stopped", async ({ page, request }) => {
    // A third interview, brought in the way anyone would bring one in.
    const made = await request.post("/api/import", {
      data: {
        text:
          "Anna: Wie läuft das bei euch?\n" +
          "Produktion: Die Unterlagen liegen im Laufwerk, aber niemand pflegt sie.\n" +
          "Anna: Und was stört am meisten?\n" +
          "Produktion: Dass die Absprachen nirgendwo festgehalten werden.\n",
        interviewer: "Anna",
        department: "Produktion",
        title: "Interview 3: Produktion",
      },
    });
    expect(made.status()).toBe(201);

    const categories = ["routine", "routine.disruption", "agreement"];
    for (const [index, one] of ["interview-01", "interview-02", "interview-3-produktion"].entries()) {
      const data = await (await request.get(`/api/interviews/${one}`)).json();
      for (const coding of data.codings) {
        await request.delete(`/api/interviews/${one}/codings/${coding.id}`);
      }
      // The first interview brings two categories, the second one more, the
      // third nothing that was not already there.
      const wanted = index === 0 ? categories.slice(0, 2) : index === 1 ? categories : [categories[0]];
      const codable = data.turns.filter((each) => !each.interviewer);
      for (const [k, category] of wanted.entries()) {
        // Distinct places, and each one checked: a coding refused for
        // overlapping would quietly change the very figures under test.
        const turn = codable[k % codable.length];
        const from = Math.floor(k / codable.length) * 30;
        const answer = await request.post(`/api/interviews/${one}/codings`, {
          data: {
            turn: turn.number,
            start: from,
            end: from + 25,
            category,
            text: turn.text.slice(from, from + 25),
            reviewed: true,
          },
        });
        expect(answer.status(), `${category} lands in ${one}`).toBe(201);
      }
    }

    await page.goto("/?lang=de");
    await page.locator('.tab[data-view="analysis"]').click();
    await expect(page.locator("#saturation svg")).toBeVisible();

    // The figures on screen are the figures the analysis computed.
    const computed = await page.evaluate(async () => {
      const data = await (await fetch("/api/analysis")).json();
      return data.saturation.map((one) => ({ fresh: one.fresh, total: one.total }));
    });
    expect(computed.map((one) => one.fresh)).toEqual([2, 1, 0]);
    expect(computed.map((one) => one.total)).toEqual([2, 3, 3]);

    await page.locator("#saturation-figures summary").click();
    const table = await page.locator("#saturation-figures tbody tr").allTextContents();
    expect(table).toHaveLength(3);
    expect(table[2]).toContain("0");

    // What it says about itself: how many interviews it has been quiet for…
    await expect(page.locator("#saturation-summary")).toContainText("3 Kategorien");
    // …and that the order it plots is the order of the folder names, which is
    // not necessarily the order the interviews were conducted in.
    await expect(page.locator("#saturation figcaption")).toContainText("Ordnernamen");
    // It shows and stops; the judgement is left where it belongs.
    await expect(page.locator("#saturation figcaption")).toContainText("entscheidet niemand außer dir");
  });

  test("nothing is drawn against the ceiling of its own scale", async ({ page, request }) => {
    /* The last point carries a "+2" above it. Drawn at the top gridline that
       label was cut off by the edge of the picture. */
    const made = await request.post("/api/import", {
      data: {
        text: "Anna: Und?\nProduktion: Die Ablage ist das Problem, ganz klar.\n",
        interviewer: "Anna",
        department: "Produktion",
        title: "Interview 3: Produktion",
      },
    });
    expect(made.status()).toBe(201);
    for (const one of ["interview-01", "interview-02", "interview-3-produktion"]) {
      const data = await (await request.get(`/api/interviews/${one}`)).json();
      for (const coding of data.codings) {
        await request.delete(`/api/interviews/${one}/codings/${coding.id}`);
      }
      const turn = data.turns.find((each) => !each.interviewer);
      await request.post(`/api/interviews/${one}/codings`, {
        data: { turn: turn.number, start: 0, end: 25, category: "routine", text: turn.text.slice(0, 25), reviewed: true },
      });
    }

    await page.goto("/?lang=de");
    await page.locator('.tab[data-view="analysis"]').click();
    await expect(page.locator("#saturation svg")).toBeVisible();

    const room = await page.evaluate(() => {
      const svg = document.querySelector("#saturation svg");
      const box = svg.getAttribute("viewBox").split(" ").map(Number);
      const labels = [...svg.querySelectorAll("text.value")].map((one) => Number(one.getAttribute("y")));
      const dots = [...svg.querySelectorAll("circle.saturation-point")].map((one) => Number(one.getAttribute("cy")));
      return { top: box[1], labels, dots };
    });
    for (const y of room.labels) expect(y, "the label stays inside the picture").toBeGreaterThan(room.top);
    // And the curve does not sit on the topmost gridline.
    for (const y of room.dots) expect(y).toBeGreaterThan(room.top + 4);
  });
});

/**
 * And the other figure that carries a percent sign.
 *
 * The bar beside the transcript shows a number per guide section, and the note
 * above it said the codings were "distributed across the guide sections" — so
 * "42 %" read as "42 % of my codings are in this block". It is nothing of the
 * kind: it is how much of what was said in that block is held in coding units,
 * a share within the block. The five numbers on a real screen added up to 245,
 * which is the giveaway nobody should have to notice.
 *
 * The word was doubly loaded, too: the code called it saturation, which in this
 * method means that no new categories are arriving — the thing the curve above
 * actually shows.
 */
test("the section bar says what its percentages are", async ({ page, request }) => {
  const data = await (await request.get("/api/interviews/interview-01")).json();
  for (const coding of data.codings) {
    await request.delete(`/api/interviews/interview-01/codings/${coding.id}`);
  }
  const codable = data.turns.filter((turn) => !turn.interviewer && turn.text.length > 80);
  for (const turn of codable.slice(0, 8)) {
    await request.post("/api/interviews/interview-01/codings", {
      data: { turn: turn.number, start: 0, end: 60, category: "routine", text: turn.text.slice(0, 60), reviewed: true },
    });
  }

  await page.goto("/?lang=de");
  await page.waitForSelector(".turn");

  const shares = await page
    .locator("#sections .share")
    .evaluateAll((all) => all.map((one) => Number(one.textContent.replace(/[^\d]/g, ""))).filter(Boolean));
  expect(shares.length).toBeGreaterThan(2);
  /* The numbers really do not add up to a hundred, which is exactly why the
     note must not call them a distribution. */
  expect(shares.reduce((sum, one) => sum + one, 0)).toBeGreaterThan(100);

  const note = await page.locator('[data-t="sectionsNote"]').innerText();
  expect(note).toContain("keine Aufteilung");
  expect(note).not.toContain("verteilen");
  // And the tooltip says which block the share is within.
  await expect(page.locator("#sections .coverage").first()).toHaveAttribute(
    "title",
    /in diesem Block/,
  );
});
