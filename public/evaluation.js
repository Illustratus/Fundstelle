/*
  The second round, in the interface.

  Three places, no new tab:

  - the Auswertung tab gets a round switcher (the first round preselected, so
    the numbers already written into the thesis stay what they were) and,
    once a study has two rounds, a section of its own: before and after per
    category, the pre-registered criteria counted in persons, the report by
    guide question, and the read-out list counted before and after;
  - the coding unit detail in the Kodieren tab gets, for an interview of a
    later round, a stance toggle (`p` supports, `c` contradicts, again to take
    it back) and the guide question the unit answers;
  - each part carries its export, the way the cross table does.

  Everything shown here is what the server computed (`/api/evaluation/…`); the
  exports are written from the same answers, so a number on screen is the
  number in the document. Nothing here decides a verdict: a criterion met from
  both sides is shown as both.

  Kept out of `app.js`, which hands over what this needs through
  `connectEvaluation`.
*/

import { quoted, t } from "./texts.js";

let host = null;

const ev = {
  // As `/api/rounds` has them, in the order they happened.
  rounds: [],
  // The guide blocks of every round that has one, by round id.
  guides: {},
  // The round the Auswertung counts: a round id or "all". Not remembered
  // across reloads on purpose: the first round is what the thesis quotes.
  analysisRound: null,
  // The category the before/after comparison is showing.
  panelCategory: null,
};

const escapeHTML = (text) =>
  String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const roundName = (id) => ev.rounds.find((one) => one.id === id)?.name ?? id;

const twoRounds = () => ev.rounds.length > 1;

/** Hand over what the module needs from the application, and listen. */
export function connectEvaluation(hooks) {
  host = hooks;
  document.querySelector("#detail").addEventListener("click", (event) => {
    const button = event.target.closest("[data-stance]");
    if (button) setStance(button.dataset.stance || null);
  });
  document.querySelector("#detail").addEventListener("change", (event) => {
    if (event.target.id === "detail-question") setQuestion(event.target.value || null);
  });
  const analysis = document.querySelector("#analysis");
  analysis.addEventListener("change", (event) => {
    if (event.target.id === "analysis-round") {
      ev.analysisRound = event.target.value;
      host.redrawAnalysis();
    }
    if (event.target.id === "panel-category") {
      ev.panelCategory = event.target.value;
      drawPanel();
    }
  });
}

/* Rounds -------------------------------------------------------------------- */

/** The rounds and the guides of the later ones; true when there are two or more. */
export async function loadRounds() {
  try {
    ev.rounds = (await host.api("/api/rounds")).rounds;
  } catch {
    ev.rounds = [];
  }
  if (!ev.rounds.some((one) => one.id === ev.analysisRound) && ev.analysisRound !== "all") {
    ev.analysisRound = ev.rounds[0]?.id ?? null;
  }
  const later = ev.rounds.slice(1).filter((one) => one.blocks);
  const guides = await Promise.all(
    later.map((one) =>
      host.api(`/api/rounds/${encodeURIComponent(one.id)}/guide`).then(
        (answer) => answer.blocks,
        () => [],
      ),
    ),
  );
  ev.guides = Object.fromEntries(later.map((one, index) => [one.id, guides[index]]));
  return twoRounds();
}

/**
 * The query the analysis and its exports carry: the chosen round once there
 * are two, nothing otherwise — a study without rounds asks as it always did.
 */
export function analysisRoundQuery(query = "") {
  const parameters = new URLSearchParams(query);
  if (twoRounds() && ev.analysisRound) parameters.set("round", ev.analysisRound);
  return parameters.toString();
}

/** The switcher above the analysis; nothing while there is only one round. */
export function roundSwitchHTML() {
  if (!twoRounds()) return "";
  const options = [
    ...ev.rounds.map((one) => [one.id, one.name]),
    ["all", t("evRoundAll")],
  ];
  return (
    `<div class="round-switch"><label class="field"><span class="field-label">${t("evRound")}</span>` +
    `<select id="analysis-round">` +
    options
      .map(
        ([id, name]) =>
          `<option value="${escapeHTML(id)}"${id === ev.analysisRound ? " selected" : ""}>${escapeHTML(name)}</option>`,
      )
      .join("") +
    `</select></label>` +
    `<p class="column-note">${escapeHTML(
      ev.analysisRound === "all" ? t("evRoundAllNote") : t("evRoundNote", { round: roundName(ev.analysisRound) }),
    )}</p></div>`
  );
}

