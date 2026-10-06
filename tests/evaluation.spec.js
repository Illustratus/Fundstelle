import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { sidePort } from "./sandbox.mjs";
import { code, startStudy, twoRounds } from "./evaluation-study.mjs";
import { required } from "../lib/panel.js";

/**
 * The second round, evaluated: stance, criteria, panel, guide questions.
 *
 * The thresholds a study registers before its second round count persons,
 * not statements — "at least four of five persons" — and a tool that counted
 * statements instead would let one talkative department decide the verdict.
 * That is the check this file is built around. The others: a stance written
 * onto one unit changes that unit's lines and nothing else; the panel compares
 * the same persons and says nothing about who is missing; the report by guide
 * question is ordered by the guide.
 */

let study;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  study = await startStudy({ port: sidePort(4178) });
  await twoRounds(study);
});

test.afterAll(() => study?.stop());

const codingFile = (interview) => join(study.transcripts, interview, "coding.json");

/* Stance ------------------------------------------------------------------- */

test("a stance is set and taken away on one unit, and the file says only that", async () => {
  const first = await code(study, "r2-vertrieb", 2, "routine");
  const second = await code(study, "r2-vertrieb", 4, "agreement");
  // Absent by default: neutral is not a value somebody chose.
  expect("stance" in first).toBe(false);
  const before = readFileSync(codingFile("r2-vertrieb"), "utf8");
  expect(before).not.toContain("stance");

  const set = await study.patch(`/api/interviews/r2-vertrieb/codings/${first.id}`, { stance: "supports" });
  expect(set.status).toBe(200);
  expect(set.json.stance).toBe("supports");
  const after = readFileSync(codingFile("r2-vertrieb"), "utf8");
  // One line more, inside the unit that changed; the `changed` stamp aside,
  // every other line is the line it was.
  const lines = (text) => text.split("\n").filter((line) => !line.includes('"changed"'));
  const added = lines(after).filter((line) => !lines(before).includes(line));
  expect(added.map((line) => line.trim())).toEqual(['"requirements": [],', '"stance": "supports"']);
  const secondBlock = (text) => text.slice(text.indexOf(second.id) - 20);
  expect(secondBlock(after)).toBe(secondBlock(before));

  const unset = await study.patch(`/api/interviews/r2-vertrieb/codings/${first.id}`, { stance: null });
  expect(unset.json.stance).toBeUndefined();
  expect(lines(readFileSync(codingFile("r2-vertrieb"), "utf8"))).toEqual(lines(before));

  const wrong = await study.patch(`/api/interviews/r2-vertrieb/codings/${first.id}?lang=en`, { stance: "maybe" });
  expect(wrong.status).toBe(400);
  expect(wrong.json).toMatchObject({ code: "errorStanceValue", error: "Expected supports, contradicts or null." });
  expect((await study.post("/api/interviews/r2-vertrieb/codings", {
    turn: 2, start: 0, end: 4, category: "routine", text: "Das ", stance: "against",
  })).json.code).toBe("errorStanceValue");

  // Tidy up for what follows.
  await study.del(`/api/interviews/r2-vertrieb/codings/${first.id}`);
  await study.del(`/api/interviews/r2-vertrieb/codings/${second.id}`);
});

/* Criteria ----------------------------------------------------------------- */

test("a threshold is a number of persons, and a share is rounded up exactly", () => {
  expect(required({ atLeast: 4 }, 5)).toBe(4);
  expect(required({ fraction: "2/3" }, 5)).toBe(4);
  expect(required({ fraction: "2/3" }, 3)).toBe(2);
  expect(required({ fraction: "1/2" }, 5)).toBe(3);
  expect(required({ fraction: "1/2" }, 4)).toBe(2);
  expect(required({ fraction: 0.5 }, 5)).toBe(3);
});

test("criteria are checked against the rounds and categories the study has", async () => {
  const put = (criteria) => study.patch("/api/propositions/practice", { criteria });
  const base = { verdict: "supported", round: "evaluation", categories: ["routine"], threshold: { atLeast: 2 } };
  expect((await put("x")).json.code).toBe("errorCriteriaList");
  expect((await put([{ ...base, verdict: "maybe" }])).json.code).toBe("errorCriterionVerdict");
  expect((await put([{ ...base, round: undefined }])).json.code).toBe("errorCriterionRound");
  expect((await put([{ ...base, round: "nowhere" }])).json.code).toBe("errorUnknownRound");
  expect((await put([{ ...base, categories: [] }])).json.code).toBe("errorCriterionCategories");
  expect((await put([{ ...base, categories: ["nope"] }])).json.code).toBe("errorUnknownCategory");
  expect((await put([{ ...base, stance: "neutral" }])).json.code).toBe("errorCriterionStance");
  expect((await put([{ ...base, threshold: { atLeast: 0 } }])).json.code).toBe("errorCriterionThreshold");
  expect((await put([{ ...base, threshold: { fraction: "3/2" } }])).json.code).toBe("errorCriterionThreshold");
  expect((await put([{ ...base, threshold: { atLeast: 2, fraction: "1/2" } }])).json.code).toBe(
    "errorCriterionThreshold",
  );
  // Nothing was written by any of them.
  const saved = JSON.parse(readFileSync(join(study.folder, "categories.json"), "utf8"));
  expect(saved.propositions.practice.criteria).toBeUndefined();
});

