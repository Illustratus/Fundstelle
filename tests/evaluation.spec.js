import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { sidePort } from "./sandbox.mjs";
import { code, startStudy, twoRounds } from "./evaluation-study.mjs";
import { required } from "../lib/panel.js";

/**
 * The second round, evaluated: stances, criteria, panel, guide questions.
 *
 * The thresholds a study registers before its second round count persons,
 * not statements — "at least four of five persons" — and a tool that counted
 * statements instead would let one talkative department decide the verdict.
 * That is the check this file is built around. The others: a stance written
 * onto one unit changes that unit's lines and nothing else, and is a stance
 * towards a proposition rather than one of its category; the panel compares
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

/* Stances -------------------------------------------------------------------- */

test("a stance per proposition is set and taken away on one unit, and the file says only that", async () => {
  const first = await code(study, "r2-vertrieb", 2, "routine");
  const second = await code(study, "r2-vertrieb", 4, "agreement");
  // Absent by default: no bearing is not a value somebody chose.
  expect("stances" in first).toBe(false);
  const before = readFileSync(codingFile("r2-vertrieb"), "utf8");
  expect(before).not.toContain("stance");

  const set = await study.patch(`/api/interviews/r2-vertrieb/codings/${first.id}`, { stances: { practice: "supports" } });
  expect(set.status).toBe(200);
  expect(set.json.stances).toEqual({ practice: "supports" });
  const after = readFileSync(codingFile("r2-vertrieb"), "utf8");
  // A few lines more, inside the unit that changed; the `changed` stamp aside,
  // every other line is the line it was.
  const lines = (text) => text.split("\n").filter((line) => !line.includes('"changed"'));
  const added = lines(after).filter((line) => !lines(before).includes(line));
  expect(added.map((line) => line.trim())).toEqual(['"requirements": [],', '"stances": {', '"practice": "supports"', "}"]);
  const secondBlock = (text) => text.slice(text.indexOf(second.id) - 20);
  expect(secondBlock(after)).toBe(secondBlock(before));

  // Independent of the category: a unit coded under Absprachen supports the
  // practice proposition, and one unit bears on two propositions.
  const both = await study.patch(`/api/interviews/r2-vertrieb/codings/${second.id}`, {
    stances: { practice: "contradicts", coordination: "supports" },
  });
  expect(both.json.stances).toEqual({ coordination: "supports", practice: "contradicts" });
  // A patch names only what changes: one stance away, the other stays.
  const one = await study.patch(`/api/interviews/r2-vertrieb/codings/${second.id}`, { stances: { practice: null } });
  expect(one.json.stances).toEqual({ coordination: "supports" });

  const unset = await study.patch(`/api/interviews/r2-vertrieb/codings/${first.id}`, { stances: null });
  expect(unset.json.stances).toBeUndefined();
  await study.patch(`/api/interviews/r2-vertrieb/codings/${second.id}`, { stances: { coordination: null } });
  expect(lines(readFileSync(codingFile("r2-vertrieb"), "utf8"))).toEqual(lines(before));

  const patch = (body) => study.patch(`/api/interviews/r2-vertrieb/codings/${first.id}?lang=en`, body);
  expect((await patch({ stances: { practice: "maybe" } })).json).toMatchObject({
    code: "errorStanceValue",
    error: "Expected supports, contradicts or null.",
  });
  expect((await patch({ stances: ["practice"] })).json.code).toBe("errorStancesShape");
  expect((await patch({ stances: { nowhere: "supports" } })).status).toBe(404);
  // The fallback claims nothing; nothing can stand towards it.
  const fallback = await patch({ stances: { none: "supports" } });
  expect(fallback.status).toBe(400);
  expect(fallback.json.code).toBe("errorStanceNoClaim");
  expect((await study.post("/api/interviews/r2-vertrieb/codings", {
    turn: 2, start: 0, end: 4, category: "routine", text: "Das ", stances: { practice: "against" },
  })).json.code).toBe("errorStanceValue");
  // Nothing of it reached the file.
  expect(lines(readFileSync(codingFile("r2-vertrieb"), "utf8"))).toEqual(lines(before));

  // Tidy up for what follows.
  await study.del(`/api/interviews/r2-vertrieb/codings/${first.id}`);
  await study.del(`/api/interviews/r2-vertrieb/codings/${second.id}`);
});