/* Stance and question on a coding unit ------------------------------------- */

/** The round of the interview on screen, when it is a later one; else null. */
function laterRound() {
  if (!twoRounds()) return null;
  const round = host.state.interviews.find((one) => one.id === host.state.current)?.round;
  if (!round || round === ev.rounds[0].id) return null;
  return round;
}

/** The two fields in the unit detail, for an interview of a later round. */
export function evaluationDetailHTML(coding) {
  const round = laterRound();
  if (!round) return "";
  const stance = coding.stance ?? "";
  const button = (value, label, key) =>
    `<button type="button" class="button-quiet stance-choice" data-stance="${value}"` +
    ` data-stance-value="${value || "none"}" aria-pressed="${stance === value}"` +
    (key ? ` aria-keyshortcuts="${key}" title="${escapeHTML(t("evStanceKey", { key }))}"` : "") +
    `>${label}${key ? ` <kbd>${key}</kbd>` : ""}</button>`;
  const stanceRow =
    `<div class="stance" role="group" aria-label="${escapeHTML(t("evStance"))}">` +
    `<span class="field-label">${t("evStance")}</span>` +
    button("supports", t("evStanceSupports"), "p") +
    button("contradicts", t("evStanceContradicts"), "c") +
    button("", t("evStanceNone"), "") +
    `</div>`;

  const blocks = ev.guides[round] ?? [];
  const items = blocks.flatMap((block) =>
    [...block.checklist, ...block.mandatory].map((item) => ({ ...item, blockName: block.name })),
  );
  if (!items.length) return stanceRow;
  const known = items.some((item) => item.id === coding.question);
  const option = (item) =>
    `<option value="${escapeHTML(item.id)}"${item.id === coding.question ? " selected" : ""}>` +
    `${escapeHTML(item.text)}${item.tag ? ` [${escapeHTML(item.tag)}]` : ""}</option>`;
  const question =
    `<label class="field"><span class="field-label">${t("evQuestion")}</span>` +
    `<select id="detail-question" aria-keyshortcuts="q">` +
    `<option value="">${t("evQuestionNone")}</option>` +
    (coding.question && !known
      ? `<option value="${escapeHTML(coding.question)}" selected>${escapeHTML(t("evQuestionUnknown"))}</option>`
      : "") +
    blocks
      .filter((block) => block.checklist.length || block.mandatory.length)
      .map(
        (block) =>
          `<optgroup label="${escapeHTML(block.name)}">` +
          items.filter((item) => item.blockName === block.name).map(option).join("") +
          `</optgroup>`,
      )
      .join("") +
    `</select></label>`;
  return stanceRow + question;
}

/** A small sign beside a unit in the margin, so the stances read at a glance. */
export function evaluationMarkHTML(coding) {
  if (!coding.stance || !laterRound()) return "";
  const supports = coding.stance === "supports";
  return (
    `<span class="stance-mark" data-stance-mark="${coding.stance}"` +
    ` title="${escapeHTML(t(supports ? "evStanceSupports" : "evStanceContradicts"))}">` +
    `${supports ? "+" : "−"}</span>`
  );
}

async function changeUnit(fields, said) {
  const coding = host.state.codings.find((one) => one.id === host.state.selected);
  if (!coding) return;
  try {
    const updated = await host.api(
      `/api/interviews/${encodeURIComponent(host.state.current)}/codings/${coding.id}`,
      { method: "PATCH", body: fields },
    );
    // A key the server took away is absent in the answer, and must go here too.
    for (const key of Object.keys(fields)) delete coding[key];
    Object.assign(coding, updated);
    host.drawAll();
    host.notify(said);
  } catch (error) {
    host.complain(error);
  }
}

