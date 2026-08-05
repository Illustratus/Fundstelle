import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { plainText, projectFile, projectXML, safeName, uuid, zip } from "../lib/refi.js";

/**
 * The study, leaving whole.
 *
 * The README's claim is that the work is not locked in this tool — everything
 * is plain files beside the transcripts. That is only half an answer while the
 * other half is "and to continue in MAXQDA you retype it". REFI-QDA is the
 * interchange format MAXQDA, ATLAS.ti, NVivo, QualCoder and Quirkos all read,
 * so the study can be handed over: the category system with its definitions,
 * every transcript as text, and every coding as a character range on that text.
 *
 * Two things decide whether this is worth having or actively harmful.
 *
 * The ranges. A coding here is an offset inside one turn; over there it is an
 * offset inside the whole document. Off by the length of a speaker line and
 * every citation lands on the wrong sentence — silently, in somebody else's
 * program, where nothing would say so. So the checks read the text back out of
 * the archive and compare what the offsets point at with what the coding says
 * it quoted.
 *
 * And the archive. Written by hand here, because a tool that installs nothing
 * to run should not install something to export — so `unzip` is asked whether
 * it is a zip at all, rather than this suite grading its own homework.
 */

const study = (id, turns, codings = []) => ({
  transcript: {
    id,
    title: `Interview ${id}`,
    department: "Vertrieb",
    sections: [{ index: 0, name: "Erzählanstoß: 1 · Ablage", number: 1, short: "Ablage" }],
    turns: turns.map((turn) => ({ section: 0, interviewer: false, speaker: "Vertrieb", ...turn })),
  },
  codings,
  memo: "",
});

const CATEGORIES = [
  { id: "routine", name: "Arbeitsalltag", definition: "Wiederkehrende Abläufe.", proposition: "practice", parent: null, codingRules: ["Nur wenn es wiederkehrt"] },
  { id: "routine.disruption", name: "Störungen", definition: "Unterbrechungen.", proposition: "practice", parent: "routine", codingRules: [] },
  { id: "agreement", name: "Absprachen", definition: "Getroffene Absprachen.", proposition: "coordination", parent: null, codingRules: [] },
];
const PROPOSITIONS = { practice: { color: "#6C8EBF" }, coordination: { color: "#D79B00" } };

function unpack(buffer) {
  const folder = mkdtempSync(join(tmpdir(), "fundstelle-qdpx-"));
  const file = join(folder, "project.qdpx");
  writeFileSync(file, buffer);
  // `unzip` is the outside opinion: this suite should not be the only thing
  // that believes the archive is an archive.
  execFileSync("unzip", ["-q", "-o", file, "-d", folder]);
  const read = (name) => readFileSync(join(folder, name), "utf8");
  const list = execFileSync("unzip", ["-Z1", file], { encoding: "utf8" }).trim().split("\n");
  return { read, list, clean: () => rmSync(folder, { recursive: true, force: true }) };
}

test("what comes out is a zip, and the outside agrees", () => {
  const buffer = projectFile({ studies: [study("i1", [{ number: 2, text: "Ein Satz." }])], categories: CATEGORIES, name: "T" });
  const { list, read, clean } = unpack(buffer);
  expect(list).toContain("project.qde");
  expect(list).toContain("Sources/i1.txt");
  expect(read("project.qde")).toContain("urn:QDA-XML:project:1.0");
  clean();
});

test("the same study exported twice is the same file", () => {
  // No timestamps in the envelope: a study that has not changed should not
  // produce a different archive, or a diff of two exports says nothing.
  const now = new Date("2026-08-05T00:00:00Z");
  const one = study("i1", [{ number: 2, text: "Ein Satz." }]);
  const options = { studies: [one], categories: CATEGORIES, name: "T", now };
  expect(projectFile(options).equals(projectFile(options))).toBe(true);
});

test("every coding lands on the words it says it quotes", () => {
  const text = "Wir legen das im Laufwerk ab, aber jeder macht es ein bisschen anders.";
  const one = study(
    "i1",
    [
      { number: 1, text: "Wie legt ihr das ab?", interviewer: true, speaker: "Interviewer", time: "0:01" },
      { number: 2, text, time: "0:11" },
      { number: 4, text: "Und dann sucht man doppelt so lange.", time: "0:30" },
    ],
    [
      { id: "c1", turn: 2, start: 0, end: 28, category: "routine", text: text.slice(0, 28) },
      { id: "c2", turn: 2, start: 30, end: 68, category: "agreement", text: text.slice(30, 68) },
      { id: "c3", turn: 4, start: 0, end: 20, category: "routine.disruption", text: "Und dann sucht man d" },
    ],
  );
  const { read, clean } = unpack(projectFile({ studies: [one], categories: CATEGORIES, name: "T" }));
  const source = read("Sources/i1.txt");
  const xml = read("project.qde");

  const selections = [...xml.matchAll(/startPosition="(\d+)" endPosition="(\d+)"/g)];
  expect(selections).toHaveLength(3);
  /* Read back out of the archive, not out of the object that made it: this is
     the step where an off-by-a-speaker-line would show. */
  for (const [index, [, from, to]] of selections.entries()) {
    expect(source.slice(Number(from), Number(to)), `coding ${index + 1}`).toBe(one.codings[index].text);
  }
  // And the speaker line the citation needs is in the document above it.
  expect(source).toContain("2 · Vertrieb [0:11]");
  clean();
});