test("the single stance of 0.12 is still read, counted and accepted, and only ever written as stances", async () => {
  // A unit as version 0.12 wrote it, put into the file by hand.
  const made = await code(study, "r2-einkauf", 4, "routine");
  const file = codingFile("r2-einkauf");
  const raw = JSON.parse(readFileSync(file, "utf8"));
  raw.codings.find((one) => one.id === made.id).stance = "supports";
  writeFileSync(file, JSON.stringify(raw, null, 2) + "\n");
  const stored = readFileSync(file, "utf8");

  // Read as a stance towards the proposition of its category (routine → practice).
  const units = (await study.get("/api/evaluation/propositions")).json.propositions
    .find((one) => one.id === "practice").rounds[0].tally;
  expect(units.supports).toEqual(["Einkauf"]);
  // Reading wrote nothing; a change that is not about stances leaves it be.
  expect(readFileSync(file, "utf8")).toBe(stored);
  await study.patch(`/api/interviews/r2-einkauf/codings/${made.id}`, { memo: "Notiz" });
  expect(JSON.parse(readFileSync(file, "utf8")).codings.find((one) => one.id === made.id).stance).toBe("supports");

  // A stance written folds it in: the older field goes, nothing is lost.
  const folded = await study.patch(`/api/interviews/r2-einkauf/codings/${made.id}`, { stances: { coordination: "contradicts" } });
  expect(folded.json.stances).toEqual({ coordination: "contradicts", practice: "supports" });
  expect(folded.json.stance).toBeUndefined();

  // The older field is still accepted on a write, and becomes `stances`.
  const legacy = await study.patch(`/api/interviews/r2-einkauf/codings/${made.id}`, { stance: "contradicts" });
  expect(legacy.json.stances).toEqual({ coordination: "contradicts", practice: "contradicts" });
  const created = await study.post("/api/interviews/r2-einkauf/codings", {
    turn: 2, start: 0, end: 4, category: "agreement", text: "Ich ", stance: "supports", reviewed: true,
  });
  expect(created.json).toMatchObject({ stances: { coordination: "supports" } });
  expect(created.json.stance).toBeUndefined();

  // Before a unit changes category, its older stance is folded in under the
  // old one — it meant the old category's proposition.
  await study.del(`/api/interviews/r2-einkauf/codings/${created.json.id}`);
  const again = JSON.parse(readFileSync(file, "utf8"));
  const unit = again.codings.find((one) => one.id === made.id);
  delete unit.stances;
  unit.stance = "supports";
  writeFileSync(file, JSON.stringify(again, null, 2) + "\n");
  const moved = await study.patch(`/api/interviews/r2-einkauf/codings/${made.id}`, { category: "agreement" });
  expect(moved.json).toMatchObject({ category: "agreement", stances: { practice: "supports" } });
  expect(moved.json.stance).toBeUndefined();

  // Under a category that argues nothing the older field has nothing to mean:
  // it is not counted for any proposition, refused when sent, and taken away
  // when it is asked to go.
  const inductive = await study.post("/api/categories", { name: "Nebenbei", definition: "Was sonst gesagt wird." });
  expect(inductive.status).toBe(201);
  const other = await study.post("/api/interviews/r2-einkauf/codings", {
    turn: 2, start: 0, end: 4, category: inductive.json.id, text: "Ich ", reviewed: true,
  });
  const stranded = JSON.parse(readFileSync(file, "utf8"));
  stranded.codings.find((one) => one.id === other.json.id).stance = "contradicts";
  writeFileSync(file, JSON.stringify(stranded, null, 2) + "\n");
  const tally = (await study.get("/api/evaluation/propositions")).json.propositions.map((one) => one.rounds[0].tally.contradicts);
  expect(tally.flat()).not.toContain("Einkauf");
  expect((await study.patch(`/api/interviews/r2-einkauf/codings/${other.json.id}`, { stance: "supports" })).json.code).toBe(
    "errorStanceNoTarget",
  );
  const cleared = await study.patch(`/api/interviews/r2-einkauf/codings/${other.json.id}`, { stance: null });
  expect(cleared.json.stance).toBeUndefined();
  await study.del(`/api/interviews/r2-einkauf/codings/${other.json.id}`);
  await study.del(`/api/categories/${inductive.json.id}`);
  await study.del(`/api/interviews/r2-einkauf/codings/${made.id}`);
});

/* Propositions without a claim ------------------------------------------------ */

