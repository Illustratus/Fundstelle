/*
  The second round, in the interface.

  Three places, no new tab:

  - the Auswertung tab gets a round switcher (the first round preselected, so
    the numbers already written into the thesis stay what they were) and,
    once a study has two rounds, a section of its own: before and after per
    category, the pre-registered criteria counted in persons, the report by
    guide question, and the read-out list counted before and after;
  - the coding unit detail in the Kodieren tab gets, for an interview of a
    later round, a stance per proposition — supports, no bearing, contradicts,
    whatever the unit's category (a digit picks the proposition, `p` supports,
    `c` contradicts, the same key again takes it back) — and the guide
    question the unit answers;
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
    const button = event.target.closest("[data-stance-for]");
    if (!button) return;
    const coding = selectedUnit();
    if (coding) aim = { unit: coding.id, proposition: button.dataset.stanceFor };
    setStance(button.dataset.stanceFor, button.dataset.stance || null);
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
  analysis.addEventListener("submit", (event) => {
    const form = event.target.closest(".untestable-new");
    if (!form) return;
    event.preventDefault();
    const department = form.querySelector('[name="department"]').value;
    const reason = form.querySelector('[name="reason"]').value.trim();
    if (!reason) {
      host.complain(new Error(t("evUntestableReasonMissing")));
      form.querySelector('[name="reason"]').focus();
      return;
    }
    markUntestable(form.dataset.round, form.dataset.proposition, department, reason);
  });
  analysis.addEventListener("click", (event) => {
    const button = event.target.closest("[data-untestable-remove]");
    if (!button) return;
    const shell = button.closest(".untestable");
    markUntestable(shell.dataset.round, shell.dataset.proposition, button.dataset.department, "");
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

/* Stances and question on a coding unit ----------------------------------- */

/** The round of the interview on screen, when it is a later one; else null. */
function laterRound() {
  if (!twoRounds()) return null;
  const round = host.state.interviews.find((one) => one.id === host.state.current)?.round;
  if (!round || round === ev.rounds[0].id) return null;
  return round;
}

const NO_PROPOSITION = "none";

const STANCE_TEXT = { supports: "evStanceSupports", contradicts: "evStanceContradicts" };

/**
 * The propositions a unit can stand towards, in the order the study lists
 * them: every one with a claim of its own — not the fallback, not a heading
 * marked as claiming nothing.
 */
function claims() {
  return Object.entries(host.state.propositions ?? {}).filter(
    ([id, proposition]) => id !== NO_PROPOSITION && proposition.claim !== false,
  );
}

/** The proposition of a unit's category, when it makes a claim; else null. */
function ownProposition(coding) {
  const category = host.state.categories.find((one) => one.id === coding.category);
  const id = category?.proposition ?? NO_PROPOSITION;
  const proposition = host.state.propositions?.[id];
  return proposition && id !== NO_PROPOSITION && proposition.claim !== false ? id : null;
}

/**
 * A unit's stances as they count — the same reading as the server's
 * (`lib/stances.js`): `stances`, and the single `stance` of version 0.12 as
 * one towards the proposition of the unit's category.
 */
export function stancesOf(coding) {
  const own = { ...(coding.stances ?? {}) };
  if (coding.stance === "supports" || coding.stance === "contradicts") {
    const target = ownProposition(coding);
    if (target && !(target in own)) own[target] = coding.stance;
  }
  return own;
}

const selectedUnit = () => host.state.codings.find((one) => one.id === host.state.selected) ?? null;

/*
  Which proposition `p` and `c` act on. A digit picks one for the unit in hand;
  without that, it is the proposition of the unit's category — so the common
  case is one key, as it was — or the only proposition there is. A unit coded
  under a category that argues nothing has none until a digit says which: a
  stance towards the wrong proposition would be counted for the wrong claim.
*/
let aim = { unit: null, proposition: null };

function aimedAt(coding) {
  const list = claims();
  if (aim.unit === coding.id && list.some(([id]) => id === aim.proposition)) return aim.proposition;
  const own = ownProposition(coding);
  if (own) return own;
  return list.length === 1 ? list[0][0] : null;
}

