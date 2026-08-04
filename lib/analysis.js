/**
 * Aggregation across all interviews, and the exports for the paper.
 *
 * Two exports feed the text directly: the cross table of department by
 * category, from which the prioritization takes its count of naming
 * departments, and the coding guide with definitions, anchor examples and
 * coding rules that the appendix promises.
 *
 * Every export takes the language it is written in: the prose, the column
 * headings and the quotation marks follow the language the tool is operated in,
 * so the files land in the paper in the language the paper is written in.
 */

import { effectiveWord, matchesSlice } from "../public/search.js";
import { quoted, translator } from "./texts.js";

const TIMESTAMP = /\s*\[\d+:\d{2}\]\s*/g;

/**
 * The coding units that still have a place in the transcript.
 *
 * A unit whose passage was edited away is handed over for re-anchoring rather
 * than guessed at — that much the tool did from the start. What it also did was
 * go on counting it: the cross table, the totals and every export treated a
 * unit with no place as evidence, and the coding table quoted a sentence the
 * transcript no longer contains. That is precisely the failure the whole
 * anchoring machinery exists to prevent.
 *
 * They are not dropped from the study; the interview view still shows them and
 * says how many are waiting. They are dropped from the arithmetic, because a
 * citation nobody can point to is not evidence yet.
 */
export const placed = (codings) => codings.filter((coding) => coding.state !== "lost");

/** How many units across the study are waiting to be given a place again. */
export const displaced = (interviews) =>
  interviews.reduce(
    (n, { codings }) => n + codings.filter((coding) => coding.state === "lost").length,
    0,
  );

function quote(text) {
  return text.replace(TIMESTAMP, " ").replace(/\s+/g, " ").trim();
}

export function condense(interviews) {
  const departments = [];
  const cells = new Map();
  const byCategory = new Map();

  for (const { transcript, codings: all } of interviews) {
    const codings = placed(all);
    const department = transcript.department;
    if (!departments.includes(department)) departments.push(department);
    const turnByNumber = new Map(transcript.turns.map((turn) => [turn.number, turn]));

    for (const coding of codings) {
      const key = `${coding.category} ${department}`;
      cells.set(key, (cells.get(key) ?? 0) + 1);
      if (!byCategory.has(coding.category)) byCategory.set(coding.category, []);
      const turn = turnByNumber.get(coding.turn);
      byCategory.get(coding.category).push({
        id: coding.id,
        interview: transcript.id,
        interviewTitle: transcript.title,
        department,
        turn: coding.turn,
        time: turn?.time ?? null,
        section: turn?.section ?? null,
        sectionName: turn?.section != null ? transcript.sections[turn.section]?.name : null,
        text: quote(coding.text),
        memo: coding.memo ?? "",
        anchor: Boolean(coding.anchor),
        reviewed: coding.reviewed === true,
        requirements: coding.requirements ?? [],
      });
    }
  }

  return { departments, cells, byCategory };
}

export function analysis(interviews, categories) {
  const { departments, cells, byCategory } = condense(interviews);

  const rows = categories.map((category) => {
    const values = departments.map((d) => cells.get(`${category.id} ${d}`) ?? 0);
    const sum = values.reduce((a, b) => a + b, 0);
    return {
      category: category.id,
      name: category.name,
      parent: category.parent,
      origin: category.origin,
      proposition: category.proposition,
      values,
      sum,
      // How many of its citations are marked as anchor examples: the appendix
      // needs at least one, and the gap is worth naming before it is exported.
      anchors: (byCategory.get(category.id) ?? []).filter((one) => one.anchor).length,
      departmentsNaming: values.filter((value) => value > 0).length,
    };
  });

  const progress = interviews.map(({ transcript, codings: all, memo }) => {
    const codings = placed(all);
    const codable = transcript.turns.filter((turn) => !turn.interviewer);
    const touched = new Set(codings.map((coding) => coding.turn));
    const codedCharacters = codings.reduce((n, coding) => n + (coding.end - coding.start), 0);
    return {
      interview: transcript.id,
      title: transcript.title,
      department: transcript.department,
      memo: memo ?? "",
      turns: codable.length,
      turnsCoded: codable.filter((turn) => touched.has(turn.number)).length,
      codings: codings.length,
      characterShare: transcript.characters ? codedCharacters / transcript.characters : 0,
    };
  });

  // The guide sections across all interviews, in guide order (first mention
  // counts; unnumbered sections such as an opening stay in front that way).
  // Equal section names count as the same prompt — the distribution holds even
  // when one interview skipped a section.
  const sections = [];
  for (const { transcript } of interviews) {
    for (const section of transcript.sections) {
      if (!sections.some((known) => known.name === section.name)) {
        sections.push({ name: section.name, number: section.number, short: section.short });
      }
    }
  }

  return {
    departments,
    sections,
    rows,
    progress,
    saturation: saturation(interviews, categories),
    // Said out loud rather than left as a silent subtraction: the totals above
    // do not include these, and the reader has to know that.
    displaced: displaced(interviews),
    citations: Object.fromEntries(byCategory),
    total: rows.reduce((n, row) => n + row.sum, 0),
  };
}