test("a heading that claims nothing takes no stance and no criteria, and is refused while either depends on it", async () => {
  const added = await study.post("/api/propositions", { name: "Aus Erkenntnisinteressen abgeleitet", color: "#8a9299" });
  const id = added.json.id;
  expect((await study.patch(`/api/propositions/${id}`, { claim: "no" })).json.code).toBe("errorClaimValue");
  const marked = await study.patch(`/api/propositions/${id}`, { claim: false });
  expect(marked.status).toBe(200);
  expect(marked.json.claim).toBe(false);
  const saved = JSON.parse(readFileSync(join(study.folder, "categories.json"), "utf8"));
  expect(saved.propositions[id]).toEqual({ name: "Aus Erkenntnisinteressen abgeleitet", color: "#8a9299", claim: false });

  const unit = await code(study, "r2-marketing", 4, "agreement");
  const refused = await study.patch(`/api/interviews/r2-marketing/codings/${unit.id}?lang=de`, { stances: { [id]: "supports" } });
  expect(refused.status).toBe(400);
  expect(refused.json.error).toBe("„Aus Erkenntnisinteressen abgeleitet“ trägt keine eigene Aussage. Zu ihr nimmt keine Kodiereinheit Stellung.");
  expect((await study.patch(`/api/propositions/${id}`, {
    criteria: [{ verdict: "supported", round: "evaluation", stance: "supports", threshold: { atLeast: 1 } }],
  })).json.code).toBe("errorCriteriaNeedClaim");
  // Nor does the evaluation list it.
  expect((await study.get("/api/evaluation/propositions")).json.propositions.map((one) => one.id)).not.toContain(id);
  expect((await study.patch("/api/propositions/none", { claim: true })).json.code).toBe("errorNoneMakesNoClaim");

  // Back to a claim, a stance on it, and the mark is refused while that stands.
  expect((await study.patch(`/api/propositions/${id}`, { claim: true })).json.claim).toBeUndefined();
  await study.patch(`/api/interviews/r2-marketing/codings/${unit.id}`, { stances: { [id]: "supports" } });
  const inUse = await study.patch(`/api/propositions/${id}?lang=en`, { claim: false });
  expect(inUse.status).toBe(409);
  expect(inUse.json).toMatchObject({ code: "errorClaimInUse", error: "1 coding units stand towards this proposition. Remove their stances first." });
  const dissolve = await study.del(`/api/propositions/${id}`);
  expect(dissolve.status).toBe(409);
  expect(dissolve.json.code).toBe("errorPropositionInUse");

  await study.del(`/api/interviews/r2-marketing/codings/${unit.id}`);
  expect((await study.del(`/api/propositions/${id}`)).status).toBe(204);
});

/* Criteria ----------------------------------------------------------------- */

test("a threshold is a number of persons, and a share is rounded up exactly", () => {
  expect(required({ atLeast: 4 }, 5)).toBe(4);
  expect(required({ fraction: "2/3" }, 5)).toBe(4);
  expect(required({ fraction: "2/3" }, 3)).toBe(2);
  expect(required({ fraction: "1/2" }, 5)).toBe(3);
  expect(required({ fraction: "1/2" }, 4)).toBe(2);
  expect(required({ fraction: 0.5 }, 5)).toBe(3);
  expect(required({ none: true }, 5)).toBe(0);
});

test("criteria are checked against the rounds and categories the study has", async () => {
  const put = (criteria) => study.patch("/api/propositions/practice", { criteria });
  const base = { verdict: "supported", round: "evaluation", categories: ["routine"], threshold: { atLeast: 2 } };
  expect((await put("x")).json.code).toBe("errorCriteriaList");
  expect((await put([{ ...base, verdict: "maybe" }])).json.code).toBe("errorCriterionVerdict");
  expect((await put([{ ...base, round: undefined }])).json.code).toBe("errorCriterionRound");
  expect((await put([{ ...base, round: "nowhere" }])).json.code).toBe("errorUnknownRound");
  // Neither a stance nor a category: it would count everybody who said anything.
  expect((await put([{ ...base, categories: [] }])).json.code).toBe("errorCriterionCategories");
  expect((await put([{ ...base, categories: ["nope"] }])).json.code).toBe("errorUnknownCategory");
  expect((await put([{ ...base, stance: "neutral" }])).json.code).toBe("errorCriterionStance");
  expect((await put([{ ...base, threshold: { atLeast: 0 } }])).json.code).toBe("errorCriterionThreshold");
  expect((await put([{ ...base, threshold: { fraction: "3/2" } }])).json.code).toBe("errorCriterionThreshold");
  expect((await put([{ ...base, threshold: { atLeast: 2, fraction: "1/2" } }])).json.code).toBe(
    "errorCriterionThreshold",
  );
  expect((await put([{ ...base, threshold: { none: false } }])).json.code).toBe("errorCriterionThreshold");
  expect((await put([{ ...base, threshold: undefined }])).json.code).toBe("errorCriterionThreshold");
  expect((await put([{ ...base, kind: "guess" }])).json.code).toBe("errorCriterionKind");
  expect((await put([{ ...base, kind: "manual" }])).json.code).toBe("errorCriterionManualThreshold");
  expect((await put([{ ...base, base: "some" }])).json.code).toBe("errorCriterionBase");
  expect((await study.patch("/api/propositions/practice", { combine: { supported: "most" } })).json.code).toBe("errorCombineValue");
  expect((await study.patch("/api/propositions/practice", { combine: { maybe: "any" } })).json.code).toBe("errorCombineValue");
  // Nothing was written by any of them.
  const saved = JSON.parse(readFileSync(join(study.folder, "categories.json"), "utf8"));
  expect(saved.propositions.practice.criteria).toBeUndefined();
  expect(saved.propositions.practice.combine).toBeUndefined();
});