function setStance(value) {
  const said = value
    ? t("evStanceSet", { stance: t(value === "supports" ? "evStanceSupports" : "evStanceContradicts") })
    : t("evStanceCleared");
  return changeUnit({ stance: value }, said);
}

function setQuestion(value) {
  return changeUnit({ question: value }, t(value ? "evQuestionSet" : "evQuestionCleared"));
}

/**
 * The keys of the unit detail, with a unit chosen and no passage being coded:
 * `p` and `c` set the stance, and take it back when it is already that one;
 * `q` goes to the question. True when the key was used.
 */
export function evaluationKey(event) {
  if (!host.state.selected || !laterRound()) return false;
  const coding = host.state.codings.find((one) => one.id === host.state.selected);
  if (!coding) return false;
  if (event.key === "p" || event.key === "c") {
    event.preventDefault();
    const wanted = event.key === "p" ? "supports" : "contradicts";
    setStance(coding.stance === wanted ? null : wanted);
    return true;
  }
  if (event.key === "q") {
    const field = document.querySelector("#detail-question");
    if (!field) return false;
    event.preventDefault();
    field.focus();
    return true;
  }
  return false;
}

/* The evaluation section of the Auswertung --------------------------------- */

const exportLink = (path, query, label, id) =>
  `<a class="button-quiet"${id ? ` id="${id}"` : ""} href="${host.exportHref(path, query)}" download>${label}</a>`;

function stanceLabel(stance) {
  if (stance === "supports") return `<span class="stance-tag" data-stance-mark="supports">${t("evStanceSupports")}</span>`;
  if (stance === "contradicts") return `<span class="stance-tag" data-stance-mark="contradicts">${t("evStanceContradicts")}</span>`;
  return "";
}

/** One unit as the analysis cites it, with its way back into the transcript. */
function unitHTML(unit, { department = null } = {}) {
  return (
    `<div class="citation" style="--mark-color:${host.colorOf(unit.category)}">` +
    `<div class="head-row">` +
    (department ? `<span>${escapeHTML(department)}</span>` : "") +
    `<span>${t("turn")} ${unit.turn}${unit.time ? ` · ${escapeHTML(unit.time)}` : ""}</span>` +
    stanceLabel(unit.stance) +
    (unit.reviewed ? "" : `<span class="open-mark">${t("unreviewed")}</span>`) +
    `<button type="button" class="button-quiet goto" data-passage="${escapeHTML(unit.id)}"` +
    ` data-interview="${escapeHTML(unit.interview)}">${t("viewInTranscript")}</button></div>` +
    `<blockquote>${quoted(escapeHTML(unit.text))}</blockquote></div>`
  );
}

/** Fill the section, or leave it empty while the study has one round. */
export async function drawEvaluation() {
  const root = document.querySelector("#evaluation-part");
  if (!root) return;
  if (!twoRounds()) {
    root.innerHTML = "";
    return;
  }
  const first = ev.rounds[0];
  const last = ev.rounds.at(-1);
  root.innerHTML =
    `<h3>${t("evTitle")}</h3>` +
    `<p class="lead">${escapeHTML(t("evLead", { from: first.name, to: last.name }))}</p>` +
    `<section id="panel-part"></section>` +
    `<section id="propositions-part"></section>` +
    `<section id="tags-part"></section>` +
    `<section id="readout-part"></section>`;
  await Promise.all([drawPanel(), drawPropositions(), drawTags()]);
}

