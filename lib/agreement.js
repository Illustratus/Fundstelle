/**
 * How far two coders agree.
 *
 * Every content analysis that goes into a paper is asked the same question at
 * some point: did anyone else code this, and did they arrive at the same
 * result? Mayring answers it with intercoder reliability, and until now this
 * tool had no answer at all — which is the one hole a supervisor is guaranteed
 * to find.
 *
 * Nothing about the workflow changes for it. The second coder runs their own
 * copy of Fundstelle on the same transcripts, which is what local-first is for,
 * and hands over their `coding.json`. It goes next to the first one as
 * `coding.<name>.json` and is never written to. What follows is arithmetic.
 *
 * ## The unit, which is the whole argument
 *
 * Two coders do not segment alike: one marks a sentence, the other the two
 * sentences around it. Comparing segments directly would then count a
 * difference in where a passage was cut as a difference in what it means. So
 * the unit here is the **speaker turn, per category**: for every turn either
 * coder could code, and every category, each of them either used that category
 * somewhere in that turn or did not. That is a decision both coders really
 * made, and it survives different segmentation.
 *
 * It has to be stated wherever the number is shown. A kappa without its unit
 * says nothing — the same two coders can produce 0.4 or 0.9 depending on what
 * one chooses to count, and the choice is not a detail.
 *
 * ## What is reported, and why not just one number
 *
 * Cohen's kappa alone is misleading here and known to be: when almost every
 * cell is "neither coder used this category", chance agreement is high and
 * kappa drops even though the two agree nearly everywhere. That is the kappa
 * paradox, and it is a property of the measure, not a fault of the coding. So
 * the raw agreement, the four cell counts and the number of units are reported
 * beside it, and per category as well — where the skew is, is visible.
 *
 * The list of passages the two read differently comes with it. That list, not
 * the coefficient, is what a consensus round actually works from.
 */

/** Cohen's kappa for a 2×2 table, or null where it is not defined. */
export function kappa({ both, onlyFirst, onlySecond, neither }) {
  const total = both + onlyFirst + onlySecond + neither;
  if (!total) return null;
  const observed = (both + neither) / total;
  const expected =
    (((both + onlyFirst) * (both + onlySecond)) / total +
      ((onlySecond + neither) * (onlyFirst + neither)) / total) /
    total;
  // Both coders used the category everywhere, or neither used it anywhere:
  // chance alone explains the agreement and the coefficient has no value. A
  // zero would read as "they disagree", which is the opposite of the truth.
  if (expected >= 1) return null;
  return (observed - expected) / (1 - expected);
}

/**
 * The customary reading of a coefficient, named as the convention it is.
 *
 * Landis and Koch's bands are a habit of the literature, not a measurement.
 * They are offered as a word for the number and labelled as borrowed, because
 * a threshold presented as a fact is how „κ = .61" turns into „good" in a
 * paper without anyone having thought about it.
 */
export function band(value) {
  if (value == null) return null;
  if (value < 0) return "none";
  if (value < 0.21) return "slight";
  if (value < 0.41) return "fair";
  if (value < 0.61) return "moderate";
  if (value < 0.81) return "substantial";
  return "almost";
}

/** The turns of an interview that may carry a coding at all. */
const codable = (transcript) => transcript.turns.filter((turn) => !turn.interviewer);

/** Which categories a coder used in a turn. */
function usedIn(codings) {
  const found = new Map();
  for (const coding of codings) {
    if (!found.has(coding.turn)) found.set(coding.turn, new Set());
    found.get(coding.turn).add(coding.category);
  }
  return found;
}

/**
 * Compare one second coding against the first, across everything both covered.
 *
 * `interviews` carries the transcript, the first coder's codings and whatever
 * second codings were found beside them. An interview the second coder never
 * touched is left out of the arithmetic and named separately: counting it would
 * read every uncoded turn as a disagreement, which would say something false
 * about a person who was simply not asked to code it.
 */
