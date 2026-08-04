import { expect, test } from "@playwright/test";

/**
 * The exports say the same as the analysis.
 *
 * The Markdown files are what leaves the tool for the paper, and once they are
 * in a manuscript nobody re-derives them. A number that drifts between the
 * table on screen and the table in the appendix would be found, if at all, by a
 * reader of the finished work. So both are read here and compared: the cross
 * table cell by cell, the citations per category, the catalog per requirement,
 * and every coding table against its own count.
 */

const FIRST = "interview-01";
const SECOND = "interview-02";

/* Each test builds its own study. Without this they pile onto one another,
   `fill` runs into its own overlaps and creates almost nothing, and what is
   being compared is whatever the previous test happened to leave. */
test.beforeEach(async ({ request }) => {
  for (const interview of [FIRST, SECOND]) {
    const data = await (await request.get(`/api/interviews/${interview}`)).json();
    for (const coding of data.codings) {
      await request.delete(`/api/interviews/${interview}/codings/${coding.id}`);
    }
  }
  const { requirements } = await (await request.get("/api/requirements")).json();
  for (const requirement of requirements) {
    await request.delete(`/api/requirements/${requirement.id}`);
  }
});

/** A study with enough in it that the numbers can disagree at all. */
async function fill(request) {
  const categories = (await (await request.get("/api/categories")).json()).categories;
  let made = 0;
  for (const interview of [FIRST, SECOND]) {
    const transcript = await (await request.get(`/api/interviews/${interview}`)).json();
    const codable = transcript.turns.filter(
      (turn) => !turn.interviewer && turn.text.length > 60,
    );
    for (const [index, turn] of codable.entries()) {
      const answer = await request.post(`/api/interviews/${interview}/codings`, {
        data: {
          turn: turn.number,
          start: 0,
          end: 50,
          category: categories[index % categories.length].id,
          text: turn.text.slice(0, 50),
          reviewed: index % 3 !== 0,
          anchor: index === 0,
        },
      });
      if (answer.ok()) made += 1;
    }
  }
  expect(made).toBeGreaterThan(5);
  return made;
}

/** The rows of a Pandoc grid table, wrapped cells folded back together. */
function gridRows(markdown) {
  const lines = markdown
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()));
  const rows = [];
  for (const line of lines) {
    if (line[0]) rows.push(line);
    else if (rows.length) {
      rows[rows.length - 1] = rows[rows.length - 1].map((cell, i) => cell || line[i]);
    }
  }
  return rows;
}

test("the cross table in the appendix carries the numbers of the analysis", async ({ request }) => {
  await fill(request);
  const analysis = await (await request.get("/api/analysis")).json();
  const [header, ...body] = gridRows(
    await (await request.get("/api/export/matrix.md?lang=de")).text(),
  );

  expect(header).toEqual(["Kategorie", ...analysis.departments, "Summe", "Bereiche"]);
  expect(body).toHaveLength(analysis.rows.length);

  const nameOf = (id) => analysis.categories.find((c) => c.id === id)?.name ?? id;
  for (const row of analysis.rows) {
    const label = (row.parent ? "… " : "") + nameOf(row.category);
    const printed = body.find((one) => one[0] === label);
    expect(printed, `the table has a row for ${label}`).toBeTruthy();
    expect(printed.slice(1)).toEqual([
      ...row.values.map(String),
      String(row.sum),
      String(row.departmentsNaming),
    ]);
  }
});

