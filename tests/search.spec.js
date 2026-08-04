import { expect, test } from "@playwright/test";

import { effectiveWord, matchesSlice, occurrences, trimStem } from "../public/search.js";
import { citationsMarkdown } from "../lib/analysis.js";

/**
 * One search, three places.
 *
 * The README promises the same semantics in the transcript search, the citation
 * filter and the note search. The wildcard half was shared from the start; the
 * other half — trimming an inflecting ending when a word finds nothing at all —
 * only ever existed in the transcript search. Searching "Unterlagen" where the
 * text says "Unterlage" found the passage and none of its citations.
 *
 * Trimming is allowed only on one condition, which this file also holds it to:
 * that it says which term it actually ran with. Reinterpreting the input in
 * silence would be worse than no hit.
 */

const SINGULAR = ["Die Unterlage liegt im Laufwerk.", "Nichts weiter dazu."];

test("a wildcard means the same thing wherever it is typed", () => {
  const text = "Wichtige Unterlagen werden abgelegt, andere werden abzulegen vergessen.";
  // The README's own example, which reaches three inflections of one verb.
  expect(occurrences(text, "ab*leg*").length).toBe(2);
  expect(matchesSlice({ text, memo: "" }, { word: "ab*leg*" })).toBe(true);
  // And a wildcard is never second-guessed by trimming.
  expect(trimStem("ab*leg*", "de")).toBe(null);
  expect(effectiveWord([text], "ab*leg*", "de").instead).toBe(null);
});

test("a word that finds nothing is tried without its ending", () => {
  const settled = effectiveWord(SINGULAR, "Unterlagen", "de");
  expect(settled.word).toBe("Unterlag");
  // …and says so, which is the whole condition for doing it.
  expect(settled.instead).toBe("Unterlag");

  // A word that finds something is left exactly as it was typed.
  expect(effectiveWord(SINGULAR, "Unterlage", "de")).toEqual({
    word: "Unterlage",
    instead: null,
  });
  // A word that finds nothing either way is not quietly replaced.
  expect(effectiveWord(SINGULAR, "Protokolle", "de").instead).toBe(null);
});

test("the ending is trimmed once for the whole set, not text by text", () => {
  /* If one citation matched the word and the next only its stem, the slice
     would be two searches at once and its count would mean nothing. */
  const mixed = ["Die Unterlagen liegen dort.", "Die Unterlage liegt hier."];
  const settled = effectiveWord(mixed, "Unterlagen", "de");
  // The word itself hits the first text, so nothing is trimmed for either.
  expect(settled).toEqual({ word: "Unterlagen", instead: null });
});

test("the citation export runs the slice the screen would have run", () => {
  const interviews = [
    {
      transcript: {
        id: "i1",
        title: "Interview 1: Vertrieb",
        department: "Vertrieb",
        sections: [],
        turns: [{ number: 2, text: SINGULAR[0], interviewer: false }],
      },
      codings: [
        {
          id: "c1",
          turn: 2,
          start: 0,
          end: SINGULAR[0].length,
          category: "routine",
          text: SINGULAR[0],
          reviewed: true,
        },
      ],
      memo: "",
    },
  ];
  const categories = [{ id: "routine", name: "Arbeitsalltag" }];

  // The plural finds nothing on its own; the export must reach it the same way
  // the view does, or the paper cites a slice the screen never showed.
  const found = citationsMarkdown(interviews, categories, { word: "Unterlagen" }, "de");
  expect(found).toContain("Die Unterlage liegt im Laufwerk");

  // And a word that genuinely matches nothing still comes back empty.
  const empty = citationsMarkdown(interviews, categories, { word: "Protokolle" }, "de");
  expect(empty).toContain("Kein Beleg passt zu diesem Schnitt.");
});

test("the citation filter reaches what the transcript search reaches", async ({
  page,
  request,
}) => {
  // The citation list spans every interview, so every one of them is cleared —
  // a leftover from another spec would be counted here just the same.
  const interviews = await (await request.get("/api/interviews")).json();
  for (const interview of interviews) {
    const data = await (await request.get(`/api/interviews/${interview.id}`)).json();
    for (const coding of data.codings) {
      await request.delete(`/api/interviews/${interview.id}/codings/${coding.id}`);
    }
  }
  const transcript = await (await request.get("/api/interviews/interview-01")).json();
  // A citation whose wording differs from the search term only by its ending.
  const turn = transcript.turns.find((one) => one.text.includes("Unterlagen"));
  expect(turn).toBeTruthy();
  await request.post("/api/interviews/interview-01/codings", {
    data: {
      turn: turn.number,
      start: 0,
      end: 40,
      category: "routine",
      text: turn.text.slice(0, 40),
      reviewed: true,
    },
  });

  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator(".citation")).toHaveCount(1);

  // "Unterlagenen" finds nothing as typed; trimmed it reaches the citation, and
  // the filter says which term it ran with.
  await page.locator('[data-filter="word"]').fill("Unterlagenen");
  await expect(page.locator(".citation")).toHaveCount(1);
  await expect(page.locator('.citation-filter .instead')).toContainText("Unterlagen");
});

/* Which endings inflect is a fact about a language, and the list was German
   only. An English study got half the feature: the plural came through by
   coincidence, because "s" and "es" inflect in both, while "-ing" and "-ed"
   reached nothing at all. */

test("the endings that get trimmed follow the language of the study", () => {
  for (const [term, target] of [
    ["searching", "search"],
    ["recorded", "record"],
    ["stored", "store"],
    ["agreed", "agree"],
    ["meetings", "meeting"],
  ]) {
    const stem = trimStem(term, "en");
    expect(stem, `${term} is trimmed`).toBeTruthy();
    // Matching is by substring, so a stem trimmed a little too far still finds
    // the word it came from.
    expect(occurrences(`We ${target} things.`, stem).length, `${stem} reaches ${target}`)
      .toBeGreaterThan(0);
  }

  // German is untouched by the change.
  expect(trimStem("Unterlagen", "de")).toBe("Unterlag");
  expect(trimStem("Protokolle", "de")).toBe("Protokoll");

  // Neither list second-guesses a wildcard.
  expect(trimStem("search*", "en")).toBe(null);
  expect(trimStem("ab*leg*", "de")).toBe(null);
});

test("the two languages do not borrow each other's endings", () => {
  // "-ing" is not a German ending, and the German list must not invent one.
  expect(trimStem("searching", "de")).not.toBe("search");
  // A language nobody wrote a list for falls back rather than throwing.
  expect(() => trimStem("searching", "fr")).not.toThrow();
  expect(trimStem("searching", "fr")).toBe("search");
});

test("an English study reaches its own citations", () => {
  const english = ["We store the quotes on the drive.", "Nothing else on that."];
  const settled = effectiveWord(english, "stored", "en");
  expect(settled.word).toBe("stor");
  expect(settled.instead).toBe("stor");
  expect(occurrences(english[0], settled.word).length).toBe(1);

  // And under the German list the same search would have found nothing.
  expect(effectiveWord(english, "stored", "de").instead).toBe(null);
});