export function compare(interviews, categories, coder) {
  const ids = categories.map((category) => category.id);
  const nameOf = new Map(categories.map((category) => [category.id, category.name]));

  const cells = { both: 0, onlyFirst: 0, onlySecond: 0, neither: 0 };
  const perCategory = new Map(
    ids.map((id) => [id, { both: 0, onlyFirst: 0, onlySecond: 0, neither: 0 }]),
  );
  /* Kept by turn rather than by cell. One turn where the two chose different
     categories is one passage to talk about, and listing it twice — once as
     „only here", once as „only theirs" — makes the same disagreement look like
     two and the passage appear twice in a row. */
  const apart = new Map();
  const covered = [];
  const skipped = [];

  for (const { transcript, codings, others } of interviews) {
    const second = others?.[coder];
    if (!second) {
      skipped.push({ id: transcript.id, title: transcript.title });
      continue;
    }
    covered.push({ id: transcript.id, title: transcript.title });

    const first = usedIn(codings);
    const other = usedIn(second);
    for (const turn of codable(transcript)) {
      const mine = first.get(turn.number) ?? new Set();
      const yours = other.get(turn.number) ?? new Set();
      for (const id of ids) {
        const a = mine.has(id);
        const b = yours.has(id);
        const cell = a && b ? "both" : a ? "onlyFirst" : b ? "onlySecond" : "neither";
        cells[cell] += 1;
        perCategory.get(id)[cell] += 1;
        if (cell === "onlyFirst" || cell === "onlySecond") {
          const key = `${transcript.id} ${turn.number}`;
          if (!apart.has(key)) {
            apart.set(key, {
              interview: transcript.id,
              interviewTitle: transcript.title,
              turn: turn.number,
              text: turn.text,
              first: [],
              second: [],
            });
          }
          apart.get(key)[cell === "onlyFirst" ? "first" : "second"].push(nameOf.get(id) ?? id);
        }
      }
    }
  }

  const units = cells.both + cells.onlyFirst + cells.onlySecond + cells.neither;
  const value = kappa(cells);
  return {
    coder,
    covered,
    skipped,
    units,
    turns: covered.length ? units / Math.max(1, ids.length) : 0,
    categories: ids.length,
    cells,
    agreement: units ? (cells.both + cells.neither) / units : null,
    kappa: value,
    band: band(value),
    byCategory: ids
      .map((id) => {
        const counts = perCategory.get(id);
        const one = kappa(counts);
        return {
          id,
          name: nameOf.get(id) ?? id,
          ...counts,
          disagreed: counts.onlyFirst + counts.onlySecond,
          kappa: one,
          band: band(one),
        };
      })
      // Where they part company first is the useful order.
      .sort((a, b) => b.disagreed - a.disagreed || a.name.localeCompare(b.name)),
    // The number of judgements that differ, which is what kappa was computed
    // from — not the same as the number of passages below.
    apartCells: cells.onlyFirst + cells.onlySecond,
    // The turn, not the coefficient, is what a consensus round works from.
    disagreements: [...apart.values()].sort(
      (a, b) => a.interview.localeCompare(b.interview) || a.turn - b.turn,
    ),
  };
}

/** Every second coding found beside the first, each compared on its own. */
export function agreement(interviews, categories) {
  const coders = [
    ...new Set(interviews.flatMap(({ others }) => Object.keys(others ?? {}))),
  ].sort();
  return {
    coders,
    comparisons: coders.map((coder) => compare(interviews, categories, coder)),
  };
}

/**
 * The comparison as Markdown, for the methods chapter and the appendix.
 *
 * A reliability figure that only exists on a screen does not get reported, and
 * an unreported one might as well not have been computed. What goes in is the
 * unit, the coefficient, the table it came from, and the passages the two read
 * differently — the last of these is the appendix of the consensus round.
 */
export function agreementMarkdown(all, language, t) {
  const lines = [`# ${t("agreementDocTitle")}`, "", t("agreementDocLead"), ""];

  if (!all.coders.length) {
    lines.push(t("agreementDocNone"), "");
    return `${lines.join("\n")}\n`;
  }
  lines.push(t("agreementDocUnit"), "");

  for (const one of all.comparisons) {
    lines.push(`## ${t("agreementDocWith", { coder: one.coder })}`, "");
    lines.push(
      t("agreementDocFigures", {
        kappa: one.kappa == null ? "—" : one.kappa.toFixed(2),
        band: t(`agreementBand${one.band ? one.band[0].toUpperCase() + one.band.slice(1) : "None"}`),
        agreement: one.agreement == null ? "—" : `${(one.agreement * 100).toFixed(0)} %`,
        units: one.units,
        interviews: one.covered.map((entry) => entry.title).join(", "),
      }),
      "",
    );
    if (one.skipped.length) {
      lines.push(
        t("agreementDocSkipped", {
          interviews: one.skipped.map((entry) => entry.title).join(", "),
        }),
        "",
      );
    }

    lines.push(`| ${t("agreementCell")} | ${t("agreementCount")} |`, "| --- | ---: |");
    for (const [key, value] of [
      ["agreementBoth", one.cells.both],
      ["agreementNeither", one.cells.neither],
      ["agreementOnlyFirst", one.cells.onlyFirst],
      ["agreementOnlySecond", one.cells.onlySecond],
    ]) {
      lines.push(`| ${t(key, { coder: one.coder })} | ${value} |`);
    }
    lines.push("");

    lines.push(
      `| ${t("category")} | ${t("agreementApart")} | ${t("agreementKappa")} |`,
      "| --- | ---: | ---: |",
    );
    for (const row of one.byCategory) {
      lines.push(
        `| ${row.name} | ${row.disagreed} | ${row.kappa == null ? "—" : row.kappa.toFixed(2)} |`,
      );
    }
    lines.push("");

    if (!one.disagreements.length) {
      lines.push(t("agreementApartNone"), "");
      continue;
    }
    // Every one of them, not the first sixty: the screen shows a sample, the
    // paper carries the record.
    lines.push(`### ${t("agreementDocApart")}`, "");
    for (const entry of one.disagreements) {
      lines.push(`**${entry.interviewTitle} · ${t("turn")} ${entry.turn}**  `);
      lines.push(
        `${t("agreementSideHere", {
          categories: entry.first.join(", ") || t("agreementNothing"),
        })} · ${t("agreementSideThere", {
          coder: one.coder,
          categories: entry.second.join(", ") || t("agreementNothing"),
        })}`,
        "",
      );
      lines.push(`> ${entry.text.replace(/\s*\[\d+:\d{2}\]\s*/g, " ").replace(/\s+/g, " ").trim()}`, "");
    }
  }
  return `${lines.join("\n")}\n`;
}
