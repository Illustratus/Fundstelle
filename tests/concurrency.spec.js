import { expect, test } from "@playwright/test";

const FIRST = "interview-01";

/**
 * Two things happening at once.
 *
 * Every change reads the whole file, alters it and writes it back, and the read
 * is awaited — so two requests arriving together both read the old state and
 * the second write drops the first one's work. Two browser tabs on one study is
 * the ordinary case: twenty codings sent at once left two behind, and sixteen
 * of them failed outright, because inside one process every concurrent write
 * also shared a single temporary file name.
 */

test.beforeEach(async ({ request }) => {
  const data = await (await request.get(`/api/interviews/${FIRST}`)).json();
  for (const coding of data.codings) {
    await request.delete(`/api/interviews/${FIRST}/codings/${coding.id}`);
  }
});

test("codings sent all at once all arrive", async ({ request }) => {
  const transcript = await (await request.get(`/api/interviews/${FIRST}`)).json();
  const turns = transcript.turns
    .filter((turn) => !turn.interviewer && turn.text.length > 60)
    .slice(0, 20);
  expect(turns.length).toBe(20);

  const answers = await Promise.all(
    turns.map((turn) =>
      request.post(`/api/interviews/${FIRST}/codings`, {
        data: {
          turn: turn.number,
          start: 0,
          end: 40,
          category: "routine",
          text: turn.text.slice(0, 40),
          reviewed: true,
        },
      }),
    ),
  );
  expect(answers.filter((answer) => answer.status() === 201)).toHaveLength(20);

  const after = await (await request.get(`/api/interviews/${FIRST}`)).json();
  expect(after.codings).toHaveLength(20);
  // Each one is its own, not the same one written twenty times.
  expect(new Set(after.codings.map((coding) => coding.id)).size).toBe(20);
  expect(new Set(after.codings.map((coding) => coding.turn)).size).toBe(20);
});

test("categories added at once all survive", async ({ request }) => {
  const names = [...Array(10)].map((_, index) => `Gleichzeitig${index}`);
  const answers = await Promise.all(
    names.map((name) =>
      request.post("/api/categories", { data: { name, definition: "Am Material." } }),
    ),
  );
  expect(answers.filter((answer) => answer.status() === 201)).toHaveLength(10);

  const { categories } = await (await request.get("/api/categories")).json();
  const made = categories.filter((category) => category.name.startsWith("Gleichzeitig"));
  expect(made).toHaveLength(10);

  for (const name of names) {
    await request.delete(`/api/categories/${`ind.${name.toLowerCase()}`}`);
  }
});

test("the note and a coding written together do not overwrite each other", async ({ request }) => {
  // They live in the same file, so one careless write loses the other.
  const transcript = await (await request.get(`/api/interviews/${FIRST}`)).json();
  const turn = transcript.turns.find((one) => !one.interviewer && one.text.length > 60);

  const [memo, coding] = await Promise.all([
    request.patch(`/api/interviews/${FIRST}`, {
      data: { memo: "Gespräch lief schleppend an." },
    }),
    request.post(`/api/interviews/${FIRST}/codings`, {
      data: {
        turn: turn.number,
        start: 0,
        end: 40,
        category: "routine",
        text: turn.text.slice(0, 40),
        reviewed: true,
      },
    }),
  ]);
  expect(memo.status()).toBe(200);
  expect(coding.status()).toBe(201);

  const after = await (await request.get(`/api/interviews/${FIRST}`)).json();
  expect(after.memo).toBe("Gespräch lief schleppend an.");
  expect(after.codings).toHaveLength(1);
});

test("a change that fails does not block the ones behind it", async ({ request }) => {
  const transcript = await (await request.get(`/api/interviews/${FIRST}`)).json();
  const turn = transcript.turns.find((one) => !one.interviewer && one.text.length > 60);
  const interviewer = transcript.turns.find((one) => one.interviewer);

  // The middle one is refused; the queue must carry on regardless.
  const [first, refused, third] = await Promise.all([
    request.post(`/api/interviews/${FIRST}/codings`, {
      data: {
        turn: turn.number,
        start: 0,
        end: 30,
        category: "routine",
        text: turn.text.slice(0, 30),
      },
    }),
    request.post(`/api/interviews/${FIRST}/codings`, {
      data: { turn: interviewer.number, start: 0, end: 20, category: "routine", text: "no" },
    }),
    request.post(`/api/interviews/${FIRST}/codings`, {
      data: {
        turn: turn.number,
        start: 40,
        end: 70,
        category: "agreement",
        text: turn.text.slice(40, 70),
      },
    }),
  ]);

  expect(first.status()).toBe(201);
  expect(refused.status()).toBe(409);
  expect(third.status()).toBe(201);

  const after = await (await request.get(`/api/interviews/${FIRST}`)).json();
  expect(after.codings).toHaveLength(2);
});

/* A second process on the same folder ------------------------------------- */

test("two processes on one folder do not overwrite each other", async () => {
  /* The queue above is per process, which is no help when a container and a
     local start share a mounted folder — something the tool invites by telling
     you to point it at the folder you already have. Two stores stand in for two
     processes: they share nothing but the files. */
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { Store } = await import("../lib/store.js");

  const root = mkdtempSync(join(tmpdir(), "fundstelle-two-"));
  const make = () =>
    new Store({
      toolRoot: root,
      transcriptRoot: root,
      categoriesFile: join(root, "categories.json"),
      seedLanguage: "de",
    });
  const [one, other] = [make(), make()];
  await one.ensureSeeded("de");

  const names = [...Array(12)].map((_, index) => `Parallel${index}`);
  const answers = await Promise.allSettled(
    names.map((name, index) =>
      (index % 2 ? one : other).addCategory({ name, definition: "Am Material." }),
    ),
  );
  expect(answers.filter((answer) => answer.status === "fulfilled")).toHaveLength(12);

  const { categories } = await one.categories();
  const made = categories.filter((category) => category.name.startsWith("Parallel"));
  expect(made, "every category written by either store survives").toHaveLength(12);
});

test("a lock left behind by a process that died is broken, not waited on", async () => {
  const { mkdtempSync, writeFileSync, existsSync, utimesSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { Store } = await import("../lib/store.js");

  const root = mkdtempSync(join(tmpdir(), "fundstelle-stale-"));
  const categoriesFile = join(root, "categories.json");
  const store = new Store({
    toolRoot: root,
    transcriptRoot: root,
    categoriesFile,
    seedLanguage: "de",
  });
  await store.ensureSeeded("de");

  // What a killed process leaves: a lock with nobody behind it, old enough to
  // be plainly not real work.
  const lock = `${categoriesFile}.lock`;
  writeFileSync(lock, "999999");
  const longAgo = new Date(Date.now() - 60_000);
  utimesSync(lock, longAgo, longAgo);

  await store.addCategory({ name: "Trotzdem", definition: "Am Material." });

  const { categories } = await store.categories();
  expect(categories.some((category) => category.name === "Trotzdem")).toBe(true);
  expect(existsSync(lock), "and the lock is cleared away after").toBe(false);
});
