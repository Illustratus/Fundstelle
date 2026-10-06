import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sidePort } from "./sandbox.mjs";
import { code, startStudy, twoRounds } from "./evaluation-study.mjs";

/**
 * The second round, as documents: panel, criteria, guide questions, read-out.
 *
 * Three promises are checked here. A number in an export is the number the
 * screen got from the API, because both are written from one computation. A
 * criterion counts persons, so a department saying a thing twice is still one.
 * And no export lets a reader work out which department the second round did
 * not reach — "Lager" was asked in the first round, carries codings and even a
 * read-out list, and must appear in none of the four documents.
 */

let study;

test.describe.configure({ mode: "serial" });

const EXPORTS = [
  "/api/export/evaluation-panel.md",
  "/api/export/evaluation-panel.md?category=routine",
  "/api/export/evaluation-readout.md",
  "/api/export/evaluation-propositions.md",
  "/api/export/evaluation-tags.md",
];

/**
 * The cells of a grid table, read back: one array per body row, each cell's
 * lines joined by a space. Column edges are where the rule line has its `+`.
 */
function gridCells(markdown) {
  const lines = markdown.split("\n");
  const rows = [];
  let edges = null;
  let current = null;
  let header = true;
  for (const line of lines) {
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
  study = await startStudy({ port: sidePort(4152) });
});

test.afterAll(() => study?.stop());

test("with one round there is nothing to compare, and the exports say so as an error", async () => {
  const panel = await study.get("/api/export/evaluation-panel.md?lang=en");
  expect(panel.status).toBe(409);
  expect(panel.json.code).toBe("errorPanelNeedsTwoRounds");
  expect((await study.get("/api/export/evaluation-readout.md")).status).toBe(409);
  expect((await study.get("/api/export/evaluation-tags.md")).json.code).toBe("errorRoundRequired");
});

test("the study of the second round is filled", async () => {
  await twoRounds(study);
  await study.put("/api/rounds/evaluation/guide", {
    blocks: [
      {
        id: "systeme",
        name: "5 · Systemlandschaft",
        readout: {
          label: "Systeme",
          perDepartment: { Vertrieb: ["Postfach", "Laufwerk", "Telefon"], Lager: ["Zettelwand"] },
        },
      },
      {
        id: "schluss",
        name: "7 · Konkrete Fragen zum Schluss",
        mandatory: [
          { id: "m-aufwand", text: "Kostet das Ablegen Zeit?", tag: "Erwarteter Aufwand" },
          { id: "m-frei", text: "Sonst noch etwas?" },
        ],
      },
    ],
  });
  // Round one: Lager speaks, as everybody else does.
  await code(study, "r1-vertrieb", 2, "routine");
  await code(study, "r1-lager", 2, "routine");
  await code(study, "r1-lager", 4, "agreement");
  // Round two: Marketing twice under the stance, Vertrieb once (plus one
  // against, still a suggestion), Einkauf neutral.
  await code(study, "r2-marketing", 2, "routine", { stance: "supports", question: "m-aufwand" });
  await code(study, "r2-marketing", 4, "routine", { stance: "supports" });
  await code(study, "r2-vertrieb", 2, "routine", { stance: "supports", question: "m-frei" });
  await code(study, "r2-vertrieb", 4, "routine", { stance: "contradicts", reviewed: false });
  await code(study, "r2-einkauf", 2, "routine");
  await study.patch("/api/propositions/practice", {
    criteria: [
      {
        text: "Mindestens zwei Drittel schildern keinen Mehraufwand.",
        verdict: "supported",
        round: "evaluation",
        categories: ["routine"],
        stance: "supports",
        threshold: { fraction: "2/3" },
      },
      { verdict: "falsified", round: "evaluation", categories: ["routine"], stance: "contradicts", threshold: { atLeast: 1 } },
    ],
  });
  await study.post("/api/sessions", { department: "Vertrieb", round: "evaluation", folder: "r2-vertrieb" });
  await study.patch("/api/sessions/r2-vertrieb", { op: "readout", block: "systeme", item: "Postfach", state: "still" });
  await study.patch("/api/sessions/r2-vertrieb", { op: "readout", block: "systeme", item: "Laufwerk", state: "no-longer" });
});