test("criteria count persons, not statements, and list the deviant cases with their evidence", async () => {
  /* Marketing says it twice, Vertrieb once, Einkauf not at all — under the
     stance the criterion asks for. Three statements, two persons. */
  await code(study, "r2-marketing", 2, "routine", { stance: "supports" });
  await code(study, "r2-marketing", 4, "routine", { stance: "supports" });
  await code(study, "r2-vertrieb", 2, "routine", { stance: "supports" });
  // Vertrieb also names the interruption; Einkauf says something neutral.
  await code(study, "r2-vertrieb", 4, "routine", { stance: "contradicts" });
  await code(study, "r2-einkauf", 2, "routine");

  const set = await study.patch("/api/propositions/practice", {
    criteria: [
      {
        text: "Mindestens zwei Drittel schildern keinen Mehraufwand.",
        verdict: "supported",
        round: "evaluation",
        categories: ["routine"],
        stance: "supports",
        threshold: { fraction: "2/3" },
      },
      {
        verdict: "falsified",
        round: "evaluation",
        categories: ["routine"],
        stance: "contradicts",
        threshold: { fraction: "1/2" },
      },
    ],
  });
  expect(set.status).toBe(200);
  expect(set.json.criteria.map((one) => one.id)).toEqual(["supported-1", "falsified-2"]);

  const result = (await study.get("/api/evaluation/propositions")).json.propositions;
  expect(result.map((one) => one.id)).toEqual(["practice"]);
  const [supported, falsified] = result[0].criteria;

  // Three persons in the round; two thirds of three is two; two meet it.
  expect(supported).toMatchObject({ persons: 3, required: 2, count: 2, met: true });
  expect(supported.meeting.map((one) => one.department)).toEqual(["Marketing", "Vertrieb"]);
  // Marketing's evidence is all of its statements, and still one person.
  expect(supported.meeting[0].units).toHaveLength(2);
  // The deviant case comes with what it did say in that category.
  expect(supported.deviant).toHaveLength(1);
  expect(supported.deviant[0].department).toBe("Einkauf");
  expect(supported.deviant[0].units.map((unit) => unit.stance)).toEqual([null]);

  // Half of three is two persons; only Vertrieb names the interruption.
  expect(falsified).toMatchObject({ persons: 3, required: 2, count: 1, met: false });

  expect(result[0].rounds).toEqual([
    expect.objectContaining({ round: "evaluation", status: "supported", persons: 3, uncoded: [] }),
  ]);
  expect(result[0].rounds[0].deviant.map((one) => one.department)).toEqual(["Einkauf"]);

  // The first round has no criteria, so asking for it gives none.
  expect((await study.get("/api/evaluation/propositions?round=requirements")).json.propositions).toEqual([]);
  expect((await study.get("/api/evaluation/propositions?round=nowhere")).status).toBe(404);
});

test("a criterion met from both sides is reported as both, not settled", async () => {
  await study.patch("/api/propositions/practice", {
    criteria: [
      { verdict: "supported", round: "evaluation", categories: ["routine"], stance: "supports", threshold: { atLeast: 1 } },
      { verdict: "falsified", round: "evaluation", categories: ["routine"], stance: "contradicts", threshold: { atLeast: 1 } },
    ],
  });
  const [one] = (await study.get("/api/evaluation/propositions")).json.propositions;
  expect(one.rounds[0].status).toBe("both");
  expect(one.rounds[0].deviant).toEqual([]);
});

test("taking the criteria away leaves the proposition as it was before", async () => {
  await study.patch("/api/propositions/practice", { criteria: [] });
  const saved = JSON.parse(readFileSync(join(study.folder, "categories.json"), "utf8"));
  expect(Object.keys(saved.propositions.practice)).toEqual(["name", "color"]);
  expect((await study.get("/api/evaluation/propositions")).json.propositions).toEqual([]);
});

/* The panel ---------------------------------------------------------------- */

