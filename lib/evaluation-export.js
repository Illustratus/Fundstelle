/**
 * The second round, as documents for the paper.
 *
 * Four exports, one per strand the evaluation reports on: the panel (what each
 * department said in one round beside what it said in the other), the
 * pre-registered criteria counted in persons, the report by guide question,
 * and the read-out list counted before and after. Each is written from the
 * very answer the Auswertung tab draws — `panelView`, `propositionsView` and
 * `tagsView` in `evaluation-routes.js` — so a number in the appendix cannot
 * come out of a second arithmetic.
 *
 * ## What is never written
 *
 * A department that took part in one round and not in the other. The panel is
 * the departments present in both, and the prose here never says how many were
 * left out or that any were: who is missing is for the researcher to say in
 * their own words, and a sentence an export writes for them would say it.
 *
 * Tables are Pandoc grid tables set to the width the other exports use, so a
 * cell can hold a list of quotations and the table still reads in a plain
 * editor.
 */

import { GRID_WIDTH } from "./analysis.js";
import { quoted, translator } from "./texts.js";

const TIMESTAMP = /\s*\[\d+:\d{2}\]\s*/g;

const clean = (text) => String(text ?? "").replace(TIMESTAMP, " ").replace(/\s+/g, " ").trim();

/* Grid tables -------------------------------------------------------------- */

/* The helpers of `analysis.js` are module-private there; these are the same
   rules (wrap at word boundaries, pad on the right, colon for right-aligned
   columns), plus the one thing a cell of quotations needs: a list inside it. */

