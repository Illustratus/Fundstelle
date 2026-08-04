import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * A change you can read in a diff.
 *
 * The README's reason for existing is that the codings live in the same folder
 * — and the same git history — as the transcripts they refer to. A history is
 * only worth having if a change in it can be read: one coding added should be
 * one coding added, not a file rewritten around it.
 *
 * It was not. The fields of a coding unit were written in whatever order the
 * object happened to be built in — one order when a unit was created, another
 * after it had been read back and migrated — so a file held the same kind of
 * record in two orders at once, and adding a single unit rewrote the lines of
 * a unit nobody had touched. Nothing was lost and nothing looked wrong; the
 * history simply stopped saying what happened.
 *
 * These run against a copy in a temporary git repository, never against a real
 * one, and drive a server of their own so the sandbox the rest of the suite
 * shares is left alone.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = 4187;
const BASE = `http://127.0.0.1:${PORT}`;

let work;
let server;

const git = (...args) =>
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], {
    cwd: work,
    encoding: "utf8",
  });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test.beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "fundstelle-git-"));
  execFileSync("cp", ["-R", join(ROOT, "tests", "fixtures"), join(work, "transcripts")]);
  rmSync(join(work, "transcripts", "generator.mjs"), { force: true });

  const { spawn } = await import("node:child_process");
  server = spawn(process.execPath, [join(ROOT, "server.js")], {
    env: {
      ...process.env,
      PORT: String(PORT),
      TRANSCRIPTS: join(work, "transcripts"),
      CATEGORIES: join(work, "categories.json"),
      START_LANGUAGE: "de",
    },
    stdio: "ignore",
  });
  for (let tries = 0; tries < 60; tries += 1) {
    const up = await fetch(`${BASE}/api/interviews`).then(
      (answer) => answer.ok,
      () => false,
    );
    if (up) break;
    await wait(200);
  }

  // A study with something in it, committed as the starting point.
  const { categories } = await (await fetch(`${BASE}/api/categories`)).json();
  const data = await (await fetch(`${BASE}/api/interviews/interview-01`)).json();
  const codable = data.turns.filter((turn) => !turn.interviewer && turn.text.length > 70);
  for (const [index, turn] of codable.slice(0, 8).entries()) {
    await fetch(`${BASE}/api/interviews/interview-01/codings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        turn: turn.number,
        start: 0,
        end: 60,
        category: categories[index % categories.length].id,
        text: turn.text.slice(0, 60),
        reviewed: true,
      }),
    });
  }
  git("init", "-q", ".");
  git("add", "-A");
  git("commit", "-qm", "a study with eight units in it");
});

test.afterAll(() => {
  server?.kill();
  rmSync(work, { recursive: true, force: true });
});

test.beforeEach(() => {
  git("checkout", "--", ".");
  git("clean", "-qfd");
});

/** The lines a change touched, ignoring which file they were in. */
function touched() {
  const numbers = git("diff", "--numstat").trim();
  if (!numbers) return { added: 0, removed: 0, files: 0 };
  const rows = numbers.split("\n").map((line) => line.split("\t"));
  return {
    added: rows.reduce((n, row) => n + Number(row[0]), 0),
    removed: rows.reduce((n, row) => n + Number(row[1]), 0),
    files: rows.length,
  };
}

/** The changed lines themselves, without the diff's own furniture. */
const changedLines = () =>
  git("diff", "-U0")
    .split("\n")
    .filter((line) => /^[+-][^+-]/.test(line))
    .map((line) => line.slice(1).trim());

test("one field written touches that field and the timestamp", async () => {
  const data = await (await fetch(`${BASE}/api/interviews/interview-01`)).json();
  const one = data.codings[3];
  await fetch(`${BASE}/api/interviews/interview-01/codings/${one.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ memo: "Grenzfall zur Störung." }),
  });

  const lines = changedLines();
  /* Two lines out, two lines in: the memo and the moment it was written. A
     reviewer reading the history sees the memo and nothing else. */
  expect(touched()).toEqual({ added: 2, removed: 2, files: 1 });
  expect(lines.filter((line) => line.includes("memo"))).toHaveLength(2);
  expect(lines.filter((line) => line.includes("changed"))).toHaveLength(2);
});

test("one unit added adds one unit and changes nothing else", async () => {
  const data = await (await fetch(`${BASE}/api/interviews/interview-01`)).json();
  const free = data.turns.find(
    (turn) => !turn.interviewer && turn.text.length > 70 && !data.codings.some((c) => c.turn === turn.number),
  );
  await fetch(`${BASE}/api/interviews/interview-01/codings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      turn: free.number,
      start: 0,
      end: 60,
      category: "routine",
      text: free.text.slice(0, 60),
      reviewed: true,
    }),
  });

  const { added, removed } = touched();
  /* A unit is its eleven fields between two braces, and the line before it
     grows a comma. Anything more than that is a unit nobody touched being
     rewritten around the one that was added. */
  expect(added).toBeLessThanOrEqual(15);
  expect(removed, "nothing but the timestamp goes out").toBe(1);

  // And the one line that goes out is that timestamp, not a field of a unit
  // somebody had already coded.
  const gone = git("diff", "-U0")
    .split("\n")
    .filter((line) => /^-[^-]/.test(line))
    .map((line) => line.slice(1).trim());
  expect(gone).toHaveLength(1);
  expect(gone[0]).toMatch(/^"changed":/);
});

test("every unit in the file is written in the same order", async () => {
  /* The property underneath both checks above. Two orders in one file is how
     adding a unit came to rewrite a unit that had not changed. */
  const data = await (await fetch(`${BASE}/api/interviews/interview-01`)).json();
  const free = data.turns.find(
    (turn) => !turn.interviewer && turn.text.length > 70 && !data.codings.some((c) => c.turn === turn.number),
  );
  await fetch(`${BASE}/api/interviews/interview-01/codings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      turn: free.number,
      start: 0,
      end: 60,
      category: "routine",
      text: free.text.slice(0, 60),
      reviewed: true,
    }),
  });

  const stored = JSON.parse(
    readFileSync(join(work, "transcripts", "interview-01", "coding.json"), "utf8"),
  );
  const orders = new Set(stored.codings.map((coding) => Object.keys(coding).join(",")));
  expect([...orders], "one order for every unit").toHaveLength(1);
  // And it is the order the reader expects, oldest field first.
  expect([...orders][0]).toBe(
    "id,created,turn,start,end,category,text,memo,anchor,reviewed,requirements",
  );
});

test("the marks the anchor check hangs on a unit never reach the file", async () => {
  /* `state` and `reason` are what the tool works out while reading; writing
     them would put a judgement about today's transcript into a record that
     outlives it. */
  const data = await (await fetch(`${BASE}/api/interviews/interview-01?lang=de`)).json();
  expect(data.codings.some((one) => "state" in one || "reason" in one)).toBe(true);

  const stored = readFileSync(join(work, "transcripts", "interview-01", "coding.json"), "utf8");
  expect(stored).not.toContain('"state"');
  expect(stored).not.toContain('"reason"');
  expect(stored).not.toContain('"reasonKey"');
});

test("reading a study changes nothing in it", async () => {
  // Opening the tool is not an edit, and a history full of empty commits is a
  // history nobody reads.
  for (const one of await (await fetch(`${BASE}/api/interviews`)).json()) {
    await fetch(`${BASE}/api/interviews/${one.id}`);
  }
  await fetch(`${BASE}/api/analysis`);
  await fetch(`${BASE}/api/export/coding-guide.md?lang=de`);
  expect(touched()).toEqual({ added: 0, removed: 0, files: 0 });
});
