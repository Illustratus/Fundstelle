import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { sidePort } from "./sandbox.mjs";
import { FIRST_ROUND, SECOND_ROUND, code, startStudy, twoRounds } from "./evaluation-study.mjs";

/**
 * Rounds and the interview guide of each.
 *
 * A study that asks the same people twice has two sets of material about one
 * panel. Which interview belongs to which round is the one fact every count of
 * the second round depends on, so it is written down in one place —
 * `study.json` beside the category system — and nowhere else.
 *
 * The first checks are about a study that never asked for any of this: it must
 * read exactly as before, and reading it must not write a file into it.
 */

let study;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  study = await startStudy({ port: sidePort(4176) });
});

test.afterAll(() => study?.stop());

const file = () => join(study.folder, "study.json");

test("a study without rounds reads as it always did, and reading writes nothing", async () => {
  const rounds = await study.get("/api/rounds");
  expect(rounds.status).toBe(200);
  expect(rounds.json).toEqual({ rounds: [] });

  const interviews = await study.get("/api/interviews");
  expect(interviews.json).toHaveLength(7);
  expect(interviews.json.every((one) => one.round === null)).toBe(true);

  // The analysis counts every interview, as it always has.
  const analysis = await study.get("/api/analysis");
  expect(analysis.status).toBe(200);
  expect(analysis.json.progress).toHaveLength(7);

  expect((await study.get("/api/sessions")).json).toEqual({ sessions: [] });
  expect(existsSync(file()), "nothing asked for rounds, so there is no file").toBe(false);
});

test("the first round is where every existing interview falls", async () => {
  const made = await study.post("/api/rounds", { name: "Anforderungserhebung", id: "requirements" });
  expect(made.status).toBe(201);
  expect(made.json).toEqual({ id: "requirements", name: "Anforderungserhebung" });

  const rounds = (await study.get("/api/rounds")).json.rounds;
  expect(rounds[0].interviews).toHaveLength(7);
  // Nothing was assigned: the file holds the round and no assignment lines.
  expect(JSON.parse(readFileSync(file(), "utf8"))).toEqual({
    version: 1,
    rounds: [{ id: "requirements", name: "Anforderungserhebung" }],
    assignments: {},
  });
});

test("a second round takes the interviews it is given, and no others", async () => {
  const made = await study.post("/api/rounds", { name: "Evaluation" });
  expect(made.json.id).toBe("evaluation");

  const assigned = await study.post("/api/rounds/evaluation/assign", {
    interviews: Object.keys(SECOND_ROUND),
  });
  expect(assigned.status).toBe(200);

  const rounds = (await study.get("/api/rounds")).json.rounds;
  expect(rounds.map((one) => one.interviews)).toEqual([
    Object.keys(FIRST_ROUND).sort(),
    Object.keys(SECOND_ROUND).sort(),
  ]);
  const listed = (await study.get("/api/interviews")).json;
  expect(listed.find((one) => one.id === "r2-vertrieb").round).toBe("evaluation");
  expect(listed.find((one) => one.id === "r1-vertrieb").round).toBe("requirements");
});

test("a round is refused what it cannot hold", async () => {
  expect((await study.post("/api/rounds", { name: "" })).json.code).toBe("errorRoundName");
  expect((await study.post("/api/rounds", { name: "Evaluation" })).json.code).toBe("errorRoundExists");
  expect((await study.post("/api/rounds/nowhere/assign", { interviews: ["r1-lager"] })).status).toBe(404);
  const notAFolder = await study.post("/api/rounds/evaluation/assign", { interviews: ["no-such"] });
  expect(notAFolder.status).toBe(404);
  expect(notAFolder.json.code).toBe("errorUnknownInterview");
  expect((await study.post("/api/rounds/evaluation/assign", { interviews: "r1-lager" })).json.code).toBe(
    "errorInterviewList",
  );
});

test("a round somebody belongs to cannot be removed; an empty one can", async () => {
  const refused = await study.del("/api/rounds/evaluation");
  expect(refused.status).toBe(409);
  expect(refused.json.code).toBe("errorRoundInUse");
  // Worded in the language asked for, with the number in it.
  expect((await study.del("/api/rounds/evaluation?lang=en")).json.error).toContain("3 interviews");
  expect((await study.del("/api/rounds/evaluation?lang=de")).json.error).toContain("3 Interviews");

  await study.post("/api/rounds", { name: "Leer" });
  expect((await study.del("/api/rounds/leer")).status).toBe(204);
  expect((await study.get("/api/rounds")).json.rounds.map((one) => one.id)).toEqual([
    "requirements",
    "evaluation",
  ]);
});