function stancesHTML(coding) {
  const list = claims();
  if (!list.length) return "";
  const stances = stancesOf(coding);
  const aimed = aimedAt(coding);
  const rows = list
    .map(([id, proposition], index) => {
      const current = stances[id] ?? "";
      const digit = list.length > 1 && index < 9 ? String(index + 1) : "";
      const isAim = id === aimed;
      const name = proposition.name ?? id;
      const button = (value, label, key) =>
        `<button type="button" class="button-quiet stance-choice" data-stance-for="${escapeHTML(id)}"` +
        ` data-stance="${value}" data-stance-value="${value || "none"}" aria-pressed="${current === value}"` +
        (isAim && key ? ` aria-keyshortcuts="${key}" title="${escapeHTML(t("evStanceKey", { key }))}"` : "") +
        `>${label}${isAim && key ? ` <kbd>${key}</kbd>` : ""}</button>`;
      return (
        `<div class="stance-row" data-proposition="${escapeHTML(id)}"${isAim ? ' data-aimed="true"' : ""}` +
        ` style="--stance-color:${escapeHTML(proposition.color ?? "")}">` +
        `<span class="stance-name">${digit ? `<kbd aria-hidden="true">${digit}</kbd>` : ""}` +
        `<span class="stance-dot" aria-hidden="true"></span>${escapeHTML(name)}</span>` +
        `<span class="stance-choices" role="group" aria-label="${escapeHTML(name)}"` +
        (digit ? ` aria-keyshortcuts="${digit}"` : "") +
        `>` +
        button("supports", t("evStanceSupports"), "p") +
        button("", t("evStanceNone"), "") +
        button("contradicts", t("evStanceContradicts"), "c") +
        `</span></div>`
      );
    })
    .join("");
  // A stance of version 0.12 under a category that argues nothing: kept, shown,
  // and counted nowhere until somebody says which proposition it meant.
  const stranded = (coding.stance === "supports" || coding.stance === "contradicts") && !ownProposition(coding)
    ? `<p class="column-note stance-stranded">${escapeHTML(t("evStanceStranded", { stance: t(STANCE_TEXT[coding.stance]) }))}</p>`
    : "";
  return (
    `<fieldset class="stances"><legend class="field-label">${t("evStances")}</legend>` +
    rows +
    `<p class="column-note stance-hint">${escapeHTML(t(list.length > 1 ? "evStancesHint" : "evStancesHintOne"))}</p>` +
    stranded +
    `</fieldset>`
  );
}

/** The stances and the guide question in the unit detail, for an interview of a later round. */
export function evaluationDetailHTML(coding) {
  const round = laterRound();
  if (!round) return "";
  const stanceRows = stancesHTML(coding);

  const blocks = ev.guides[round] ?? [];
  const items = blocks.flatMap((block) =>
    [...block.checklist, ...block.mandatory].map((item) => ({ ...item, blockName: block.name })),
  );
  if (!items.length) return stanceRows;
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
  return stanceRows + question;
}

/**
 * Small signs beside a unit in the margin, one per proposition it stands
 * towards: the sign says the stance, the dot beside it the proposition, in the
 * proposition's colour — colour in this tool says the proposition and nothing
 * else.
 */
export function evaluationMarkHTML(coding) {
  if (!laterRound()) return "";
  const stances = stancesOf(coding);
  return claims()
    .filter(([id]) => stances[id])
    .map(([id, proposition]) => {
      const supports = stances[id] === "supports";
      const said = `${proposition.name ?? id}: ${t(STANCE_TEXT[stances[id]])}`;
      return (
        `<span class="stance-mark" data-stance-mark="${stances[id]}" data-proposition="${escapeHTML(id)}"` +
        ` style="--stance-color:${escapeHTML(proposition.color ?? "")}" title="${escapeHTML(said)}">` +
        `<span class="stance-dot" aria-hidden="true"></span><span aria-hidden="true">${supports ? "+" : "−"}</span>` +
        `<span class="visually-hidden">${escapeHTML(said)}</span></span>`
      );
    })
    .join("");
}

async function changeUnit(fields, said) {
  const coding = selectedUnit();
  if (!coding) return;
  try {
    const updated = await host.api(
      `/api/interviews/${encodeURIComponent(host.state.current)}/codings/${coding.id}`,
      { method: "PATCH", body: fields },
    );
    // A key the server took away is absent in the answer, and must go here
    // too — the older single stance among them, which a stance write folds in.
    for (const key of [...Object.keys(fields), "stance"]) delete coding[key];
    Object.assign(coding, updated);
    host.drawAll();
    host.notify(said);
  } catch (error) {
    host.complain(error);
  }
}

function setStance(proposition, value) {
  const name = host.state.propositions?.[proposition]?.name ?? proposition;
  const said = value
    ? t("evStanceSet", { name, stance: t(STANCE_TEXT[value]) })
    : t("evStanceCleared", { name });
  return changeUnit({ stances: { [proposition]: value } }, said);
}

