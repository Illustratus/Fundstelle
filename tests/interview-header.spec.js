import { expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * What an interview says about itself, written rather than only read.
 *
 * The transcript format has parsed a title and a block of `- Field: value`
 * lines since the first version. They carry the department every cross table is
 * cut by, and they are what the sample table of a paper is built from. All of
 * it was readable and none of it was writable: a department spelled two ways
 * across eighteen folders meant leaving the tool and editing the files every
 * citation hangs on.
 *
 * The rule that makes this safe is the one the whole tool rests on: a coding
 * unit holds its place by turn number and character range inside that turn. So
 * the header may be rewritten as often as one likes, as long as the turns are
 * handed back exactly as they were — which is what these check, on the file
 * itself rather than on what the interface says about it.
 *
 * Runs on its own server against its own folder: renaming and deleting an
 * interview move and remove directories, and the shared sandbox is what every
 * other spec in the suite is standing on.
 */

const PORT = 4194;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = fileURLToPath(new URL("..", import.meta.url));

let server;
let folder;
let transcripts;

const TRANSCRIPT =
  "# Interview 1: Vertrieb\n\n" +
  "Synthetisches Prüftranskript.\n\n" +
  "- Erhebung: 28. Juli 2026\n" +
  "- Quelle: erfunden\n\n" +
  "---\n\n" +
  "## Section: 1 · Ablage\n\n" +
  "**1 · Interviewer [0:01]**\n\nWie legen Sie ab?\n\n" +
  "**2 · Vertrieb [0:11]**\n\n" +
  "Wir legen das im Laufwerk ab, aber jeder macht es anders und am Ende sucht man doppelt.\n\n";

const send = (path, body, method = "POST") =>
  fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const read = (interview) =>
  readFileSync(join(transcripts, interview, "final.md"), "utf8");

async function makeInterview(name) {
  mkdirSync(join(transcripts, name), { recursive: true });
  writeFileSync(join(transcripts, name, "final.md"), TRANSCRIPT);
}

test.beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), "fundstelle-header-"));
  transcripts = join(folder, "transcripts");
  await makeInterview("interview-01");
  server = spawn(process.execPath, [join(ROOT, "server.js")], {
    env: {
      ...process.env,
      PORT: String(PORT),
      TRANSCRIPTS: transcripts,
      CATEGORIES: join(folder, "categories.json"),
      START_LANGUAGE: "de",
    },
    stdio: "ignore",
  });
  for (let tries = 0; tries < 60; tries += 1) {
    const up = await fetch(`${BASE}/api/interviews`).then((answer) => answer.ok, () => false);
    if (up) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
});

test.afterAll(() => {
  server?.kill();
  rmSync(folder, { recursive: true, force: true });
});

test("the title and the header lines are written back into the file", async () => {
  const answer = await send(
    "/api/interviews/interview-01",
    {
      title: "Interview 1: Vertrieb Nord",
      meta: { Erhebung: "28. Juli 2026", Quelle: "erfunden", Rolle: "Teamleitung" },
    },
    "PATCH",
  );
  expect(answer.status).toBe(200);

  const file = read("interview-01");
  expect(file).toContain("# Interview 1: Vertrieb Nord");
  expect(file).toContain("- Rolle: Teamleitung");
  // Everything that is not the header is left exactly as it was: the note under
  // the title, the guide section, and above all the turns.
  expect(file).toContain("Synthetisches Prüftranskript.");
  expect(file).toContain("## Section: 1 · Ablage");
  expect(file).toContain("**2 · Vertrieb [0:11]**");
  expect(file).toContain("Wir legen das im Laufwerk ab, aber jeder macht es anders");
});

test("a header line can be taken away again", async () => {
  await send(
    "/api/interviews/interview-01",
    { meta: { Erhebung: "28. Juli 2026", Quelle: "erfunden" } },
    "PATCH",
  );
  expect(read("interview-01")).not.toContain("Rolle");
});

test("the department is written where the format keeps it", async () => {
  const answer = await (
    await send("/api/interviews/interview-01", { department: "Vertrieb Süd" }, "PATCH")
  ).json();
  // It is no line of its own: the format reads it off the title behind the
  // colon, so that is where setting it writes.
  expect(answer.department).toBe("Vertrieb Süd");
  expect(read("interview-01")).toContain("# Interview 1: Vertrieb Süd");
});