/**
 * Where each category turns up for the first time.
 *
 * "How do you know you had enough interviews?" is the question every
 * qualitative study is asked, and the answer it is expected to give is that the
 * material stopped producing anything new. That is a claim about the coding,
 * and the coding is right here — so the tool can show it instead of leaving it
 * to be asserted.
 *
 * Purely descriptive, deliberately. It counts how many categories appear for
 * the first time in each interview and how many are in play by then; it does
 * not pronounce the study saturated. Where a curve has flattened enough is a
 * judgement about the material, and one no arithmetic can make.
 *
 * The order is the order the interviews are listed in, which is the order of
 * their folder names — not necessarily the order they were conducted or coded.
 * Whoever reads the figure has to be told that, so it is said with it rather
 * than left to be assumed.
 */
export function saturation(interviews, categories) {
  const known = new Set();
  const named = new Map(categories.map((category) => [category.id, category.name]));
  return interviews.map(({ transcript, codings }) => {
    const fresh = [];
    for (const coding of placed(codings)) {
      if (known.has(coding.category)) continue;
      known.add(coding.category);
      fresh.push(named.get(coding.category) ?? coding.category);
    }
    return {
      interview: transcript.id,
      title: transcript.title,
      department: transcript.department,
      fresh: fresh.length,
      names: fresh,
      total: known.size,
    };
  });
}

function escapePipes(text) {
  return text.replace(/\|/g, "\\|");
}

/** Break text onto a column width, at word boundaries. */
function wrap(text, width) {
  const lines = [];
  let current = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (!current.length) current = word;
    else if (current.length + 1 + word.length <= width) current += " " + word;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length) lines.push(current);
  return lines.length ? lines : [""];
}

/** The longest single word — the width below which a column cannot wrap cleanly. */
function longestWord(text) {
  return Math.max(0, ...String(text).split(/\s+/).map((word) => word.length));
}

/**
 * Label on the left, origin on the right, in a cell joined across both columns:
 * in a grid table that simply means leaving the separator out.
 */
function joinedRow(left, right, width) {
  return `| ${(left + " " + right).padEnd(width)} |`;
}

