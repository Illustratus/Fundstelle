/**
 * Aggregation across all interviews, and the exports for the paper.
 *
 * Two exports feed the text directly: the cross table of department by
 * category, from which the prioritization takes its count of naming
 * departments, and the coding guide with definitions, anchor examples and
 * coding rules that the appendix promises.
 *
 * The export prose is German because the exports feed a German paper; the
 * interface is bilingual, the files it writes are not.
 */

import { matchesSlice } from "../public/search.js";

const TIMESTAMP = /\s*\[\d+:\d{2}\]\s*/g;

function quote(text) {
  return text.replace(TIMESTAMP, " ").replace(/\s+/g, " ").trim();
}

export function condense(interviews) {
  const departments = [];
  const cells = new Map();
  const byCategory = new Map();

  for (const { transcript, codings } of interviews) {
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
      departmentsNaming: values.filter((value) => value > 0).length,
    };
  });

  const progress = interviews.map(({ transcript, codings, memo }) => {
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
    citations: Object.fromEntries(byCategory),
    total: rows.reduce((n, row) => n + row.sum, 0),
  };
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
export function codingGuideMarkdown(interviews, categories) {
  const { byCategory } = condense(interviews);

  /* A grid table instead of a pipe table, because only the former knows a cell
     joined across both columns: the category row. The column widths of the grid
     also determine the column widths in typesetting, which is why they are
     fixed here and not in the stylesheet. */
  const LABEL = 18;
  const CONTENT = 54;
  const rule = (character) => `+${character.repeat(LABEL + 2)}+${character.repeat(CONTENT + 2)}+`;

  const lines = ["::: {.leitfaden}", "", rule("-")];

  let first = true;
  for (const category of categories) {
    const head = `${category.parent ? "↳ " : ""}${category.name}`;
    const kind = category.origin === "deductive" ? "deduktiv" : "induktiv";
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

    field("Definition", category.definition || "[PLATZHALTER: Definition]");
    if (category.initialDefinition) {
      // The wording a category started from: for a deductive category the one
      // the study went into the field with, for an inductive one the one it was
      // created with. Both are reportable changes to the coding guide.
      field(
        category.origin === "deductive" ? "Vor der Erhebung" : "Beim Anlegen",
        `${category.initialDefinition} — am Material geschärft.`,
      );
    }

    const anchors = (byCategory.get(category.id) ?? []).filter((citation) => citation.anchor);
    anchors.forEach((anchor, index) => {
      const label = anchors.length === 1 ? "Ankerbeispiel" : `Ankerbeispiel ${index + 1}`;
      field(
        label,
        `„${anchor.text}" (${anchor.department}, Beitrag ${anchor.turn}${anchor.reviewed ? "" : ", ungeprüft"})`,
      );
    });

    const rules = (category.codingRules ?? []).map((r) => (typeof r === "string" ? r : r.text));
    rules.forEach((text, index) => {
      field(rules.length === 1 ? "Kodierregel" : `Kodierregel ${index + 1}`, text);
    });
  }

  lines.push("", ":::", "");
  return [
    "# Kodierleitfaden",
    "",
    "Erzeugt vom Kodierwerkzeug aus dem Stand der Kodierung. Die deduktiven",
    "Definitionen stammen aus dem Kategoriensystem vor der Erhebung;",
    "Ankerbeispiele und Kodierregeln sind am Material entstanden. Wo eine",
    "Definition in der Rücküberprüfung geschärft wurde, steht der Wortlaut vor",
    "der Schärfung mit dabei.",
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
export function citationsMarkdown(interviews, categories, slice = {}) {
  const { byCategory } = condense(interviews);
  const named = [
    slice.department && `Bereich ${slice.department}`,
    slice.section && `Erzählanstoß „${slice.section}"`,
    slice.anchor && "nur Ankerbeispiele",
    slice.memo && "nur mit Notiz",
    slice.withoutRequirement && "noch ohne Anforderung",
    slice.unreviewed && "nur ungeprüfte",
    (slice.word ?? "").trim() && `Wortlaut „${slice.word.trim()}"`,
  ].filter(Boolean);

  const lines = [
    "# Belege",
    "",
    named.length
      ? `Schnitt: ${named.join(", ")}.`
      : "Alle Kodiereinheiten, ohne Einschränkung.",
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
        `- „${escapePipes(citation.text)}" — ${citation.department}, Beitrag ${citation.turn}` +
          (citation.sectionName ? `, ${citation.sectionName}` : "") +
          (citation.anchor ? ", Ankerbeispiel" : "") +
          (citation.reviewed ? "" : " **[ungeprüft]**"),
      );
      if (citation.memo.trim()) lines.push(`  - Notiz: ${escapePipes(citation.memo.trim())}`);
    }
    lines.push("");
  }
  if (!total) lines.push("Kein Beleg passt zu diesem Schnitt.", "");
  return lines.join("\n");
}

/**
 * The notes taken while coding, in one place.
 *
 * The traceability of the method does not hang on the result but on the
 * decisions along the way being recorded and reportable. Coding guide and
 * coding table show the state; this export shows how it came about.
 */
export function notesMarkdown(interviews, categories) {
  const { byCategory } = condense(interviews);
  const lines = [
    "# Notizen zum Kodiervorgang",
    "",
    "Erzeugt vom Kodierwerkzeug. Arbeitsnotizen, keine Ergebnisdarstellung.",
    "",
  ];

  const withNote = interviews.filter(({ memo }) => (memo ?? "").trim());
  if (withNote.length) {
    lines.push("## Zu den Interviews", "");
    for (const { transcript, memo } of withNote) {
      lines.push(`### ${transcript.title}`, "", memo.trim(), "");
    }
  }

  const categoryNotes = categories.filter((c) => (c.memo ?? "").trim() || c.initialDefinition);
  if (categoryNotes.length) {
    lines.push("## Zu den Kategorien", "");
    for (const category of categoryNotes) {
      lines.push(`### ${category.name}`, "");
      if ((category.memo ?? "").trim()) lines.push(category.memo.trim(), "");
      if (category.initialDefinition) {
        lines.push(
          `${category.origin === "deductive" ? "Definition vor der Erhebung" : "Definition beim Anlegen"}: ${category.initialDefinition}`,
          "",
        );
      }
    }
  }

  const passages = categories.flatMap((category) =>
    (byCategory.get(category.id) ?? [])
      .filter((citation) => citation.memo.trim())
      .map((citation) => ({ ...citation, categoryName: category.name })),
  );
  if (passages.length) {
    lines.push("## Zu einzelnen Fundstellen", "");
    lines.push("| Fundstelle | Kategorie | Notiz |", "| --- | --- | --- |");
    for (const passage of passages) {
      lines.push(
        `| ${escapePipes(passage.department)}, Beitrag ${passage.turn} | ${escapePipes(passage.categoryName)} | ${escapePipes(passage.memo.trim())} |`,
      );
    }
    lines.push("");
  }

  if (lines.length === 4) lines.push("Noch keine Notizen festgehalten.", "");
  return lines.join("\n");
}

/** Coding table of one interview: location, category, citation. */
export function codingTableMarkdown(transcript, codings, categories) {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const turnByNumber = new Map(transcript.turns.map((turn) => [turn.number, turn]));
  const sorted = [...codings].sort((a, b) => a.turn - b.turn || a.start - b.start);

  const lines = [
    `# Kodiertabelle ${transcript.title}`,
    "",
    `Bereich: ${transcript.department}. Kodierungen: ${sorted.length}, davon ` +
      `${sorted.filter((coding) => coding.reviewed === true).length} geprüft.`,
    "",
    "Eine ungeprüfte Zuordnung ist ein Vorschlag und belegt nichts.",
    "",
    "| Fundstelle | Block | Kategorie | Stand | Beleg |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const coding of sorted) {
    const turn = turnByNumber.get(coding.turn);
    const section =
      turn?.section != null ? (transcript.sections[turn.section]?.short ?? "") : "";
    lines.push(
      `| ${coding.turn} | ${escapePipes(section)} | ${escapePipes(byId.get(coding.category)?.name ?? coding.category)} ` +
        `| ${coding.reviewed === true ? "geprüft" : "**ungeprüft**"} | ${escapePipes(quote(coding.text))} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

/* Cross table department by category --------------------------------------- */

const MATRIX_TITLE = "Kategorien nach Bereich";
const MATRIX_LEAD =
  "Kodiereinheiten je Kategorie und Bereich. Die Spalte „Bereiche“ zählt, wie " +
  "viele der befragten Bereiche eine Kategorie überhaupt ansprechen; sie trägt " +
  "in die Priorisierung des Anforderungskatalogs.";

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
export function matrixGridMarkdown(data, categories) {
  const rows = matrixRows(data, categories);
  const headers = ["Kategorie", ...data.departments, "Summe", "Bereiche"];
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

  const cellLines = (cells) => {
    const wrapped = cells.map((cell, index) => wrap(cell, all[index]));
    const height = Math.max(...wrapped.map((lines) => lines.length));
    const lines = [];
    for (let line = 0; line < height; line++) {
      lines.push(
        "| " +
          wrapped
            .map((column, index) => {
              const text = column[line] ?? "";
              return index === 0 ? text.padEnd(all[index]) : text.padStart(all[index]);
            })
            .join(" | ") +
          " |",
      );
    }
    return lines;
  };

  const lines = [`# ${MATRIX_TITLE}`, "", ...wrap(MATRIX_LEAD, GRID_WIDTH), "", rule("-")];
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

export const OPERATIONS = [
  { id: "filing", name: "Ablage" },
  { id: "retrieval", name: "Abruf" },
  { id: "transfer", name: "Transfer" },
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

  for (const { transcript, codings } of interviews) {
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

const OPERATION_NAME = Object.fromEntries(OPERATIONS.map((o) => [o.id, o.name]));

export function catalogMarkdown(rows) {
  const parts = [
    "# Priorisierter Anforderungskatalog",
    "",
    "Erzeugt aus den Kodierungen. Die Spalte „Bereiche\" zählt, wie viele der",
    "befragten Bereiche die Anforderung ansprechen; „blockiert\" nennt die",
    "Operationen, deren Ausbleiben die Anforderung nach Einschätzung des",
    "Verfassers verhindert. Beide zusammen tragen die MoSCoW-Stufe.",
    "",
    "| Anforderung | MoSCoW | Bereiche | Belege | blockiert |",
    "| --- | --- | ---: | ---: | --- |",
  ];
  for (const row of rows) {
    const level = MOSCOW.find((m) => m.id === row.moscow)?.name ?? "offen";
    const blocked =
      (row.blockedOperations ?? []).map((o) => OPERATION_NAME[o] ?? o).join(", ") || "—";
    parts.push(
      `| ${escapePipes(row.title)} | ${level} | ${row.departments.length} | ${row.citations.length} | ${blocked} |`,
    );
  }
  parts.push("");

  for (const row of rows) {
    parts.push(`## ${row.title}`, "");
    if (row.description) parts.push(row.description, "");
    parts.push(`Genannt von: ${row.departments.join(", ") || "noch keinem Bereich"}.`, "");
    if (row.citations.length) {
      parts.push("**Belege.**", "");
      for (const citation of row.citations) {
        parts.push(
          `- „${escapePipes(citation.text)}" (${citation.department}, Beitrag ${citation.turn}, ${citation.categoryName})`,
        );
      }
      parts.push("");
    }
  }
  return parts.join("\n");
}
