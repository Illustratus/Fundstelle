import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { sidePort } from "./sandbox.mjs";
import { code, startStudy, twoRounds } from "./evaluation-study.mjs";

/**
 * Criteria that count persons by their stance towards a proposition.
 *
 * The evaluation round of the study this was built for codes in two steps:
 * the category says what a person talks about, and, independently of it, a
 * stance per proposition says what the statement means for that claim. A
 * criterion then counts persons — never statements — with a unit of the stance
 * it asks for, from whichever category. What is checked here is what the
 * researcher has to be able to rely on when the counts go into the thesis:
 *
 * - a person who supports and contradicts counts for both, and stands with the
 *   deviant cases whatever the status says;
 * - the base is everybody asked, or only the persons the proposition can be
 *   checked with, and who is left out is named with the reason;
 * - "nobody names …" is a threshold of its own;
 * - a criterion the tool cannot decide is shown with its evidence and decides
 *   nothing, and a verdict that hangs on it says so instead of guessing;
 * - one of several criteria can be enough for a verdict, when that is what was
 *   registered.
 */

let study;

test.describe.configure({ mode: "serial" });

/** The body rows of the grid tables in a document, each cell's lines joined by a space. */
function gridCells(markdown) {
  const rows = [];
  let edges = null;
  let current = null;
  let header = true;
  for (const line of markdown.split("\n")) {
    if (/^\+[-=+:]+\+$/.test(line)) {
      edges ??= [...line].map((character, index) => (character === "+" ? index : -1)).filter((index) => index >= 0);
      if (current && !header) rows.push(current.map((parts) => parts.join(" ").replace(/\s+/g, " ").trim()));
      if (line.includes("=")) header = false;
      current = edges.slice(1).map(() => []);
      continue;
    }
    if (!edges || !line.startsWith("|")) {
      edges = null;
      header = true;
      current = null;
      continue;
    }
    edges.slice(1).forEach((edge, index) => current[index].push(line.slice(edges[index] + 1, edge).trim()));
  }
  return rows;
}

test.beforeAll(async () => {
  study = await startStudy({ port: sidePort(4154) });
  await twoRounds(study);
});

test.afterAll(() => study?.stop());

const studyFile = () => join(study.folder, "study.json");
const evaluated = async (id = "practice", query = "") =>
  (await study.get(`/api/evaluation/propositions${query}`)).json.propositions.find((one) => one.id === id);
const setCriteria = (criteria, extra = {}) => study.patch("/api/propositions/practice", { criteria, ...extra });

test("a stance counts for its proposition from any category, unless the criterion names categories", async () => {
  // Marketing speaks about agreements and says something about practice.
  await code(study, "r2-marketing", 4, "agreement", { stances: { practice: "supports" } });
  await code(study, "r2-vertrieb", 2, "routine", { stances: { practice: "supports" } });
  await code(study, "r2-einkauf", 2, "routine");

  await setCriteria([
    { id: "any", verdict: "supported", round: "evaluation", stance: "supports", threshold: { atLeast: 2 } },
    { id: "routine-only", verdict: "supported", round: "evaluation", stance: "supports", categories: ["routine"], threshold: { atLeast: 2 } },
  ]);
  const practice = await evaluated();
  const [any, routineOnly] = practice.criteria;
  expect(any).toMatchObject({ count: 2, met: true });
  expect(any.meeting.map((one) => one.department)).toEqual(["Marketing", "Vertrieb"]);
  expect(any.meeting[0].units.map((unit) => unit.category)).toEqual(["agreement"]);
  expect(routineOnly).toMatchObject({ count: 1, met: false });
  // A stance towards practice is no stance towards coordination, whose category it was.
  expect((await evaluated("coordination")).rounds[0].tally.supports).toEqual([]);
});

