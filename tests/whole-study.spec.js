import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * One whole study, from an empty folder to the documents a thesis is built from.
 *
 * Every part of this has its own checks, and the first five minutes were walked
 * end to end once. The rest never was. A tool can pass four hundred checks of
 * its parts and still have a seam where two of them meet — a figure that counts
 * something the export does not, a document that goes out empty because the step
 * before it left the study in a shape nobody tested.
 *
 * So this is the walk: empty folder, a recording read in, a category system, a
 * coding pass with the keyboard, an inductive category that emerges from the
 * material, a second coder handing their work over, the analysis, and every
 * document the analysis offers. It asserts the things that have to agree across
 * those steps rather than within them — the same numbers in the figures and on
 * paper, every document non-empty and about this study, and nothing claimed
 * that the study does not hold.
 *
 * It drives a server of its own over a folder with nothing in it, because that
 * is the only way to start where a reader starts.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = 4165;
const BASE = `http://127.0.0.1:${PORT}`;

let folder;
let server;

const VTT = (speaker, lines) =>
  `WEBVTT\n\n` +
  lines
    .map(
      (line, index) =>
        `${index + 1}\n00:0${index}:00.000 --> 00:0${index}:30.000\n` +
        `<v ${index % 2 === 0 ? "Anna Berger" : speaker}>${line}</v>\n`,
    )
    .join("\n");

const TALK = [
  "Erzähl doch bitte, wie ihr ablegt, was im Tagesgeschäft anfällt.",
  "Wir legen alles im Laufwerk ab, aber jeder macht es anders, und am Ende sucht man doppelt so lange wie nötig.",
  "Und wenn jemand nicht da ist, der es abgelegt hat?",
  "Dann baue ich mir den Stand aus alten Nachrichten neu zusammen, und bin am Ende trotzdem nicht sicher.",
  "Wie übergebt ihr einen Vorgang?",
  "Mündlich, im Vorbeigehen. Aufgeschrieben wird nichts, dafür fehlt im Tagesgeschäft schlicht die Zeit.",
  "Was müsste ein Werkzeug können, damit es hilft?",
  "Mir sagen, was aktuell ist, und mir die letzte Fassung zeigen, ohne dass ich jemanden fragen muss.",
];

test.beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), "fundstelle-study-"));
  server = spawn(process.execPath, [join(ROOT, "server.js")], {
    env: {
      ...process.env,
      PORT: String(PORT),
      TRANSCRIPTS: join(folder, "transcripts"),
      CATEGORIES: join(folder, "categories.json"),
      START_LANGUAGE: "de",
    },
    stdio: "ignore",
  });
  for (let tries = 0; tries < 60; tries += 1) {
    const up = await fetch(`${BASE}/api/interviews`).then(() => true, () => false);
    if (up) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
});

