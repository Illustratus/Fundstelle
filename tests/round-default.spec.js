import { expect, test } from "@playwright/test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { sidePort } from "./sandbox.mjs";
import { FIRST_ROUND, SECOND_ROUND, code, startStudy } from "./evaluation-study.mjs";

/**
 * The numbers of the first round stay what they were when a second arrives.
 *
 * The first round's cross table, catalog and citations are already written
 * into the thesis by the time the second round is interviewed. Counting
 * surfaces used to answer for the whole study when no `?round=` was given — so
 * importing the second round silently changed every one of those numbers. Once
 * a study has two rounds, they now count the first unless asked otherwise;
 * `round=all` asks for everything on purpose. Without rounds nothing changes.
 */

let study;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  // The first round only, as the study stood before the second was planned.
  study = await startStudy({ port: sidePort(4151), interviews: FIRST_ROUND });
});

test.afterAll(() => study?.stop());

/** Every surface that counts or quotes, as a reader of the thesis would quote it. */
const SURFACES = [
  "/api/export/matrix.md?lang=de",
  "/api/export/analysis.md?lang=de",
  "/api/export/citations.md?lang=de",
  "/api/export/coding-guide.md?lang=de",
  "/api/export/sample.md?lang=de",
  "/api/export/notes.md?lang=de",
  "/api/export/requirements-catalog.md?lang=de",
  "/api/figures/categories.svg?lang=de",
  "/api/figures/heatmap.svg?lang=de",
];

async function snapshot() {
  const taken = {};
  for (const path of SURFACES) taken[path] = (await study.get(path)).text;
  const analysis = (await study.get("/api/analysis")).json;
  taken.analysis = { total: analysis.total, departments: analysis.departments, rows: analysis.rows };
  const requirements = (await study.get("/api/requirements")).json;
  taken.requirements = { departments: requirements.departments, rows: requirements.requirements };
  return taken;
}

let before;

test("without rounds, every surface counts the whole study and nothing is written", async () => {
  await code(study, "r1-vertrieb", 2, "routine");
  await code(study, "r1-lager", 2, "routine");
  await code(study, "r1-marketing", 4, "agreement");
  const requirement = await study.post("/api/requirements", { title: "Ablage an einem Ort" });
  const units = (await study.get("/api/interviews/r1-vertrieb")).json.codings;
  await study.patch(`/api/interviews/r1-vertrieb/codings/${units[0].id}`, {
    requirements: [requirement.json.id],
  });

  before = await snapshot();
  expect(before.analysis.total).toBe(3);
  expect(before.analysis.departments).toEqual(["Einkauf", "Lager", "Marketing", "Vertrieb"]);
  // `all` is the same thing said out loud.
  expect((await study.get("/api/analysis?round=all")).json.total).toBe(3);
  expect(existsSync(join(study.folder, "study.json")), "reading made no study file").toBe(false);
});

test("a first round alone changes nothing either", async () => {
  await study.post("/api/rounds", { name: "Anforderungserhebung", id: "requirements" });
  expect(await snapshot()).toEqual(before);
});

test("once a second round is imported, the first round's numbers stay exactly as they were", async () => {
  // The second round arrives: folders on disk, a round, the assignment, codings.
  for (const [id, text] of Object.entries(SECOND_ROUND)) {
    mkdirSync(join(study.transcripts, id), { recursive: true });
    writeFileSync(join(study.transcripts, id, "final.md"), text);
  }
  await study.post("/api/rounds", { name: "Evaluation", id: "evaluation" });
  await study.post("/api/rounds/evaluation/assign", { interviews: Object.keys(SECOND_ROUND) });
  await code(study, "r2-vertrieb", 2, "routine", { stances: { practice: "supports" } });
  await code(study, "r2-marketing", 2, "routine", { stances: { practice: "supports" } });
  await code(study, "r2-marketing", 4, "agreement");
  const requirementId = (await study.get("/api/requirements")).json.requirements[0].id;
  const later = (await study.get("/api/interviews/r2-vertrieb")).json.codings;
  await study.patch(`/api/interviews/r2-vertrieb/codings/${later[0].id}`, { requirements: [requirementId] });

  // Byte for byte: every export, every figure, every count.
  const after = await snapshot();
  for (const path of SURFACES) expect(after[path], path).toBe(before[path]);
  expect(after.analysis).toEqual(before.analysis);
  expect(after.requirements).toEqual(before.requirements);
  // And it is the first round by name, not by accident.
  expect((await study.get("/api/export/matrix.md?round=requirements&lang=de")).text).toBe(
    before["/api/export/matrix.md?lang=de"],
  );
});

test("the whole study and the second round are there when asked for", async () => {
  const all = (await study.get("/api/analysis?round=all")).json;
  expect(all.total).toBe(6);
  expect(all.progress).toHaveLength(7);
  const second = (await study.get("/api/analysis?round=evaluation")).json;
  expect(second.total).toBe(3);
  expect(second.departments).toEqual(["Einkauf", "Marketing", "Vertrieb"]);
  expect((await study.get("/api/export/matrix.md?round=all&lang=de")).text).not.toBe(
    before["/api/export/matrix.md?lang=de"],
  );
  // The catalog of both rounds counts the requirement's evidence from both.
  const catalog = (await study.get("/api/requirements?round=all")).json.requirements[0];
  expect(catalog.citations).toHaveLength(2);
  expect((await study.get("/api/analysis?round=nowhere")).status).toBe(404);
});

test("the interview list is a list, not a count: every interview, each with its round", async () => {
  const listed = (await study.get("/api/interviews")).json;
  expect(listed).toHaveLength(7);
  expect(listed.find((one) => one.id === "r2-vertrieb").round).toBe("evaluation");
  expect((await study.get("/api/interviews?round=all")).json).toHaveLength(7);
  expect((await study.get("/api/interviews?round=evaluation")).json).toHaveLength(3);
});