test("a unit that has lost its place is not exported as a range", () => {
  /* The rule every surface in this tool keeps. A range that points at nothing
     would land on whatever text happens to sit there — in another program,
     where nobody would know to doubt it. */
  const text = "Ein Satz, der noch da ist.";
  const one = study("i1", [{ number: 2, text }], [
    { id: "c1", turn: 2, start: 0, end: 8, category: "routine", text: "Ein Satz" },
    { id: "c2", turn: 2, start: 0, end: 8, category: "routine", text: "Ein Satz", state: "lost" },
    // Not marked lost, but the text no longer matches what sits there.
    { id: "c3", turn: 2, start: 0, end: 8, category: "routine", text: "Was ganz anderes" },
    // A turn that is not in the transcript at all.
    { id: "c4", turn: 99, start: 0, end: 4, category: "routine", text: "Ein " },
  ]);
  const { xml } = projectXML({ studies: [one], categories: CATEGORIES, name: "T" });
  expect((xml.match(/<PlainTextSelection /g) ?? [])).toHaveLength(1);
  expect(xml).toContain(uuid("sel:c1"));
  for (const gone of ["sel:c2", "sel:c3", "sel:c4"]) expect(xml).not.toContain(uuid(gone));
});

test("the category system arrives with its shape, its definitions and its rules", () => {
  const { xml } = projectXML({
    studies: [study("i1", [{ number: 2, text: "Ein Satz." }])],
    categories: CATEGORIES,
    propositions: PROPOSITIONS,
    name: "T",
  });
  // Two at the top, one under the first: the hierarchy, not a flat list.
  expect((xml.match(/<Code /g) ?? [])).toHaveLength(3);
  expect(xml).toMatch(/name="Arbeitsalltag"[^>]*>.*?name="Störungen"/s);
  expect(xml).not.toMatch(/name="Absprachen"[^>]*>.*?<Code /s);
  // The definition is what a category means; without it the import is labels.
  expect(xml).toContain("Wiederkehrende Abläufe.");
  // Coding rules travel with it — there is nowhere else in the format for them.
  expect(xml).toContain("– Nur wenn es wiederkehrt");
  // The proposition colour, so the import looks like the study it came from.
  expect(xml).toContain('color="#6C8EBF"');
});