test("a round can be renamed, and its id stays", async () => {
  const renamed = await study.patch("/api/rounds/evaluation", { name: "Evaluationsrunde" });
  expect(renamed.json).toEqual({ id: "evaluation", name: "Evaluationsrunde" });
  await study.patch("/api/rounds/evaluation", { name: "Evaluation" });
});

test("?round= counts one round, and an unknown one is said to be unknown", async () => {
  const first = await study.get("/api/analysis?round=requirements");
  expect(first.json.progress.map((one) => one.interview).sort()).toEqual(Object.keys(FIRST_ROUND).sort());
  const second = await study.get("/api/interviews?round=evaluation");
  expect(second.json.map((one) => one.id).sort()).toEqual(Object.keys(SECOND_ROUND).sort());

  await code(study, "r1-lager", 2, "routine");
  const matrix = await study.get("/api/export/matrix.md?round=evaluation&lang=de");
  expect(matrix.status).toBe(200);
  // The department the second round could not reach is not in its table.
  expect(matrix.text).not.toContain("Lager");
  expect((await study.get("/api/export/matrix.md?round=requirements&lang=de")).text).toContain("Lager");

  const unknown = await study.get("/api/analysis?round=nowhere");
  expect(unknown.status).toBe(404);
  expect(unknown.json.code).toBe("errorUnknownRound");
});

test("a renamed interview keeps its round; a removed one takes its line along", async () => {
  const renamed = await study.post("/api/interviews/r2-einkauf/rename", { to: "r2-einkauf-b" });
  expect(renamed.json.id).toBe("r2-einkauf-b");
  let saved = JSON.parse(readFileSync(file(), "utf8"));
  expect(saved.assignments["r2-einkauf-b"]).toBe("evaluation");
  expect(saved.assignments["r2-einkauf"]).toBeUndefined();

  await study.post("/api/interviews/r2-einkauf-b/rename", { to: "r2-einkauf" });
  saved = JSON.parse(readFileSync(file(), "utf8"));
  expect(saved.assignments["r2-einkauf"]).toBe("evaluation");
  // Written sorted, so a diff of the file reads as the change it is.
  expect(Object.keys(saved.assignments)).toEqual([...Object.keys(saved.assignments)].sort());
});

/* The guide ---------------------------------------------------------------- */

const GUIDE = {
  blocks: [
    { name: "Warmfrage", prompt: "Wie geht es Ihnen mit dem Werkzeug?" },
    {
      name: "1 · Ablage (Wissen festhalten)",
      prompt: "Erzählen Sie, wie Sie zuletzt etwas festgehalten haben.",
      checklist: [
        { text: "Bestätigungsschritt", tag: "Erwarteter Aufwand" },
        "Ablageort",
      ],
      mandatory: [{ text: "Wie lief das über den Bibliothekar?", condition: "falls über ihn abgelegt" }],
    },
    {
      name: "5 · Systemlandschaft",
      prompt: "Welche Systeme durchsuchen Sie noch von Hand?",
      readout: {
        label: "Im ersten Gespräch genannte Systeme",
        perDepartment: { Vertrieb: ["Postfach", "Laufwerk"], Marketing: ["Ordner A", "Chat"] },
      },
    },
  ],
};

test("a guide is written whole, and every block and item gets an id", async () => {
  const empty = await study.get("/api/rounds/evaluation/guide");
  expect(empty.json).toEqual({ round: "evaluation", name: "Evaluation", blocks: [] });

  const written = await study.put("/api/rounds/evaluation/guide", GUIDE);
  expect(written.status).toBe(200);
  const blocks = written.json.blocks;
  expect(blocks.map((one) => one.id)).toEqual([
    "warmfrage",
    "1-ablage-wissen-festhalten",
    "5-systemlandschaft",
  ]);
  const ablage = blocks[1];
  expect(ablage.checklist.map((one) => one.text)).toEqual(["Bestätigungsschritt", "Ablageort"]);
  expect(ablage.checklist[0].tag).toBe("Erwarteter Aufwand");
  // A keyword without a tag carries no empty tag.
  expect("tag" in ablage.checklist[1]).toBe(false);
  expect(ablage.mandatory[0].condition).toBe("falls über ihn abgelegt");
  for (const item of [...ablage.checklist, ...ablage.mandatory]) expect(item.id).toMatch(/^[cm]-[0-9a-f]{8}$/);

  // Written again with its ids, nothing changes.
  const again = await study.put("/api/rounds/evaluation/guide", written.json);
  expect(again.json.blocks).toEqual(blocks);
  expect((await study.get("/api/rounds")).json.rounds[1].blocks).toBe(3);
});

