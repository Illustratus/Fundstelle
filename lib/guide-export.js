/**
 * The interview guide of one round, as the appendix prints it.
 *
 * The guide used to be kept twice: once in the study's document, where the
 * appendix needs it, and once in the tool, where the interview mode reads it.
 * Two copies of an instrument drift, and the one that drifts is the one in the
 * appendix — which is the one a reader checks the interviews against. So the
 * appendix is written from the tool's copy.
 *
 * The shape is Helfferich's form the way it is set in a thesis: per block a
 * bold heading line carrying the narrative prompt, then the checklist on one
 * line, the mandatory questions one per line with their tag and condition in
 * the label, and the read-out list per department nested under its heading. No
 * title: the appendix chapter has its own heading and its own lead paragraph.
 *
 * ## Which read-out lists are printed
 *
 * A read-out list names what a department said in the earlier round, so the
 * guide holds a list for every department of that round. Printing them all in
 * the appendix of a later round that could not reach one of them tells the
 * reader exactly which one is missing — the thing every other surface of the
 * second round is careful not to say. Once a round has interviews (or logs of
 * interviews under way), only the lists of departments that are in it are
 * printed. Before that the guide is a plan, written ahead of the interviews,
 * and it is printed whole.
 */

import { translator } from "./texts.js";

/** A label ends in one stop: „Warmfrage." but „Wie geht es?" stays as it is. */
function stopped(text) {
  return /[.?!:…]$/.test(text) ? text : `${text}.`;
}

/**
 * Number the blocks — unless the researcher already did.
 *
 * Guides are often numbered by hand and only in part ("Warmfrage", "1 · Ablage",
 * …, "Abschluss"); a second number in front of the first would be wrong in both
 * places. A guide with no number anywhere is numbered in order.
 */
function blockNames(blocks) {
  const numberedByHand = blocks.some((block) => /^\d/.test(block.name));
  return blocks.map((block, index) => (numberedByHand ? block.name : `${index + 1} · ${block.name}`));
}

/**
 * @param {{ id: string, name: string, guide?: { blocks: object[] } }} round
 * @param {{ departments: Set<string> | null, language: string }} options
 *   `departments` — whose read-out lists may be printed; `null` prints all.
 */
export function guideMarkdown(round, { departments = null, language } = {}) {
  const t = translator(language);
  const blocks = round.guide?.blocks ?? [];
  if (!blocks.length) return `${t("guideExportEmpty", { round: round.name })}\n`;

  const names = blockNames(blocks);
  const lines = [];
  blocks.forEach((block, index) => {
    lines.push(`**${stopped(names[index])}**${block.prompt ? ` ${block.prompt}` : ""}`, "");

    const bullets = [];
    const checklist = t("guideExportChecklist");
    const plain = block.checklist.filter((item) => !item.tag);
    if (plain.length) {
      bullets.push(`- *${checklist}.* ${plain.map((item) => item.text).join(" · ")}`);
    }
    for (const item of block.checklist.filter((one) => one.tag)) {
      bullets.push(`- *${stopped(`${checklist}, ${item.tag}`)}* ${item.text}`);
    }
    for (const item of block.mandatory) {
      const label = [t("guideExportMandatory"), item.tag, item.condition].filter(Boolean).join(", ");
      bullets.push(`- *${stopped(label)}* ${item.text}`);
    }

    const lists = Object.entries(block.readout?.perDepartment ?? {}).filter(
      ([department, items]) => items.length && (!departments || departments.has(department)),
    );
    if (lists.length) {
      bullets.push(`- *${stopped(block.readout.label || t("guideExportReadout"))}*`);
      for (const [department, items] of lists) {
        bullets.push(`  - *${stopped(department)}* ${items.join(", ")}`);
      }
    }

    if (bullets.length) lines.push(...bullets, "");
  });
  return lines.join("\n");
}