test("a person who supports and contradicts counts for both, and stands with the deviant cases", async () => {
  await code(study, "r2-marketing", 2, "routine", { stances: { practice: "contradicts" } });
  await setCriteria([
    { id: "s", verdict: "supported", round: "evaluation", stance: "supports", threshold: { atLeast: 2 } },
    { id: "f", verdict: "falsified", round: "evaluation", stance: "contradicts", threshold: { atLeast: 1 } },
  ]);
  const practice = await evaluated();
  const [supported, falsified] = practice.criteria;
  expect(supported).toMatchObject({ count: 2, met: true });
  expect(falsified).toMatchObject({ count: 1, met: true });
  expect(falsified.meeting.map((one) => one.department)).toEqual(["Marketing"]);
  // Shown, not settled: both verdicts hold, and Marketing is named as split.
  const round = practice.rounds[0];
  expect(round.status).toBe("both");
  expect(round.tally).toEqual({ supports: ["Marketing", "Vertrieb"], contradicts: ["Marketing"], neither: ["Einkauf"] });
  expect(round.split).toHaveLength(1);
  expect(round.split[0].department).toBe("Marketing");
  expect(round.split[0].contradicts.map((unit) => unit.turn)).toEqual([2]);
  expect(round.split[0].supports.map((unit) => unit.turn)).toEqual([4]);
  // Its contradiction travels with it where it meets the supporting criterion.
  expect(supported.meeting[0].opposite.map((unit) => unit.turn)).toEqual([2]);
});

test("a person can be marked as not checkable for a proposition, with a reason, and taken back", async () => {
  const before = readFileSync(studyFile(), "utf8");
  const mark = (body, lang = "en") => study.patch(`/api/rounds/evaluation/untestable?lang=${lang}`, body);

  expect((await mark({ proposition: "", department: "Einkauf", reason: "x" })).json.code).toBe("errorUntestableShape");
  expect((await mark({ proposition: "nowhere", department: "Einkauf", reason: "x" })).status).toBe(404);
  expect((await mark({ proposition: "none", department: "Einkauf", reason: "x" })).json.code).toBe("errorStanceNoClaim");
  // A department the round does not have — the one the second round did not reach.
  const absent = await mark({ proposition: "practice", department: "Lager", reason: "x" });
  expect(absent.status).toBe(404);
  expect(absent.json.error).toBe("There is no department Lager in this round.");
  expect((await study.patch("/api/rounds/nowhere/untestable", { proposition: "practice", department: "Einkauf", reason: "x" })).status).toBe(404);
  expect(readFileSync(studyFile(), "utf8")).toBe(before);

  const set = await mark({ proposition: "practice", department: "Einkauf", reason: "Hat in der Nutzungsphase nichts abgelegt." });
  expect(set.status).toBe(200);
  expect(set.json).toEqual({
    round: "evaluation",
    untestable: { practice: { Einkauf: "Hat in der Nutzungsphase nichts abgelegt." } },
  });
  const saved = JSON.parse(readFileSync(studyFile(), "utf8"));
  expect(saved.rounds[1].untestable).toEqual({ practice: { Einkauf: "Hat in der Nutzungsphase nichts abgelegt." } });
  // The list of rounds carries it.
  const rounds = (await study.get("/api/rounds")).json.rounds;
  expect(rounds.map((one) => one.untestable)).toEqual([{}, { practice: { Einkauf: "Hat in der Nutzungsphase nichts abgelegt." } }]);

  const round = (await evaluated()).rounds[0];
  expect(round).toMatchObject({ persons: 3, testable: 2 });
  expect(round.untestable).toEqual([{ department: "Einkauf", reason: "Hat in der Nutzungsphase nichts abgelegt.", present: true }]);

  // An empty reason takes it back, and the file is what it was.
  const cleared = await mark({ proposition: "practice", department: "Einkauf", reason: "" });
  expect(cleared.json.untestable).toEqual({});
  expect(readFileSync(studyFile(), "utf8")).toBe(before);
});

test("the base is everybody asked, or only those the proposition can be checked with", async () => {
  await study.patch("/api/rounds/evaluation/untestable", { proposition: "practice", department: "Einkauf", reason: "Nicht genutzt." });
  await setCriteria([
    { id: "all", verdict: "supported", round: "evaluation", stance: "supports", threshold: { fraction: "1/1" } },
    { id: "testable", verdict: "supported", round: "evaluation", stance: "supports", base: "testable", threshold: { fraction: "1/1" } },
  ]);
  const practice = await evaluated();
  const [all, testable] = practice.criteria;
  // Everybody: three persons, all three needed, two have it.
  expect(all).toMatchObject({ persons: 3, required: 3, count: 2, met: false, untestable: [] });
  expect(all.deviant.map((one) => one.department)).toEqual(["Einkauf"]);
  // Only the checkable: Einkauf is out of the base and named with its reason.
  expect(testable).toMatchObject({ persons: 2, required: 2, count: 2, met: true });
  expect(testable.deviant).toEqual([]);
  expect(testable.untestable).toEqual([{ department: "Einkauf", interviews: ["r2-einkauf"], reason: "Nicht genutzt." }]);
  // Supported: the two criteria must both hold, and one does not.
  expect(practice.rounds[0].status).toBe("open");
  expect(practice.rounds[0].pending).toEqual([]);
});

