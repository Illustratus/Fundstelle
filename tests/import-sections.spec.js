import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { sidePort } from "./sandbox.mjs";
import { BLOCKS, LATE, T0, VTT, openLog } from "./import-sections-study.mjs";
import { startStudy, twoRounds } from "./evaluation-study.mjs";
import { chosenSections, readOffset, shiftedSession } from "../lib/import-sections.js";
import { parseTranscript } from "../lib/transcript.js";

/**
 * The guide's sections at import, corrected before they are written.
 *
 * Teams starts its recording a little after the interviewer pressed start in
 * the log, so every block start lands that much too late among the turns. One
 * offset for the whole import moves them all; a single heading a turn off is
 * moved by hand, and the list the researcher looked at is what gets written.
 * Neither is stored in the log unless the researcher says so.
 */

/* Pure parts ----------------------------------------------------------------- */

test("an offset moves every timed start alike and leaves the untimed alone", () => {
  const session = { t0: T0, blockStarts: [{ block: "a", at: 22 }, { block: "b", at: null }] };
  expect(shiftedSession(session, -20).blockStarts).toEqual([
    { block: "a", at: 2 },
    { block: "b", at: null },
  ]);
  // Nothing to shift is the log itself, untouched.
  expect(shiftedSession(session, 0)).toBe(session);
  expect(session.blockStarts[0].at).toBe(22);
  expect(readOffset(undefined)).toBe(0);
  expect(readOffset(-12.5)).toBe(-12.5);
  expect(() => readOffset("-12")).toThrow();
});

test("a chosen list is checked, not repaired, and comes back in turn order", () => {
  const turns = [{ at: 2 }, { at: 6 }, { at: 30 }];
  expect(
    chosenSections(
      [
        { block: "1-ablage", before: 2, at: 30 },
        { block: "warmfrage", before: 0 },
      ],
      turns,
      BLOCKS,
    ),
  ).toEqual([
    { block: "warmfrage", name: "Warmfrage", at: null, before: 0, turn: 1, turnAt: 2 },
    { block: "1-ablage", name: "1 · Ablage (Wissen festhalten)", at: 30, before: 2, turn: 3, turnAt: 30 },
  ]);
  // Two headings before one turn keep the order given: an empty section is the
  // researcher's to see, not this function's to tidy away.
  expect(
    chosenSections(
      [
        { block: "5-systeme", before: 1 },
        { block: "1-ablage", before: 1 },
      ],
      turns,
      BLOCKS,
    ).map((one) => one.block),
  ).toEqual(["5-systeme", "1-ablage"]);
  expect(() => chosenSections([{ block: "warmfrage", before: 3 }], turns, BLOCKS)).toThrow("errorSectionList");
  expect(() => chosenSections([{ block: "warmfrage", before: 1.5 }], turns, BLOCKS)).toThrow("errorSectionList");
  expect(() => chosenSections([{ block: "nope", before: 0 }], turns, BLOCKS)).toThrow("errorUnknownBlock");
  expect(() => chosenSections({}, turns, BLOCKS)).toThrow("errorSectionList");
});

/* Over HTTP ------------------------------------------------------------------- */

let study;