test("a guide that does not hold together is refused", async () => {
  expect((await study.put("/api/rounds/evaluation/guide", { blocks: "no" })).json.code).toBe("errorGuideShape");
  expect((await study.put("/api/rounds/evaluation/guide", { blocks: [{ prompt: "?" }] })).json.code).toBe(
    "errorBlockName",
  );
  const twice = await study.put("/api/rounds/evaluation/guide", {
    blocks: [{ name: "A", checklist: [{ id: "x", text: "a" }, { id: "x", text: "b" }] }],
  });
  expect(twice.json.code).toBe("errorGuideDuplicateId");
  const readout = await study.put("/api/rounds/evaluation/guide", {
    blocks: [{ name: "A", readout: { perDepartment: { Vertrieb: "Postfach" } } }],
  });
  expect(readout.json.code).toBe("errorReadoutShape");
  expect((await study.put("/api/rounds/nowhere/guide", GUIDE)).status).toBe(404);
  // Nothing was written by any of them.
  expect((await study.get("/api/rounds/evaluation/guide")).json.blocks).toHaveLength(3);
});

test("a block is added, changed, moved and removed on its own", async () => {
  const added = await study.post("/api/rounds/evaluation/guide/blocks", {
    name: "8 · Abschluss",
    prompt: "Möchten Sie noch etwas ergänzen?",
  });
  expect(added.status).toBe(201);
  expect(added.json.id).toBe("8-abschluss");

  const before = (await study.get("/api/rounds/evaluation/guide")).json.blocks[1];
  const [kept] = before.checklist;
  const changed = await study.patch("/api/rounds/evaluation/guide/blocks/1-ablage-wissen-festhalten", {
    name: "1 · Ablage (Wissen festhalten, neu)",
    checklist: [{ ...kept, text: "Bestätigungsschritt (Dauer)" }, { text: "Rückfrage", tag: "Gegenprobe" }],
  });
  expect(changed.status).toBe(200);
  // The block keeps its id when renamed; the reworded item keeps its id; the
  // new one gets its own; the one left out is gone.
  expect(changed.json.id).toBe("1-ablage-wissen-festhalten");
  expect(changed.json.checklist[0].id).toBe(kept.id);
  expect(changed.json.checklist[0].text).toBe("Bestätigungsschritt (Dauer)");
  expect(changed.json.checklist[1].id).not.toBe(before.checklist[1].id);
  expect(changed.json.mandatory).toEqual(before.mandatory);

  const moved = await study.patch("/api/rounds/evaluation/guide/blocks/8-abschluss", { position: 0 });
  expect(moved.status).toBe(200);
  expect((await study.get("/api/rounds/evaluation/guide")).json.blocks[0].id).toBe("8-abschluss");
  await study.patch("/api/rounds/evaluation/guide/blocks/8-abschluss", { position: 99 });
  expect((await study.get("/api/rounds/evaluation/guide")).json.blocks.at(-1).id).toBe("8-abschluss");

  expect((await study.del("/api/rounds/evaluation/guide/blocks/8-abschluss")).status).toBe(204);
  expect((await study.del("/api/rounds/evaluation/guide/blocks/8-abschluss")).json.code).toBe(
    "errorUnknownBlock",
  );
  expect((await study.patch("/api/rounds/evaluation/guide/blocks/1-ablage-wissen-festhalten", { name: " " })).json.code).toBe(
    "errorBlockName",
  );
});

test("what the material refers to cannot be dropped from the guide", async () => {
  const guide = (await study.get("/api/rounds/evaluation/guide")).json;
  const ablage = guide.blocks.find((one) => one.id === "1-ablage-wissen-festhalten");
  const question = ablage.mandatory[0];

  // A coding unit in the second round names the question it answers.
  await code(study, "r2-vertrieb", 2, "routine", { question: question.id });
  const dropped = await study.patch("/api/rounds/evaluation/guide/blocks/1-ablage-wissen-festhalten", {
    mandatory: [],
  });
  expect(dropped.status).toBe(409);
  expect(dropped.json.code).toBe("errorGuideItemInUse");
  expect((await study.del("/api/rounds/evaluation/guide/blocks/1-ablage-wissen-festhalten")).json.code).toBe(
    "errorGuideItemInUse",
  );
  // Reworded is fine.
  const reworded = await study.patch("/api/rounds/evaluation/guide/blocks/1-ablage-wissen-festhalten", {
    mandatory: [{ ...question, text: "Wie lief die Ablage über den Bibliothekar?" }],
  });
  expect(reworded.status).toBe(200);

  // A question of another round's guide, or none at all, is refused on the unit.
  const unknown = await study.post("/api/interviews/r1-vertrieb/codings", {
    turn: 4,
    start: 0,
    end: 3,
    category: "routine",
    text: "Mit",
    question: question.id,
  });
  expect(unknown.status).toBe(404);
  expect(unknown.json.code).toBe("errorUnknownGuideItem");
});