/** Break text onto a width, at word boundaries; an overlong word is cut. */
function wrap(text, width) {
  const lines = [];
  let current = "";
  for (let word of String(text).split(/\s+/).filter(Boolean)) {
    while (word.length > width) {
      if (current) {
        lines.push(current);
        current = "";
      }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!word) continue;
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

const longestWord = (text) => Math.max(0, ...String(text).split(/\s+/).map((word) => word.length));

/**
 * A cell is a string (one paragraph) or a list of blocks: `{ text }` for a
 * paragraph, `{ item }` for a list entry. Paragraph and list are separated by
 * a blank line, list entries are not — a tight list, as Pandoc reads it.
 */
const blocksOf = (cell) => (Array.isArray(cell) ? cell : [{ text: String(cell ?? "") }]);

function cellLines(cell, width) {
  const lines = [];
  let previous = null;
  for (const block of blocksOf(cell)) {
    const kind = block.item !== undefined ? "item" : "text";
    if (previous && !(previous === "item" && kind === "item")) lines.push("");
    if (kind === "item") {
      wrap(block.item, width - 2).forEach((part, index) => lines.push(`${index ? "  " : "- "}${part}`));
    } else {
      lines.push(...wrap(block.text, width));
    }
    previous = kind;
  }
  return lines.length ? lines : [""];
}

const cellWords = (cell) => blocksOf(cell).map((block) => block.item ?? block.text).join(" ");

/**
 * A grid table at `GRID_WIDTH`.
 *
 * `columns` are `{ header, right?, flex? }`. Every column is at least as wide
 * as its longest word (capped, a quotation may hold a URL); what is left of the
 * width goes to the flexible columns, the ones holding prose. With too many
 * columns for the width the table grows rather than clipping a number.
 */
export function gridTable(columns, rows) {
  const CAP = 24;
  const widths = columns.map((column, index) =>
    Math.max(
      column.right ? 4 : 6,
      Math.min(CAP, longestWord(column.header)),
      ...rows.map((row) => Math.min(CAP, longestWord(cellWords(row[index])) + (Array.isArray(row[index]) ? 2 : 0))),
    ),
  );
  const frame = 3 * columns.length + 1;
  const flexible = columns.map((column, index) => (column.flex ? index : -1)).filter((index) => index >= 0);
  let rest = GRID_WIDTH - frame - widths.reduce((a, b) => a + b, 0);
  if (flexible.length && rest > 0) {
    const share = Math.floor(rest / flexible.length);
    for (const index of flexible) widths[index] += share;
    rest -= share * flexible.length;
    widths[flexible[0]] += rest;
  } else if (!flexible.length && rest > 0) {
    // No prose column: the first column takes the room, so the table spans the
    // width the other exports have.
    widths[0] += rest;
  }

  const rule = (character) => "+" + widths.map((width) => character.repeat(width + 2)).join("+") + "+";
  const headerRule =
    "+" +
    widths
      .map((width, index) => (columns[index].right ? "=".repeat(width + 1) + ":" : "=".repeat(width + 2)))
      .join("+") +
    "+";
  const rowLines = (cells) => {
    const wrapped = cells.map((cell, index) => cellLines(cell, widths[index]));
    const height = Math.max(...wrapped.map((lines) => lines.length));
    const lines = [];
    for (let line = 0; line < height; line += 1) {
      lines.push(
        "| " + wrapped.map((column, index) => (column[line] ?? "").padEnd(widths[index])).join(" | ") + " |",
      );
    }
    return lines;
  };

  const lines = [rule("-"), ...rowLines(columns.map((column) => column.header)), headerRule];
  for (const row of rows) lines.push(...rowLines(row), rule("-"));
  return lines;
}

/* Shared wording ------------------------------------------------------------ */

const roundName = (rounds, id) => rounds.find((one) => one.id === id)?.name ?? id;

const STANCE_KEYS = { supports: "evxStanceSupports", contradicts: "evxStanceContradicts" };

/**
 * What follows a quotation: where it stands, its stances, whether it is
 * checked. A stance is named with its proposition — "Konversationsprinzip
 * stützt" — except where the document is about one proposition already
 * (`proposition`), where the stance alone is enough.
 */
function unitTail(t, unit, { department = null, propositions = {}, proposition = null } = {}) {
  const where = department
    ? t("citationSource", { department, turn: unit.turn })
    : t("evxTurn", { turn: unit.turn });
  const stances = Object.entries(unit.stances ?? {}).filter(([id, stance]) =>
    STANCE_KEYS[stance] && (!proposition || id === proposition),
  );
  const marks = stances.map(([id, stance]) =>
    proposition ? t(STANCE_KEYS[stance]) : `${propositions[id]?.name ?? id} ${t(STANCE_KEYS[stance])}`,
  );
  return (
    `(${where})` +
    (marks.length ? ` [${marks.join(", ")}]` : "") +
    (unit.reviewed ? "" : t("citationUnreviewed"))
  );
}

const unitLine = (t, unit, options) => `${quoted(t, clean(unit.text))} ${unitTail(t, unit, options)}`;

/* The panel ---------------------------------------------------------------- */

/**
 * Per category, a table of the compared departments: the units of the earlier
 * round beside those of the later one, each cell opened by its count.
 * Categories nothing was coded with in either round are left out and the lead
 * says so; asked for one category, its table stands even when empty.
 */
export function evaluationPanelMarkdown(panel, { rounds, language, only = null, propositions = {} }) {
  const t = translator(language);
  const from = roundName(rounds, panel.from);
  const to = roundName(rounds, panel.to);
  const lines = [
    `# ${t("evxPanelTitle", { from, to })}`,
    "",
    ...wrap(t("evxPanelLead", { from, to }), GRID_WIDTH),
    "",
  ];
  const cell = (side) => [
    { text: t("evxUnits", { n: side.count }) },
    ...side.units.map((unit) => ({ item: unitLine(t, unit, { propositions }) })),
  ];
  const rows = panel.categories.filter(
    (row) => only || row.cells.some((one) => one.from.count || one.to.count),
  );
  if (!only && rows.length < panel.categories.length) {
    lines.push(...wrap(t("evxPanelSkipped"), GRID_WIDTH), "");
  }
  if (!rows.length) lines.push(...wrap(t("evxPanelEmpty"), GRID_WIDTH), "");
  for (const row of rows) {
    const before = row.cells.reduce((n, one) => n + one.from.count, 0);
    const after = row.cells.reduce((n, one) => n + one.to.count, 0);
    lines.push(`## ${row.parent ? "… " : ""}${row.name} · ${before} → ${after}`, "");
    lines.push(
      ...gridTable(
        [{ header: t("department") }, { header: from, flex: true }, { header: to, flex: true }],
        row.cells.map((one) => [one.department, cell(one.from), cell(one.to)]),
      ),
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

/* The read-out list -------------------------------------------------------- */

/** Per compared department: listed in the first round, still searched, no longer, open. */
export function evaluationReadoutMarkdown(panel, { rounds, language }) {
  const t = translator(language);
  const from = roundName(rounds, panel.from);
  const to = roundName(rounds, panel.to);
  const lines = [
    `# ${t("evxReadoutTitle")}`,
    "",
    ...wrap(t("evxReadoutLead", { from, to }), GRID_WIDTH),
    "",
  ];
  if (!panel.readout.length) {
    lines.push(...wrap(t("evxReadoutNone"), GRID_WIDTH), "");
    return `${lines.join("\n")}\n`;
  }
  lines.push(
    ...gridTable(
      [
        { header: t("department") },
        { header: t("evxColumnList"), flex: true },
        { header: t("evxColumnListed"), right: true },
        { header: t("evxColumnStill"), right: true },
        { header: t("evxColumnNoLonger"), right: true },
        { header: t("evxColumnOpen"), right: true },
      ],
      panel.readout.map((one) => [
        one.department,
        one.label || "—",
        String(one.listed),
        String(one.still),
        String(one.noLonger),
        String(one.open),
      ]),
    ),
    "",
  );
  const stateName = {
    still: t("evxStateStill"),
    "no-longer": t("evxStateNoLonger"),
  };
  for (const one of panel.readout) {
    lines.push(`## ${one.department}${one.label ? ` · ${one.label}` : ""}`, "");
    for (const item of one.items) {
      lines.push(`- ${item.item}: ${stateName[item.state] ?? t("evxStateOpen")}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

/* The propositions ------------------------------------------------------- */

function thresholdText(t, threshold) {
  if (threshold?.none) return t("evxThresholdNone");
  if (threshold?.atLeast !== undefined) return t("evxThresholdAtLeast", { n: threshold.atLeast });
  return t("evxThresholdFraction", { fraction: String(threshold?.fraction ?? "") });
}

const STATUS_KEYS = {
  supported: "evxStatusSupported",
  falsified: "evxStatusFalsified",
  both: "evxStatusBoth",
  open: "evxStatusOpen",
};

const VERDICT_KEYS = { supported: "evxVerdictSupported", falsified: "evxVerdictFalsified" };

/** A criterion in one line: round, stance, categories, base, and how it is decided. */
function ruleOf(t, criterion, { rounds, categoryName }) {
  const parts = [t("evxRuleRound", { round: roundName(rounds, criterion.round) })];
  // Decided by hand from outside the interviews: stance, category and base say nothing.
  if (criterion.kind === "manual" && !criterion.stance && !criterion.categories?.length) {
    return t("evxRule", { rule: [...parts, t("evxRuleManualOutside")].join(", ") });
  }
  parts.push(criterion.stance ? t("evxRuleStance", { stance: t(STANCE_KEYS[criterion.stance]) }) : t("evxRuleAnyStance"));
  parts.push(
    criterion.categories?.length
      ? t("evxRuleCategories", { categories: criterion.categories.map(categoryName).join(", ") })
      : t("evxRuleAllCategories"),
  );
  parts.push(t(criterion.base === "testable" ? "evxRuleBaseTestable" : "evxRuleBaseAll"));
  parts.push(
    criterion.kind === "manual"
      ? t("evxRuleManual")
      : t("evxRuleThreshold", { threshold: thresholdText(t, criterion.threshold) }),
  );
  return t("evxRule", { rule: parts.join(", ") });
}

/** The persons cell of the criteria table. */
function countText(t, criterion) {
  if (criterion.kind === "manual") {
    return criterion.count == null
      ? t("evxCountManualNone")
      : t("evxCountManual", { count: criterion.count, persons: criterion.persons });
  }
  if (criterion.threshold?.none) return t("evxCountNone", { count: criterion.count, persons: criterion.persons });
  return t("evxCountOf", { count: criterion.count, persons: criterion.persons, required: criterion.required });
}

const metText = (t, criterion) =>
  criterion.met === null ? t("evxByHand") : t(criterion.met ? "evxYes" : "evxNo");

/**
 * Every proposition that makes a claim: per round its stances counted in
 * persons, who is not checkable and why, who said both, the status as
 * computed — never settled here — and, per criterion, the persons counted
 * against its threshold, who meets it, and the deviant cases with what they
 * said that bears on it. Unreviewed evidence is counted and named.
 */
export function evaluationPropositionsMarkdown(view, { rounds, categories, language, propositions = {} }) {
  const t = translator(language);
  const categoryName = (id) => categories.find((one) => one.id === id)?.name ?? id;
  const lines = [`# ${t("evxPropositionsTitle")}`, "", ...wrap(t("evxPropositionsLead"), GRID_WIDTH), ""];
  if (!view.propositions.length) {
    lines.push(...wrap(t("evxPropositionsNone"), GRID_WIDTH), "");
    return `${lines.join("\n")}\n`;
  }
  const paragraph = (text) => lines.push(...wrap(text, GRID_WIDTH), "");
  for (const proposition of view.propositions) {
    const line = (unit) => unitLine(t, unit, { propositions, proposition: proposition.id });
    lines.push(`## ${proposition.name}`, "");
    for (const round of proposition.rounds) {
      const name = roundName(rounds, round.round);
      paragraph(
        t("evxRoundStatus", { round: name, status: t(STATUS_KEYS[round.status]), persons: round.persons }) +
          (round.testable !== round.persons ? ` ${t("evxTestable", { n: round.testable })}` : ""),
      );
      for (const verdict of round.pending) {
        paragraph(t("evxPending", { verdict: t(STATUS_KEYS[verdict]) }));
      }
      const who = (list) => (list.length ? list.join(", ") : "—");
      lines.push(
        ...gridTable(
          [{ header: t("evxColumnStance") }, { header: t("evxColumnPersons"), right: true }, { header: t("evxColumnDepartments"), flex: true }],
          [
            [t("evxStanceSupports"), String(round.tally.supports.length), who(round.tally.supports)],
            [t("evxStanceContradicts"), String(round.tally.contradicts.length), who(round.tally.contradicts)],
            [t("evxStanceNeither"), String(round.tally.neither.length), who(round.tally.neither)],
          ],
        ),
        "",
      );
      if (round.split.length) {
        paragraph(t("evxSplit", { departments: round.split.map((one) => one.department).join(", ") }));
      }
      if (round.untestable.length) {
        lines.push(t("evxUntestableHeading"), "");
        for (const one of round.untestable) {
          lines.push(`- ${one.department}: ${one.reason}${one.present ? "" : ` ${t("evxUntestableAbsent")}`}`);
        }
        lines.push("");
      }
      if (round.uncoded.length) paragraph(t("evxUncoded", { departments: round.uncoded.join(", ") }));
    }
    if (!proposition.criteria.length) {
      paragraph(t("evxNoCriteria"));
    } else {
      lines.push(
        ...gridTable(
          [
            { header: t("evxColumnCriterion"), flex: true },
            { header: t("evxColumnVerdict") },
            { header: t("evxColumnPersons") },
            { header: t("evxColumnMet") },
          ],
          proposition.criteria.map((criterion) => [
            [
              ...(criterion.text ? [{ text: criterion.text }] : []),
              { text: ruleOf(t, criterion, { rounds, categoryName }) },
            ],
            t(VERDICT_KEYS[criterion.verdict]),
            countText(t, criterion),
            metText(t, criterion),
          ]),
        ),
        "",
      );
      for (const verdict of ["supported", "falsified"]) {
        const of = proposition.criteria.filter((one) => one.verdict === verdict);
        if (of.length > 1) {
          paragraph(t(proposition.combine?.[verdict] === "any" ? "evxCombineAny" : "evxCombineAll", { verdict: t(VERDICT_KEYS[verdict]) }));
        }
      }
    }
    // A person who also said the opposite is marked here; what they said
    // against stands once, with the deviant cases of the round.
    const persons = (list) => {
      for (const person of list) {
        lines.push(
          `- ${person.department}` +
            (person.opposite?.length ? ` ${t("evxAlsoOpposite")}` : "") +
            (person.units.length ? "" : `: ${t("evxDeviantNothing")}`),
        );
        for (const unit of person.units) lines.push(`    - ${line(unit)}`);
      }
      lines.push("");
    };
    for (const criterion of proposition.criteria) {
      lines.push(`### ${criterion.text || ruleOf(t, criterion, { rounds, categoryName })}`, "");
      if (criterion.unreviewed) paragraph(t("evxUnreviewedWarning", { n: criterion.unreviewed }));
      if (criterion.untestable?.length) {
        paragraph(t("evxLeftOut", { departments: criterion.untestable.map((one) => one.department).join(", ") }));
      }
      if (criterion.count == null) {
        paragraph(t("evxNoEvidence"));
        continue;
      }
      const none = Boolean(criterion.threshold?.none);
      const manual = criterion.kind === "manual";
      const withKey = none ? "evxNamingHeading" : manual ? "evxWithEvidenceHeading" : "evxMeetingHeading";
      const withoutKey = none ? "evxNotNamingHeading" : manual ? "evxWithoutEvidenceHeading" : "evxDeviantHeading";
      lines.push(`#### ${t(withKey, { n: criterion.meeting.length, persons: criterion.persons })}`, "");
      if (criterion.meeting.length) persons(criterion.meeting);
      lines.push(`#### ${t(withoutKey, { n: criterion.deviant.length, persons: criterion.persons })}`, "");
      if (criterion.deviant.length) {
        if (!none && !manual) paragraph(t("evxDeviantLead"));
        persons(criterion.deviant);
      }
    }
    for (const round of proposition.rounds.filter((one) => one.split.length)) {
      lines.push(`### ${t("evxSplitHeading", { round: roundName(rounds, round.round) })}`, "");
      paragraph(t("evxSplitLead"));
      for (const person of round.split) {
        lines.push(`- ${person.department}`);
        for (const unit of [...person.contradicts, ...person.supports]) lines.push(`    - ${line(unit)}`);
      }
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
}

/* By guide question -------------------------------------------------------- */

/**
 * Units by the tag of the guide question they answer, grouped by department
 * within a tag, each quotation followed by the question it was assigned to.
 */
export function evaluationTagsMarkdown(report, { rounds, blocks, language, propositions = {} }) {
  const t = translator(language);
  const items = new Map();
  for (const block of blocks) {
    for (const item of [...block.checklist, ...block.mandatory]) items.set(item.id, { ...item, blockName: block.name });
  }
  const total = report.unassigned + report.tags.reduce((n, one) => n + one.units.length, 0) +
    report.untagged.units.length + report.unknownQuestion.length;
  const lines = [
    `# ${t("evxTagsTitle", { round: roundName(rounds, report.round) })}`,
    "",
    ...wrap(t("evxTagsLead"), GRID_WIDTH),
    "",
    ...wrap(t("evxTagsUnassigned", { n: report.unassigned, total }), GRID_WIDTH),
    "",
  ];

  const group = (heading, entry, questions) => {
    lines.push(`## ${heading}`, "");
    if (questions.length) {
      lines.push(`${t("evxTagsQuestions")}`, "");
      for (const item of questions) lines.push(`- ${quoted(t, item.text)} (${item.blockName ?? items.get(item.id)?.blockName ?? ""})`);
      lines.push("");
    }
    lines.push(t("evxTagsSummary", { units: entry.units.length, departments: entry.departments }), "");
    const byDepartment = new Map();
    for (const unit of entry.units) {
      if (!byDepartment.has(unit.department)) byDepartment.set(unit.department, []);
      byDepartment.get(unit.department).push(unit);
    }
    for (const [department, units] of byDepartment) {
      lines.push(`### ${department} · ${units.length}`, "");
      for (const unit of units) {
        const question = items.get(unit.question);
        lines.push(
          `- ${unitLine(t, unit, { propositions })}` +
            (question ? ` — ${t("evxQuestion", { text: quoted(t, question.text) })}` : ""),
        );
      }
      lines.push("");
    }
  };

  if (!report.tags.length && !report.untagged.units.length) {
    lines.push(...wrap(t("evxTagsNoTags"), GRID_WIDTH), "");
  }
  for (const tag of report.tags) {
    group(tag.tag, tag, tag.items.map((item) => ({ ...item, blockName: items.get(item.id)?.blockName })));
  }
  if (report.untagged.units.length) {
    group(t("evxTagsUntagged"), report.untagged, []);
  }
  if (report.unknownQuestion.length) {
    lines.push(`## ${t("evxTagsUnknown")}`, "");
    for (const unit of report.unknownQuestion) {
      lines.push(`- ${unitLine(t, unit, { department: unit.department, propositions })}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
