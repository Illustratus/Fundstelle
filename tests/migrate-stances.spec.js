import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { sidePort } from "./sandbox.mjs";
import { code, startStudy, twoRounds } from "./evaluation-study.mjs";
import { migrationPlan, normalName, propositionMatcher, stancesInMemo } from "../lib/memo-stances.js";

/**
 * Stances written into memos before the field existed, moved into the field.
 *
 * The study this was built for began coding its evaluation round with a
 * sentence in the memo — "Stufe je Proposition: Konversationsprinzip stützt."
 * — and the tool has to carry those over without changing anything else and
 * without reading anything into a memo that it does not say. What is checked:
 * only sentences of that form count (a memo that says "if so, it supports …"
 * does not); "(Grenzfall)" is a note and the stance holds; a name is matched to
 * exactly one proposition or the run stops; a dry run writes nothing; a real
 * run writes `stances` and leaves memo and review mark as they were; a second
 * run writes nothing; and a unit that already says otherwise is never
 * overwritten.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TOOL = join(ROOT, "tools", "migrate-stances.mjs");

const PROPOSITIONS = {
  konversation: { name: "Konversationsprinzip", color: "#6c8ebf" },
  struktur: { name: "Struktur als Implementierungsdetail", color: "#9673a6" },
  transparenz: { name: "Transparenz auf Abruf", color: "#d79b00" },
  keine: { name: "Aus Erkenntnisinteressen abgeleitet", color: "#8a9299", claim: false },
  none: { name: "Aus dem Erkenntnisinteresse abgeleitet", color: "#8a9299" },
};

test("only the marked sentence is read, item by item, and a borderline case keeps its stance", () => {
  expect(stancesInMemo("Erster Entwurf traf. Stufe je Proposition: Konversationsprinzip stützt.").found).toEqual([
    { name: "Konversationsprinzip", stance: "supports", borderline: false },
  ]);
  expect(stancesInMemo("Stufe je Proposition: Konversationsprinzip widerspricht (Grenzfall).").found).toEqual([
    { name: "Konversationsprinzip", stance: "contradicts", borderline: true },
  ]);
  expect(
    stancesInMemo("Stufe je Proposition: Konversationsprinzip stützt, Transparenz-auf-Abruf-Prinzip widerspricht (Grenzfall). Rest.")
      .found,
  ).toEqual([
    { name: "Konversationsprinzip", stance: "supports", borderline: false },
    { name: "Transparenz-auf-Abruf-Prinzip", stance: "contradicts", borderline: true },
  ]);
  expect(stancesInMemo("Stance per proposition: Conversation principle supports.").found).toEqual([
    { name: "Conversation principle", stance: "supports", borderline: false },
  ]);
  // Said conditionally, or about something else: no stance.
  expect(stancesInMemo("Wenn ja, stützt es das Struktur-als-Implementierungsdetail-Prinzip.")).toEqual({ found: [], unreadable: [] });
  expect(stancesInMemo("Fremdbericht, zählt nicht als Stufe der befragten Person.")).toEqual({ found: [], unreadable: [] });
  // Marked but not of the form: said, not guessed.
  expect(stancesInMemo("Stufe je Proposition: Konversationsprinzip eher stützend.").unreadable).toEqual([
    "Konversationsprinzip eher stützend",
  ]);
});

test("a name means one proposition with a claim, or the plan says why not", () => {
  expect(normalName("Transparenz-auf-Abruf-Prinzip")).toBe(normalName("Transparenz auf Abruf"));
  expect(normalName("Struktur-als-Implementierungsdetail-Prinzip")).toBe(normalName("Struktur als Implementierungsdetail"));
  const match = propositionMatcher(PROPOSITIONS);
  expect(match("Konversationsprinzip")).toEqual({ id: "konversation" });
  expect(match("Transparenz-auf-Abruf-Prinzip")).toEqual({ id: "transparenz" });
  expect(match("struktur")).toEqual({ id: "struktur" });
  // A heading without a claim is no proposition to stand towards.
  expect(match("Aus Erkenntnisinteressen abgeleitet")).toMatchObject({ problem: "unknown" });
  expect(match("Verständlichkeitsprinzip")).toMatchObject({ problem: "unknown" });
  expect(propositionMatcher(PROPOSITIONS, { Verständlichkeitsprinzip: "struktur" })("Verständlichkeitsprinzip")).toEqual({ id: "struktur" });
  const twins = { a: { name: "Prinzip A" }, b: { name: "Prinzip-A" } };
  expect(propositionMatcher(twins)("Prinzip A")).toEqual({ problem: "ambiguous", ids: ["a", "b"] });

  const plan = migrationPlan({
    propositions: PROPOSITIONS,
    interviews: [
      {
        id: "eval",
        codings: [
          { id: "1", turn: 8, category: "ablage", memo: "Stufe je Proposition: Konversationsprinzip stützt." },
          { id: "2", turn: 10, category: "ablage", memo: "Stufe je Proposition: Konversationsprinzip stützt, Konversationsprinzip widerspricht." },
          { id: "3", turn: 12, category: "ablage", memo: "Stufe je Proposition: Konversationsprinzip stützt.", stances: { konversation: "supports" } },
          { id: "4", turn: 14, category: "ablage", memo: "Stufe je Proposition: Konversationsprinzip stützt.", stances: { konversation: "contradicts" } },
          { id: "5", turn: 16, category: "ablage", memo: "Keine Stufe." },
        ],
      },
    ],
  });
  expect(plan.units.map((one) => [one.id, one.state, one.write])).toEqual([
    ["1", "write", { konversation: "supports" }],
    ["2", "write", { konversation: "supports" }],
    ["3", "unchanged", {}],
    ["4", "conflict", {}],
  ]);
  expect(plan.problems.map((one) => [one.id, one.kind])).toEqual([
    ["2", "twice"],
    ["4", "conflict"],
  ]);
});

/* The script, against a running server ---------------------------------------- */