/** Coding guide for the appendix: definition, anchor examples, coding rules. */
export function codingGuideMarkdown(interviews, categories, language) {
  const t = translator(language);
  const { byCategory } = condense(interviews);

  /* A grid table instead of a pipe table, because only the former knows a cell
     joined across both columns: the category row. The column widths of the grid
     also determine the column widths in typesetting, which is why they are
     fixed here and not in the stylesheet. */
  const LABEL = 18;
  const CONTENT = 54;
  const rule = (character) => `+${character.repeat(LABEL + 2)}+${character.repeat(CONTENT + 2)}+`;

  /* Two class names on one div: `coding-guide` is the name to write templates
     against, `leitfaden` is what templates written for earlier versions already
     select on. Pandoc applies both, so nobody's typesetting breaks over a
     rename. */
  const lines = ["::: {.coding-guide .leitfaden}", "", rule("-")];

  let first = true;
  for (const category of categories) {
    const head = `${category.parent ? "↳ " : ""}${category.name}`;
    const kind = t(category.origin === "deductive" ? "originDeductive" : "originInductive");
    const width = LABEL + CONTENT + 3;
    // The origin carries its own markup because Pandoc collapses whitespace
    // inside a cell and it would otherwise stick to the name.
    lines.push(joinedRow(head, `[${kind}]{.art}`, width));
    // The first joined row becomes a header row through `+===+`, all further
    // ones stay ordinary rows. Pandoc typesets both as a colspan.
    lines.push(rule(first ? "=" : "-"));
    first = false;

    const field = (label, content) => {
      wrap(content, CONTENT).forEach((part, index) => {
        const left = (index === 0 ? label : "").padEnd(LABEL);
        lines.push(`| ${left} | ${part.padEnd(CONTENT)} |`);
      });
      lines.push(rule("-"));
    };

    field(t("fieldDefinition"), category.definition || t("placeholderDefinition"));
    if (category.initialDefinition) {
      // The wording a category started from: for a deductive category the one
      // the study went into the field with, for an inductive one the one it was
      // created with. Both are reportable changes to the coding guide.
      field(
        t(category.origin === "deductive" ? "fieldBeforeSurvey" : "fieldOnCreation"),
        t("sharpenedOnMaterial", { definition: category.initialDefinition }),
      );
    }

    const cited = byCategory.get(category.id) ?? [];
    const anchors = cited.filter((citation) => citation.anchor);
    /* A category with citations and none of them marked is a gap in the
       appendix, and the guide used to leave the field out altogether — so the
       omission read as "this category needs none", which is not something the
       method allows. The definition has named its gap since the beginning;
       this one says it the same way. A category nothing has been coded with
       yet is a different matter and says nothing, because there is nothing it
       could have been anchored in. */
    if (cited.length && !anchors.length) field(t("fieldAnchor"), t("placeholderAnchor"));
    anchors.forEach((anchor, index) => {
      const label =
        anchors.length === 1
          ? t("fieldAnchor")
          : t("fieldAnchorNumbered", { n: index + 1 });
      const source =
        t("anchorSource", { department: anchor.department, turn: anchor.turn }) +
        (anchor.reviewed ? "" : t("unreviewedSuffix"));
      field(label, `${quoted(t, anchor.text)} (${source})`);
    });

    const rules = (category.codingRules ?? []).map((r) => (typeof r === "string" ? r : r.text));
    rules.forEach((text, index) => {
      field(rules.length === 1 ? t("fieldRule") : t("fieldRuleNumbered", { n: index + 1 }), text);
    });
  }

  lines.push("", ":::", "");
  return [
    `# ${t("guideTitle")}`,
    "",
    ...wrap(t("guideLead"), GRID_WIDTH),
    "",
    ...lines,
  ].join("\n");
}

/**
 * The citations of one slice, as raw material for the text.
 *
 * The full citation list is a wall; what is needed while writing is the one
 * question — what does this department say about this category. The slice
 * therefore comes along exactly as it is set in the analysis.
 */
export function citationsMarkdown(interviews, categories, slice = {}, language) {
  const t = translator(language);
  const { byCategory } = condense(interviews);

  /* The same term the view would have run with. The interface sends the word it
     settled on, so this usually changes nothing — but a bare request for the
     export must not read the slice differently from the screen it is named
     after. */
  const everything = [...byCategory.values()]
    .flat()
    .map((citation) => `${citation.text} ${citation.memo ?? ""}`);
  const wording = effectiveWord(everything, slice.word, language);
  slice = { ...slice, word: wording.word };
  const named = [
    slice.department && t("sliceDepartment", { name: slice.department }),
    slice.section && t("sliceSection", { name: quoted(t, slice.section) }),
    slice.anchor && t("sliceAnchor"),
    slice.memo && t("sliceMemo"),
    slice.withoutRequirement && t("sliceOpen"),
    slice.unreviewed && t("sliceUnreviewed"),
    (slice.word ?? "").trim() && t("sliceWord", { word: quoted(t, slice.word.trim()) }),
  ].filter(Boolean);

  const lines = [
    `# ${t("citationsTitle")}`,
    "",
    named.length ? t("sliceLead", { named: named.join(", ") }) : t("sliceAll"),
    "",
  ];

  let total = 0;
  for (const category of categories) {
    const own = (byCategory.get(category.id) ?? []).filter((c) => matchesSlice(c, slice));
    if (!own.length) continue;
    total += own.length;
    lines.push(`## ${category.name} · ${own.length}`, "");
    for (const citation of own) {
      lines.push(
        `- ${quoted(t, escapePipes(citation.text))} — ` +
          t("citationSource", { department: citation.department, turn: citation.turn }) +
          (citation.sectionName ? `, ${citation.sectionName}` : "") +
          (citation.anchor ? t("citationAnchor") : "") +
          (citation.reviewed ? "" : t("citationUnreviewed")),
      );
      if (citation.memo.trim()) {
        lines.push(`  - ${t("citationNote", { note: escapePipes(citation.memo.trim()) })}`);
      }
    }
    lines.push("");
  }
  if (!total) lines.push(t("citationsNone"), "");
  return lines.join("\n");
}