test("identifiers are derived, so the same study keeps them", () => {
  // A program that already holds one import can recognise the next one.
  expect(uuid("code:routine")).toBe(uuid("code:routine"));
  expect(uuid("code:routine")).not.toBe(uuid("code:agreement"));
  expect(uuid("code:routine")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("the plain text carries the guide sections and every turn", () => {
  const one = study("i1", [
    { number: 1, text: "Frage?", interviewer: true, speaker: "Interviewer" },
    { number: 2, text: "Antwort." },
  ]);
  const { text, startOfTurn } = plainText(one.transcript);
  expect(text).toContain("Erzählanstoß: 1 · Ablage");
  expect(text.slice(startOfTurn.get(2), startOfTurn.get(2) + 8)).toBe("Antwort.");
});

test("a name with an ampersand in it does not break the XML", () => {
  const one = study("i1", [{ number: 2, text: "Ein Satz." }]);
  one.transcript.title = 'Interview "A & B" <intern>';
  const { xml } = projectXML({ studies: [one], categories: CATEGORIES, name: "T" });
  expect(xml).toContain("Interview &quot;A &amp; B&quot; &lt;intern&gt;");
  expect(xml).not.toContain("A & B");
});

test("the zip holds what was put in it, byte for byte", () => {
  // Including the awkward case: something too random to deflate, and German
  // spelling in the content.
  const random = Array.from({ length: 4000 }, (_, n) => String.fromCharCode(33 + ((n * 7919) % 90))).join("");
  const body = `Straße, Grüße, „Anführung“\n${random}`;
  const { read, list, clean } = unpack(
    zip([
      { name: "a.txt", data: "kurz" },
      { name: "Sources/gespraech.txt", data: body },
    ]),
  );
  expect(list).toContain("Sources/gespraech.txt");
  expect(read("a.txt")).toBe("kurz");
  expect(read("Sources/gespraech.txt")).toBe(body);
  clean();
});

test("an interview folder with an umlaut still opens on the other side", () => {
  /* The archive is correct either way — Python reads a UTF-8 name flag fine.
     Info-ZIP, which is what `unzip` is on a Mac, does not: it decodes the name
     as CP437 and writes a file nobody asked for. The receiving program may hold
     a reader just as old, and "it did not open in their program" is very hard
     to diagnose from here, so the inside of the archive stays ASCII. What a
     person reads is the source's name attribute, which keeps the real title. */
  expect(safeName("interview-01")).toBe("interview-01");
  for (const awkward of ["interview-müller", "Gespräch 3", "日本語", "a/b"]) {
    expect(safeName(awkward), awkward).toMatch(/^[A-Za-z0-9._-]+$/);
  }
  // Folding must not make two interviews into one file.
  expect(safeName("interview-müller")).not.toBe(safeName("interview-muller"));

  const one = study("interview-müller", [{ number: 2, text: "Ein Satz." }]);
  const { list, read, clean } = unpack(projectFile({ studies: [one], categories: CATEGORIES, name: "T" }));
  const source = list.find((each) => each.startsWith("Sources/"));
  expect(source).toMatch(/^Sources\/[A-Za-z0-9._-]+$/);
  // And the pointer in the XML names the file that is actually in there.
  const xml = read("project.qde");
  expect(xml).toContain(`plainTextPath="internal://${source.slice("Sources/".length)}"`);
  clean();
});

/* And through the server, where somebody actually gets it. */

test("the study can be downloaded whole, and reads back", async ({ request }) => {
  // The sandbox is shared and other checks clear it, so this one puts a coding
  // of its own in: an export with nothing coded proves nothing about ranges.
  const data = await (await request.get("/api/interviews/interview-01")).json();
  const turn = data.turns.find((one) => !one.interviewer && one.text.length > 80);
  await request.post("/api/interviews/interview-01/codings", {
    data: {
      turn: turn.number,
      start: 10,
      end: 70,
      category: "routine",
      text: turn.text.slice(10, 70),
      reviewed: true,
    },
  });

  const answer = await request.get("/api/export/project.qdpx");
  expect(answer.status()).toBe(200);
  expect(answer.headers()["content-type"]).toBe("application/zip");
  expect(answer.headers()["content-disposition"]).toContain(".qdpx");

  const { read, list, clean } = unpack(await answer.body());
  expect(list).toContain("project.qde");
  expect(list.filter((one) => one.startsWith("Sources/")).length).toBeGreaterThan(0);

  const xml = read("project.qde");
  // Every code a coding points at is a code the file defines.
  const defined = new Set([...xml.matchAll(/<Code guid="([^"]+)"/g)].map((match) => match[1]));
  const used = [...xml.matchAll(/<CodeRef targetGUID="([^"]+)"/g)].map((match) => match[1]);
  expect(used.length).toBeGreaterThan(0);
  expect(used.every((one) => defined.has(one)), "every reference resolves").toBe(true);

  /* And every range lands inside its own document — taken per source rather
     than across the file, or a selection from one interview gets measured
     against another's text and the check means nothing. */
  let checked = 0;
  for (const [, path, body] of xml.matchAll(
    /<TextSource [^>]*plainTextPath="internal:\/\/([^"]+)"[^>]*>(.*?)<\/TextSource>/gs,
  )) {
    const text = read(`Sources/${path}`);
    for (const [, from, to] of body.matchAll(/startPosition="(\d+)" endPosition="(\d+)"/g)) {
      expect(Number(to), `${path} ${from}-${to}`).toBeLessThanOrEqual(text.length);
      expect(Number(from)).toBeLessThan(Number(to));
      checked += 1;
    }
  }
  expect(checked, "there were ranges to check").toBeGreaterThan(0);
  clean();
});

test("the analysis offers it, and says what it is for", async ({ page, request }) => {
  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="analysis"]').click();
  await expect(page.locator("#matrix-table")).toBeVisible();

  const link = page.locator('.exports a[href*="project.qdpx"]');
  await expect(link).toBeVisible();
  await expect(link).toHaveText("Projekt (REFI-QDA)");
  // Named programs, because "interchange format" answers nobody's question.
  const note = page.locator(".exports-where", { hasText: "MAXQDA" });
  await expect(note).toBeVisible();
  await expect(note).toContainText("QualCoder");
  // It is its own group: this is not a document for a reader.
  await expect(page.locator(".exports-part .exports-where")).toHaveCount(3);
  expect((await request.get(await link.getAttribute("href"))).status()).toBe(200);
});