test("the panel puts the same persons side by side, and never names who is missing", async () => {
  await code(study, "r1-vertrieb", 2, "routine");
  await code(study, "r1-lager", 2, "routine");
  await study.put("/api/rounds/evaluation/guide", {
    blocks: [
      {
        id: "systeme",
        name: "5 · Systemlandschaft",
        readout: { label: "Systeme", perDepartment: { Vertrieb: ["Postfach", "Laufwerk", "Telefon"] } },
      },
    ],
  });
  await study.post("/api/sessions", { department: "Vertrieb", round: "evaluation", folder: "r2-vertrieb" });
  await study.patch("/api/sessions/r2-vertrieb", { op: "readout", block: "systeme", item: "Postfach", state: "still" });
  await study.patch("/api/sessions/r2-vertrieb", { op: "readout", block: "systeme", item: "Laufwerk", state: "no-longer" });

  const panel = await study.get("/api/evaluation/panel?category=routine");
  expect(panel.status).toBe(200);
  expect(panel.json.from).toBe("requirements");
  expect(panel.json.to).toBe("evaluation");
  expect(panel.json.departments).toEqual(["Einkauf", "Marketing", "Vertrieb"]);
  // Lager was asked once; it is nowhere in the answer.
  expect(JSON.stringify(panel.json)).not.toContain("Lager");

  const vertrieb = panel.json.categories[0].cells.find((one) => one.department === "Vertrieb");
  expect(vertrieb.from.count).toBe(1);
  expect(vertrieb.from.units[0].text).toContain("Angebote liegen im Postfach");
  expect(vertrieb.to.count).toBe(2);
  expect(vertrieb.to.units.map((unit) => unit.stance)).toEqual(["supports", "contradicts"]);

  // Three listed, one still searched by hand, one no longer, one not asked.
  expect(panel.json.readout).toEqual([
    expect.objectContaining({ department: "Vertrieb", interview: "r2-vertrieb", listed: 3, still: 1, noLonger: 1, open: 1 }),
  ]);

  expect((await study.get("/api/evaluation/panel?from=evaluation&to=evaluation")).json.code).toBe(
    "errorPanelNeedsTwoRounds",
  );
  expect((await study.get("/api/evaluation/panel?category=nope")).status).toBe(404);
});

/* By guide question -------------------------------------------------------- */

test("units assigned to guide questions are reported by the questions' tags, in guide order", async () => {
  await study.put("/api/rounds/evaluation/guide", {
    blocks: [
      {
        id: "systeme",
        name: "5 · Systemlandschaft",
        readout: { label: "Systeme", perDepartment: { Vertrieb: ["Postfach", "Laufwerk", "Telefon"] } },
      },
      {
        id: "schluss",
        name: "7 · Konkrete Fragen zum Schluss",
        mandatory: [
          { id: "m-aufwand", text: "Kostet das Ablegen Zeit?", tag: "Erwarteter Aufwand" },
          { id: "m-gegen", text: "Was spricht dagegen?", tag: "Gegenprobe" },
          { id: "m-frei", text: "Sonst noch etwas?" },
        ],
        checklist: [{ id: "c-kollegen", text: "Kolleginnen", tag: "Sozialer Einfluss" }],
      },
    ],
  });
  const units = (await study.get("/api/interviews/r2-marketing")).json.codings;
  await study.patch(`/api/interviews/r2-marketing/codings/${units[0].id}`, { question: "m-gegen" });
  await study.patch(`/api/interviews/r2-marketing/codings/${units[1].id}`, { question: "m-frei" });
  const vertrieb = (await study.get("/api/interviews/r2-vertrieb")).json.codings;
  await study.patch(`/api/interviews/r2-vertrieb/codings/${vertrieb[0].id}`, { question: "m-aufwand" });

  const report = (await study.get("/api/evaluation/tags")).json;
  expect(report.round).toBe("evaluation");
  // Guide order: block by block, the checklist before the mandatory questions.
  expect(report.tags.map((one) => one.tag)).toEqual(["Sozialer Einfluss", "Erwarteter Aufwand", "Gegenprobe"]);
  const byTag = Object.fromEntries(report.tags.map((one) => [one.tag, one]));
  expect(byTag["Erwarteter Aufwand"].units.map((unit) => unit.department)).toEqual(["Vertrieb"]);
  expect(byTag.Gegenprobe.departments).toBe(1);
  expect(byTag["Sozialer Einfluss"].units).toEqual([]);
  expect(report.untagged.units).toHaveLength(1);
  // Five units in the round, three of them assigned.
  expect(report.persons).toBe(3);
  expect(report.unassigned).toBe(2);

  // Taken away again, it leaves the unit's lines as they were.
  await study.patch(`/api/interviews/r2-marketing/codings/${units[1].id}`, { question: null });
  expect(readFileSync(codingFile("r2-marketing"), "utf8")).not.toContain("m-frei");
  expect((await study.get("/api/evaluation/tags?round=nowhere")).status).toBe(404);
});