function setQuestion(value) {
  return changeUnit({ question: value }, t(value ? "evQuestionSet" : "evQuestionCleared"));
}

/**
 * The keys of the unit detail, with a unit chosen and no passage being coded:
 * a digit picks the proposition, `p` and `c` set its stance and take it back
 * when it is already that one; `q` goes to the question. True when the key
 * was used.
 */
export function evaluationKey(event) {
  if (!host.state.selected || !laterRound()) return false;
  const coding = selectedUnit();
  if (!coding) return false;
  const list = claims();
  if (/^[1-9]$/.test(event.key) && list.length > 1) {
    const chosen = list[Number(event.key) - 1];
    if (!chosen) return false;
    event.preventDefault();
    aim = { unit: coding.id, proposition: chosen[0] };
    host.drawAll();
    host.notify(t("evStanceAimed", { name: chosen[1].name ?? chosen[0] }));
    return true;
  }
  if (event.key === "p" || event.key === "c") {
    event.preventDefault();
    const target = aimedAt(coding);
    if (!target) {
      host.notify(t("evStanceChooseFirst"));
      return true;
    }
    const wanted = event.key === "p" ? "supports" : "contradicts";
    setStance(target, stancesOf(coding)[target] === wanted ? null : wanted);
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

/**
 * The stances a unit carries, each named with its proposition and drawn with
 * its colour — or, on a board that is about one proposition, that one alone.
 */
function stanceTags(unit, only = null) {
  const propositions = host.state.propositions ?? {};
  return Object.keys(propositions)
    .filter((id) => unit.stances?.[id] && (!only || id === only))
    .map((id) => {
      const stance = t(STANCE_TEXT[unit.stances[id]]);
      return (
        `<span class="stance-tag" data-stance-mark="${unit.stances[id]}" data-proposition="${escapeHTML(id)}"` +
        ` style="--stance-color:${escapeHTML(propositions[id].color ?? "")}">` +
        `<span class="stance-dot" aria-hidden="true"></span>` +
        `${only ? escapeHTML(stance) : escapeHTML(`${propositions[id].name ?? id} ${stance}`)}</span>`
      );
    })
    .join("");
}

/** One unit as the analysis cites it, with its way back into the transcript. */
function unitHTML(unit, { department = null, proposition = null } = {}) {
  return (
    `<div class="citation" style="--mark-color:${host.colorOf(unit.category)}">` +
    `<div class="head-row">` +
    (department ? `<span>${escapeHTML(department)}</span>` : "") +
    `<span>${t("turn")} ${unit.turn}${unit.time ? ` · ${escapeHTML(unit.time)}` : ""}</span>` +
    stanceTags(unit, proposition) +
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

const VERDICT = { supported: "evVerdictSupported", falsified: "evVerdictFalsified" };

function thresholdText(threshold) {
  if (threshold?.none) return t("evThresholdNone");
  if (threshold?.atLeast !== undefined) return t("evThresholdAtLeast", { n: threshold.atLeast });
  return t("evThresholdFraction", { fraction: String(threshold?.fraction ?? "") });
}

function personsHTML(list, empty, proposition) {
  if (!list.length) return `<p class="column-note">${empty}</p>`;
  return list
    .map((person) => {
      // What a person also said against stands once, with the split cases above.
      const units = person.units;
      return (
        `<details class="person" data-department="${escapeHTML(person.department)}">` +
        `<summary>${escapeHTML(person.department)} · ${person.units.length}` +
        (person.opposite?.length ? ` <span class="split-mark">${escapeHTML(t("evAlsoOpposite"))}</span>` : "") +
        `</summary>` +
        (units.length
          ? `<div class="citations">${units.map((unit) => unitHTML(unit, { proposition })).join("")}</div>`
          : `<p class="column-note">${t("evDeviantNothing")}</p>`) +
        `</details>`
      );
    })
    .join("");
}

/** What a criterion asks, in one line. */
function ruleText(criterion) {
  const categoryName = (id) => host.state.categories.find((one) => one.id === id)?.name ?? id;
  // Decided by hand from outside the interviews: stance, category and base say nothing.
  if (criterion.kind === "manual" && !criterion.stance && !criterion.categories?.length) {
    return t("evCriterionRuleOutside", { round: roundName(criterion.round), decision: t("evByHandRule") });
  }
  return t("evCriterionRule", {
    round: roundName(criterion.round),
    stance: criterion.stance ? t("evRuleStance", { stance: t(STANCE_TEXT[criterion.stance]) }) : t("evAnyStance"),
    categories: criterion.categories?.length
      ? t("evOnlyCategories", { categories: criterion.categories.map(categoryName).join(", ") })
      : t("evAnyCategory"),
    base: t(criterion.base === "testable" ? "evBaseTestable" : "evBaseAll"),
    decision: criterion.kind === "manual" ? t("evByHandRule") : t("evThresholdRule", { threshold: thresholdText(criterion.threshold) }),
  });
}

function criterionHTML(proposition, criterion) {
  const manual = criterion.kind === "manual";
  const none = !manual && Boolean(criterion.threshold?.none);
  let count;
  if (manual) {
    count =
      `<strong class="count">${escapeHTML(
        criterion.count == null
          ? t("evNoInterviewEvidence")
          : t("evCountWithEvidence", { count: criterion.count, persons: criterion.persons }),
      )}</strong> · ${t("evByHand")}`;
  } else if (none) {
    count =
      `<strong class="count">${escapeHTML(t("evCountNaming", { count: criterion.count, persons: criterion.persons }))}</strong>` +
      ` · ${escapeHTML(t("evAllowedNobody"))} · ${t(criterion.met ? "evMet" : "evNotMet")}`;
  } else {
    count =
      `<strong class="count">${escapeHTML(t("evCountOf", { count: criterion.count, persons: criterion.persons }))}</strong>` +
      ` · ${escapeHTML(t("evRequired", { n: criterion.required }))} · ${t(criterion.met ? "evMet" : "evNotMet")}`;
  }
  const headings = manual
    ? ["evWithEvidence", "evWithoutEvidence"]
    : none
      ? ["evNaming", "evNotNaming"]
      : ["evMeeting", "evDeviant"];
  return (
    `<div class="criterion" data-criterion="${escapeHTML(criterion.id)}" data-met="${criterion.met}"` +
    ` data-kind="${manual ? "manual" : none ? "none" : "count"}">` +
    `<p class="criterion-head"><span class="verdict">${t(VERDICT[criterion.verdict])}</span> ` +
    `${escapeHTML(criterion.text ?? "")}</p>` +
    `<p class="column-note">${escapeHTML(ruleText(criterion))}</p>` +
    `<p class="criterion-count">${count}</p>` +
    (criterion.unreviewed
      ? `<p class="still-open-line" role="status">${escapeHTML(t("evUnreviewed", { n: criterion.unreviewed }))}</p>`
      : "") +
    (criterion.untestable?.length
      ? `<p class="column-note">${escapeHTML(t("evLeftOut", { departments: criterion.untestable.map((one) => one.department).join(", ") }))}</p>`
      : "") +
    (criterion.count == null
      ? ""
      : `<div class="criterion-persons"><div><h6>${t(headings[0])}</h6>${personsHTML(criterion.meeting, t("evNobody"), proposition.id)}</div>` +
        `<div><h6>${t(headings[1])}</h6>${personsHTML(criterion.deviant, t("evNobody"), proposition.id)}</div></div>`) +
    `</div>`
  );
}

/** Who the proposition cannot be checked with in a round, and the way to say so. */
function untestableHTML(proposition, round) {
  const marked = new Set(round.untestable.map((one) => one.department));
  const persons = [...round.tally.supports, ...round.tally.contradicts, ...round.tally.neither];
  const open = [...new Set(persons)].filter((one) => !marked.has(one)).sort((a, b) => a.localeCompare(b));
  const list = round.untestable.length
    ? `<ul class="untestable-list">` +
      round.untestable
        .map(
          (one) =>
            `<li data-department="${escapeHTML(one.department)}"><span class="who">${escapeHTML(one.department)}</span> ` +
            `<span class="why">${escapeHTML(one.reason)}</span>` +
            (one.present ? "" : ` <span class="column-note">${escapeHTML(t("evUntestableAbsent"))}</span>`) +
            ` <button type="button" class="button-quiet" data-untestable-remove data-department="${escapeHTML(one.department)}"` +
            ` aria-label="${escapeHTML(t("evUntestableRemove", { department: one.department }))}">×</button></li>`,
        )
        .join("") +
      `</ul>`
    : `<p class="column-note">${t("evUntestableNone")}</p>`;
  const form = open.length
    ? `<form class="untestable-new" data-round="${escapeHTML(round.round)}" data-proposition="${escapeHTML(proposition.id)}">` +
      `<select name="department" aria-label="${escapeHTML(t("department"))}">` +
      open.map((one) => `<option value="${escapeHTML(one)}">${escapeHTML(one)}</option>`).join("") +
      `</select>` +
      `<input type="text" name="reason" autocomplete="off" aria-label="${escapeHTML(t("evUntestableReason"))}"` +
      ` placeholder="${escapeHTML(t("evUntestableReasonPlaceholder"))}">` +
      `<button type="submit" class="button-quiet">${t("evUntestableMark")}</button></form>`
    : "";
  return (
    `<div class="untestable" data-round="${escapeHTML(round.round)}" data-proposition="${escapeHTML(proposition.id)}">` +
    `<h6>${t("evUntestableTitle")}</h6>${list}${form}</div>`
  );
}

function roundHTML(proposition, round) {
  const tally = (key, label) =>
    `<div data-stance-tally="${key}"><dt>${t(label)}</dt><dd><span class="tally-count">${round.tally[key].length}</span>` +
    (round.tally[key].length ? ` · ${escapeHTML(round.tally[key].join(", "))}` : "") +
    `</dd></div>`;
  return (
    `<section class="proposition-round" data-round="${escapeHTML(round.round)}">` +
    `<p class="round-status" data-round="${escapeHTML(round.round)}" data-status="${round.status}">` +
    `${escapeHTML(roundName(round.round))}: <strong>${t(STATUS[round.status])}</strong> · ` +
    `${escapeHTML(t("evPersonsInRound", { n: round.persons }))}` +
    (round.testable !== round.persons ? ` · ${escapeHTML(t("evTestableInRound", { n: round.testable }))}` : "") +
    `</p>` +
    round.pending
      .map((verdict) => `<p class="column-note pending" data-pending="${verdict}">${escapeHTML(t("evPending", { verdict: t(STATUS[verdict]) }))}</p>`)
      .join("") +
    `<dl class="stance-tally">` +
    tally("supports", "evStanceSupports") +
    tally("contradicts", "evStanceContradicts") +
    tally("neither", "evStanceNone") +
    `</dl>` +
    (round.uncoded.length
      ? `<p class="column-note">${escapeHTML(t("evUncoded", { departments: round.uncoded.join(", ") }))}</p>`
      : "") +
    (round.split.length
      ? `<div class="split" role="note"><h6>${t("evSplitTitle")}</h6>` +
        `<p class="column-note">${t("evSplitLead")}</p>` +
        round.split
          .map(
            (person) =>
              `<details class="person" data-department="${escapeHTML(person.department)}">` +
              `<summary>${escapeHTML(person.department)} · ${escapeHTML(
                t("evSplitCount", { contradicts: person.contradicts.length, supports: person.supports.length }),
              )}</summary>` +
              `<div class="citations">${[...person.contradicts, ...person.supports]
                .map((unit) => unitHTML(unit, { proposition: proposition.id }))
                .join("")}</div></details>`,
          )
          .join("") +
        `</div>`
      : "") +
    untestableHTML(proposition, round) +
    `</section>`
  );
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
          proposition.rounds.map((round) => roundHTML(proposition, round)).join("") +
          (proposition.criteria.length
            ? proposition.criteria.map((criterion) => criterionHTML(proposition, criterion)).join("") +
              ["supported", "falsified"]
                .filter((verdict) => proposition.criteria.filter((one) => one.verdict === verdict).length > 1)
                .map(
                  (verdict) =>
                    `<p class="column-note combine-note">${escapeHTML(
                      t(proposition.combine?.[verdict] === "any" ? "evCombineAny" : "evCombineAll", {
                        verdict: t(VERDICT[verdict]),
                      }),
                    )}</p>`,
                )
                .join("")
            : `<p class="column-note">${t("evNoCriteria")}</p>`) +
          `</article>`,
      )
      .join("");
}

async function markUntestable(round, proposition, department, reason) {
  try {
    await host.api(`/api/rounds/${encodeURIComponent(round)}/untestable`, {
      method: "PATCH",
      body: { proposition, department, reason },
    });
    await drawPropositions();
    host.notify(t(reason ? "evUntestableMarked" : "evUntestableCleared", { department }));
  } catch (error) {
    host.complain(error);
  }
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
  [["1", "…", "9"], "evKeyAim"],
  [["p"], "evKeySupports"],
  [["c"], "evKeyContradicts"],
  [["q"], "evKeyQuestion"],
];