async function drawPanel() {
  const root = document.querySelector("#panel-part");
  if (!root) return;
  const categories = host.state.categories;
  if (!categories.some((one) => one.id === ev.panelCategory)) ev.panelCategory = categories[0]?.id ?? null;
  const query = ev.panelCategory ? `category=${encodeURIComponent(ev.panelCategory)}` : "";
  let panel;
  try {
    panel = await host.api(`/api/evaluation/panel${query ? `?${query}` : ""}`);
  } catch (error) {
    root.innerHTML = `<p class="empty-state">${escapeHTML(error.message)}</p>`;
    return;
  }
  const from = roundName(panel.from);
  const to = roundName(panel.to);
  const row = panel.categories[0];
  const choice =
    `<label class="field"><span class="field-label">${t("category")}</span>` +
    `<select id="panel-category">` +
    categories
      .map(
        (one) =>
          `<option value="${escapeHTML(one.id)}"${one.id === ev.panelCategory ? " selected" : ""}>` +
          `${one.parent ? "… " : ""}${escapeHTML(one.name)}</option>`,
      )
      .join("") +
    `</select></label>`;

  let table = `<p class="empty-state">${t("evPanelNoDepartments")}</p>`;
  if (row && row.cells.length) {
    const before = row.cells.reduce((n, one) => n + one.from.count, 0);
    const after = row.cells.reduce((n, one) => n + one.to.count, 0);
    const side = (part) =>
      `<td><div class="panel-count">${t("evUnits", { n: part.count })}</div>` +
      (part.units.length ? `<div class="citations">${part.units.map((unit) => unitHTML(unit)).join("")}</div>` : "") +
      `</td>`;
    table =
      `<p class="panel-sum" id="panel-sum">${escapeHTML(row.name)} · ${before} → ${after}</p>` +
      `<div class="table-frame"><table class="panel-table" id="panel-table">` +
      `<caption class="visually-hidden">${escapeHTML(t("evPanelCaption", { name: row.name }))}</caption>` +
      `<thead><tr><th scope="col">${t("department")}</th>` +
      `<th scope="col">${escapeHTML(from)}</th><th scope="col">${escapeHTML(to)}</th></tr></thead><tbody>` +
      row.cells
        .map(
          (cell) =>
            `<tr data-department="${escapeHTML(cell.department)}"><th scope="row">${escapeHTML(cell.department)}</th>` +
            side(cell.from) +
            side(cell.to) +
            `</tr>`,
        )
        .join("") +
      `</tbody></table></div>`;
  }

  root.innerHTML =
    `<div class="section-heading"><h4>${t("evPanelTitle")}</h4>` +
    exportLink("/api/export/evaluation-panel.md", query, t("evExportPanel"), "panel-export") +
    exportLink("/api/export/evaluation-panel.md", "", t("evExportPanelAll"), "panel-export-all") +
    `</div>` +
    `<p class="column-note">${escapeHTML(t("evPanelLead", { from, to }))}</p>` +
    choice +
    table;
  drawReadout(panel);
}

function drawReadout(panel) {
  const root = document.querySelector("#readout-part");
  if (!root) return;
  const heading =
    `<div class="section-heading"><h4>${t("evReadoutTitle")}</h4>` +
    exportLink("/api/export/evaluation-readout.md", "", t("evExportReadout"), "readout-export") +
    `</div>`;
  if (!panel.readout.length) {
    root.innerHTML = heading + `<p class="empty-state">${t("evReadoutNone")}</p>`;
    return;
  }
  const states = { still: t("evStateStill"), "no-longer": t("evStateNoLonger") };
  root.innerHTML =
    heading +
    `<p class="column-note">${escapeHTML(t("evReadoutLead", { from: roundName(panel.from), to: roundName(panel.to) }))}</p>` +
    `<div class="table-frame"><table id="readout-table"><thead><tr>` +
    `<th scope="col">${t("department")}</th><th scope="col">${t("evReadoutList")}</th>` +
    `<th class="num" scope="col">${t("evReadoutListed")}</th><th class="num" scope="col">${t("evReadoutStill")}</th>` +
    `<th class="num" scope="col">${t("evReadoutNoLonger")}</th><th class="num" scope="col">${t("evReadoutOpen")}</th>` +
    `</tr></thead><tbody>` +
    panel.readout
      .map(
        (one) =>
          `<tr data-department="${escapeHTML(one.department)}"><th scope="row">${escapeHTML(one.department)}</th>` +
          `<td><details><summary>${escapeHTML(one.label || "—")}</summary><ul class="readout-items">` +
          one.items
            .map((item) => `<li>${escapeHTML(item.item)}: ${escapeHTML(states[item.state] ?? t("evStateOpen"))}</li>`)
            .join("") +
          `</ul></details></td>` +
          `<td class="num">${one.listed}</td><td class="num">${one.still}</td>` +
          `<td class="num">${one.noLonger}</td><td class="num">${one.open}</td></tr>`,
      )
      .join("") +
    `</tbody></table></div>`;
}

