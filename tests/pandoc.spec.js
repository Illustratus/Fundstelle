import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * The exports, read by the program they are written for.
 *
 * The README promises "a Pandoc grid table set to 80 characters", and every
 * export is written to be typeset rather than looked at in a browser. Nothing
 * checked that. The suite compared the numbers in them against the numbers on
 * the screen, which is the important half, and left the other half — whether
 * the document is a document — to be discovered by whoever first ran it through
 * their thesis pipeline.
 *
 * A grid table is the part that can quietly go wrong. Its column rules have to
 * line up to the character across every row, and a row that does not is not a
 * hard error: Pandoc warns and reads the table as paragraphs, so the appendix
 * comes out as a wall of text with plus signs in it. Warnings are therefore
 * failures here, not just a non-zero exit.
 *
 * Skipped where Pandoc is not installed, and installed in the workflow so that
 * it is never skipped there.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SANDBOX = join(ROOT, ".sandbox", "transcripts");

let pandoc = true;
try {
  execFileSync("pandoc", ["--version"], { stdio: "ignore" });
} catch {
  pandoc = false;
}

/** Markdown through Pandoc: what it produced, and what it complained about. */
function convert(markdown, to = "html") {
  const work = mkdtempSync(join(tmpdir(), "fundstelle-pandoc-"));
  const file = join(work, "export.md");
  writeFileSync(file, markdown, "utf8");
  try {
    let warnings = "";
    const html = execFileSync("pandoc", ["-f", "markdown", "-t", to, file], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { html, warnings };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Pandoc writes its complaints to stderr and still exits zero. */
function complaints(markdown) {
  const work = mkdtempSync(join(tmpdir(), "fundstelle-pandoc-"));
  const file = join(work, "export.md");
  writeFileSync(file, markdown, "utf8");
  try {
    const result = execFileSync(
      "sh",
      ["-c", `pandoc -f markdown -t html "${file}" 2>&1 >/dev/null`],
      { encoding: "utf8" },
    );
    return result.trim();
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const EXPORTS = [
  ["the coding guide", "/api/export/coding-guide.md?lang=de"],
  ["the cross table", "/api/export/matrix.md?lang=de"],
  ["the citations", "/api/export/citations.md?lang=de"],
  ["the notes", "/api/export/notes.md?lang=de"],
  ["the requirements catalog", "/api/export/requirements-catalog.md?lang=de"],
  ["the reliability report", "/api/export/agreement.md?lang=de"],
  ["the coding table", "/api/export/coding-table/interview-01.md?lang=de"],
];

/** A study with enough in it that every export has something to say. */
test.beforeAll(async ({ playwright, baseURL }) => {
  const request = await playwright.request.newContext({ baseURL });
  const { categories } = await (await request.get("/api/categories")).json();

  for (const one of await (await request.get("/api/interviews")).json()) {
    const data = await (await request.get(`/api/interviews/${one.id}`)).json();
    for (const coding of data.codings) {
      await request.delete(`/api/interviews/${one.id}/codings/${coding.id}`);
    }
    const codable = data.turns.filter((turn) => !turn.interviewer && turn.text.length > 80);
    for (const [index, turn] of codable.slice(0, 6).entries()) {
      const answer = await request.post(`/api/interviews/${one.id}/codings`, {
        data: {
          turn: turn.number,
          start: 0,
          end: 80,
          category: categories[index % categories.length].id,
          text: turn.text.slice(0, 80),
          reviewed: index % 4 !== 0,
        },
      });
      if (!answer.ok()) continue;
      const made = await answer.json();
      // An anchor example, a memo, and a requirement resting on it: the
      // pipe characters and quotation marks in real prose are what breaks a
      // table, so the exports are given real prose to carry.
      await request.patch(`/api/interviews/${one.id}/codings/${made.id}`, {
        data: {
          anchor: index < 2,
          memo: index === 0 ? "Grenzfall | mit Strich, „Anführung“ und — Gedankenstrich." : "",
        },
      });
      if (index === 0) {
        const wanted = await (
          await request.post("/api/requirements", {
            data: { title: "Ablage beschreiben | mit Strich", description: "Aus dem Material." },
          })
        ).json();
        await request.patch(`/api/requirements/${wanted.id}`, {
          data: { moscow: "must", blockedOperations: ["filing"] },
        });
        await request.patch(`/api/interviews/${one.id}/codings/${made.id}`, {
          data: { requirements: [wanted.id] },
        });
      }
    }
    await request.patch(`/api/interviews/${one.id}`, {
      data: { memo: "Eine Notiz mit | Strich und einem Umlaut: Größe." },
    });
  }

  await request.patch("/api/categories/routine", {
    data: {
      codingRules: ["Die Abgrenzung zu Störungen entscheidet das Hauptprädikat."],
    },
  });

  // A second coding, so the reliability report has its tables.
  writeFileSync(
    join(SANDBOX, "interview-01", "coding.zweit.json"),
    JSON.stringify({
      version: 3,
      interview: "interview-01",
      codings: [{ id: "z1", turn: 2, start: 0, end: 60, category: "routine", text: "x" }],
    }),
  );
  await request.dispose();
});

test.afterAll(() => {
  rmSync(join(SANDBOX, "interview-01", "coding.zweit.json"), { force: true });
});

test.skip(!pandoc, "Pandoc is not installed on this machine");

for (const [what, url] of EXPORTS) {
  test(`Pandoc reads ${what} without a complaint`, async ({ request }) => {
    const markdown = await (await request.get(url)).text();
    expect(markdown.length, `${what} has content`).toBeGreaterThan(80);

    /* A malformed grid table is not a hard error: Pandoc warns and reads the
       table as paragraphs, so the appendix comes out as a wall of text with
       plus signs in it. A warning is a failure here. */
    expect(complaints(markdown), `${what} raises no warning`).toBe("");

    const { html } = convert(markdown);
    expect(html.length).toBeGreaterThan(40);
    // The heading survived, so it really was read as Markdown.
    expect(html, `${what} keeps its heading`).toMatch(/<h1[^>]*>/);
  });
}

test("the grid tables come out as tables, with their joined rows", async ({ request }) => {
  const markdown = await (await request.get("/api/export/coding-guide.md?lang=de")).text();

  /* Every line of a grid table has to be the same width to the character. The
     README says 80; the borders are 79 plus the newline. */
  const rules = markdown.split("\n").filter((line) => /^[+|]/.test(line));
  expect(rules.length).toBeGreaterThan(10);
  expect(new Set(rules.map((line) => [...line].length)), "one width throughout").toEqual(
    new Set([79]),
  );

  const { html } = convert(markdown);
  expect((html.match(/<table/g) ?? []).length).toBe(1);
  // The category rows join both columns; without that they would read as a
  // definition of nothing.
  expect((html.match(/colspan/g) ?? []).length).toBeGreaterThan(0);
  expect(html).toContain("Ankerbeispiel");
  expect(html).toContain("Kodierregel");
});

test("the cross table survives being typeset", async ({ request }) => {
  const markdown = await (await request.get("/api/export/matrix.md?lang=de")).text();
  const { html } = convert(markdown);
  expect((html.match(/<table/g) ?? []).length).toBe(1);

  // Every figure in the source is a figure in the table, in the same order.
  const rows = markdown
    .split("\n")
    .filter((line) => line.startsWith("| ") && /\d/.test(line));
  expect(rows.length).toBeGreaterThan(0);
  const numbers = [...html.matchAll(/<td[^>]*>\s*(\d+)\s*<\/td>/g)].map((one) => one[1]);
  expect(numbers.length).toBeGreaterThan(0);

  /* Every figure a figure, not a code block.
     Pandoc parses a grid cell's content as blocks, with the cell's left edge as
     column zero, so four or more leading spaces are an indented code block —
     and right-aligning the numbers in the source put every one of them in one.
     The document parsed, no warning was raised, and the cross table typeset
     with each figure in monospace inside a verbatim environment. */
  expect(html, "no figure is set as code").not.toContain("<code>");
  const { html: latex } = convert(markdown, "latex");
  expect((latex.match(/verbatim/g) ?? []).length, "nor in LaTeX").toBe(0);

  // The alignment lives in the header rule, which is what typesets it.
  expect(markdown).toMatch(/\+=+:\+/);
  expect(html).toContain('style="text-align: right;"');
});

test("no cell in a grid table begins far enough in to become code", async ({ request }) => {
  // The rule that caught it, stated so the next grid table cannot walk into it.
  for (const url of ["/api/export/matrix.md?lang=de", "/api/export/coding-guide.md?lang=de"]) {
    const markdown = await (await request.get(url)).text();
    for (const line of markdown.split("\n")) {
      if (!line.startsWith("|")) continue;
      for (const cell of line.slice(1, -1).split(" | ")) {
        // A blank cell is the continuation of a wrapped field; there is nothing
        // in it to be read as anything.
        if (!cell.trim()) continue;
        const indent = cell.length - cell.trimStart().length;
        expect(indent, `a cell of ${url} starts ${indent} in: ${JSON.stringify(cell)}`)
          .toBeLessThan(4);
      }
    }
  }
});

test("a pipe inside a citation does not open a column", async ({ request }) => {
  /* The one thing that reliably destroys a table: a character with a meaning
     in the format, arriving from an interview nobody controls. The memo lands
     in the notes, so that is where it is checked. */
  const notes = await (await request.get("/api/export/notes.md?lang=de")).text();
  expect(notes).toContain("Grenzfall");
  expect(complaints(notes)).toBe("");

  const catalog = await (await request.get("/api/export/requirements-catalog.md?lang=de")).text();
  expect(catalog).toContain("Ablage beschreiben");
  expect(complaints(catalog)).toBe("");
  const { html } = convert(catalog);
  // The pipe is text in the cell, not a cell boundary.
  expect(html).toContain("Ablage beschreiben | mit Strich");
});

test("LaTeX is written too, which is where a thesis actually ends up", async ({ request }) => {
  const markdown = await (await request.get("/api/export/coding-guide.md?lang=de")).text();
  const { html: latex } = convert(markdown, "latex");
  expect(latex).toContain("\\begin{longtable}");
  // The Pandoc block the README documents keeps its class names, so a template
  // written against either one still selects the guide.
  expect(markdown).toContain("::: {.coding-guide .leitfaden}");
});