test("the panel export prints what the panel answers, cell by cell", async () => {
  const panel = (await study.get("/api/evaluation/panel?category=routine")).json;
  const de = await study.get("/api/export/evaluation-panel.md?category=routine&lang=de");
  expect(de.status).toBe(200);
  expect(de.text).toContain("# Vorher und nachher: Anforderungserhebung und Evaluation");
  const row = panel.categories[0];
  const before = row.cells.reduce((n, one) => n + one.from.count, 0);
  const after = row.cells.reduce((n, one) => n + one.to.count, 0);
  expect(de.text).toContain(`## Arbeitsalltag · ${before} → ${after}`);
  expect([before, after]).toEqual([1, 5]);
  // Every quotation stands in its department's row, in the column of its round.
  const cells = gridCells(de.text);
  for (const cell of row.cells) {
    const printed = cells.find((one) => one[0] === cell.department);
    expect(printed, cell.department).toBeTruthy();
    expect(printed[1]).toContain(`Kodiereinheiten: ${cell.from.count}`);
    expect(printed[2]).toContain(`Kodiereinheiten: ${cell.to.count}`);
    for (const unit of cell.from.units) expect(printed[1]).toContain(unit.text.trim());
    for (const unit of cell.to.units) expect(printed[2]).toContain(unit.text.trim());
  }
  expect(de.text).toContain("[widerspricht]");
  expect(de.text).toContain("**[ungeprüft]**");
  // A grid table, at the width the other exports use.
  const table = de.text.split("\n").filter((line) => /^[+|]/.test(line));
  expect(table.length).toBeGreaterThan(5);
  expect(new Set(table.map((line) => line.length)).size).toBe(1);
  expect(table[0].length).toBeLessThanOrEqual(80);

  const en = await study.get("/api/export/evaluation-panel.md?category=routine&lang=en");
  expect(en.text).toContain("# Before and after: Anforderungserhebung and Evaluation");
  expect(en.text).toContain("Coding units: 2");
  expect(en.text).toContain("[contradicts]");
  expect(en.text).not.toContain("Kodiereinheiten");

  // Without a category: every category with something in it, and only those.
  const all = (await study.get("/api/export/evaluation-panel.md?lang=de")).text;
  expect(all).toContain("## Arbeitsalltag");
  expect(all).toContain("Kategorien ohne Kodiereinheit in beiden Runden sind ausgelassen.");
  expect(all).not.toContain("## Absprachen");
  expect((await study.get("/api/export/evaluation-panel.md?category=nope")).status).toBe(404);
});

test("criteria count persons, not statements, in the export as on the API", async () => {
  const api = (await study.get("/api/evaluation/propositions")).json.propositions[0];
  const [supported, falsified] = api.criteria;
  expect(supported).toMatchObject({ persons: 3, required: 2, count: 2, met: true });
  const de = (await study.get("/api/export/evaluation-propositions.md?lang=de")).text;
  // Marketing said it twice and is one person: two of three, not three.
  const rows = gridCells(de);
  expect(rows.find((one) => one[1] === "Stützung").slice(2)).toEqual(["2 von 3, nötig 2", "ja"]);
  expect(rows.find((one) => one[1] === "Falsifikation").slice(2)).toEqual(["1 von 3, nötig 1", "ja"]);
  expect(de).toContain("#### Erfüllt: 2 von 3 Personen");
  expect(de).toContain("#### Abweichende Fälle: 1 von 3 Personen");
  // The deviant case comes with what it did say.
  expect(de).toMatch(/- Einkauf\n {4}- „Ich lege Verträge jetzt dort ab/);
  // Both verdicts hold here: said as it is, not settled.
  expect(api.rounds[0].status).toBe("both");
  expect(de).toContain("Evaluation: beide Urteile erfüllt, die Kriterien widersprechen sich.");
  // The one unconfirmed unit is counted where it is evidence.
  expect(falsified.unreviewed).toBe(1);
  expect(de).toContain("Ungeprüfte Belege für dieses Kriterium: 1.");

  const en = (await study.get("/api/export/evaluation-propositions.md?lang=en")).text;
  expect(gridCells(en).find((one) => one[1] === "support")[2]).toBe("2 of 3, 2 required");
  expect(en).toContain("both verdicts met, the criteria contradict each other");
  expect(en).not.toContain("Personen");
  expect((await study.get("/api/export/evaluation-propositions.md?round=requirements&lang=de")).text).toContain(
    "Noch keine Proposition trägt Kriterien.",
  );
  expect((await study.get("/api/export/evaluation-propositions.md?round=nowhere")).status).toBe(404);
});