const STATUS = {
  supported: "evStatusSupported",
  falsified: "evStatusFalsified",
  both: "evStatusBoth",
  open: "evStatusOpen",
};

function thresholdText(threshold) {
  if (threshold?.atLeast !== undefined) return t("evThresholdAtLeast", { n: threshold.atLeast });
  return t("evThresholdFraction", { fraction: String(threshold?.fraction ?? "") });
}

function personsHTML(list, empty) {
  if (!list.length) return `<p class="column-note">${empty}</p>`;
  return list
    .map(
      (person) =>
        `<details class="person"><summary>${escapeHTML(person.department)} · ${person.units.length}</summary>` +
        (person.units.length
          ? `<div class="citations">${person.units.map((unit) => unitHTML(unit)).join("")}</div>`
          : `<p class="column-note">${t("evDeviantNothing")}</p>`) +
        `</details>`,
    )
    .join("");
}

async function drawPropositions() {
  const root = document.querySelector("#propositions-part");
  if (!root) return;
  let view;
  try {
    view = await host.api("/api/evaluation/propositions");
  } catch (error) {
    root.innerHTML = `<p class="empty-state">${escapeHTML(error.message)}</p>`;
    return;
  }
  const categoryName = (id) => host.state.categories.find((one) => one.id === id)?.name ?? id;
  const heading =
    `<div class="section-heading"><h4>${t("evPropositionsTitle")}</h4>` +
    exportLink("/api/export/evaluation-propositions.md", "", t("evExportPropositions"), "propositions-export") +
    `</div><p class="column-note">${t("evPropositionsLead")}</p>`;
  if (!view.propositions.length) {
    root.innerHTML = heading + `<p class="empty-state">${t("evPropositionsNone")}</p>`;
    return;
  }
  root.innerHTML =
    heading +
    view.propositions
      .map(
        (proposition) =>
          `<article class="proposition-board" data-proposition="${escapeHTML(proposition.id)}"` +
          ` style="--mark-color:${escapeHTML(proposition.color ?? "")}">` +
          `<h5>${escapeHTML(proposition.name)}</h5>` +
          proposition.rounds
            .map(
              (round) =>
                `<p class="round-status" data-round="${escapeHTML(round.round)}" data-status="${round.status}">` +
                `${escapeHTML(roundName(round.round))}: <strong>${t(STATUS[round.status])}</strong> · ` +
                `${escapeHTML(t("evPersonsInRound", { n: round.persons }))}</p>` +
                (round.uncoded.length
                  ? `<p class="column-note">${escapeHTML(t("evUncoded", { departments: round.uncoded.join(", ") }))}</p>`
                  : ""),
            )
            .join("") +
          proposition.criteria
            .map(
              (criterion) =>
                `<div class="criterion" data-criterion="${escapeHTML(criterion.id)}" data-met="${criterion.met}">` +
                `<p class="criterion-head"><span class="verdict">${t(criterion.verdict === "supported" ? "evVerdictSupported" : "evVerdictFalsified")}</span> ` +
                `${escapeHTML(criterion.text ?? "")}</p>` +
                `<p class="column-note">${escapeHTML(
                  t("evCriterionRule", {
                    round: roundName(criterion.round),
                    categories: criterion.categories.map(categoryName).join(", "),
                    stance: criterion.stance
                      ? t(criterion.stance === "supports" ? "evStanceSupports" : "evStanceContradicts")
                      : t("evAnyStance"),
                    threshold: thresholdText(criterion.threshold),
                  }),
                )}</p>` +
                `<p class="criterion-count"><strong class="count">${escapeHTML(
                  t("evCountOf", { count: criterion.count, persons: criterion.persons }),
                )}</strong> · ${escapeHTML(t("evRequired", { n: criterion.required }))} · ` +
                `${t(criterion.met ? "evMet" : "evNotMet")}</p>` +
                (criterion.unreviewed
                  ? `<p class="still-open-line" role="status">${escapeHTML(t("evUnreviewed", { n: criterion.unreviewed }))}</p>`
                  : "") +
                `<div class="criterion-persons"><div><h6>${t("evMeeting")}</h6>${personsHTML(criterion.meeting, t("evNobody"))}</div>` +
                `<div><h6>${t("evDeviant")}</h6>${personsHTML(criterion.deviant, t("evNobody"))}</div></div>` +
                `</div>`,
            )
            .join("") +
          `</article>`,
      )
      .join("");
}