test("the citations export lists every coding unit exactly once", async ({ request }) => {
  await fill(request);
  const analysis = await (await request.get("/api/analysis")).json();
  const markdown = await (await request.get("/api/export/citations.md?lang=de")).text();

  expect((markdown.match(/^- /gm) ?? []).length).toBe(analysis.total);

  // And each category's own heading carries its own count.
  const nameOf = (id) => analysis.categories.find((c) => c.id === id)?.name ?? id;
  for (const line of markdown.split("\n").filter((one) => one.startsWith("## "))) {
    const [name, count] = line.replace(/^## /, "").split(" · ");
    const row = analysis.rows.find((one) => nameOf(one.category) === name);
    expect(row, `the analysis knows the category ${name}`).toBeTruthy();
    expect(Number(count)).toBe(row.sum);
  }
});

test("every coding table accounts for all of its units", async ({ request }) => {
  await fill(request);
  const analysis = await (await request.get("/api/analysis")).json();

  for (const entry of analysis.progress) {
    const markdown = await (
      await request.get(`/api/export/coding-table/${entry.interview}.md?lang=de`)
    ).text();
    const rows = markdown
      .split("\n")
      .filter((line) => line.startsWith("| ") && !line.startsWith("| ---"));
    // One heading row plus one per unit.
    expect(rows.length - 1, `rows for ${entry.interview}`).toBe(entry.codings);

    // Every row says whether it is confirmed; nothing is left unstated, because
    // an unreviewed assignment is a suggestion and proves nothing.
    const reviewed = (markdown.match(/\| geprüft \|/g) ?? []).length;
    const unreviewed = (markdown.match(/\| \*\*ungeprüft\*\* \|/g) ?? []).length;
    expect(reviewed + unreviewed).toBe(entry.codings);
    expect(unreviewed).toBeGreaterThan(0);
  }
});

test("the catalog counts the same departments and citations as the tool", async ({ request }) => {
  await fill(request);
  const made = await (
    await request.post("/api/requirements", {
      data: { title: "Volltextsuche über alle Ablagen", moscow: "must" },
    })
  ).json();

  // Hang two citations from two interviews onto it.
  for (const interview of [FIRST, SECOND]) {
    const data = await (await request.get(`/api/interviews/${interview}`)).json();
    await request.patch(`/api/interviews/${interview}/codings/${data.codings[0].id}`, {
      data: { requirements: [made.id] },
    });
  }

  const catalog = await (await request.get("/api/requirements")).json();
  const markdown = await (
    await request.get("/api/export/requirements-catalog.md?lang=de")
  ).text();
  const rows = markdown
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| ---"))
    .slice(1)
    .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()));

  expect(rows).toHaveLength(catalog.requirements.length);
  for (const requirement of catalog.requirements) {
    const printed = rows.find((row) => row[0] === requirement.title);
    expect(printed, `the catalog prints ${requirement.title}`).toBeTruthy();
    expect(printed[2]).toBe(String(requirement.departments.length));
    expect(printed[3]).toBe(String(requirement.citations.length));
  }
});

test("the catalog says how much of its evidence is unconfirmed", async ({ request }) => {
  /* The catalog is what carries the prioritization into the paper, and a
     requirement can rest entirely on suggestions nobody has confirmed. It was
     the one export that listed its citations without saying so. */
  const requirement = await (
    await request.post("/api/requirements", {
      data: { title: "Volltextsuche über alle Ablagen", moscow: "must" },
    })
  ).json();

  const categories = (await (await request.get("/api/categories")).json()).categories;
  const transcript = await (await request.get(`/api/interviews/${FIRST}`)).json();
  const codable = transcript.turns
    .filter((turn) => !turn.interviewer && turn.text.length > 60)
    .slice(0, 3);

  for (const [index, turn] of codable.entries()) {
    const coding = await (
      await request.post(`/api/interviews/${FIRST}/codings`, {
        data: {
          turn: turn.number,
          start: 0,
          end: 45,
          category: categories[0].id,
          text: turn.text.slice(0, 45),
          reviewed: index === 0,
        },
      })
    ).json();
    await request.patch(`/api/interviews/${FIRST}/codings/${coding.id}`, {
      data: { requirements: [requirement.id] },
    });
  }

  const markdown = await (
    await request.get("/api/export/requirements-catalog.md?lang=de")
  ).text();
  const section = markdown.slice(markdown.indexOf("## Volltextsuche"));

  // Two of the three are only suggestions, and each one says so.
  expect((section.match(/\*\*\[ungeprüft\]\*\*/g) ?? []).length).toBe(2);
  expect(section).toContain("2 von 3 Belegen noch ungeprüft");

  // A confirmed citation carries no flag.
  const lines = section.split("\n").filter((line) => line.startsWith("- "));
  expect(lines).toHaveLength(3);
  expect(lines.filter((line) => !line.includes("ungeprüft"))).toHaveLength(1);
});

test("the coding guide carries every anchor example and no more", async ({ request }) => {
  await fill(request);
  const analysis = await (await request.get("/api/analysis")).json();
  const markdown = await (await request.get("/api/export/coding-guide.md?lang=de")).text();

  const anchors = Object.values(analysis.citations)
    .flat()
    .filter((citation) => citation.anchor);
  expect(anchors.length).toBeGreaterThan(0);

  /* Counted as a field label, not as a word: the lead paragraph says
     "Ankerbeispiele" too, and counting that found a discrepancy that was not
     there. */
  const labelled = (markdown.match(/^\| Ankerbeispiel/gm) ?? []).length;
  expect(labelled).toBe(anchors.length);

  for (const anchor of anchors) {
    expect(markdown).toContain(anchor.text.slice(0, 30));
  }
});