test.describe("over HTTP", () => {
  test.describe.configure({ mode: "serial" });

  const open = (folder, starts, options) => openLog(study, folder, starts, options);
  const logOf = (folder) => readFileSync(join(study.transcripts, folder, "session.json"), "utf8");

  test.beforeAll(async () => {
    study = await startStudy({ port: sidePort(4161) });
    await twoRounds(study);
    await study.put("/api/rounds/evaluation/guide", { blocks: BLOCKS });
    await open("spaet", LATE);
  });

  test.afterAll(() => study?.stop());

  test("the preview follows the offset, lists every turn, and writes nothing", async () => {
    const before = logOf("spaet");
    const plain = await study.post("/api/import/read", {
      text: VTT,
      folder: "spaet",
      interviewer: "Anna Berger",
    });
    // Twenty seconds late, each heading falls one turn behind its question,
    // and the last block lies beyond the recording.
    expect(plain.json.sections.placed.map((one) => [one.block, one.before])).toEqual([
      ["warmfrage", 2],
      ["1-ablage", 4],
    ]);
    expect(plain.json.sections.unplaced.map((one) => [one.block, one.reason])).toEqual([
      ["5-systeme", "sectionAfterLastTurn"],
    ]);
    // Every turn, for the review to move headings along.
    expect(plain.json.timeline).toHaveLength(6);
    expect(plain.json.timeline[2]).toEqual({
      speaker: "Anna Berger",
      at: 30,
      text: "Erzählen Sie, wie Sie zuletzt etwas abgelegt haben.",
    });

    const shifted = await study.post("/api/import/read", {
      text: VTT,
      folder: "spaet",
      interviewer: "Anna Berger",
      offset: -20,
    });
    expect(shifted.json.sections.placed.map((one) => [one.block, one.before, one.at])).toEqual([
      ["warmfrage", 0, 2],
      ["1-ablage", 2, 30],
      ["5-systeme", 4, 90],
    ]);
    expect(shifted.json.sections.unplaced).toEqual([]);

    // Reading changes nothing: no transcript, and the log as it was.
    expect(existsSync(join(study.transcripts, "spaet", "final.md"))).toBe(false);
    expect(logOf("spaet")).toBe(before);
  });

  test("without a log the read answer is what it always was", async () => {
    const plain = await study.post("/api/import/read", { text: VTT, folder: "elsewhere", offset: -20 });
    expect(plain.status).toBe(200);
    expect(plain.json.sections).toBeUndefined();
    expect(plain.json.timeline).toBeUndefined();
    expect(plain.json.preview).toHaveLength(4);
  });

  test("an offset that is not a number is refused by name", async () => {
    const wrong = await study.post("/api/import/read?lang=en", {
      text: VTT,
      folder: "spaet",
      offset: "-20",
    });
    expect(wrong.status).toBe(400);
    expect(wrong.json.code).toBe("errorTimeShape");
    const write = await study.post("/api/import", { text: VTT, folder: "spaet", offset: "x" });
    expect(write.json.code).toBe("errorTimeShape");
    expect(existsSync(join(study.transcripts, "spaet", "final.md"))).toBe(false);
  });

  test("a wrong list is refused before a file is made", async () => {
    const outside = await study.post("/api/import", {
      text: VTT,
      folder: "spaet",
      interviewer: "Anna Berger",
      sections: [{ block: "warmfrage", before: 6 }],
    });
    expect(outside.status).toBe(400);
    expect(outside.json.code).toBe("errorSectionList");
    const unknown = await study.post("/api/import", {
      text: VTT,
      folder: "spaet",
      interviewer: "Anna Berger",
      sections: [{ block: "gibt-es-nicht", before: 0 }],
    });
    expect(unknown.status).toBe(404);
    expect(unknown.json.code).toBe("errorUnknownBlock");
    // A list needs the log whose guide names its blocks.
    const nolog = await study.post("/api/import", {
      text: VTT,
      folder: "ohne-log",
      interviewer: "Anna Berger",
      sections: [{ block: "warmfrage", before: 0 }],
    });
    expect(nolog.status).toBe(404);
    expect(nolog.json.code).toBe("errorUnknownSession");
    expect(existsSync(join(study.transcripts, "spaet", "final.md"))).toBe(false);
    expect(existsSync(join(study.transcripts, "ohne-log"))).toBe(false);
  });

  test("an offset alone places like the preview did", async () => {
    await open("versatz", LATE, { department: "Einkauf" });
    const made = await study.post("/api/import", {
      text: VTT,
      folder: "versatz",
      interviewer: "Anna Berger",
      offset: -20,
    });
    expect(made.status).toBe(201);
    expect(made.json.sections.placed.map((one) => one.turn)).toEqual([1, 3, 5]);
    const parsed = parseTranscript(readFileSync(join(study.transcripts, "versatz", "final.md"), "utf8"), "versatz");
    expect(parsed.problems).toEqual([]);
    expect(parsed.sections.map((one) => one.name)).toEqual(BLOCKS.map((one) => one.name));
    // Nothing of the offset went into the log.
    expect(JSON.parse(logOf("versatz")).t0).toBe(T0);
    expect(JSON.parse(logOf("versatz")).blockStarts.map((one) => one.at)).toEqual([22, 50, 110]);
  });

  test("the reviewed list is written as it was shown, moved heading and all", async () => {
    const before = logOf("spaet");
    const made = await study.post("/api/import", {
      text: VTT,
      folder: "spaet",
      interviewer: "Anna Berger",
      offset: -20,
      // The researcher moved the second heading one turn on, and set the third
      // — which the rule could not place without the offset — by hand.
      sections: [
        { block: "warmfrage", before: 0, at: 2 },
        { block: "1-ablage", before: 3, at: 30 },
        { block: "5-systeme", before: 4, at: 90 },
      ],
    });
    expect(made.status).toBe(201);
    expect(made.json.sections.placed.map((one) => [one.block, one.turn])).toEqual([
      ["warmfrage", 1],
      ["1-ablage", 4],
      ["5-systeme", 5],
    ]);
    expect(made.json.sections.unplaced).toEqual([]);

    const text = readFileSync(join(study.transcripts, "spaet", "final.md"), "utf8");
    const parsed = parseTranscript(text, "spaet");
    expect(parsed.problems).toEqual([]);
    expect(parsed.turns.map((turn) => [turn.number, turn.section])).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 1],
      [5, 2],
      [6, 2],
    ]);
    // An ordinary section line, editable later like any other.
    expect(text).toContain("## Section: 1 · Ablage (Wissen festhalten)\n\n**4 · Vertrieb");
    expect(logOf("spaet")).toBe(before);
  });

  test("a list that leaves a block out reports what the rule could not place", async () => {
    await open("teilweise", LATE, { department: "Marketing" });
    const made = await study.post("/api/import?lang=en", {
      text: VTT,
      folder: "teilweise",
      interviewer: "Anna Berger",
      sections: [{ block: "warmfrage", before: 0 }],
    });
    expect(made.json.sections.placed.map((one) => one.block)).toEqual(["warmfrage"]);
    expect(made.json.sections.unplaced).toEqual([
      {
        block: "5-systeme",
        name: "5 · Systemlandschaft",
        at: 110,
        reason: "sectionAfterLastTurn",
        why: "The block starts after the recording's last turn.",
      },
    ]);
    const parsed = parseTranscript(readFileSync(join(study.transcripts, "teilweise", "final.md"), "utf8"), "x");
    expect(parsed.sections.map((one) => one.name)).toEqual(["Warmfrage"]);
  });
});
