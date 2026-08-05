import { expect, test } from "@playwright/test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* Loaded inside the checks rather than at the top, so that this file still runs
   against a build where the guard does not exist yet: an import that fails takes
   the HTTP checks down with it, and those are the ones that describe the hole. */

/**
 * A name from a URL must not decide where the files are.
 *
 * An interview identifier arrives in the path — `/api/interviews/<id>` — and
 * every file this tool touches for that interview is built by joining it onto a
 * root. A URL can say `..%2f..%2fetc`, and it did: reading resolved two levels
 * above the transcript folder, and a longer chain walked further up still. The
 * shape of the read is narrow, always `<somewhere>/final.md`, and the tool binds
 * to 127.0.0.1 — which makes it a smaller thing than it looks, and no smaller
 * than it is. The write path was the same join, so a coding could have been
 * filed into a folder nobody chose.
 *
 * Static files were already guarded. This is the other door, and it was open.
 *
 * The rule is narrow on purpose: one segment, nothing that means anything to a
 * filesystem. Folders are made by the tool itself from a slug, so nothing
 * legitimate is turned away. It is kept in the two places every path is built —
 * the transcript loader and the store — so no route can forget it, and again at
 * the boundary so the answer is a 404 that reads as a sentence.
 */

const CRAFTED = [
  "../etc",
  "../../etc",
  "..%2f..%2fetc",
  "../../../../etc/passwd",
  "beispiel/../../x",
  "..",
  ".",
  ".hidden",
  "-rf",
  "with/slash",
  "with\\backslash",
  "",
];

test("a name that could steer a path is not an interview name", async () => {
  const { safeInterviewId } = await import("../lib/transcript.js");
  for (const bad of CRAFTED) expect(safeInterviewId(bad), JSON.stringify(bad)).toBe(false);
  // And the ones the tool makes itself still are.
  for (const good of ["interview-01", "beispiel-kundenservice", "example-interview", "Gespraech_3", "a.b"]) {
    expect(safeInterviewId(good), good).toBe(true);
  }
});

test("the transcript loader refuses before it reads", async () => {
  const { loadTranscript } = await import("../lib/transcript.js");
  for (const bad of CRAFTED) {
    await expect(loadTranscript("/tmp", bad), JSON.stringify(bad)).rejects.toThrow("errorUnknownInterview");
  }
});

test("the store refuses before it writes", async () => {
  const { Store } = await import("../lib/store.js");
  const root = mkdtempSync(join(tmpdir(), "fundstelle-paths-"));
  const store = new Store({ toolRoot: root, transcriptRoot: join(root, "transcripts"), seedLanguage: "de" });
  const unit = { turn: 2, start: 0, end: 5, category: "routine", text: "abcde" };

  for (const bad of ["../../escaped", "..", "with/slash"]) {
    await expect(store.addCoding(bad, unit), bad).rejects.toThrow("errorUnknownInterview");
    await expect(store.codings(bad), bad).rejects.toThrow("errorUnknownInterview");
  }
  /* The point of the check, said as a fact about the disk rather than about an
     exception: nothing appeared where the crafted name pointed. */
  expect(existsSync(join(root, "escaped"))).toBe(false);
  expect(existsSync(join(root, "transcripts", "..", "escaped"))).toBe(false);
  rmSync(root, { recursive: true, force: true });
});

/* And over HTTP, which is where it actually arrives. */

test("a crafted id is a wrong address, not a way out of the folder", async ({ request }) => {
  for (const bad of ["..%2f..%2fetc", "..%2f..%2f..%2f..%2fetc%2fpasswd", "%2e%2e%2f%2e%2e%2fx", ".hidden"]) {
    const answer = await request.get(`/api/interviews/${bad}`);
    expect(answer.status(), bad).toBe(404);
    const body = await answer.json();
    expect(body.code, bad).toBe("errorUnknownInterview");
  }
});

test("writing through a crafted id is refused too", async ({ request }) => {
  const answer = await request.post("/api/interviews/..%2f..%2fescaped/codings", {
    data: { turn: 2, start: 0, end: 5, category: "routine", text: "abcde" },
  });
  expect(answer.status()).toBe(404);
  expect((await answer.json()).code).toBe("errorUnknownInterview");
});

test("an export asked for an interview that is not there says so", async ({ request }) => {
  const answer = await request.get("/api/export/coding-table/..%2f..%2fsecret.md");
  expect(answer.status()).toBe(404);
  expect((await answer.json()).code).toBe("errorUnknownInterview");
});

test("no answer carries a path from the machine it runs on", async ({ request }) => {
  /* The old failure was a 500 whose message was the absolute path it had tried
     to open. Names are for the reader; internals are for the terminal. */
  for (const path of [
    "/api/interviews/nope",
    "/api/interviews/..%2f..%2fetc",
    "/api/export/coding-table/nope.md",
  ]) {
    const body = await (await request.get(path)).text();
    expect(body, path).not.toMatch(/\/(Users|home|private|var|tmp)\//);
    expect(body, path).not.toContain("ENOENT");
  }
});

test("a real interview is still perfectly readable", async ({ request }) => {
  // The negative half: a guard that turns away everything is not a guard.
  const all = await (await request.get("/api/interviews")).json();
  expect(all.length).toBeGreaterThan(0);
  for (const one of all) {
    const answer = await request.get(`/api/interviews/${one.id}`);
    expect(answer.status(), one.id).toBe(200);
    expect((await answer.json()).id).toBe(one.id);
  }
});