/**
 * The notes taken while coding, in one place.
 *
 * The traceability of the method does not hang on the result but on the
 * decisions along the way being recorded and reportable. Coding guide and
 * coding table show the state; this export shows how it came about.
 */
export function notesMarkdown(interviews, categories, language) {
  const t = translator(language);
  const { byCategory } = condense(interviews);
  const lines = [`# ${t("notesTitle")}`, "", t("notesLead"), ""];

  const withNote = interviews.filter(({ memo }) => (memo ?? "").trim());
  if (withNote.length) {
    lines.push(`## ${t("notesOnInterviews")}`, "");
    for (const { transcript, memo } of withNote) {
      lines.push(`### ${transcript.title}`, "", memo.trim(), "");
    }
  }

  const categoryNotes = categories.filter((c) => (c.memo ?? "").trim() || c.initialDefinition);
  if (categoryNotes.length) {
    lines.push(`## ${t("notesOnCategories")}`, "");
    for (const category of categoryNotes) {
      lines.push(`### ${category.name}`, "");
      if ((category.memo ?? "").trim()) lines.push(category.memo.trim(), "");
      if (category.initialDefinition) {
        const label = t(
          category.origin === "deductive"
            ? "notesDefinitionBefore"
            : "notesDefinitionOnCreation",
        );
        lines.push(`${label}: ${category.initialDefinition}`, "");
      }
    }
  }

  const passages = categories.flatMap((category) =>
    (byCategory.get(category.id) ?? [])
      .filter((citation) => citation.memo.trim())
      .map((citation) => ({ ...citation, categoryName: category.name })),
  );
  if (passages.length) {
    lines.push(`## ${t("notesOnPassages")}`, "");
    lines.push(
      `| ${t("columnPassage")} | ${t("columnCategory")} | ${t("columnNote")} |`,
      "| --- | --- | --- |",
    );
    for (const passage of passages) {
      const where = t("citationSource", {
        department: escapePipes(passage.department),
        turn: passage.turn,
      });
      lines.push(
        `| ${where} | ${escapePipes(passage.categoryName)} | ${escapePipes(passage.memo.trim())} |`,
      );
    }
    lines.push("");
  }

  if (lines.length === 4) lines.push(t("notesNone"), "");
  return lines.join("\n");
}