let study;

test.describe("the script", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    study = await startStudy({ port: sidePort(4156) });
    await twoRounds(study);
    await study.post("/api/propositions", { name: "Konversationsprinzip", color: "#6c8ebf" });
    await study.post("/api/propositions", { name: "Transparenz auf Abruf", color: "#d79b00" });
  });

  test.afterAll(() => study?.stop());

  const run = (...args) =>
    spawnSync(process.execPath, [TOOL, "--base", study.base, "--lang", "de", ...args], { encoding: "utf8" });
  const file = (interview) => join(study.transcripts, interview, "coding.json");

  test("a dry run says what it would write and writes nothing; the run writes stances and nothing else", async () => {
    await code(study, "r2-marketing", 2, "routine", { memo: "Struktur entsteht von selbst. Stufe je Proposition: Konversationsprinzip stützt." });
    await code(study, "r2-marketing", 4, "agreement", {
      memo: "Grenzfall. Stufe je Proposition: Konversationsprinzip widerspricht (Grenzfall), Transparenz-auf-Abruf-Prinzip stützt.",
      reviewed: false,
    });
    await code(study, "r2-vertrieb", 2, "routine", { memo: "Wenn ja, stützt es das Konversationsprinzip." });
    const before = { marketing: readFileSync(file("r2-marketing"), "utf8"), vertrieb: readFileSync(file("r2-vertrieb"), "utf8") };

    const usage = spawnSync(process.execPath, [TOOL, "--lang", "en"], { encoding: "utf8" });
    expect(usage.status).toBe(1);
    expect(usage.stdout).toContain("--dry-run");

    const dry = run("--round", "evaluation", "--dry-run");
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toContain("r2-marketing · Beitrag 4 · agreement: Konversationsprinzip widerspricht (Grenzfall), Transparenz auf Abruf stützt");
    expect(dry.stdout).toContain("Kodiereinheiten mit einer Stufe im Memo: 2.");
    expect(dry.stdout).toContain("  Konversationsprinzip stützt: 1 (davon Grenzfall: 0)");
    expect(dry.stdout).toContain("  Konversationsprinzip widerspricht: 1 (davon Grenzfall: 1)");
    expect(dry.stdout).toContain("Trockenlauf: nichts geschrieben.");
    expect(dry.stdout).not.toContain("r2-vertrieb");
    expect(readFileSync(file("r2-marketing"), "utf8")).toBe(before.marketing);

    const real = run("--interview", "r2-marketing", "--interview", "r2-vertrieb");
    expect(real.status, real.stderr).toBe(0);
    expect(real.stdout).toContain("Geschrieben: 2 Kodiereinheiten.");
    const after = JSON.parse(readFileSync(file("r2-marketing"), "utf8")).codings;
    const earlier = JSON.parse(before.marketing).codings;
    expect(after.map((one) => one.stances)).toEqual([
      { konversationsprinzip: "supports" },
      { konversationsprinzip: "contradicts", "transparenz-auf-abruf": "supports" },
    ]);
    // Memo, review mark and every other field as they were.
    expect(after.map(({ stances, ...rest }) => rest)).toEqual(earlier);
    expect(after[1].reviewed).toBe(false);
    expect(readFileSync(file("r2-vertrieb"), "utf8")).toBe(before.vertrieb);

    // A second run finds everything in place and writes nothing.
    const settled = readFileSync(file("r2-marketing"), "utf8");
    const again = run("--interview", "r2-marketing");
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("Zu schreiben: 0 Kodiereinheiten. Schon gesetzt: 2.");
    expect(readFileSync(file("r2-marketing"), "utf8")).toBe(settled);
  });

  test("what cannot be read without a guess stops the whole run before the first write", async () => {
    await code(study, "r2-einkauf", 2, "routine", { memo: "Stufe je Proposition: Verständlichkeitsprinzip stützt." });
    await code(study, "r2-einkauf", 4, "routine", { memo: "Stufe je Proposition: Konversationsprinzip stützt." });
    const before = readFileSync(file("r2-einkauf"), "utf8");

    const stopped = run("--interview", "r2-einkauf");
    expect(stopped.status).toBe(1);
    expect(stopped.stderr).toContain(
      "r2-einkauf · Beitrag 2: „Verständlichkeitsprinzip“ ist keine Proposition mit eigener Aussage. Mit --map \"Verständlichkeitsprinzip=<id>\" zuordnen.",
    );
    expect(stopped.stderr).toContain("Nichts geschrieben");
    // Not even the unit that could have been read.
    expect(readFileSync(file("r2-einkauf"), "utf8")).toBe(before);

    // Settled by naming it.
    const mapped = run("--interview", "r2-einkauf", "--map", "Verständlichkeitsprinzip=konversationsprinzip");
    expect(mapped.status, mapped.stderr).toBe(0);
    expect(JSON.parse(readFileSync(file("r2-einkauf"), "utf8")).codings.map((one) => one.stances)).toEqual([
      { konversationsprinzip: "supports" },
      { konversationsprinzip: "supports" },
    ]);

    // A unit that already says otherwise is not overwritten.
    const units = JSON.parse(readFileSync(file("r2-einkauf"), "utf8")).codings;
    await study.patch(`/api/interviews/r2-einkauf/codings/${units[1].id}`, { stances: { konversationsprinzip: "contradicts" } });
    const kept = readFileSync(file("r2-einkauf"), "utf8");
    const conflict = run("--interview", "r2-einkauf", "--map", "Verständlichkeitsprinzip=konversationsprinzip", "--lang", "en");
    expect(conflict.status).toBe(1);
    expect(conflict.stderr).toContain(
      "“Konversationsprinzip” already carries the stance “contradicts”, the memo says “supports”. Nothing overwritten.",
    );
    expect(readFileSync(file("r2-einkauf"), "utf8")).toBe(kept);
  });
});