test.afterAll(() => {
  server?.kill();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

test("a study runs from an empty folder to the documents it is written from", async ({ page }) => {
  test.setTimeout(120_000);
  const study = await page.context().newPage();
  const send = (path, data, method = "POST") =>
    fetch(BASE + path, {
      method,
      headers: { "content-type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });

  /* 1 — the empty screen. Nothing to code, and it says what to do about it. */
  await study.goto(`${BASE}/?lang=de`);
  await expect(study.locator(".onboarding")).toBeVisible();
  await expect(study.locator("#onboarding-import")).toBeVisible();

  /* 2 — two recordings read in, the way a person actually arrives: with what
     came out of Teams, not with this tool's own file format. */
  for (const [department, speaker] of [["Vertrieb", "Jonas Klein"], ["Marketing", "Mara Sund"]]) {
    await study.locator("#import").click();
    await study.locator("#import-file").setInputFiles({
      name: `${department}.vtt`,
      mimeType: "text/vtt",
      buffer: Buffer.from(VTT(speaker, TALK), "utf8"),
    });
    await study.locator("#import-interviewer").selectOption("Anna Berger");
    await study.locator("#import-department").fill(department);
    await study.locator("#import-title").fill(`Interview: ${department}`);
    await study.locator("#import-form button[type=submit]").click();
    await expect(study.locator("#import-sheet")).toBeHidden();
  }
  const interviews = await (await fetch(`${BASE}/api/interviews`)).json();
  expect(interviews).toHaveLength(2);
  expect(interviews.map((one) => one.department).sort()).toEqual(["Marketing", "Vertrieb"]);

  /* 3 — coding, from the keyboard, on the screen that says how. */
  await study.goto(`${BASE}/?lang=de`);
  await study.waitForSelector(".turn");
  await expect(study.locator("#how-to-code")).toBeVisible();
  await study.locator("#transcript").focus();
  await study.keyboard.press("j");
  await study.keyboard.press("s");
  await study.keyboard.press("1");
  await expect(study.locator(".segment")).toHaveCount(1);
  // The hint has done its work and stops being furniture.
  await expect(study.locator("#how-to-code")).toBeHidden();

  /* 4 — a category the material asked for, which is what inductive means. */
  await study.locator("#inductive-shell > summary").click();
  await study.locator("#inductive-name").fill("Wissensverlust");
  await study
    .locator("#inductive-definition")
    .fill("Aussagen darüber, dass ein Stand nur in einem Kopf liegt und mit dieser Person weg ist.");
  await study.locator("#inductive-submit").click();
  await expect(study.locator("#categories")).toContainText("Wissensverlust");

  /* 5 — the rest of the coding, over both interviews and every category, so the
     figures have something to be about. */
  const categories = (await (await fetch(`${BASE}/api/categories`)).json()).categories;
  let made = 0;
  for (const one of interviews) {
    const data = await (await fetch(`${BASE}/api/interviews/${one.id}`)).json();
    for (const [index, turn] of data.turns.filter((each) => !each.interviewer).entries()) {
      for (const k of [0, 1]) {
        const start = k * 60;
        const end = Math.min(start + 55, turn.text.length);
        if (end - start < 25) continue;
        const answer = await send(`/api/interviews/${one.id}/codings`, {
          turn: turn.number,
          start,
          end,
          category: categories[(index + k + made) % categories.length].id,
          text: turn.text.slice(start, end),
          reviewed: true,
        });
        if (answer.ok) made += 1;
      }
    }
  }
  expect(made, "the study holds coded material").toBeGreaterThan(6);

  /* 6 — a second coder hands their work over, which is what turns a coding into
     something with a reliability figure attached. */
  const bundle = await (await fetch(`${BASE}/api/export/coding.json?name=anna`)).json();
  // Not identical to the first, or the agreement would be a tautology.
  for (const [id, one] of Object.entries(bundle.interviews)) {
    one.codings = one.codings.filter((_, index) => index % 4 !== 0);
    expect(one.codings.length, id).toBeGreaterThan(0);
  }
  expect((await send("/api/codings/second", { bundle })).status).toBe(201);
  const agreement = await (await fetch(`${BASE}/api/agreement`)).json();
  expect(agreement.coders).toContain("anna");
  expect(agreement.comparisons[0].kappa).toBeGreaterThan(0);

  /* 7 — the analysis. The figures on screen and the study behind them have to be
     the same study, which is the seam this whole file exists for. */
  await study.goto(`${BASE}/?lang=de`);
  await study.locator('.tab[data-view="analysis"]').click();
  await expect(study.locator("#matrix-table")).toBeVisible();
  const analysis = await (await fetch(`${BASE}/api/analysis`)).json();
  /* Counted from the interviews rather than from a tally kept here: two of this
     tool's own surfaces agreeing is worth something, and a number this file
     added up itself only checks this file's arithmetic. (It caught mine — the
     passage coded from the keyboard in step 3 was never in the tally.) */
  let held = 0;
  for (const one of interviews) {
    const data = await (await fetch(`${BASE}/api/interviews/${one.id}`)).json();
    held += data.codings.filter((unit) => unit.state !== "lost").length;
  }
  expect(held).toBeGreaterThan(made);
  expect(analysis.total).toBe(held);
  expect(analysis.departments).toHaveLength(2);
  await expect(study.locator(".metric .value").first()).toHaveText(String(analysis.total));

  /* 8 — every document the screen offers. A button that downloads a page about
     nothing is worse than no button, and this is the only place that walks all
     of them against a study built the long way. */
  const links = await study.locator(".exports-part a").evaluateAll((all) =>
    all.map((one) => one.getAttribute("href")),
  );
  expect(links.length).toBeGreaterThan(6);
  for (const href of links) {
    const answer = await fetch(BASE + href);
    expect(answer.status, href).toBe(200);
    const text = await answer.text();
    expect(text.length, `${href} has content`).toBeGreaterThan(60);
    // And it is about this study rather than a template: the departments this
    // study actually holds turn up in everything that names any.
    if (/analysis|sample|matrix|citations/.test(href)) {
      expect(text, href).toMatch(/Vertrieb|Marketing/);
    }
  }

  /* 9 — and the study leaves whole, for a program that is not this one. */
  const project = await fetch(`${BASE}/api/export/project.qdpx`);
  expect(project.status).toBe(200);
  const archive = Buffer.from(await project.arrayBuffer());
  expect(archive.subarray(0, 2).toString("latin1")).toBe("PK");
  expect(archive.length).toBeGreaterThan(500);

  /* 10 — and what is on the disk is what the README says is on the disk: the
     tool only ever added files beside the transcripts. */
  for (const one of interviews) {
    const entries = readdirSync(join(folder, "transcripts", one.id)).sort();
    expect(entries, one.id).toEqual(["coding.anna.json", "coding.json", "final.md"]);
  }

  /* 11 — the deepest seam in the tool, and the one a real study walks into on
     any Tuesday: somebody corrects the transcript after coding it. Units that
     shift are carried along; a unit whose passage is gone has no place, and the
     rule this tool keeps everywhere is that a unit with no place counts on no
     surface. Here that rule is checked across surfaces rather than within one. */
  const edited = interviews[0];
  const file = join(folder, "transcripts", edited.id, "final.md");
  const original = readFileSync(file, "utf8");
  const wasAt = new Map(
    (await (await fetch(`${BASE}/api/interviews/${edited.id}`)).json()).codings.map((unit) => [
      unit.id,
      unit.start,
    ]),
  );
  writeFileSync(
    file,
    original.replace(
      "Wir legen alles im Laufwerk ab",
      "Also, wie gesagt. Wir legen alles im Laufwerk ab",
    ),
    "utf8",
  );

  const after = await (await fetch(`${BASE}/api/interviews/${edited.id}`)).json();
  expect(after.problems, "the file still reads").toEqual([]);
  /* The edit has to have actually moved something, or the rest of this step is
     a check that nothing happened. A passage that shifted is carried along
     silently — that is the whole point of anchoring by text rather than by
     offset — so what proves it happened is the offset, not a message. */
  const moved = after.codings.filter((unit) => wasAt.has(unit.id) && unit.start !== wasAt.get(unit.id));
  expect(moved.length, "the correction shifted a coded passage").toBeGreaterThan(0);
  for (const unit of moved) {
    const turn = after.turns.find((each) => each.number === unit.turn);
    // Carried along means still on its own words, not merely renumbered.
    expect(turn.text.slice(unit.start, unit.end), unit.id).toBe(unit.text);
  }
  const placedNow = after.codings.filter((unit) => unit.state !== "lost").length;
  const displaced = after.codings.length - placedNow;

  let stillHeld = placedNow;
  for (const one of interviews.slice(1)) {
    const data = await (await fetch(`${BASE}/api/interviews/${one.id}`)).json();
    stillHeld += data.codings.filter((unit) => unit.state !== "lost").length;
  }
  const afterAnalysis = await (await fetch(`${BASE}/api/analysis`)).json();
  expect(afterAnalysis.total, "the figures count what has a place").toBe(stillHeld);

  // And the document says the same thing the screen does, including about the
  // ones that lost their place — silence there would make the total look small
  // for no stated reason.
  const paper = await (await fetch(`${BASE}/api/export/analysis.md?lang=de`)).text();
  expect(paper).toContain(String(afterAnalysis.total));
  if (displaced) expect(paper).toContain("ihren Platz im Transkript verloren");

  await study.close();
});