/** Coding table of one interview: location, category, citation. */
export function codingTableMarkdown(transcript, codings, categories, language) {
  const t = translator(language);
  const byId = new Map(categories.map((category) => [category.id, category]));
  const turnByNumber = new Map(transcript.turns.map((turn) => [turn.number, turn]));
  // A unit whose passage was edited away has no place to point at, so the table
  // does not quote it as though it did — and says how many it left out, because
  // a silent subtraction from an appendix is worse than a line about it.
  const displacedHere = codings.filter((coding) => coding.state === "lost").length;
  const sorted = placed(codings).sort((a, b) => a.turn - b.turn || a.start - b.start);

  const lines = [
    `# ${t("codingTableTitle", { title: transcript.title })}`,
    "",
    t("codingTableLead", {
      department: transcript.department,
      total: sorted.length,
      reviewed: sorted.filter((coding) => coding.reviewed === true).length,
    }),
    "",
    t("codingTableWarning"),
    "",
    ...(displacedHere ? [t("codingTableDisplaced", { n: displacedHere }), ""] : []),
    `| ${t("columnPassage")} | ${t("columnSection")} | ${t("columnCategory")} | ` +
      `${t("columnState")} | ${t("columnCitation")} |`,
    "| --- | --- | --- | --- | --- |",
  ];
  for (const coding of sorted) {
    const turn = turnByNumber.get(coding.turn);
    const section =
      turn?.section != null ? (transcript.sections[turn.section]?.short ?? "") : "";
    lines.push(
      `| ${coding.turn} | ${escapePipes(section)} | ${escapePipes(byId.get(coding.category)?.name ?? coding.category)} ` +
        `| ${t(coding.reviewed === true ? "stateReviewed" : "stateUnreviewed")} ` +
        `| ${escapePipes(quote(coding.text))} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

/* Cross table department by category --------------------------------------- */

function matrixRows(data, categories) {
  const byId = new Map(categories.map((category) => [category.id, category]));
  return data.rows.map((row) => ({
    name: (row.parent ? "… " : "") + (byId.get(row.category)?.name ?? row.category),
    values: row.values,
    sum: row.sum,
    departmentsNaming: row.departmentsNaming,
  }));
}

/** The width every line of the grid table is set to. */
export const GRID_WIDTH = 80;

/**
 * The same cross table as a Pandoc grid table, set to a fixed line width.
 *
 * A pipe table leaves the column widths to whoever typesets it; a grid table
 * fixes them in the file, so the table looks in the manuscript the way it looks
 * here — and stays readable in a plain text editor. Long department names wrap
 * inside their column instead of pushing the table off the page.
 *
 * The width budget goes to the numbers first, because a clipped number is a
 * wrong number; the category column takes whatever is left over. With so many
 * departments that even that no longer fits, the table grows past the target
 * width rather than losing a column.
 */
export function matrixGridMarkdown(data, categories, language) {
  const t = translator(language);
  const rows = matrixRows(data, categories);
  const headers = [
    t("columnCategory"),
    ...data.departments,
    t("columnTotal"),
    t("columnDepartments"),
  ];
  const numericColumns = headers.length - 1;

  const digits = (index) =>
    Math.max(
      1,
      ...rows.map((row) => String([...row.values, row.sum, row.departmentsNaming][index]).length),
    );

  // Every column except the first is a number column: it needs room for its
  // widest value, and enough room to wrap its heading without breaking a word.
  const minimums = headers.slice(1).map((header, index) => Math.max(digits(index), 4));
  const wishes = headers.slice(1).map((header, index) =>
    Math.max(minimums[index], longestWord(header)),
  );

  const NAME_MINIMUM = 16;
  const frame = 3 * headers.length + 1;
  const budget = GRID_WIDTH - frame;

  const widths = [...minimums];
  let rest = budget - NAME_MINIMUM - minimums.reduce((a, b) => a + b, 0);
  for (let index = 0; index < numericColumns && rest > 0; index++) {
    const extra = Math.min(rest, wishes[index] - minimums[index]);
    widths[index] += extra;
    rest -= extra;
  }
  const nameWidth = Math.max(
    NAME_MINIMUM,
    budget - widths.reduce((a, b) => a + b, 0),
  );
  const all = [nameWidth, ...widths];

  const rule = (character) =>
    "+" + all.map((width) => character.repeat(width + 2)).join("+") + "+";
  // Pandoc reads the trailing colon in the header rule as right alignment.
  const headerRule =
    "+" +
    all
      .map((width, index) =>
        index === 0 ? "=".repeat(width + 2) : "=".repeat(width + 1) + ":",
      )
      .join("+") +
    "+";

  /* Padded on the right, never on the left.
     Pandoc parses the content of a grid cell as blocks, with the cell's own
     left edge as column zero — so four or more leading spaces are an indented
     code block, exactly as they would be in a document. Right-aligning the
     figures in the source did that to every one of them: the cross table
     typeset with each number in monospace inside a verbatim environment, 24 of
     them in one appendix, and Pandoc reported no problem because there was
     none to report. The alignment belongs to the colon in the header rule,
     which right-aligns the column when it is set; the source only has to keep
     the borders straight. */
  const cellLines = (cells) => {
    const wrapped = cells.map((cell, index) => wrap(cell, all[index]));
    const height = Math.max(...wrapped.map((lines) => lines.length));
    const lines = [];
    for (let line = 0; line < height; line++) {
      lines.push(
        "| " +
          wrapped.map((column, index) => (column[line] ?? "").padEnd(all[index])).join(" | ") +
          " |",
      );
    }
    return lines;
  };

  const lines = [
    `# ${t("matrixTitle")}`,
    "",
    ...wrap(t("matrixLead"), GRID_WIDTH),
    "",
    rule("-"),
  ];
  lines.push(...cellLines(headers), headerRule);
  for (const row of rows) {
    lines.push(
      ...cellLines([
        row.name,
        ...row.values.map(String),
        String(row.sum),
        String(row.departmentsNaming),
      ]),
      rule("-"),
    );
  }
  lines.push("");
  return lines.join("\n");
}

/* Requirements catalog ---------------------------------------------------- */

export const MOSCOW = [
  { id: "must", name: "Must have" },
  { id: "should", name: "Should have" },
  { id: "could", name: "Could have" },
  { id: "wont", name: "Won't have" },
];

// The same shape as in the interface: the id is stored, the name is looked up
// in the language the catalog is written in.
export const OPERATIONS = [
  { id: "filing", key: "operationFiling" },
  { id: "retrieval", key: "operationRetrieval" },
  { id: "transfer", key: "operationTransfer" },
];

const RANK = { must: 0, should: 1, could: 2, wont: 3 };

/**
 * Condenses the citations of a requirement.
 *
 * The number of naming departments is not entered but counted from the coding
 * units. Only that keeps the prioritization tied to the material, and makes it
 * change when a further interview comes in.
 */
export function catalog(interviews, requirements, categories) {
  const byCategory = new Map(categories.map((category) => [category.id, category]));
  const citations = new Map(requirements.map((requirement) => [requirement.id, []]));

  for (const { transcript, codings: all } of interviews) {
    const codings = placed(all);
    const turnByNumber = new Map(transcript.turns.map((turn) => [turn.number, turn]));
    for (const coding of codings) {
      for (const id of coding.requirements ?? []) {
        if (!citations.has(id)) continue;
        const turn = turnByNumber.get(coding.turn);
        citations.get(id).push({
          id: coding.id,
          interview: transcript.id,
          department: transcript.department,
          turn: coding.turn,
          time: turn?.time ?? null,
          category: coding.category,
          categoryName: byCategory.get(coding.category)?.name ?? coding.category,
          text: quote(coding.text),
          // A requirement can rest entirely on suggestions nobody has confirmed,
          // and the catalog is what carries the prioritization into the paper.
          reviewed: coding.reviewed === true,
        });
      }
    }
  }

  const rows = requirements.map((requirement) => {
    const own = citations.get(requirement.id) ?? [];
    const departments = [...new Set(own.map((c) => c.department))].sort((a, b) =>
      a.localeCompare(b, "de"),
    );
    const involved = [...new Set(own.map((c) => c.category))];
    return {
      ...requirement,
      citations: own,
      departments,
      categories: involved.map((id) => ({
        id,
        name: byCategory.get(id)?.name ?? id,
        proposition: byCategory.get(id)?.proposition ?? "none",
      })),
    };
  });

  rows.sort(
    (a, b) =>
      (RANK[a.moscow] ?? 9) - (RANK[b.moscow] ?? 9) ||
      b.departments.length - a.departments.length ||
      b.citations.length - a.citations.length ||
      a.title.localeCompare(b.title, "de"),
  );
  return rows;
}

const OPERATION_KEY = Object.fromEntries(OPERATIONS.map((o) => [o.id, o.key]));

export function catalogMarkdown(rows, language) {
  const t = translator(language);
  const parts = [
    `# ${t("catalogTitle")}`,
    "",
    ...wrap(t("catalogLead"), GRID_WIDTH),
    "",
    `| ${t("columnRequirement")} | ${t("columnMoscow")} | ${t("columnDepartments")} | ` +
      `${t("columnCitations")} | ${t("columnBlocks")} |`,
    "| --- | --- | ---: | ---: | --- |",
  ];
  for (const row of rows) {
    const level = MOSCOW.find((m) => m.id === row.moscow)?.name ?? t("moscowOpen");
    const blocked =
      (row.blockedOperations ?? [])
        .map((operation) => (OPERATION_KEY[operation] ? t(OPERATION_KEY[operation]) : operation))
        .join(", ") || "—";
    parts.push(
      `| ${escapePipes(row.title)} | ${level} | ${row.departments.length} | ${row.citations.length} | ${blocked} |`,
    );
  }
  parts.push("");

  for (const row of rows) {
    parts.push(`## ${row.title}`, "");
    if (row.description) parts.push(row.description, "");
    parts.push(
      t("catalogNamedBy", {
        departments: row.departments.join(", ") || t("catalogNamedByNobody"),
      }),
      "",
    );
    if (row.citations.length) {
      parts.push(t("catalogCitations"), "");
      for (const citation of row.citations) {
        const source = t("citationSource", {
          department: citation.department,
          turn: citation.turn,
        });
        parts.push(
          `- ${quoted(t, escapePipes(citation.text))} (${source}, ${citation.categoryName})` +
            (citation.reviewed ? "" : t("citationUnreviewed")),
        );
      }
      // How much of the evidence is still only a suggestion decides how far the
      // MoSCoW level above can be trusted, so it is said rather than counted up
      // by the reader.
      const open = row.citations.filter((citation) => !citation.reviewed).length;
      parts.push("", open ? t("catalogUnreviewed", { n: open, total: row.citations.length }) : "");
    }
  }
  return parts.join("\n");
}