test("nobody naming it is a threshold of its own", async () => {
  await setCriteria([
    { id: "nobody", verdict: "supported", round: "evaluation", stance: "contradicts", categories: ["agreement"], threshold: { none: true } },
    { id: "nobody-routine", verdict: "falsified", round: "evaluation", stance: "contradicts", categories: ["routine"], threshold: { none: true } },
  ]);
  const practice = await evaluated();
  const [nobody, routine] = practice.criteria;
  // Nobody contradicts practice under agreement: met, with nobody required.
  expect(nobody).toMatchObject({ required: 0, count: 0, met: true });
  expect(nobody.meeting).toEqual([]);
  // Marketing contradicts it under routine: one person is enough to break it,
  // and it is the one listed.
  expect(routine).toMatchObject({ required: 0, count: 1, met: false });
  expect(routine.meeting.map((one) => one.department)).toEqual(["Marketing"]);
  expect(practice.rounds[0].status).toBe("supported");
  // The person who names it is not a deviant case of a "nobody" criterion that holds.
  expect(practice.rounds[0].deviant).toEqual([]);
});

test("a criterion by hand shows its evidence and decides nothing, and a verdict hanging on it says so", async () => {
  await setCriteria([
    { id: "counted", verdict: "supported", round: "evaluation", stance: "supports", threshold: { atLeast: 2 } },
    { id: "git", text: "Organisches Wachstum über mehrere Bereiche.", verdict: "supported", round: "evaluation", kind: "manual" },
    { id: "cause", text: "Die häufigste Ursache.", verdict: "falsified", round: "evaluation", kind: "manual", stance: "contradicts" },
  ]);
  let practice = await evaluated();
  const [counted, git, cause] = practice.criteria;
  expect(counted.met).toBe(true);
  // Nothing from the interviews for a criterion the commit history decides.
  expect(git).toMatchObject({ kind: "manual", met: null, required: null, count: null, meeting: [], deviant: [] });
  // The cause is read by hand from the contradicting units, which are listed.
  expect(cause).toMatchObject({ kind: "manual", met: null, required: null, count: 1 });
  expect(cause.meeting.map((one) => one.department)).toEqual(["Marketing"]);
  expect(cause).not.toHaveProperty("threshold");
  // Supported hangs on the commit history; falsified on the cause. Neither is guessed.
  expect(practice.rounds[0]).toMatchObject({ status: "open", verdicts: { supported: null, falsified: null } });
  expect(practice.rounds[0].pending).toEqual(["supported", "falsified"]);

  // An unmet counted criterion decides an "all" verdict on its own.
  await setCriteria([
    { id: "counted", verdict: "supported", round: "evaluation", stance: "supports", threshold: { atLeast: 3 } },
    { id: "git", verdict: "supported", round: "evaluation", kind: "manual" },
  ]);
  practice = await evaluated();
  expect(practice.rounds[0]).toMatchObject({ status: "open", verdicts: { supported: false }, pending: [] });
});

test("one of several criteria is enough where that is what was registered", async () => {
  const criteria = [
    { id: "interview", verdict: "falsified", round: "evaluation", stance: "contradicts", threshold: { atLeast: 1 } },
    { id: "git", verdict: "falsified", round: "evaluation", kind: "manual" },
  ];
  // All by default: the counted one is met, the one by hand keeps it open.
  await setCriteria(criteria);
  let practice = await evaluated();
  expect(practice.combine).toEqual({ supported: "all", falsified: "all" });
  expect(practice.rounds[0]).toMatchObject({ status: "open", pending: ["falsified"] });

  // "Interview or Git": the interview criterion suffices.
  const set = await setCriteria(criteria, { combine: { falsified: "any" } });
  expect(set.json.combine).toEqual({ falsified: "any" });
  practice = await evaluated();
  expect(practice.rounds[0]).toMatchObject({ status: "falsified", pending: [] });
  // Only what differs from the default is written.
  const saved = JSON.parse(readFileSync(join(study.folder, "categories.json"), "utf8"));
  expect(saved.propositions.practice.combine).toEqual({ falsified: "any" });
  expect(Object.keys(saved.propositions.practice)).toEqual(["name", "color", "combine", "criteria"]);

  // Unmet and by hand under "any": still open, and said to hang on the one by hand.
  await setCriteria([{ ...criteria[0], threshold: { atLeast: 3 } }, criteria[1]]);
  practice = await evaluated();
  expect(practice.rounds[0]).toMatchObject({ status: "open", pending: ["falsified"] });

  // Back to all: the setting goes.
  await study.patch("/api/propositions/practice", { combine: { falsified: "all" } });
  expect(Object.keys(JSON.parse(readFileSync(join(study.folder, "categories.json"), "utf8")).propositions.practice)).toEqual([
    "name",
    "color",
    "criteria",
  ]);
});