test("the guide-question export groups by tag and says how much is unassigned", async () => {
  const report = (await study.get("/api/evaluation/tags")).json;
  const de = (await study.get("/api/export/evaluation-tags.md?lang=de")).text;
  expect(de).toContain("# Kodiereinheiten nach Leitfadenfrage: Evaluation");
  expect(de).toContain(`Keiner Leitfadenfrage zugeordnet: ${report.unassigned} von 5 Kodiereinheiten dieser Runde.`);
  expect(de).toContain("## Erwarteter Aufwand");
  expect(de).toContain("- „Kostet das Ablegen Zeit?“ (7 · Konkrete Fragen zum Schluss)");
  expect(de).toContain("### Marketing · 1");
  expect(de).toContain("## Fragen ohne Tag");
  expect(de).toContain("Frage „Sonst noch etwas?“");
  const en = (await study.get("/api/export/evaluation-tags.md?lang=en")).text;
  expect(en).toContain("# Coding units by guide question: Evaluation");
  expect(en).toContain("question “Sonst noch etwas?”");
});

test("the read-out export counts what the log marked, and open is neither", async () => {
  const panel = (await study.get("/api/evaluation/panel")).json;
  expect(panel.readout).toEqual([expect.objectContaining({ department: "Vertrieb", listed: 3, still: 1, noLonger: 1, open: 1 })]);
  const de = (await study.get("/api/export/evaluation-readout.md?lang=de")).text;
  expect(de).toMatch(/\| Vertrieb +\| Systeme +\| 3 +\| 1 +\| 1 +\| 1 +\|/);
  expect(de).toContain("- Postfach: weiterhin von Hand durchsucht");
  expect(de).toContain("- Telefon: offen");
  const en = (await study.get("/api/export/evaluation-readout.md?lang=en")).text;
  expect(en).toContain("- Laufwerk: no longer");
});

test("no export lets a reader infer which department the second round did not reach", async () => {
  for (const path of EXPORTS) {
    for (const lang of ["de", "en"]) {
      const answer = await study.get(`${path}${path.includes("?") ? "&" : "?"}lang=${lang}`);
      expect(answer.status, path).toBe(200);
      expect(answer.text, `${path} names the absent department`).not.toContain("Lager");
      expect(answer.text, `${path} quotes the absent department`).not.toContain("Zettel");
      // Nor does the prose count the compared departments against the asked ones.
      expect(answer.text).not.toMatch(/\b4\b.*(Bereich|department)/i);
    }
  }
});

let pandoc = true;
try {
  execFileSync("pandoc", ["--version"], { stdio: "ignore" });
} catch {
  pandoc = false;
}

test("Pandoc reads every evaluation export without a complaint", async () => {
  test.skip(!pandoc, "Pandoc is not installed here");
  for (const path of EXPORTS) {
    const markdown = (await study.get(`${path}${path.includes("?") ? "&" : "?"}lang=de`)).text;
    const work = mkdtempSync(join(tmpdir(), "fundstelle-pandoc-"));
    const file = join(work, "export.md");
    writeFileSync(file, markdown, "utf8");
    try {
      const said = execFileSync("sh", ["-c", `pandoc -f markdown -t html "${file}" 2>&1 >/dev/null`], {
        encoding: "utf8",
      });
      expect(said.trim(), path).toBe("");
      const html = execFileSync("pandoc", ["-f", "markdown", "-t", "html", file], { encoding: "utf8" });
      if (markdown.includes("+===")) expect(html, `${path} becomes a table`).toContain("<table");
      expect(html).not.toContain("+---");
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
});