async function drawTags() {
  const root = document.querySelector("#tags-part");
  if (!root) return;
  let report;
  try {
    report = await host.api("/api/evaluation/tags");
  } catch (error) {
    root.innerHTML = `<p class="empty-state">${escapeHTML(error.message)}</p>`;
    return;
  }
  const blocks = ev.guides[report.round] ?? [];
  const questions = new Map(
    blocks.flatMap((block) => [...block.checklist, ...block.mandatory]).map((item) => [item.id, item]),
  );
  const assigned =
    report.tags.reduce((n, one) => n + one.units.length, 0) +
    report.untagged.units.length +
    report.unknownQuestion.length;
  const heading =
    `<div class="section-heading"><h4>${escapeHTML(t("evTagsTitle", { round: roundName(report.round) }))}</h4>` +
    exportLink("/api/export/evaluation-tags.md", "", t("evExportTags"), "tags-export") +
    `</div><p class="column-note">${t("evTagsLead")}</p>` +
    `<p class="column-note" id="tags-unassigned">${escapeHTML(
      t("evTagsUnassigned", { n: report.unassigned, total: report.unassigned + assigned }),
    )}</p>`;
  const group = (name, entry, items) => {
    const byDepartment = new Map();
    for (const unit of entry.units) {
      if (!byDepartment.has(unit.department)) byDepartment.set(unit.department, []);
      byDepartment.get(unit.department).push(unit);
    }
    return (
      `<details class="citation-group tag-group" data-tag="${escapeHTML(name)}"${entry.units.length ? " open" : ""}>` +
      `<summary class="citation-head">${escapeHTML(name)} · ${entry.units.length}` +
      ` <span class="of">${escapeHTML(t("evTagDepartments", { n: entry.departments }))}</span></summary>` +
      (items.length
        ? `<ul class="tag-questions">${items.map((item) => `<li>${quoted(escapeHTML(item.text))}</li>`).join("")}</ul>`
        : "") +
      [...byDepartment]
        .map(
          ([department, units]) =>
            `<h6>${escapeHTML(department)} · ${units.length}</h6><div class="citations">` +
            units
              .map(
                (unit) =>
                  unitHTML(unit) +
                  (questions.get(unit.question)
                    ? `<p class="column-note tag-question">${escapeHTML(t("evQuestionLine", { text: questions.get(unit.question).text }))}</p>`
                    : ""),
              )
              .join("") +
            `</div>`,
        )
        .join("") +
      `</details>`
    );
  };
  const body =
    report.tags.map((one) => group(one.tag, one, one.items)).join("") +
    (report.untagged.units.length ? group(t("evTagsUntagged"), report.untagged, []) : "") +
    (report.unknownQuestion.length
      ? group(t("evTagsUnknown"), { units: report.unknownQuestion, departments: new Set(report.unknownQuestion.map((u) => u.department)).size }, [])
      : "");
  root.innerHTML =
    heading + (body || `<p class="empty-state">${t("evTagsNone")}</p>`);
}

/* For the key sheet: the stance keys, listed only where they work. */
export const EVALUATION_KEYS = [
  [["p"], "evKeySupports"],
  [["c"], "evKeyContradicts"],
  [["q"], "evKeyQuestion"],
];