test("the export prints the stances in persons, the split, the base and what is decided by hand", async () => {
  await setCriteria(
    [
      { id: "s", text: "Zwei Drittel aller Befragten ohne Mehrbelastung.", verdict: "supported", round: "evaluation", stance: "supports", threshold: { fraction: "2/3" } },
      { id: "git", text: "Organisches Wachstum (Commit-Historie).", verdict: "supported", round: "evaluation", kind: "manual" },
      { id: "f", text: "Die Hälfte der Prüfbaren nennt die Unterbrechung.", verdict: "falsified", round: "evaluation", stance: "contradicts", base: "testable", threshold: { fraction: "1/2" } },
      { id: "n", text: "Niemand nennt es unter Absprachen.", verdict: "falsified", round: "evaluation", stance: "contradicts", categories: ["agreement"], threshold: { none: true } },
    ],
    { combine: { falsified: "any" } },
  );
  const api = await evaluated();
  const de = (await study.get("/api/export/evaluation-propositions.md?lang=de")).text;
  // Prose is wrapped at the width of the tables; read it as one line.
  const prose = de.replace(/\s+/g, " ");
  expect(de).toContain("# Propositionen: Stufen und vorab festgelegte Kriterien");
  expect(prose).toContain("Evaluation: falsifiziert. Personen in der Runde: 3. Davon prüfbar: 2.");
  expect(prose).toContain("Ob die Proposition als gestützt gilt, hängt an Kriterien, die von Hand entschieden werden.");
  expect(de).toMatch(/\| stützt +\| 2 +\| Marketing, Vertrieb +\|/);
  expect(de).toMatch(/\| widerspricht +\| 1 +\| Marketing +\|/);
  expect(de).toMatch(/\| kein Bezug +\| 1 +\| Einkauf +\|/);
  expect(prose).toContain("Stützt und widerspricht zugleich: Marketing.");
  expect(de).toContain("- Einkauf: Nicht genutzt.");
  expect(de).toContain("### Abweichende Fälle in Evaluation: stützt und widerspricht");
  const criterionCell = gridCells(de).find((row) => row[0].startsWith("Die Hälfte der Prüfbaren"));
  expect(criterionCell[0]).toContain("Bezugsgröße die Befragten, bei denen die Proposition prüfbar ist");
  expect(criterionCell.slice(1)).toEqual(["Falsifikation", "1 von 2, nötig 1", "ja"]);
  expect(gridCells(de).find((row) => row[0].startsWith("Organisches Wachstum")).slice(2)).toEqual([
    "keine Belege aus den Interviews",
    "von Hand",
  ]);
  expect(prose).toContain("Nicht in der Bezugsgröße, weil nicht prüfbar: Einkauf.");
  expect(prose).toContain("Die Falsifikation gilt, wenn eines ihrer Kriterien erfüllt ist.");
  expect(prose).toContain("Dieses Kriterium wählt keine Belege aus den Interviews aus");
  expect(de).toContain("#### Nennen es nicht: 3 von 3 Personen");
  // Under one proposition, a quotation carries its stance towards that one alone.
  expect(de).toMatch(/„Der Bestätigungsschritt stört mich nicht, er geht schnell\.“ \(Beitrag 4\) \[stützt\]/);
  // The numbers in the table are the numbers of the API.
  const f = api.criteria.find((one) => one.id === "f");
  expect(criterionCell[2]).toBe(`${f.count} von ${f.persons}, nötig ${f.required}`);
  expect(api.rounds[0].status).toBe("falsified");

  const en = (await study.get("/api/export/evaluation-propositions.md?lang=en")).text;
  const english = en.replace(/\s+/g, " ");
  expect(english).toContain("Evaluation: falsified. Persons in the round: 3. Checkable among them: 2.");
  expect(english).toContain("Supports and contradicts at once: Marketing.");
  expect(gridCells(en).some((row) => row[3] === "by hand")).toBe(true);
  expect(en).not.toMatch(/Personen|stützt|Bezugsgröße/);
});