test("a citation still sits where it sat before the header was rewritten", async () => {
  await send("/api/categories", {
    name: "Ablage",
    definition: "Aussagen über den Ort, an dem etwas liegt.",
  });
  const unit = await (
    await send("/api/interviews/interview-01/codings", {
      turn: 2,
      start: 0,
      end: 25,
      category: "ind.ablage",
      text: "Wir legen das im Laufwerk",
      reviewed: true,
    })
  ).json();

  await send(
    "/api/interviews/interview-01",
    { title: "Interview 1: Vertrieb", meta: { Quelle: "erfunden" } },
    "PATCH",
  );

  const after = await (await fetch(`${BASE}/api/interviews/interview-01`)).json();
  const same = after.codings.find((one) => one.id === unit.id);
  // Checked and found where it was: not moved along, not handed back as lost.
  // The turns were never touched, so there was nothing for the check to do.
  expect(same.state).toBe("ok");
  expect(same.turn).toBe(2);
  expect(same.start).toBe(0);
});

test("renaming the folder takes the codings with it", async () => {
  const moved = await (
    await send("/api/interviews/interview-01/rename", { to: "Vertrieb & Innendienst" })
  ).json();
  // Slugged the way the import slugs a title, and the answer says what it became.
  expect(moved.id).toBe("vertrieb-innendienst");

  const after = await (await fetch(`${BASE}/api/interviews/vertrieb-innendienst`)).json();
  expect(after.codings.length).toBe(1);
  expect((await fetch(`${BASE}/api/interviews/interview-01`)).status).toBe(404);
  // The coding file names the interview in a line of its own. Nothing reads it
  // — the folder is what the tool goes by — but a file saying the old name
  // after the rename lies to whoever opens the history.
  const coding = JSON.parse(
    readFileSync(join(transcripts, "vertrieb-innendienst", "coding.json"), "utf8"),
  );
  expect(coding.interview).toBe("vertrieb-innendienst");

  await makeInterview("interview-02");
  const refused = await send("/api/interviews/vertrieb-innendienst/rename", { to: "interview-02" });
  expect(refused.status).toBe(409);
  expect((await refused.json()).code).toBe("errorInterviewExists");
});

test("deleting an interview takes its transcript and its codings together", async () => {
  expect((await send("/api/interviews/interview-02", undefined, "DELETE")).status).toBe(204);
  const left = await (await fetch(`${BASE}/api/interviews`)).json();
  expect(left.map((one) => one.id)).toEqual(["vertrieb-innendienst"]);
  expect((await send("/api/interviews/interview-02", undefined, "DELETE")).status).toBe(404);
});

test("the panel writes the header, and asks before it deletes", async ({ page }) => {
  await page.goto(`${BASE}/?lang=de`);
  await page.waitForSelector(".turn");
  await page.locator("#about-shell > summary").click();

  const title = page.locator('#about-form [data-about="title"]');
  await title.fill("Interview 1: Vertrieb gesamt");
  await title.blur();
  await expect(page.locator("#message")).toContainText("heißt jetzt");
  expect(read("vertrieb-innendienst")).toContain("# Interview 1: Vertrieb gesamt");

  await page.locator("#meta-new-key").fill("Rolle");
  await page.locator("#meta-new-value").fill("Teamleitung");
  await page.locator("#meta-new button").click();
  await expect(page.locator("#message")).toContainText("Kopfzeilen");
  expect(read("vertrieb-innendienst")).toContain("- Rolle: Teamleitung");

  /* The one place the tool asks first. Transcript and codings go together and
     there is no copy anywhere — they are meant to be version-controlled beside
     each other, which is where they can be got back from. */
  let asked = null;
  page.on("dialog", (dialog) => {
    asked = dialog.message();
    dialog.dismiss();
  });
  await page.locator("#about-remove").click();
  await expect.poll(() => asked).toContain("Kodiereinheiten");
  const still = await (await fetch(`${BASE}/api/interviews`)).json();
  expect(still.length).toBe(1);
});
