import { expect, test } from "@playwright/test";

import { checkAnchors, withReasons, withoutCheckMarks } from "../lib/anchoring.js";
import { translator } from "../lib/texts.js";

/**
 * Re-anchoring after the transcript was corrected.
 *
 * This is where the tool is most dangerous when it is wrong: a unit put back in
 * the wrong place turns into a citation in the paper that the passage does not
 * carry. The rule is therefore to move only what is unambiguous and to hand
 * everything else over — including a move that would land on a neighbour, which
 * used to go through and quietly broke "one place, one category".
 */

const turnWith = (text) => ({ turns: [{ number: 1, text }] });

/** Any two units that both still count, sitting on the same characters. */
function overlapping(codings) {
  const live = codings.filter((coding) => coding.state !== "lost");
  const found = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const [a, b] = [live[i], live[j]];
      if (a.turn === b.turn && a.start < b.end && b.start < a.end) found.push([a.id, b.id]);
    }
  }
  return found;
}

const PAIR = [
  { id: "A", turn: 1, start: 0, end: 3, text: "abc", category: "x" },
  { id: "B", turn: 1, start: 5, end: 8, text: "cde", category: "y" },
];

test("a unit that still sits where it was filed is left alone", () => {
  const { codings, changed } = checkAnchors(turnWith("abcXXcde"), PAIR);
  expect(codings.map((coding) => coding.state)).toEqual(["ok", "ok"]);
  expect(changed).toBe(false);
});

test("a passage that shifted is moved silently", () => {
  const { codings, changed } = checkAnchors(turnWith("ZZabcXXcde"), PAIR);
  expect(codings.map((coding) => coding.state)).toEqual(["moved", "moved"]);
  expect(changed).toBe(true);
  // Moved onto what they actually say, not merely shifted by a guess.
  const text = "ZZabcXXcde";
  for (const coding of codings) {
    expect(text.slice(coding.start, coding.end)).toBe(coding.text);
  }
  expect(overlapping(codings)).toEqual([]);
});

test("a move is refused when it would land on a neighbour", () => {
  // The XX was a recognition error and gets corrected away. "cde" then reads
  // across the end of "abc", which still sits exactly where it was filed.
  const { codings, changed } = checkAnchors(turnWith("abcde"), PAIR);

  expect(overlapping(codings)).toEqual([]);
  const [a, b] = codings;
  expect(a.state).toBe("ok");
  // The one that still matches holds its ground; the other is handed over.
  expect(b.state).toBe("lost");
  expect(b.reasonKey).toBe("anchorWouldOverlap");
  // Nothing was written: a refusal is not a change.
  expect(changed).toBe(false);
  // And it keeps the range it was filed under, for the reader to recognise.
  expect(b.start).toBe(5);
  expect(b.end).toBe(8);
});

test("a citation that reads twice is not guessed at", () => {
  const codings = [{ id: "A", turn: 1, start: 9, end: 12, text: "cde", category: "x" }];
  const { codings: checked } = checkAnchors(turnWith("cdeXXcdeXX"), codings);
  expect(checked[0].state).toBe("lost");
  expect(checked[0].reasonKey).toBe("anchorAmbiguous");
});

test("a citation that is gone, and a turn that is gone, are told apart", () => {
  const gone = checkAnchors(turnWith("nothing like it"), PAIR).codings;
  expect(gone.every((coding) => coding.reasonKey === "anchorNotFound")).toBe(true);

  const other = checkAnchors({ turns: [{ number: 7, text: "abc" }] }, PAIR).codings;
  expect(other[0].reasonKey).toBe("anchorTurnGone");
  expect(other[0].reasonParams).toEqual({ turn: 1 });
});

test("the reason is worded in the language that asked", () => {
  const { codings } = checkAnchors(turnWith("abcde"), PAIR);
  const german = withReasons(codings, translator("de"))[1];
  const english = withReasons(codings, translator("en"))[1];

  expect(german.reason).toContain("über einer anderen Kodiereinheit");
  expect(english.reason).toContain("on top of another coding unit");
  // The key is spent on the way out; what reaches the interface is a sentence.
  expect(german.reasonKey).toBeUndefined();
  expect(english.reasonKey).toBeUndefined();
});

test("nothing of the check is written back into the file", () => {
  const { codings } = checkAnchors(turnWith("abcde"), PAIR);
  for (const coding of withoutCheckMarks(codings)) {
    expect(coding.state).toBeUndefined();
    expect(coding.reason).toBeUndefined();
    expect(coding.reasonKey).toBeUndefined();
    expect(coding.reasonParams).toBeUndefined();
  }
});