test("a criterion of 0.12 reads back as it was written", async () => {
  const old = {
    id: "supported-1",
    text: "Mindestens zwei Drittel schildern keinen Mehraufwand.",
    verdict: "supported",
    round: "evaluation",
    categories: ["routine"],
    stance: "supports",
    threshold: { fraction: "2/3" },
  };
  const set = await study.patch("/api/propositions/practice", { criteria: [old] });
  expect(set.json.criteria).toEqual([old]);
  const saved = JSON.parse(readFileSync(join(study.folder, "categories.json"), "utf8"));
  expect(Object.keys(saved.propositions.practice.criteria[0])).toEqual(Object.keys(old));
  await study.patch("/api/propositions/practice", { criteria: [] });
});

test("criteria count persons, not statements, and list the deviant cases with their evidence", async () => {
  /* Marketing says it twice, Vertrieb once, Einkauf not at all — under the
     stance the criterion asks for. Three statements, two persons. */
  await code(study, "r2-marketing", 2, "routine", { stances: { practice: "supports" } });
  await code(study, "r2-marketing", 4, "routine", { stances: { practice: "supports" } });
  await code(study, "r2-vertrieb", 2, "routine", { stances: { practice: "supports" } });
  // Vertrieb also names the interruption; Einkauf says something with no bearing.
  await code(study, "r2-vertrieb", 4, "routine", { stances: { practice: "contradicts" } });
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
  expect(result.map((one) => one.id)).toEqual(["practice", "coordination"]);
  const [supported, falsified] = result[0].criteria;

  // Three persons in the round; two thirds of three is two; two meet it.
  expect(supported).toMatchObject({ persons: 3, required: 2, count: 2, met: true });
  expect(supported.meeting.map((one) => one.department)).toEqual(["Marketing", "Vertrieb"]);
  // Marketing's evidence is all of its statements, and still one person.
  expect(supported.meeting[0].units).toHaveLength(2);
  // Vertrieb said both; it meets the criterion and its contradiction is shown with it.
  expect(supported.meeting[1].opposite.map((unit) => unit.stances.practice)).toEqual(["contradicts"]);
  // The deviant case comes with what it did say in that category.
  expect(supported.deviant).toHaveLength(1);
  expect(supported.deviant[0].department).toBe("Einkauf");
  expect(supported.deviant[0].units.map((unit) => unit.stances)).toEqual([{}]);

  // Half of three is two persons; only Vertrieb names the interruption.
  expect(falsified).toMatchObject({ persons: 3, required: 2, count: 1, met: false });

  expect(result[0].rounds).toEqual([
    expect.objectContaining({ round: "evaluation", status: "supported", persons: 3, testable: 3, uncoded: [], pending: [] }),
  ]);
  expect(result[0].rounds[0].deviant.map((one) => one.department)).toEqual(["Einkauf"]);
  // In persons: two support, one contradicts — Vertrieb counts for both, and
  // stands with the deviant cases whatever the status says.
  expect(result[0].rounds[0].tally).toEqual({
    supports: ["Marketing", "Vertrieb"],
    contradicts: ["Vertrieb"],
    neither: ["Einkauf"],
  });
  expect(result[0].rounds[0].split.map((one) => [one.department, one.supports.length, one.contradicts.length])).toEqual([
    ["Vertrieb", 1, 1],
  ]);
  // A proposition without criteria is still counted in persons.
  expect(result[1]).toMatchObject({ id: "coordination", criteria: [] });
  expect(result[1].rounds[0].status).toBe("open");

  // The first round has no criteria and no stances, so asking for it gives none.
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
  const [practice] = (await study.get("/api/evaluation/propositions")).json.propositions;
  expect(practice.criteria).toEqual([]);
  expect(practice.rounds[0].status).toBe("open");
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
  expect(vertrieb.to.units.map((unit) => unit.stances.practice)).toEqual(["supports", "contradicts"]);

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
