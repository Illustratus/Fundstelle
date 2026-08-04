/*
  Interface of the coding tool.

  The core is the conversion between the selection in the browser and the
  character positions inside a speaker turn, because only those positions are
  stable enough to be stored next to the transcript. Everything else hangs off
  them: highlight, apparatus, citation and export.
*/

import { matchesSlice, occurrences, trimStem } from "./search.js";
import { language, plural, setLanguage, t } from "./texts.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const TIMESTAMP = /\[\d+:\d{2}\]/g;
const SIGNS = "abcdefghijklmnopqrstuvwxyz";
const NEUTRAL_COLOR = "#8A9299";

const STORAGE = {
  interview: "fundstelle.interview",
  theme: "fundstelle.theme",
  readingPosition: (interview) => `fundstelle.readingPosition.${interview}`,
};

/**
 * Bring the statically labelled parts of the interface into the chosen
 * language. German already stands in the HTML; for other languages the
 * `data-t…` anchors swap text, placeholder, title and screen-reader name.
 */
function translateChrome() {
  const current = language();
  document.documentElement.lang = current;

  // The switch carries the target language and changes it permanently; a
  // `?lang=…` in the address drops out, or it would win the argument.
  const choice = $("#language");
  choice.textContent = t("languageTarget");
  choice.title = t("languageTitle");
  choice.setAttribute("aria-label", t("languageAria"));
  choice.addEventListener("click", () => {
    setLanguage(current === "de" ? "en" : "de");
    const target = new URL(location.href);
    target.searchParams.delete("lang");
    location.href = target.href;
  });

  if (current === "de") return;
  for (const el of $$("[data-t]")) el.textContent = t(el.dataset.t);
  for (const el of $$("[data-t-html]")) el.innerHTML = t(el.dataset.tHtml);
  for (const el of $$("[data-t-placeholder]")) el.placeholder = t(el.dataset.tPlaceholder);
  for (const el of $$("[data-t-title]")) el.title = t(el.dataset.tTitle);
  for (const el of $$("[data-t-aria]")) el.setAttribute("aria-label", t(el.dataset.tAria));
}

const EMPTY_SLICE = {
  department: "",
  section: "",
  anchor: false,
  memo: false,
  withoutRequirement: false,
  unreviewed: false,
  word: "",
};

const state = {
  interviews: [],
  current: null,
  transcript: null,
  codings: [],
  categories: [],
  propositions: {},
  selection: null,
  selected: null,
  expanded: new Set(),
  // A coding rule begun but not yet submitted, per category. It sits in no
  // file, but survives the redraw of the list — otherwise a save that just
  // finished would wipe out the next sentence being typed.
  ruleDraft: new Map(),
  requirements: [],
  moscow: [],
  departments: [],
  reanchoring: null,
  view: "code",
  // Letters typed while the coding bar is open.
  filter: "",
  search: "",
  // Trimmed form of the search term, if the input itself found nothing.
  instead: null,
  // Last computed analysis, so that the citation slices work without a refetch.
  analysis: null,
  citationFilter: { ...EMPTY_SLICE },
  noteFilter: "",
  noteKind: "",
  noteCategory: "",
  matches: [],
  matchIndex: 0,
  inFocus: null,
};

/* Helpers --------------------------------------------------------------- */

async function api(path, options = {}) {
  const response = await fetch(path, {
    // The server answers in the language of the request, so an error message
    // arrives in the language the interface is set to and not in the one the
    // browser happens to prefer.
    headers: { "content-type": "application/json", "accept-language": language() },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error ?? t("errorGeneric")), { data });
  return data;
}

let messageTimer;
let offer = null;

/**
 * A message, optionally with one handle on it.
 *
 * Deleting a coding unit loses its memo, its anchor-example flag and its
 * requirement assignments; in a session with a hundred units a misfire is only
 * a matter of time. The undo therefore sits on the message itself and not in a
 * menu, and it stands long enough to be noticed.
 */
function notify(text, kind = "info", handle = null) {
  const element = $("#message");
  element.dataset.kind = kind;
  element.innerHTML =
    escapeHTML(text) +
    (handle
      ? ` <button type="button" class="button-quiet" id="message-action">${escapeHTML(handle.label)}</button>`
      : "");
  offer = handle;
  element.hidden = false;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(
    () => {
      element.hidden = true;
      offer = null;
    },
    handle ? 15000 : kind === "error" ? 6000 : 3200,
  );
}

function escapeHTML(text) {
  return String(text).replace(
    /[&<>"]/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character],
  );
}

function textHTMLWithTimestamps(text) {
  return escapeHTML(text).replace(TIMESTAMP, (match) => `<span class="timestamp">${match}</span>`);
}

function withoutTimestamps(text) {
  return text.replace(TIMESTAMP, " ").replace(/\s+/g, " ").trim();
}

const categoryById = (id) => state.categories.find((category) => category.id === id);

function colorOf(categoryId) {
  const category = categoryById(categoryId);
  const proposition = state.propositions[category?.proposition ?? "none"];
  return proposition?.color ?? NEUTRAL_COLOR;
}

/* Loading --------------------------------------------------------------- */

async function loadCategories() {
  const data = await api("/api/categories");
  state.categories = data.categories;
  state.propositions = data.propositions;
}

async function loadRequirements() {
  const data = await api("/api/requirements");
  state.requirements = data.requirements;
  state.moscow = data.moscow;
  state.departments = data.departments;
}

async function loadInterviews() {
  state.interviews = await api("/api/interviews");
  const choice = $("#interview-choice");
  choice.innerHTML = state.interviews
    .map((i) => `<option value="${escapeHTML(i.id)}">${escapeHTML(i.title)}</option>`)
    .join("");
  if (!state.interviews.length) return;
  const remembered = localStorage.getItem(STORAGE.interview);
  state.current = state.interviews.some((i) => i.id === remembered)
    ? remembered
    : state.interviews[0].id;
  choice.value = state.current;
}

async function loadTranscript() {
  if (!state.current) return;
  const data = await api(`/api/interviews/${encodeURIComponent(state.current)}`);
  state.transcript = data;
  state.codings = data.codings;
  state.selected = null;
  state.reanchoring = null;
  state.inFocus = null;
  state.matchIndex = 0;
  localStorage.setItem(STORAGE.interview, state.current);
  if (data.moved) {
    notify(data.moved === 1 ? t("unitMoved") : t("unitsMoved", { n: data.moved }));
  }
}

/* Drawing the transcript -------------------------------------------------- */

function codingsOf(turnNumber) {
  return state.codings
    .filter((coding) => coding.turn === turnNumber && coding.state !== "lost")
    .sort((a, b) => a.start - b.start);
}

const lostCodings = () => state.codings.filter((coding) => coding.state === "lost");

function turnTextHTML(turn) {
  const own = codingsOf(turn.number);
  if (!own.length) return textHTMLWithTimestamps(turn.text);

  const parts = [];
  let position = 0;
  own.forEach((coding, index) => {
    if (coding.start > position) {
      parts.push(textHTMLWithTimestamps(turn.text.slice(position, coding.start)));
    }
    const inner = textHTMLWithTimestamps(turn.text.slice(coding.start, coding.end));
    parts.push(
      `<mark class="segment" data-id="${coding.id}" style="--mark-color:${colorOf(coding.category)}"` +
        ` data-no-proposition="${(categoryById(coding.category)?.proposition ?? "none") === "none"}"` +
        // When a unit follows the previous one immediately the boundary blurs —
        // especially when both carry the same category.
        `${index > 0 && coding.start === position ? ' data-adjacent="true"' : ""}` +
        `${coding.reviewed === true ? "" : ' data-unreviewed="true"'}` +
        `${state.selected === coding.id ? ' data-selected="true"' : ""}>` +
        `${inner}<sup class="mark-sup">${SIGNS[index] ?? "+"}</sup></mark>`,
    );
    position = coding.end;
  });
  if (position < turn.text.length) parts.push(textHTMLWithTimestamps(turn.text.slice(position)));
  return parts.join("");
}

function apparatusHTML(turn) {
  const marks = codingsOf(turn.number)
    .map((coding, index) => {
      const category = categoryById(coding.category);
      return (
        `<li><button type="button" class="mark" data-id="${coding.id}"` +
        ` aria-pressed="${state.selected === coding.id}"` +
        ` style="--mark-color:${colorOf(coding.category)}">` +
        `<span class="what">${escapeHTML(category?.name ?? coding.category)}` +
        `${coding.anchor ? `<span class="anchor"> ▪ ${escapeHTML(t("anchorShort"))}</span>` : ""}</span>` +
        `<span class="sign">${SIGNS[index] ?? "+"}</span></button></li>`
      );
    })
    .join("");
  return (
    `<span class="location">${turn.number}</span>` +
    (marks ? `<ol class="marks">${marks}</ol>` : "")
  );
}

/**
 * The first start without transcripts is not a dead end but the instruction:
 * it names the expected folder, shows the file format as a specimen and the way
 * to a category system of one's own.
 */
function drawOnboarding(root) {
  root.innerHTML =
    `<div class="onboarding">` +
    `<h2>${t("onboardingTitle")}</h2>` +
    `<p>${t("onboardingReads")}</p>` +
    `<p class="onboarding-path"><code id="onboarding-path">…/my-interview/final.md</code></p>` +
    `<pre class="onboarding-sample">${escapeHTML(t("onboardingSample"))}</pre>` +
    `<p>${t("onboardingContract")}</p>` +
    `<p><button type="button" class="button-quiet" id="onboarding-reload">${t("reload")}</button></p>` +
    `<p class="column-note">${t("onboardingStartSystem")}</p>` +
    `</div>`;
  api("/api/environment")
    .then((environment) => {
      const field = document.getElementById("onboarding-path");
      if (field) field.textContent = `${environment.transcripts}/my-interview/final.md`;
    })
    .catch(() => {});
  document.getElementById("onboarding-reload")?.addEventListener("click", () => location.reload());
}

function drawTranscript() {
  const root = $("#transcript");
  if (!state.transcript) {
    drawOnboarding(root);
    return;
  }
  const parts = [];
  let lastSection = -1;
  for (const turn of state.transcript.turns) {
    if (turn.section !== lastSection) {
      lastSection = turn.section;
      const section = state.transcript.sections[turn.section];
      if (section) {
        const own = state.transcript.turns.filter(
          (other) => other.section === section.index && !other.interviewer,
        );
        const units = state.codings.filter((coding) =>
          own.some((other) => other.number === coding.turn),
        ).length;
        parts.push(
          `<div class="section-head" id="section-${section.index}">` +
            `<h2>${escapeHTML(section.name)}</h2><p>` +
            `<span>${own.length} ${plural(own.length, "turnOne", "turnMany")}</span>` +
            `<span>${units} ${plural(units, "unitOne", "unitMany")}</span>` +
            `</p></div>`,
        );
      }
    }
    parts.push(
      `<article class="turn" data-turn="${turn.number}"` +
        ` data-interviewer="${turn.interviewer}" id="turn-${turn.number}">` +
        `<div class="apparatus">${apparatusHTML(turn)}</div>` +
        `<div class="speech"><p class="voice">${escapeHTML(turn.speaker)} · ${turn.time}</p>` +
        `<p class="text" data-turn="${turn.number}">${turnTextHTML(turn)}</p></div></article>`,
    );
  }
  root.innerHTML = parts.join("");
  highlightMatches();
  showFocus();
}

/* Search and navigation in the transcript ---------------------------------- */

/**
 * Highlights the locations of the search.
 *
 * The coding units hold their place through character positions in the text of
 * the speaker turn. A match is therefore only wrapped, never replaced: the text
 * nodes add up to the same wording, and the conversion from selection to
 * character range stays valid.
 */
function highlightMatches(scroll = false) {
  const root = $("#transcript");
  for (const mark of [...root.querySelectorAll("mark.match")]) {
    mark.replaceWith(...mark.childNodes);
  }
  root.normalize();

  const input = state.search.trim();
  state.instead = null;
  let matches = input.length >= 2 ? markAll(root, input) : [];

  // Nothing found? Then without the inflecting ending — and the status says
  // what was searched for instead.
  if (!matches.length && input.length >= 2) {
    const stem = trimStem(input);
    if (stem) {
      const second = markAll(root, stem);
      if (second.length) {
        state.instead = stem;
        matches = second;
      }
    }
  }

  state.matches = matches;
  if (state.matchIndex >= matches.length) state.matchIndex = 0;
  showMatch(scroll);
}

function markAll(root, word) {
  const matches = [];
  for (const field of root.querySelectorAll(".text")) {
    const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement?.closest(".mark-sup")
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) wrapMatches(node, word, matches);
  }
  return matches;
}

function wrapMatches(node, word, matches) {
  let rest = node;
  let places = occurrences(rest.nodeValue, word);
  while (places.length) {
    const [from, to] = places[0];
    const middle = rest.splitText(from);
    rest = middle.splitText(to - from);
    const mark = document.createElement("mark");
    mark.className = "match";
    middle.replaceWith(mark);
    mark.append(middle);
    matches.push(mark);
    places = occurrences(rest.nodeValue, word);
  }
}

function showMatch(scroll) {
  state.matches.forEach((mark, index) =>
    mark.classList.toggle("current", index === state.matchIndex),
  );
  const count = state.matches.length;
  $("#search-status").textContent = !state.search.trim()
    ? ""
    : count
      ? t("searchPosition", { i: state.matchIndex + 1, n: count }) +
        (state.instead ? ` · „${state.instead}“` : "")
      : t("searchNoMatch");
  if (scroll && count) {
    state.matches[state.matchIndex].scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function jumpMatch(direction) {
  if (!state.matches.length) return;
  const count = state.matches.length;
  state.matchIndex = (state.matchIndex + direction + count) % count;
  showMatch(true);
}

function clearSearch() {
  $("#search").value = "";
  state.search = "";
  state.matchIndex = 0;
  highlightMatches();
  showElsewhere({ interviews: [] });
}

/**
 * Locations in the other interviews.
 *
 * „Somebody else said that too" is the most frequent reason to look something
 * up while coding — and the other interview happens not to be open. The count
 * comes from the server, because only there do all transcripts lie.
 */
let searchRun = 0;

async function searchElsewhere(word) {
  const run = ++searchRun;
  if (word.trim().length < 2) return showElsewhere({ interviews: [] });
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(word.trim())}`);
    if (run === searchRun) showElsewhere(data);
  } catch {
    /* The search in the open interview stands without this addition. */
  }
}

function showElsewhere(data) {
  const field = $("#search-elsewhere");
  const others = (data.interviews ?? []).filter((i) => i.id !== state.current);
  if (!others.length) {
    field.hidden = true;
    field.innerHTML = "";
    return;
  }
  field.hidden = false;
  field.innerHTML =
    `<span class="field-label">${t("searchElsewhere")}` +
    `${data.instead ? ` · „${escapeHTML(data.instead)}“` : ""}</span>` +
    others
      .map(
        (interview) =>
          `<button type="button" class="elsewhere" data-interview="${escapeHTML(interview.id)}">` +
          `<span class="where">${escapeHTML(interview.department)}</span>` +
          `<span class="how-many">${interview.hits} ` +
          `${plural(interview.hits, "locationOne", "locationMany")}</span>` +
          `<span class="sample">${escapeHTML(interview.first?.excerpt ?? "")}</span></button>`,
      )
      .join("");
}

/** The topmost turn still inside the window. */
function turnInWindow() {
  for (const element of $$("#transcript .turn")) {
    if (element.getBoundingClientRect().bottom > 120) return Number(element.dataset.turn);
  }
  return null;
}

function showFocus() {
  for (const element of $$("#transcript .turn.focused")) element.classList.remove("focused");
  if (state.inFocus == null) return;
  document.getElementById(`turn-${state.inFocus}`)?.classList.add("focused");
}

/**
 * Turn by turn through the material, without a hand on the mouse. Walking the
 * material is the regular case of the method; „next untouched turn" by contrast
 * skips over what is already coded.
 */
function jumpTurn(direction) {
  const all = state.transcript?.turns ?? [];
  if (!all.length) return;
  const now = state.inFocus ?? turnInWindow();
  const at = all.findIndex((turn) => turn.number === now);
  // The first keystroke grabs the turn already on screen instead of skipping it.
  const target =
    at < 0
      ? all[0]
      : state.inFocus == null
        ? all[at]
        : all[Math.min(all.length - 1, Math.max(0, at + direction))];
  if (!target) return;
  state.inFocus = target.number;
  showFocus();
  document
    .getElementById(`turn-${target.number}`)
    ?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function drawDrift() {
  const field = $("#drift");
  const open = lostCodings();
  if (!open.length) {
    field.hidden = true;
    field.innerHTML = "";
    return;
  }
  field.hidden = false;
  field.innerHTML =
    `<h2>${open.length === 1 ? t("driftTitleOne") : t("driftTitleMany", { n: open.length })}</h2>` +
    `<p>${t("driftNote")}</p><ul>` +
    open
      .map(
        (coding) =>
          `<li data-id="${coding.id}"><span class="source">${t("turn")} ${coding.turn} · ` +
          `${escapeHTML(categoryById(coding.category)?.name ?? coding.category)}</span>` +
          `<blockquote>„${escapeHTML(withoutTimestamps(coding.text))}“</blockquote>` +
          `<span class="reason">${escapeHTML(coding.reason ?? "")}</span>` +
          `<span class="actions"><button type="button" class="button-quiet" data-reanchor="${coding.id}">` +
          `${t("reanchor")}</button>` +
          `<button type="button" class="button-quiet remove" data-drift-remove="${coding.id}">` +
          `${t("delete")}</button></span></li>`,
      )
      .join("") +
    `</ul>`;
}

/* Sections and status ----------------------------------------------------- */

function drawSections() {
  const list = $("#sections");
  if (!state.transcript) return (list.innerHTML = "");

  const charactersPerSection = new Map();
  const codedPerSection = new Map();
  for (const turn of state.transcript.turns) {
    if (turn.interviewer || turn.section == null) continue;
    charactersPerSection.set(
      turn.section,
      (charactersPerSection.get(turn.section) ?? 0) + turn.text.length,
    );
  }
  for (const coding of state.codings) {
    const turn = state.transcript.turns.find((other) => other.number === coding.turn);
    if (!turn || turn.section == null) continue;
    codedPerSection.set(
      turn.section,
      (codedPerSection.get(turn.section) ?? 0) + (coding.end - coding.start),
    );
  }

  list.innerHTML = state.transcript.sections
    .map((section) => {
      const total = charactersPerSection.get(section.index) ?? 0;
      const coded = codedPerSection.get(section.index) ?? 0;
      const share = total ? Math.min(100, (coded / total) * 100) : 0;
      return (
        `<li><button type="button" class="section-entry" data-section="${section.index}">` +
        `<span class="num">${section.number ?? "·"}</span>` +
        `<span class="name">${escapeHTML(section.short)}</span>` +
        `<span class="share">${share >= 1 ? Math.round(share) + " %" : "—"}</span>` +
        (share >= 1
          ? `<span class="saturation" title="${t("saturationTitle", { n: share.toFixed(0) })}">` +
            `<i style="width:${share.toFixed(1)}%"></i></span>`
          : "") +
        `</button></li>`
      );
    })
    .join("");

  const codable = state.transcript.turns.filter((turn) => !turn.interviewer);
  const touched = new Set(state.codings.map((coding) => coding.turn));
  const touchedCount = codable.filter((turn) => touched.has(turn.number)).length;
  const open = state.codings.filter((coding) => coding.reviewed !== true).length;
  $("#status").innerHTML =
    `<div>${t("statusUnits", { n: state.codings.length })}</div>` +
    `<div>${t("statusTouched", { n: touchedCount, m: codable.length })}</div>` +
    `<div>${t("statusSections", { n: state.transcript.sections.length })}</div>` +
    (open
      ? `<div class="open-status">${t("statusUnreviewed", { n: open })}</div>` +
        `<button type="button" class="button-quiet jump" id="review">${t("nextUnreviewed")}</button>`
      : state.codings.length
        ? `<div class="open-status reviewed">${t("allReviewed")}</div>`
        : "") +
    `<button type="button" class="button-quiet jump" id="jump">${t("nextUntouched")}</button>`;

  const conducted = state.transcript.meta.Erhebung ?? state.transcript.meta.Conducted ?? "";
  $("#header-subtitle").textContent = `${state.transcript.department} · ${conducted}`.trim();

  // Do not overwrite while it is being written in.
  const note = $("#note");
  if (document.activeElement !== note) note.value = state.transcript.memo ?? "";
}

/* Categories ------------------------------------------------------------- */

function countCategory(id) {
  return state.codings.filter((coding) => coding.category === id).length;
}

function ruleText(rule) {
  return (typeof rule === "string" ? rule : (rule?.text ?? "")).trim();
}

/**
 * Save a change to the category system and redraw everything — a name also
 * stands at every margin mark in the transcript. If it fails, the state is
 * fetched from the server again, so that a field does not keep showing what was
 * not saved.
 *
 * The changes run one after another, and `build` gets the category only when
 * its turn comes: whoever submits two coding rules in quick succession would
 * otherwise append the second to a list without the first and delete it again.
 */
let categoryChain = Promise.resolve();

function updateCategory(id, build, message) {
  categoryChain = categoryChain.then(async () => {
    try {
      const fields = typeof build === "function" ? build(categoryById(id)) : build;
      if (!fields) return;
      await api(`/api/categories/${encodeURIComponent(id)}`, { method: "PATCH", body: fields });
      await loadCategories();
      drawAll();
      notify(message);
    } catch (error) {
      await loadCategories();
      drawAll();
      notify(error.message, "error");
    }
  });
  return categoryChain;
}

/**
 * Expanded category: definition and coding rules are input here, not display.
 * Both sharpen only on the material — that a rule was drawn too narrowly shows
 * at the third doubtful case and not when it was written.
 *
 * The name stays fixed for deductive categories: it is the name the study was
 * designed with and the name in every cross table that comes out of it. The
 * definition may change, but not unnoticed — hence the record of the wording it
 * started from, for inductive categories just as much as for deductive ones.
 */
function categoryDetail(category) {
  const id = category.id;
  const inductive = category.origin === "inductive";
  const rules = (category.codingRules ?? []).map(ruleText);
  return (
    `<li class="category-detail" data-detail="${id}">` +
    (inductive
      ? `<label class="field"><span class="field-label">${t("fieldName")}</span>` +
        `<input type="text" data-category-name="${id}" value="${escapeHTML(category.name ?? "")}"></label>` +
        // The same as dragging in the list, only without a mouse.
        `<label class="field"><span class="field-label">${t("fieldParent")}</span>` +
        `<select data-category-parent="${id}">` +
        `<option value="">${t("standalone")}</option>` +
        state.categories
          .filter((other) => !other.parent && other.id !== id)
          .map(
            (other) =>
              `<option value="${other.id}"${other.id === category.parent ? " selected" : ""}>` +
              `${escapeHTML(other.name)}</option>`,
          )
          .join("") +
        `</select></label>`
      : "") +
    `<label class="field"><span class="field-label">${t("fieldDefinition")}</span>` +
    `<textarea rows="4" data-definition="${id}" aria-label="${escapeHTML(t("definitionAria", { name: category.name ?? "" }))}"` +
    ` placeholder="${escapeHTML(t("definitionPlaceholder"))}">${escapeHTML(category.definition ?? "")}</textarea></label>` +
    (category.initialDefinition
      ? `<p class="deviation"><b>${t("sharpenedOnMaterial")}</b> ` +
        `${inductive ? t("definitionAtCreation") : t("definitionBefore")} ` +
        `„${escapeHTML(category.initialDefinition)}“ ` +
        `<button type="button" class="button-quiet" data-definition-reset="${id}">${t("definitionReset")}</button></p>`
      : "") +
    `<span class="field-label rules-head">${t("codingRules")}</span>` +
    (rules.length
      ? `<ul class="rules">` +
        rules
          .map(
            (text, index) =>
              `<li><textarea rows="2" data-rule-text="${id}" data-index="${index}"` +
              ` aria-label="${escapeHTML(t("ruleAria", { n: index + 1 }))}">${escapeHTML(text)}</textarea>` +
              `<button type="button" class="button-quiet remove" data-rule-remove="${id}" data-index="${index}"` +
              ` title="${escapeHTML(t("ruleRemoveTitle"))}" aria-label="${escapeHTML(t("ruleRemoveAria", { n: index + 1 }))}">×</button></li>`,
          )
          .join("") +
        `</ul>`
      : `<p class="empty">${t("rulesEmpty")}</p>`) +
    `<form data-rule="${id}">` +
    `<input type="text" placeholder="${escapeHTML(t("rulePlaceholder"))}" aria-label="${escapeHTML(t("newRuleAria"))}"` +
    ` value="${escapeHTML(state.ruleDraft.get(id) ?? "")}">` +
    `<button type="submit" class="button-quiet">+</button></form>` +
    `<label class="field note-field"><span class="field-label">${t("note")}</span>` +
    `<textarea rows="2" data-category-memo="${id}" aria-label="${escapeHTML(t("categoryNoteAria", { name: category.name ?? "" }))}"` +
    ` placeholder="${escapeHTML(t("categoryNotePlaceholder"))}">${escapeHTML(category.memo ?? "")}</textarea></label>` +
    (inductive ? mergeHTML(category) : "") +
    (inductive
      ? `<button type="button" class="button-quiet remove" data-category-remove="${id}">${t("removeCategory")}</button>`
      : "") +
    `</li>`
  );
}

/** Make two inductive categories that name the same thing one. */
function mergeHTML(category) {
  const others = state.categories.filter((other) => other.id !== category.id);
  if (!others.length) return "";
  return (
    `<div class="merge">` +
    `<label class="field"><span class="field-label">${t("mergeIntoCategory")}</span>` +
    `<select data-merge-target="${category.id}" aria-label="${escapeHTML(t("targetCategoryAria"))}">` +
    `<option value="">${t("chooseTarget")}</option>` +
    others
      .map(
        (other) =>
          `<option value="${other.id}">${other.parent ? "… " : ""}${escapeHTML(other.name)}</option>`,
      )
      .join("") +
    `</select></label>` +
    `<button type="button" class="button-quiet" data-merge="${category.id}">${t("merge")}</button>` +
    `</div>`
  );
}

/**
 * The dissolved category disappears, its locations move along. Afterwards the
 * target category stands open: its definition now describes one more thing and
 * wants to be pulled along.
 */
async function mergeCategories(source, target) {
  const name = categoryById(source)?.name ?? source;
  try {
    const answer = await api(`/api/categories/${encodeURIComponent(source)}/merge`, {
      method: "POST",
      body: { target },
    });
    await loadCategories();
    await loadTranscript();
    state.expanded.delete(source);
    state.expanded.add(target);
    drawAll();
    notify(
      t("categoryMerged", {
        source: name,
        target: answer.target.name,
        n: answer.moved,
        word: plural(answer.moved, "locationOne", "locationMany"),
      }),
    );
  } catch (error) {
    notify(error.message, "error");
  }
}

/**
 * Hang an inductive category under a start category or release it again.
 *
 * When it is created it is often still open whether an observation is a case of
 * its own or a variant of what the start system already knows. The answer comes
 * from the material, so the assignment has to stay movable afterwards. The
 * locations stay untouched, only the place in the systematics changes; with it
 * the proposition anchoring, which comes from the parent category.
 */
function subordinateCategory(id, parentId) {
  const category = categoryById(id);
  if (!category) return;
  const target = parentId || null;
  if ((category.parent ?? null) === target) return;
  return updateCategory(
    id,
    { parent: target },
    target
      ? t("categoryNowUnder", { name: category.name, parent: categoryById(target)?.name ?? target })
      : t("categoryNowStandalone", { name: category.name }),
  );
}

/**
 * Drag and drop in the category system.
 *
 * The assignment of an inductive category changes while coding, not in a
 * maintenance form: one sees the fourth citation and knows in that moment where
 * the category belongs. So the handle lies in the list itself.
 *
 * The drop happens on a start category; if it hits a subcategory, its parent
 * counts, because a third level is not provided for. Whoever drags next to the
 * list pulls the category back out.
 */
function connectCategoryDragging() {
  const list = $("#categories");
  let dragged = null;

  // null means „out of every parent category", undefined means „nothing happens
  // here" — otherwise dropping on the dragged category itself would pull it out
  // of its parent.
  const targetOf = (element) => {
    const button = element?.closest?.(".category");
    if (!button) return null;
    const category = categoryById(button.dataset.category);
    if (!category) return undefined;
    const top = category.parent ? categoryById(category.parent) : category;
    if (!top || top.id === dragged) return undefined;
    return top.id;
  };

  const mark = (targetId) => {
    list.querySelectorAll(".category[data-target]").forEach((c) => delete c.dataset.target);
    if (!targetId) return;
    const button = list.querySelector(`.category[data-category="${CSS.escape(targetId)}"]`);
    if (button) button.dataset.target = "true";
  };

  const finish = () => {
    dragged = null;
    mark(null);
    list.querySelectorAll(".dragging").forEach((c) => c.classList.remove("dragging"));
  };

  list.addEventListener("dragstart", (event) => {
    const button = event.target.closest?.('.category[draggable="true"]');
    if (!button) return;
    dragged = button.dataset.category;
    button.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", dragged);
  });

  list.addEventListener("dragover", (event) => {
    if (!dragged) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    mark(targetOf(event.target));
  });

  list.addEventListener("dragleave", (event) => {
    if (dragged && !list.contains(event.relatedTarget)) mark(null);
  });

  list.addEventListener("drop", (event) => {
    if (!dragged) return;
    event.preventDefault();
    const id = dragged;
    const target = targetOf(event.target);
    finish();
    if (target !== undefined) subordinateCategory(id, target);
  });

  list.addEventListener("dragend", finish);
}

/**
 * From a citation back to its place in the transcript. That is the movement one
 * makes constantly while comparing two locations: first read them side by side,
 * then look them up in context.
 */
async function showPassage(interview, id) {
  if (interview !== state.current) {
    state.current = interview;
    $("#interview-choice").value = interview;
    await loadTranscript();
  }
  setView("code");
  state.selected = id;
  const coding = state.codings.find((other) => other.id === id);
  if (coding) state.inFocus = coding.turn;
  drawAll();
  const place = document.querySelector(`#transcript .segment[data-id="${CSS.escape(id)}"]`);
  if (place) place.scrollIntoView({ behavior: "smooth", block: "center" });
  else notify(t("passageNotVisible"), "error");
}

function drawCategories() {
  const list = $("#categories");
  // Whoever is typing a rule while the previous one is being saved should not
  // fall out of the field.
  const typing = document.activeElement?.closest?.("[data-rule]")?.dataset.rule ?? null;
  list.innerHTML = state.categories
    .map((category) => {
      const expanded = state.expanded.has(category.id);
      const detail = expanded ? categoryDetail(category) : "";
      const inductive = category.origin === "inductive";
      return (
        `<li><button type="button" class="category" data-category="${category.id}"` +
        ` data-child="${Boolean(category.parent)}" data-inductive="${inductive}"` +
        (inductive
          ? ` draggable="true" title="${escapeHTML(t("dragAria", { name: category.name }))}"`
          : "") +
        ` aria-expanded="${expanded}" style="--mark-color:${colorOf(category.id)}">` +
        `<span class="dot"></span><span class="name">${escapeHTML(category.name)}` +
        (inductive ? `<span class="tag">${escapeHTML(t("inductiveTag"))}</span>` : "") +
        `</span>` +
        `<span class="count">${countCategory(category.id)}</span></button></li>${detail}`
      );
    })
    .join("");

  const parent = $("#inductive-parent");
  const remembered = parent.value;
  parent.innerHTML =
    `<option value="">${escapeHTML(t("standalone"))}</option>` +
    state.categories
      .filter((category) => !category.parent)
      .map((category) => `<option value="${category.id}">${escapeHTML(category.name)}</option>`)
      .join("");
  parent.value = remembered;

  if (typing) {
    const field = list.querySelector(`[data-rule="${CSS.escape(typing)}"] input`);
    if (field) {
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    }
  }
}

/* Detail of one coding ---------------------------------------------------- */

function drawDetail() {
  const field = $("#detail");
  const coding = state.codings.find((other) => other.id === state.selected);
  if (!coding) {
    field.hidden = true;
    field.innerHTML = "";
    return;
  }
  const turn = state.transcript.turns.find((other) => other.number === coding.turn);
  field.hidden = false;
  field.style.setProperty("--mark-color", colorOf(coding.category));
  field.innerHTML =
    `<h2>${t("codingUnit")} · ${t("turn")} ${coding.turn}${turn ? ` · ${turn.time}` : ""}</h2>` +
    `<blockquote>${escapeHTML(withoutTimestamps(coding.text))}</blockquote>` +
    `<label class="field"><span class="field-label">${t("category")}</span>` +
    `<select id="detail-category">` +
    state.categories
      .map(
        (category) =>
          `<option value="${category.id}"${category.id === coding.category ? " selected" : ""}>` +
          `${category.parent ? "… " : ""}${escapeHTML(category.name)}</option>`,
      )
      .join("") +
    `</select></label>` +
    `<label class="field" style="margin-top:.5rem"><span class="field-label">${t("memo")}</span>` +
    `<textarea id="detail-memo" rows="2" placeholder="${escapeHTML(t("memoPlaceholder"))}">${escapeHTML(coding.memo ?? "")}</textarea></label>` +
    `<div class="row">` +
    `<label><input type="checkbox" id="detail-anchor"${coding.anchor ? " checked" : ""}> ${t("anchorExample")}</label>` +
    `<label><input type="checkbox" id="detail-reviewed"${coding.reviewed === true ? " checked" : ""}> ${t("reviewed")}</label>` +
    `<button type="button" class="button-quiet remove" id="detail-remove">${t("delete")}</button>` +
    `</div>` +
    `<div class="cites"><span class="field-label">${t("citesRequirement")}</span>` +
    (state.requirements.length
      ? `<ul>` +
        state.requirements
          .map(
            (requirement) =>
              `<li><label><input type="checkbox" data-requirement="${requirement.id}"` +
              `${(coding.requirements ?? []).includes(requirement.id) ? " checked" : ""}> ` +
              `${escapeHTML(requirement.title)}</label></li>`,
          )
          .join("") +
        `</ul>`
      : `<p class="column-note">${t("noRequirementYet")}</p>`) +
    `<form id="detail-new-requirement">` +
    `<input type="text" placeholder="${escapeHTML(t("newRequirementPlaceholder"))}" aria-label="${escapeHTML(t("newRequirementAria"))}">` +
    `<button type="submit" class="button-quiet">+</button></form></div>`;
}

/* Selection in the text --------------------------------------------------- */

function textPosition(container, node, offset) {
  let counted = 0;
  let done = false;

  const walk = (current) => {
    if (done) return;
    if (current.nodeType === Node.TEXT_NODE) {
      if (current === node) {
        counted += offset;
        done = true;
        return;
      }
      counted += current.nodeValue.length;
      return;
    }
    if (current.nodeType === Node.ELEMENT_NODE && current.classList.contains("mark-sup")) {
      return; // The sign is not in the source text and does not count.
    }
    for (const child of current.childNodes) {
      walk(child);
      if (done) return;
    }
    if (current === node) done = true;
  };

  walk(container);
  return counted;
}

function nodeAt(container, position) {
  let counted = 0;
  let found = null;

  const walk = (node) => {
    if (found) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.nodeValue.length;
      if (counted + length >= position) {
        found = [node, position - counted];
        return;
      }
      counted += length;
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains("mark-sup")) return;
    for (const child of node.childNodes) {
      walk(child);
      if (found) return;
    }
  };

  walk(container);
  return found;
}

/** Make a character range inside the speaker turn visibly selected. */
function showSelection(field, from, to) {
  const start = nodeAt(field, from);
  const end = nodeAt(field, to);
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(...start);
  range.setEnd(...end);
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return range;
}

/**
 * Pull the edges of a selection onto usable boundaries.
 *
 * Dragging with the mouse easily ends in the middle of a word or starts on a
 * comma. The citation that results travels unchanged into the coding table and
 * as an anchor example into the appendix — „, ich bin se" is unusable there.
 * The edges are therefore pulled onto word boundaries and cleaned of what has
 * no business at the edge of a quotation.
 *
 * The full stop at the end stays: it belongs to the coding unit. Only the
 * positions move; the citation text afterwards is the excerpt at exactly that
 * place — otherwise the anchor check would not find it again.
 */
const WORD_CHARACTER = /[\p{L}\p{N}]/u;
const DROP_AT_START = /[\s.,;:!?)\]}»“"'’–—-]/;
const DROP_AT_END = /[\s,;:(\[{«„"'‘–—-]/;

function sharpenEdges(text, from, to) {
  let a = Math.max(0, Math.min(from, text.length));
  let b = Math.max(0, Math.min(to, text.length));

  // Complete broken-off words at both edges.
  while (a > 0 && WORD_CHARACTER.test(text[a]) && WORD_CHARACTER.test(text[a - 1])) a -= 1;
  while (b < text.length && WORD_CHARACTER.test(text[b - 1]) && WORD_CHARACTER.test(text[b])) b += 1;

  // A timestamp at the edge belongs to the transcript, not to the citation.
  const leading = text.slice(a, b).match(/^\s*\[\d+:\d{2}\]/);
  if (leading) a += leading[0].length;
  const trailing = text.slice(a, b).match(/\[\d+:\d{2}\]\s*$/);
  if (trailing) b -= trailing[0].length;

  while (a < b && DROP_AT_START.test(text[a])) a += 1;
  while (b > a && DROP_AT_END.test(text[b - 1])) b -= 1;

  return { start: a, end: b };
}

function readSelection() {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const start =
    range.startContainer.parentElement?.closest?.(".text") ??
    range.startContainer.closest?.(".text");
  const end =
    range.endContainer.parentElement?.closest?.(".text") ?? range.endContainer.closest?.(".text");
  if (!start || !end) return null;
  if (start !== end) return { error: t("selectionWithinTurn") };
  const from = textPosition(start, range.startContainer, range.startOffset);
  const to = textPosition(start, range.endContainer, range.endOffset);
  if (to <= from) return null;

  const number = Number(start.dataset.turn);
  const turn = state.transcript.turns.find((other) => other.number === number);
  const edges = sharpenEdges(turn.text, from, to);
  const cited = turn.text.slice(edges.start, edges.end);
  if (cited.trim().length < 2) return null;

  // Show the sharpened edges too, otherwise the highlight in the text does not
  // agree with what is about to be saved.
  const shown = showSelection(start, edges.start, edges.end);

  return {
    turn: number,
    start: edges.start,
    end: edges.end,
    text: cited,
    rect: (shown ?? range).getBoundingClientRect(),
    interviewer: turn.interviewer,
  };
}

function selectSentence(event) {
  const field = event.target.closest?.(".text");
  if (!field) return;
  const number = Number(field.dataset.turn);
  const turn = state.transcript.turns.find((other) => other.number === number);
  if (!turn) return;

  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  const middle = textPosition(field, range.startContainer, range.startOffset);

  const text = turn.text;
  let from = 0;
  let to = text.length;
  for (let i = middle - 1; i > 0; i--) {
    if (/[.!?]/.test(text[i]) && /\s/.test(text[i + 1] ?? " ")) {
      from = i + 1;
      break;
    }
  }
  for (let i = middle; i < text.length; i++) {
    if (/[.!?]/.test(text[i])) {
      to = i + 1;
      break;
    }
  }
  const { start, end } = sharpenEdges(text, from, to);
  if (end - start < 2) return;
  const shown = showSelection(field, start, end);
  select({
    turn: number,
    start,
    end,
    text: text.slice(start, end),
    rect: (shown ?? range).getBoundingClientRect(),
    interviewer: turn.interviewer,
  });
}

/**
 * The categories the coding bar currently shows.
 *
 * The digits 1 to 9 cover exactly the deductive start system — the first
 * inductive category would only be reachable with the mouse, which is precisely
 * the one that is new and unfamiliar. Instead of binding further keys, typed
 * letters filter the list; the digit always means the n-th *shown* category.
 */
function barCategories() {
  const wanted = state.filter.toLowerCase();
  if (!wanted) return state.categories;
  return state.categories.filter((category) => category.name.toLowerCase().includes(wanted));
}

function drawBarChoices() {
  const visible = barCategories();
  $("#coding-bar-choices").innerHTML = visible.length
    ? visible
        .map(
          (category, index) =>
            `<button type="button" class="choice" data-category="${category.id}" data-child="${Boolean(category.parent)}"` +
            ` style="--mark-color:${colorOf(category.id)}">` +
            `<span class="key">${index < 9 ? index + 1 : ""}</span><span class="dot"></span>` +
            `<span>${escapeHTML(category.name)}</span></button>`,
        )
        .join("")
    : `<p class="empty-state">${escapeHTML(t("noCategoryContains", { filter: state.filter }))}</p>`;

  const row = $("#coding-bar-filter");
  row.hidden = !state.filter;
  row.textContent = state.filter ? t("filterIs", { filter: state.filter }) : "";
}

function select(selection) {
  state.selection = selection;
  state.filter = "";
  const bar = $("#coding-bar");
  $("#coding-bar-quote").textContent = "„" + withoutTimestamps(selection.text) + "“";
  drawBarChoices();

  bar.hidden = false;
  const height = bar.offsetHeight;
  const width = bar.offsetWidth;
  const spaceBelow = window.innerHeight - selection.rect.bottom;
  const wanted =
    spaceBelow > height + 16 ? selection.rect.bottom + 8 : selection.rect.top - height - 8;
  // If the selection lies outside the viewport, after a jump into a section
  // say, the bar still has to stay on screen.
  const top = Math.min(Math.max(8, wanted), Math.max(8, window.innerHeight - height - 8));
  const left = Math.min(
    Math.max(8, selection.rect.left),
    Math.max(8, window.innerWidth - width - 8),
  );
  bar.style.top = `${top}px`;
  bar.style.left = `${left}px`;

  // Saying "this is the interviewer" and then offering the categories anyway
  // was an invitation, not a rule: the bar closes instead. The server refuses
  // it too, so nothing gets in by another door.
  if (selection.interviewer) {
    releaseSelection();
    notify(t("interviewerNote"));
  }
}

function releaseSelection() {
  state.selection = null;
  state.filter = "";
  $("#coding-bar").hidden = true;
  document.getSelection()?.removeAllRanges();
}

async function code(categoryId) {
  if (!state.selection) return;
  const { turn, start, end, text } = state.selection;
  try {
    const created = await api(`/api/interviews/${encodeURIComponent(state.current)}/codings`, {
      method: "POST",
      // Coded by hand means reviewed: the act is the decision.
      body: { turn, start, end, text, category: categoryId, reviewed: true },
    });
    state.codings.push(created);
    state.selected = created.id;
    releaseSelection();
    drawAll();
    const element = document.querySelector(`.segment[data-id="${created.id}"]`);
    if (element) element.dataset.new = "true";
    notify(t("codedAs", { name: categoryById(categoryId)?.name }));
  } catch (error) {
    // On an overlap the message only helps if it says with what.
    const conflict = error.data?.conflict;
    if (!conflict) return notify(error.message, "error");
    const name = categoryById(conflict.category)?.name ?? conflict.category;
    notify(t("overlaps", { name }), "error", {
      label: t("view"),
      run: () => {
        releaseSelection();
        state.selected = conflict.id;
        drawAll();
        document
          .querySelector(`#transcript .segment[data-id="${CSS.escape(conflict.id)}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      },
    });
  }
}

/**
 * Delete a coding unit and offer the undo.
 *
 * The unit is restored with its old identifier, so that memo, anchor example
 * and the assignment to requirements stay the same.
 */
async function removeCoding(id) {
  const unit = state.codings.find((coding) => coding.id === id);
  if (!unit) return;
  const interview = state.current;
  try {
    await api(`/api/interviews/${encodeURIComponent(interview)}/codings/${id}`, {
      method: "DELETE",
    });
    state.codings = state.codings.filter((coding) => coding.id !== id);
    if (state.selected === id) state.selected = null;
    drawAll();
    notify(t("unitDeleted"), "info", {
      label: t("undo"),
      run: () => restore(interview, unit),
    });
  } catch (error) {
    notify(error.message, "error");
  }
}

async function restore(interview, unit) {
  const { state: _state, reason: _reason, ...clean } = unit;
  try {
    const back = await api(`/api/interviews/${encodeURIComponent(interview)}/codings`, {
      method: "POST",
      body: clean,
    });
    if (interview === state.current) {
      state.codings.push(back);
      state.selected = back.id;
      drawAll();
    }
    notify(t("unitRestored"));
  } catch (error) {
    notify(t("restoreFailed", { error: error.message }), "error");
  }
}

/* Analysis ---------------------------------------------------------------- */

function bar(share) {
  const width = Math.max(0, Math.min(100, share * 100));
  return `<span class="bar"><i style="width:${width.toFixed(1)}%"></i></span>`;
}

/**
 * An export link in the language of the interface.
 *
 * A download is a plain navigation: the browser sends its own preference along,
 * not the one set in the header. Whoever switched the interface to English has
 * said what language they want their files in, so the wish travels with the
 * link.
 */
function exportHref(path, query = "") {
  const parameters = new URLSearchParams(query);
  parameters.set("lang", language());
  return `${path}?${parameters}`;
}

/** The set slice as a query, so that the export shows the same. */
function sliceQuery(filter) {
  const query = new URLSearchParams();
  if (filter.department) query.set("department", filter.department);
  if (filter.section) query.set("section", filter.section);
  if (filter.anchor) query.set("anchor", "1");
  if (filter.memo) query.set("memo", "1");
  if (filter.withoutRequirement) query.set("open", "1");
  if (filter.unreviewed) query.set("unreviewed", "1");
  if (filter.word.trim()) query.set("word", filter.word.trim());
  return query.toString();
}

/**
 * All notes in one place, searchable.
 *
 * „I did write that down somewhere" is a real question after four interviews,
 * and the notes lie in three different places. Here they stand next to each
 * other; the *notes* export shows the same for the paper.
 */
function notesHTML(data) {
  const wanted = state.noteFilter.trim();
  const kind = state.noteKind;
  const onlyCategory = state.noteCategory;
  const fits = (text) => !wanted || occurrences(text, wanted).length > 0;
  const severalDepartments = data.departments.length > 1;

  const groups = [];
  if (kind !== "category" && kind !== "passage" && !onlyCategory) {
    const own = data.progress.filter((entry) => entry.memo?.trim() && fits(entry.memo));
    if (own.length) {
      groups.push({
        title: t("onInterviews"),
        count: own.length,
        entries: own.map(
          (entry) =>
            `<div class="note-entry"><span class="source">${escapeHTML(entry.department)}</span>` +
            `<p>${escapeHTML(entry.memo.trim())}</p></div>`,
        ),
      });
    }
  }

  if (kind !== "interview" && kind !== "passage") {
    const own = data.categories.filter(
      (category) =>
        category.memo?.trim() &&
        fits(category.memo) &&
        (!onlyCategory || category.id === onlyCategory),
    );
    if (own.length) {
      groups.push({
        title: t("onCategories"),
        count: own.length,
        entries: own.map(
          (category) =>
            `<div class="note-entry"><span class="source">${escapeHTML(category.name)}</span>` +
            `<p>${escapeHTML(category.memo.trim())}</p></div>`,
        ),
      });
    }
  }

  if (kind !== "interview" && kind !== "category") {
    const entries = [];
    let count = 0;
    for (const row of data.rows) {
      if (onlyCategory && row.category !== onlyCategory) continue;
      for (const citation of data.citations[row.category] ?? []) {
        if (!citation.memo?.trim() || !fits(citation.memo)) continue;
        count += 1;
        entries.push(
          `<div class="note-entry"><span class="source">` +
            (severalDepartments ? `${escapeHTML(citation.department)} · ` : "") +
            `${t("turn")} ${citation.turn} · ${escapeHTML(row.name)}` +
            `<button type="button" class="button-quiet goto" data-passage="${citation.id}"` +
            ` data-interview="${escapeHTML(citation.interview)}">${t("view")}</button></span>` +
            `<p>${escapeHTML(citation.memo.trim())}</p></div>`,
        );
      }
    }
    if (count) groups.push({ title: t("onPassages"), count, entries });
  }

  const controls =
    `<div class="note-search">` +
    `<label class="field"><span class="field-label">${t("searchAllNotes")}</span>` +
    `<input type="search" id="note-filter" value="${escapeHTML(state.noteFilter)}" ` +
    `placeholder="${escapeHTML(t("filterPlaceholder"))}"></label>` +
    `<label class="field"><span class="field-label">${t("attachedTo")}</span>` +
    `<select id="note-kind">` +
    [
      ["", t("all")],
      ["interview", t("theInterview")],
      ["category", t("toCategories")],
      ["passage", t("toPassages")],
    ]
      .map(
        ([value, label]) =>
          `<option value="${value}"${kind === value ? " selected" : ""}>${escapeHTML(label)}</option>`,
      )
      .join("") +
    `</select></label>` +
    `<label class="field"><span class="field-label">${t("category")}</span>` +
    `<select id="note-category"><option value="">${t("all")}</option>` +
    data.categories
      .map(
        (category) =>
          `<option value="${category.id}"${onlyCategory === category.id ? " selected" : ""}>` +
          `${category.parent ? "… " : ""}${escapeHTML(category.name)}</option>`,
      )
      .join("") +
    `</select></label>` +
    `<a class="button-quiet" href="${exportHref("/api/export/notes.md")}" download>${t("exportNotesButton")}</a></div>`;

  return (
    `<h3>${t("notesTitle")}</h3>` +
    controls +
    (groups.length
      ? groups
          .map(
            (group) =>
              `<h4 class="citation-head">${escapeHTML(group.title)} · ${group.count}</h4>` +
              `<div class="note-list">${group.entries.join("")}</div>`,
          )
          .join("")
      : `<p class="empty-state">${
          wanted || kind || onlyCategory ? t("noNoteMatches") : t("noNoteYet")
        }</p>`)
  );
}

/**
 * The way from citation to requirement, right inside the analysis.
 *
 * The catalog does not arise while coding but while reading the citations of a
 * category: there one notices that five passages carry the same demand. Until
 * now that only worked through the transcript, passage by passage — the detour
 * costs exactly the overview the requirement arises from.
 *
 * The note on the passage is the better title suggestion than the citation
 * itself: it is already written in the language of a requirement. Renaming the
 * title is possible in the catalog.
 */
function requirementRowHTML(citation) {
  const assigned = (citation.requirements ?? [])
    .map((id) => state.requirements.find((requirement) => requirement.id === id))
    .filter(Boolean);
  const rest = state.requirements.filter(
    (requirement) => !(citation.requirements ?? []).includes(requirement.id),
  );
  const suggestion = (citation.memo ?? "").trim()
    ? t("newRequirementFromNote")
    : t("newRequirementFromPassage");

  return (
    `<div class="citation-requirement">` +
    assigned
      .map(
        (requirement) =>
          `<span class="requirement-tag">${escapeHTML(requirement.title)}` +
          `<button type="button" class="unlink" data-unlink="${requirement.id}" data-citation="${citation.id}"` +
          ` data-interview="${escapeHTML(citation.interview)}" title="${escapeHTML(t("unlinkTitle"))}"` +
          ` aria-label="${escapeHTML(t("unlinkAria", { title: requirement.title }))}">×</button></span>`,
      )
      .join("") +
    `<select class="requirement-choice" data-citation="${citation.id}" data-interview="${escapeHTML(citation.interview)}"` +
    ` aria-label="${escapeHTML(t("assignRequirementAria"))}">` +
    `<option value="">${escapeHTML(t("citesRequirementChoice"))}</option>` +
    rest
      .map(
        (requirement) =>
          `<option value="${requirement.id}">${escapeHTML(requirement.title)}</option>`,
      )
      .join("") +
    `<option value="new">${escapeHTML(suggestion)}</option>` +
    `</select></div>`
  );
}

/** Change an assignment and draw the analysis with the new state. */
async function assign(interview, citationId, change) {
  const citation = citationById(citationId);
  if (!citation) return;
  try {
    await api(`/api/interviews/${encodeURIComponent(interview)}/codings/${citationId}`, {
      method: "PATCH",
      body: { requirements: change(citation.requirements ?? []) },
    });
    await refreshAnalysis();
  } catch (error) {
    notify(error.message, "error");
  }
}

/**
 * Title suggestion from the note on the passage.
 *
 * Notes often carry an observation and behind it the demand, set off with the
 * marker word „Anforderungskandidat". The marker is bookkeeping and does not
 * belong in the catalog: with a colon behind it the demand is what follows;
 * standing on its own, the demand is what precedes it.
 */
const REQUIREMENT_MARKER = /Anforderungskandidat/;

function titleSuggestion(citation) {
  const note = (citation.memo ?? "").trim();
  if (!note) return citation.text;
  const afterColon = note.match(/Anforderungskandidat[^:.]*:\s*(.+)$/s);
  if (afterColon) return afterColon[1].trim();
  if (!REQUIREMENT_MARKER.test(note)) return note;
  const withoutMarker = note.replace(/\s*Anforderungskandidat[^.]*\.?\s*/g, " ").trim();
  return withoutMarker || note;
}

async function createRequirementFrom(interview, citationId) {
  const citation = citationById(citationId);
  if (!citation) return;
  const title = titleSuggestion(citation).slice(0, 90).trim();
  try {
    const created = await api("/api/requirements", { method: "POST", body: { title } });
    await api(`/api/interviews/${encodeURIComponent(interview)}/codings/${citationId}`, {
      method: "PATCH",
      body: { requirements: [...(citation.requirements ?? []), created.id] },
    });
    await refreshAnalysis();
    notify(t("requirementCreatedRefine", { title }));
  } catch (error) {
    notify(error.message, "error");
  }
}

function citationById(id) {
  for (const row of state.analysis?.rows ?? []) {
    const found = (state.analysis.citations[row.category] ?? []).find(
      (citation) => citation.id === id,
    );
    if (found) return found;
  }
  return null;
}

/**
 * Bring analysis, requirements and the open transcript onto one state.
 *
 * The view is recomputed entirely, because an assignment changes the catalog
 * too. The scroll height is preserved — with a hundred and ten citations a jump
 * to the top after every move would be unusable.
 */
async function refreshAnalysis() {
  const column = $("#view-analysis");
  const height = column.scrollTop;
  await loadRequirements();
  await loadTranscript();
  await drawAnalysis();
  column.scrollTop = height;
  if (state.view === "code") drawAll();
}

function citationsHTML(data, color) {
  const filter = state.citationFilter;
  // The same condition as the export — it lives in search.js so that view and
  // export cannot drift apart.
  const fits = (citation) => matchesSlice(citation, filter);

  const all = data.rows.flatMap((row) => data.citations[row.category] ?? []);
  const sections = [...new Set(all.map((citation) => citation.sectionName).filter(Boolean))];
  const shown = all.filter(fits).length;
  const active = Boolean(
    filter.department ||
      filter.section ||
      filter.anchor ||
      filter.memo ||
      filter.withoutRequirement ||
      filter.unreviewed ||
      filter.word.trim(),
  );

  const controls =
    `<div class="citation-filter" id="citation-filter">` +
    `<label class="field"><span class="field-label">${t("department")}</span>` +
    `<select data-filter="department"><option value="">${t("all")}</option>` +
    data.departments
      .map(
        (department) =>
          `<option value="${escapeHTML(department)}"${filter.department === department ? " selected" : ""}>${escapeHTML(department)}</option>`,
      )
      .join("") +
    `</select></label>` +
    `<label class="field"><span class="field-label">${t("guideSection")}</span>` +
    `<select data-filter="section"><option value="">${t("all")}</option>` +
    sections
      .map(
        (section) =>
          `<option value="${escapeHTML(section)}"${filter.section === section ? " selected" : ""}>${escapeHTML(section)}</option>`,
      )
      .join("") +
    `</select></label>` +
    `<label class="field"><span class="field-label">${t("inCitationOrNote")}</span>` +
    `<input type="search" data-filter="word" value="${escapeHTML(filter.word)}" placeholder="${escapeHTML(t("filterPlaceholder"))}"></label>` +
    `<label class="box"><input type="checkbox" data-filter="anchor"${filter.anchor ? " checked" : ""}> ${t("anchorsOnly")}</label>` +
    `<label class="box"><input type="checkbox" data-filter="memo"${filter.memo ? " checked" : ""}> ${t("withNoteOnly")}</label>` +
    `<label class="box"><input type="checkbox" data-filter="withoutRequirement"` +
    `${filter.withoutRequirement ? " checked" : ""}> ${t("withoutRequirementOnly")}</label>` +
    `<label class="box"><input type="checkbox" data-filter="unreviewed"` +
    `${filter.unreviewed ? " checked" : ""}> ${t("unreviewedOnly")}</label>` +
    (active
      ? `<button type="button" class="button-quiet" id="filter-clear">${t("clearSlice", { shown, all: all.length })}</button>`
      : `<span class="filter-status">${all.length} ${plural(all.length, "citationOne", "citationMany")}</span>`) +
    `<a class="button-quiet" id="slice-export" download href="${exportHref("/api/export/citations.md", sliceQuery(filter))}">` +
    `${t("exportSlice")}</a>` +
    `</div>`;

  const lists = data.rows
    .map((row) => {
      const own = (data.citations[row.category] ?? []).filter(fits);
      if (!own.length) return "";
      return (
        `<h4 class="citation-head">${escapeHTML(row.name)} · ${own.length}` +
        (own.length !== row.sum ? ` <span class="of">${t("ofCount", { n: row.sum })}</span>` : "") +
        `</h4><div class="citations">` +
        own
          .map(
            (citation) =>
              `<div class="citation" style="--mark-color:${color(row.category)}">` +
              `<div class="head-row"><span>${escapeHTML(citation.department)}</span>` +
              `<span>${t("turn")} ${citation.turn}${citation.time ? ` · ${citation.time}` : ""}</span>` +
              `${citation.sectionName ? `<span>${escapeHTML(citation.sectionName)}</span>` : ""}` +
              `${citation.anchor ? `<span>${t("anchorExample")}</span>` : ""}` +
              `<button type="button" class="button-quiet goto" data-passage="${citation.id}"` +
              ` data-interview="${escapeHTML(citation.interview)}">${t("viewInTranscript")}</button></div>` +
              `<blockquote>„${escapeHTML(citation.text)}“</blockquote>` +
              `${citation.memo ? `<p class="memo">${escapeHTML(citation.memo)}</p>` : ""}` +
              requirementRowHTML(citation) +
              `</div>`,
          )
          .join("") +
        `</div>`
      );
    })
    .join("");

  return (
    `<h3>${t("citationsTitle")}</h3>` +
    controls +
    (lists ||
      `<p class="empty-state">${all.length ? t("noCitationMatches") : t("nothingCodedYet")}</p>`)
  );
}

function colorFrom(data) {
  return (id) => {
    const category = data.categories.find((other) => other.id === id);
    return data.propositions[category?.proposition ?? "none"]?.color ?? NEUTRAL_COLOR;
  };
}

/* Charts ------------------------------------------------------------------
   The cross table stays the citable number; the chart is the overview. Series
   color follows the department in a fixed order (validated palette in app.css),
   never its rank — a change in the data recolors no department. */

const SERIES_COUNT = 8;

/**
 * Map departments onto the eight series colors. From the ninth department on,
 * the rest collapses into „others": a ninth color could no longer be told apart
 * from the first eight reliably.
 */
function seriesFrom(departments) {
  if (departments.length <= SERIES_COUNT) {
    return departments.map((name, index) => ({
      name,
      className: `series-s${index + 1}`,
      sources: [name],
    }));
  }
  const series = departments.slice(0, SERIES_COUNT - 1).map((name, index) => ({
    name,
    className: `series-s${index + 1}`,
    sources: [name],
  }));
  series.push({
    name: t("seriesMore"),
    className: `series-s${SERIES_COUNT}`,
    sources: departments.slice(SERIES_COUNT - 1),
  });
  return series;
}

/** A round axis step (1, 2, 5, 10, …) that leads to at most five ticks. */
function axisStep(max) {
  if (max <= 5) return 1;
  const raw = max / 5;
  const decade = 10 ** Math.floor(Math.log10(raw));
  for (const factor of [1, 2, 5, 10]) if (raw <= factor * decade) return factor * decade;
  return 10 * decade;
}

/** Rectangle path; the right end is rounded when `round` is set. */
function segmentPath(x, y, width, height, round) {
  const r = round ? Math.min(3, width / 2) : 0;
  return (
    `M ${x} ${y} h ${width - r} ` +
    (r
      ? `a ${r} ${r} 0 0 1 ${r} ${r} v ${height - 2 * r} a ${r} ${r} 0 0 1 ${-r} ${r} `
      : `v ${height} `) +
    `h ${-(width - r)} z`
  );
}

function shorten(text, limit = 30) {
  return text.length > limit ? text.slice(0, limit - 1).trimEnd() + "…" : text;
}

/**
 * What a chart says, in a sentence, for whoever cannot see it.
 *
 * `role="img"` with a title announces "Coding units per category, image" and
 * stops there — the picture is the whole content, and none of it arrives. So
 * every chart carries a summary in numbers: how much of what, where the weight
 * lies, and where the same figures can be read one by one. It is not drawn,
 * because on screen the picture already says it.
 */
function chartSummaryHTML(id, sentence) {
  return `<p id="${id}-summary" class="visually-hidden">${escapeHTML(sentence)}</p>`;
}

/**
 * The figures behind a chart, as a table one can read, copy or tab through.
 *
 * A tooltip that only answers to a hovering mouse answers nobody else, and only
 * the bar chart had a table underneath it carrying the same numbers — the
 * heatmap and the whole catalog had none at all. A disclosure is the cheap
 * answer: closed it costs a line, opened it gives the figures exactly, and
 * `details` is operable from the keyboard without a line of script.
 *
 * `rows` are arrays whose first entry is the row heading; numbers are set as
 * numbers, anything else as text.
 */
function chartFiguresHTML(id, { caption, columns, rows }) {
  if (!rows.length) return "";
  const head = columns
    .map(
      (column, index) =>
        `<th scope="col"${index ? ' class="num"' : ""}>${escapeHTML(String(column))}</th>`,
    )
    .join("");
  const body = rows
    .map(
      ([heading, ...cells]) =>
        `<tr><th scope="row">${escapeHTML(String(heading))}</th>` +
        cells
          .map(
            (cell) =>
              `<td class="${typeof cell === "number" ? "num" : ""}">${escapeHTML(String(cell))}</td>`,
          )
          .join("") +
        `</tr>`,
    )
    .join("");
  return (
    `<details class="figures" id="${id}-figures"><summary>${t("showFigures")}</summary>` +
    `<div class="table-frame"><table>` +
    `<caption class="visually-hidden">${escapeHTML(caption)}</caption>` +
    `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></details>`
  );
}

/** The largest row, named — the one thing a reader takes from a bar chart. */
function largestRow(rows) {
  return rows.reduce((best, row) => (row.sum > (best?.sum ?? -1) ? row : best), null);
}

const chartLegend = (series) =>
  series.length > 1
    ? `<div class="chart-legend">` +
      series
        .map((one) => `<span><i class="${one.className}"></i>${escapeHTML(one.name)}</span>`)
        .join("") +
      `</div>`
    : "";

/**
 * A horizontal stacked bar chart: one row per entry, segments per department.
 *
 * Shared by the analysis (categories) and the catalog (requirements), because
 * both answer the same question — how much of this comes from where — and a
 * second visual idiom for the same question would only cost the reader.
 */
function stackedBarsHTML({
  id,
  title,
  caption,
  file,
  rows,
  departments,
  summaryKey,
  figuresCaption,
  figuresRef,
}) {
  if (!rows.length || !departments.length) return "";
  const series = seriesFrom(departments);

  const values = rows.map((row) =>
    series.map((one) =>
      one.sources.reduce((n, name) => n + (row.values[departments.indexOf(name)] ?? 0), 0),
    ),
  );

  const max = Math.max(1, ...rows.map((row) => row.sum));
  const step = axisStep(max);
  const end = Math.ceil(max / step) * step;

  const LABEL = 200;
  const VALUE = 34;
  const WIDTH = 720;
  const ROW = 26;
  const BAR = 14;
  const TOP = 6;
  const track = WIDTH - LABEL - VALUE - 8;
  const height = TOP + rows.length * ROW + 22;
  const scale = (value) => (value / end) * track;

  let grid = "";
  for (let tick = 0; tick <= end; tick += step) {
    const x = LABEL + scale(tick);
    if (tick > 0) {
      grid += `<line class="grid" x1="${x}" y1="${TOP}" x2="${x}" y2="${height - 20}"></line>`;
    }
    grid += `<text class="axis" x="${x}" y="${height - 7}" text-anchor="middle">${tick}</text>`;
  }

  const bars = rows
    .map((row, index) => {
      const y = TOP + index * ROW + (ROW - BAR) / 2;
      const label = (row.child ? "… " : "") + row.name;
      let x = LABEL;
      let last = -1;
      values[index].forEach((value, k) => {
        if (value > 0) last = k;
      });
      const segments = values[index]
        .map((value, k) => {
          if (!value) return "";
          const full = scale(value);
          // 2px of air between the segments; the last one ends rounded.
          const width = Math.max(1, full - (k === last ? 0 : 2));
          const part =
            `<path class="segment ${series[k].className}" d="${segmentPath(x, y, width, BAR, k === last)}"` +
            ` data-department="${escapeHTML(series[k].name)}" data-row="${escapeHTML(row.name)}"` +
            ` data-value="${value}" data-tip="${escapeHTML(`${row.name} — ${series[k].name}: ${value}`)}"></path>`;
          x += full;
          return part;
        })
        .join("");
      return (
        `<text class="row-label${row.child ? " child" : ""}" x="${LABEL - 8}" y="${y + BAR - 3}" text-anchor="end">${escapeHTML(shorten(label))}</text>` +
        segments +
        `<text class="value${row.sum ? "" : " empty"}" x="${x + 6}" y="${y + BAR - 3}">${row.sum}</text>`
      );
    })
    .join("");

  const largest = largestRow(rows);
  const summary = t(summaryKey ?? "summaryBars", {
    rows: rows.length,
    total: rows.reduce((n, row) => n + row.sum, 0),
    departments: departments.length,
    top: largest?.name ?? "—",
    topValue: largest?.sum ?? 0,
  });

  return (
    `<div class="chart-head"><h3 id="${id}-title">${escapeHTML(title)}</h3>` +
    `<button type="button" class="button-quiet" data-svg="${id}" data-file="${file}">${t("saveAsSvg")}</button></div>` +
    chartLegend(series) +
    chartSummaryHTML(id, summary) +
    // A chart either carries its own figures or names the table that already
    // holds them; the category chart is followed by the cross table anyway.
    `<figure class="chart" id="${id}"${figuresRef ? ` data-figures="${figuresRef}"` : ""}>` +
    `<svg viewBox="0 0 ${WIDTH} ${height}" role="img" aria-labelledby="${id}-title"` +
    ` aria-describedby="${id}-summary" preserveAspectRatio="xMinYMin meet">` +
    `<line class="baseline" x1="${LABEL}" y1="${TOP}" x2="${LABEL}" y2="${height - 20}"></line>` +
    grid +
    bars +
    `</svg>` +
    `<div class="chart-tip" hidden></div>` +
    `<figcaption class="column-note">${escapeHTML(caption)}</figcaption>` +
    `</figure>` +
    // The category chart is followed by the cross table anyway; only the charts
    // that stand on their own need the figures spelled out again.
    (figuresCaption
      ? chartFiguresHTML(id, {
          caption: figuresCaption,
          columns: [title, ...departments, t("total")],
          rows: rows.map((row) => [row.name, ...row.values, row.sum]),
        })
      : "")
  );
}

function categoryChartHTML(data) {
  return stackedBarsHTML({
    id: "chart",
    figuresRef: "matrix-table",
    title: t("chartTitle"),
    caption: t("chartCaption"),
    file: "coding-units-per-category.svg",
    departments: data.departments,
    rows: data.rows.map((row) => ({
      name: row.name,
      child: Boolean(row.parent),
      values: row.values,
      sum: row.sum,
    })),
  });
}

/**
 * Distribution across the guide sections: category by section as a heatmap. It
 * answers the question whether a category sticks to its section or spreads
 * across the conversation — magnitude, so a sequential ramp from one hue, not
 * category colors.
 */
function heatmapHTML(data) {
  const sections = data.sections ?? [];
  if (!data.rows.length || sections.length < 2) return "";

  const counts = new Map();
  for (const [categoryId, citations] of Object.entries(data.citations)) {
    for (const citation of citations) {
      if (!citation.sectionName) continue;
      const key = `${categoryId}|${citation.sectionName}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const max = Math.max(0, ...counts.values());
  if (!max) return "";
  const levelOf = (n) => Math.max(1, Math.ceil((n / max) * 5));

  const LABEL = 200;
  const WIDTH = 720;
  const CELL = 22;
  const track = WIDTH - LABEL - 8;
  const width = track / sections.length;

  /* Guide sections are named, not numbered, and the names are sentences: a
     column barely wider than a thumbnail cannot hold "Zusammenarbeit über
     Bereiche" horizontally. Set upright they were cut to eight characters and
     eight of nine columns read as an ellipsis — legible only on hover, which is
     no help at all in the exported SVG or on paper.

     So the headings are set at an angle, ascending to the left into the space
     above the row labels, which is empty anyway. That space is what bounds
     them: a heading may reach as far left as the row labels start. */
  const ANGLE = 45;
  const RADIANS = (ANGLE * Math.PI) / 180;
  const CHARACTER = 5.1; // 10px sans, measured across the section names
  const TOP = 2;

  /* An angled heading ends at its column and trails away behind it. Rising to
     the right it would trail down-left; set below the grid that is exactly the
     free space — under the row labels, where nothing else is. Rising labels
     placed above would instead trail off the right edge of the widest ones. */
  const room = LABEL + width / 2 - 6; // how far the first column may trail left
  const maxCharacters = Math.max(8, Math.min(30, Math.floor(room / Math.cos(RADIANS) / CHARACTER)));
  const headings = sections.map((section) => shorten(section.short, maxCharacters));
  const longest = Math.max(...headings.map((heading) => heading.length));
  const FOOT = Math.ceil(longest * CHARACTER * Math.sin(RADIANS)) + 12;

  const grid = TOP + data.rows.length * CELL;
  const height = grid + FOOT;

  const heads = sections
    .map((section, k) => {
      const x = LABEL + k * width + width / 2;
      const y = grid + 10;
      return (
        `<text class="axis heading" x="${x}" y="${y}" text-anchor="end"` +
        ` transform="rotate(-${ANGLE} ${x} ${y})">` +
        `<title>${escapeHTML(section.short)}</title>${escapeHTML(headings[k])}</text>`
      );
    })
    .join("");

  const cells = data.rows
    .map((row, index) => {
      const y = TOP + index * CELL;
      const label = (row.parent ? "… " : "") + row.name;
      const line = sections
        .map((section, k) => {
          const x = LABEL + k * width;
          const n = counts.get(`${row.category}|${section.name}`) ?? 0;
          if (!n) {
            return `<rect class="cell-empty" x="${x + 1}" y="${y + 1}" width="${width - 2}" height="${CELL - 2}"></rect>`;
          }
          const level = levelOf(n);
          return (
            `<rect class="cell level-${level}" x="${x + 1}" y="${y + 1}" width="${width - 2}" height="${CELL - 2}" rx="3"` +
            ` data-row="${escapeHTML(row.name)}" data-section="${escapeHTML(section.short)}" data-value="${n}"` +
            ` data-tip="${escapeHTML(`${row.name} — ${section.short}: ${n}`)}"></rect>` +
            `<text class="cell-value${level >= 4 ? " inverse" : ""}" x="${x + width / 2}" y="${y + CELL / 2 + 3.5}" text-anchor="middle">${n}</text>`
          );
        })
        .join("");
      return (
        `<text class="row-label${row.parent ? " child" : ""}" x="${LABEL - 8}" y="${y + CELL / 2 + 4}" text-anchor="end">${escapeHTML(shorten(label))}</text>` +
        line
      );
    })
    .join("");

  const ramp =
    `<div class="chart-legend ramp"><span>1</span>` +
    [1, 2, 3, 4, 5].map((level) => `<i class="level-${level}"></i>`).join("") +
    `<span>${max}</span><span class="ramp-label">${t("rampLabel")}</span></div>`;

  // The strongest cell is the one finding of the heatmap: this category is
  // concentrated in that section rather than spread across the conversation.
  let strongest = { value: 0, row: "—", section: "—" };
  for (const row of data.rows) {
    for (const section of sections) {
      const n = counts.get(`${row.category}|${section.name}`) ?? 0;
      if (n > strongest.value) strongest = { value: n, row: row.name, section: section.short };
    }
  }
  const summary = t("summaryHeatmap", {
    rows: data.rows.length,
    sections: sections.length,
    top: strongest.row,
    section: strongest.section,
    value: strongest.value,
  });

  return (
    `<div class="chart-head"><h3 id="heatmap-title">${t("heatmapTitle")}</h3>` +
    `<button type="button" class="button-quiet" data-svg="heatmap" data-file="distribution-across-sections.svg">${t("saveAsSvg")}</button></div>` +
    ramp +
    chartSummaryHTML("heatmap", summary) +
    `<figure class="chart" id="heatmap">` +
    `<svg viewBox="0 0 ${WIDTH} ${height}" role="img" aria-labelledby="heatmap-title"` +
    ` aria-describedby="heatmap-summary"` +
    ` data-angle="${ANGLE}" data-baseline="${grid + 10}" preserveAspectRatio="xMinYMin meet">` +
    heads +
    cells +
    `</svg>` +
    `<div class="chart-tip" hidden></div>` +
    `<figcaption class="column-note">${t("heatmapCaption")}</figcaption>` +
    `</figure>` +
    chartFiguresHTML("heatmap", {
      caption: t("heatmapFiguresCaption"),
      columns: [t("category"), ...sections.map((section) => section.short)],
      rows: data.rows.map((row) => [
        (row.parent ? "… " : "") + row.name,
        ...sections.map((section) => counts.get(`${row.category}|${section.name}`) ?? 0),
      ]),
    })
  );
}

/** The chart with its colors resolved, saved as a standalone SVG file. */
function saveChart(id, file) {
  const svg = document.querySelector(`#${id} svg`);
  if (!svg) return;
  const copy = svg.cloneNode(true);
  const originals = svg.querySelectorAll("*");
  const copies = copy.querySelectorAll("*");
  originals.forEach((element, index) => {
    const style = getComputedStyle(element);
    for (const property of ["fill", "stroke", "stroke-width", "font-family", "font-size", "font-weight"]) {
      copies[index].style.setProperty(property, style.getPropertyValue(property));
    }
  });
  // A ground plane in the theme color, so that the file is readable on its own.
  const ground = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  ground.setAttribute("width", "100%");
  ground.setAttribute("height", "100%");
  ground.setAttribute("fill", getComputedStyle(document.body).backgroundColor);
  copy.insertBefore(ground, copy.firstChild);
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const blob = new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file;
  link.click();
  URL.revokeObjectURL(url);
  notify(t("svgSaved"));
}

/** Redraw only the citations part; the cross table stays as it is. */
function drawCitations() {
  const part = document.getElementById("citations-part");
  if (!part || !state.analysis) return;
  const typing = document.activeElement?.dataset?.filter === "word";
  part.innerHTML = citationsHTML(state.analysis, colorFrom(state.analysis));
  if (typing) keepCaret(part.querySelector('[data-filter="word"]'));
}

function drawNotes() {
  const part = document.getElementById("notes-part");
  if (!part || !state.analysis) return;
  const typing = document.activeElement?.id === "note-filter";
  part.innerHTML = notesHTML(state.analysis);
  if (typing) keepCaret(part.querySelector("#note-filter"));
}

/** Put the caret back into the field after it has been redrawn. */
function keepCaret(field) {
  if (!field) return;
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
}

async function drawAnalysis() {
  const root = $("#analysis");
  root.innerHTML = `<p class="empty-state">${t("calculating")}</p>`;
  const data = await api("/api/analysis");
  state.analysis = data;

  const color = colorFrom(data);

  const heading = `<h2>${t("analysis")}</h2><p class="lead">${t("analysisLead")}</p>`;

  const allCitations = Object.values(data.citations).flat();
  const reviewedShare = allCitations.length
    ? Math.round(
        (allCitations.filter((citation) => citation.reviewed).length / allCitations.length) * 100,
      )
    : 100;
  const metrics =
    `<div class="metrics">` +
    `<div class="metric"><div class="value">${data.total}</div><span class="label">${t("metricUnits")}</span></div>` +
    `<div class="metric"><div class="value">${reviewedShare} %</div><span class="label">${t("reviewed")}</span></div>` +
    `<div class="metric"><div class="value">${data.departments.length}</div><span class="label">${t("departments")}</span></div>` +
    `<div class="metric"><div class="value">${data.progress.length}</div><span class="label">${t("interviews")}</span></div>` +
    `<div class="metric"><div class="value">${data.rows.filter((row) => row.origin === "inductive").length}</div>` +
    `<span class="label">${t("inductiveCategories")}</span></div>` +
    `</div>`;

  // The table carries its own export, the way the charts carry theirs: what one
  // reads here is what one wants in the manuscript, and looking for it in a
  // list of exports two screens down is a detour.
  const matrix =
    `<div class="section-heading"><h3>${t("categoriesByDepartment")}</h3>` +
    `<a class="button-quiet" id="matrix-export" href="${exportHref("/api/export/matrix.md")}" download` +
    ` title="${escapeHTML(t("exportMatrixTitle"))}">${t("exportMatrix")}</a></div>` +
    /* The row and column headers are marked as such, so that a screen reader
       can say which category and which department a number belongs to instead
       of reading a wall of figures. The caption is not drawn, because the
       heading above already says it on screen. */
    `<div class="table-frame"><table id="matrix-table">` +
    `<caption class="visually-hidden">${t("matrixCaption")}</caption><thead><tr>` +
    `<th scope="col">${t("category")}</th>` +
    data.departments
      .map((d) => `<th class="num" scope="col">${escapeHTML(d)}</th>`)
      .join("") +
    `<th class="num" scope="col">${t("total")}</th>` +
    `<th class="num" scope="col">${t("departments")}</th></tr></thead><tbody>` +
    data.rows
      .map(
        (row) =>
          `<tr class="${row.parent ? "child" : ""}"><th scope="row"><span class="category-cell">` +
          `<i class="dot" style="--mark-color:${color(row.category)}"></i>${escapeHTML(row.name)}</span></th>` +
          row.values
            .map((v) =>
              v
                ? `<td class="num">${v}</td>`
                : // A middle dot reads as nothing at all; the zero it stands
                  // for is said instead.
                  `<td class="num empty"><span aria-hidden="true">·</span>` +
                  `<span class="visually-hidden">0</span></td>`,
            )
            .join("") +
          `<td class="num">${row.sum}</td><td class="num">${row.departmentsNaming}</td></tr>`,
      )
      .join("") +
    `</tbody></table></div>` +
    `<div class="legend">` +
    Object.entries(data.propositions)
      .map(
        ([, proposition]) =>
          `<span><i style="background:${proposition.color}"></i>${escapeHTML(proposition.name)}</span>`,
      )
      .join("") +
    `</div>`;

  const progress =
    `<h3>${t("progressPerInterview")}</h3><div class="table-frame"><table><thead><tr>` +
    `<th>${t("interview")}</th><th>${t("department")}</th><th class="num">${t("metricUnits")}</th>` +
    `<th class="num">${t("turnsTouched")}</th><th>${t("materialCoded")}</th></tr></thead><tbody>` +
    data.progress
      .map(
        (entry) =>
          `<tr><td>${escapeHTML(entry.title)}</td><td>${escapeHTML(entry.department)}</td>` +
          `<td class="num">${entry.codings}</td>` +
          `<td class="num">${entry.turnsCoded} / ${entry.turns}</td>` +
          `<td class="num">${bar(entry.characterShare)}${(entry.characterShare * 100).toFixed(0)} %</td></tr>`,
      )
      .join("") +
    `</tbody></table></div>`;

  const exports =
    `<h3>${t("exports")}</h3><div class="exports">` +
    `<a class="button-quiet" href="${exportHref("/api/export/coding-guide.md")}" download>${t("exportCodingGuide")}</a>` +
    `<a class="button-quiet" href="${exportHref("/api/export/notes.md")}" download>${t("exportNotes")}</a>` +
    data.progress
      .map(
        (entry) =>
          `<a class="button-quiet" href="${exportHref(`/api/export/coding-table/${encodeURIComponent(entry.interview)}.md`)}" download>` +
          `${t("exportCodingTable")} ${escapeHTML(entry.department)}</a>`,
      )
      .join("") +
    `</div>`;

  root.innerHTML =
    heading +
    metrics +
    categoryChartHTML(data) +
    heatmapHTML(data) +
    matrix +
    progress +
    exports +
    `<section id="citations-part">${citationsHTML(data, color)}</section>` +
    `<section id="notes-part">${notesHTML(data)}</section>`;

  fitAngledHeadings(root.querySelector("#heatmap svg"));
  markScrollableTables(root);
}

/**
 * Lets the keyboard reach a table that is wider than its frame.
 *
 * With nine guide sections the figures run past the edge and the frame scrolls.
 * A mouse can scroll it; a keyboard cannot reach a scrolling box that nothing
 * inside it can hold focus, and the columns beyond the edge are simply lost. So
 * a frame that actually overflows becomes focusable — and only then, because a
 * tab stop that leads nowhere is its own nuisance.
 */
function markScrollableTables(root) {
  const mark = (frame) => {
    // A frame inside a closed disclosure has no width yet and would measure as
    // fitting, so the figures are measured again when they are opened.
    if (frame.scrollWidth > frame.clientWidth + 1) {
      frame.tabIndex = 0;
      frame.setAttribute("role", "region");
      frame.setAttribute("aria-label", frame.querySelector("caption")?.textContent ?? t("table"));
    } else {
      frame.removeAttribute("tabindex");
      frame.removeAttribute("role");
      frame.removeAttribute("aria-label");
    }
  };

  for (const frame of root.querySelectorAll(".table-frame")) mark(frame);
  for (const disclosure of root.querySelectorAll("details.figures")) {
    // The markup is rebuilt on every draw, so these do not pile up.
    disclosure.addEventListener("toggle", () => {
      for (const frame of disclosure.querySelectorAll(".table-frame")) mark(frame);
    });
  }
}

/**
 * Grows the drawing until the angled headings fit inside it.
 *
 * How wide a heading actually is depends on the font, the language and the
 * reader's settings, so guessing at it from a character count is guessing: the
 * two longest section names ran straight through the caption. The text is
 * therefore measured once it exists, and the drawing is given the depth the
 * longest one needs. `getBBox` reports the untransformed box, which is what is
 * wanted here — the rotation is ours to account for.
 */
function fitAngledHeadings(svg) {
  const headings = svg ? [...svg.querySelectorAll("text.heading")] : [];
  if (!headings.length) return;

  const angle = (Number(svg.dataset.angle) * Math.PI) / 180;
  const baseline = Number(svg.dataset.baseline);
  const widest = Math.max(...headings.map((heading) => heading.getBBox().width));
  const needed = Math.ceil(baseline + widest * Math.sin(angle)) + 6;

  const [x, y, width, height] = svg.getAttribute("viewBox").split(/\s+/).map(Number);
  if (needed <= height) return;
  svg.setAttribute("viewBox", `${x} ${y} ${width} ${needed}`);
}

/** Put a coding unit that lost its place onto the selected passage. */
async function reanchor(selection) {
  const id = state.reanchoring;
  try {
    const updated = await api(
      `/api/interviews/${encodeURIComponent(state.current)}/codings/${id}`,
      {
        method: "PATCH",
        body: {
          turn: selection.turn,
          start: selection.start,
          end: selection.end,
          text: selection.text,
        },
      },
    );
    const previous = state.codings.find((coding) => coding.id === id);
    Object.assign(previous, updated, { state: "ok", reason: undefined });
    state.reanchoring = null;
    state.selected = id;
    document.getSelection()?.removeAllRanges();
    document.body.classList.remove("anchoring");
    drawAll();
    notify(t("reanchored"));
  } catch (error) {
    notify(error.message, "error");
  }
}

/** Set or release a coding unit as the citation of a requirement. */
async function link(coding, requirementId, on) {
  const now = new Set(coding.requirements ?? []);
  on ? now.add(requirementId) : now.delete(requirementId);
  try {
    const updated = await api(
      `/api/interviews/${encodeURIComponent(state.current)}/codings/${coding.id}`,
      { method: "PATCH", body: { requirements: [...now] } },
    );
    Object.assign(coding, updated);
  } catch (error) {
    notify(error.message, "error");
  }
}

/* Requirements catalog ----------------------------------------------------- */

const OPERATIONS = [
  { id: "filing", key: "operationFiling" },
  { id: "retrieval", key: "operationRetrieval" },
  { id: "transfer", key: "operationTransfer" },
];

const MOSCOW_ORDER = ["must", "should", "could", "wont"];

const moscowClass = (level) => `moscow-${MOSCOW_ORDER.includes(level) ? level : "open"}`;
const moscowName = (level) =>
  state.moscow.find((one) => one.id === level)?.name ?? t("open");

/**
 * The MoSCoW distribution as a single band.
 *
 * Not a pie and not five bars: the question is how the catalog divides up, and
 * a hundred percent split into four steps reads fastest as one bar. Whatever
 * carries no level yet sits at the end in the unfilled step — a catalog is only
 * decided when that step has disappeared.
 */
function moscowBandHTML(rows) {
  const levels = [
    ...MOSCOW_ORDER.map((id) => ({ id, name: moscowName(id) })),
    { id: "open", name: t("open") },
  ]
    .map((level) => ({
      ...level,
      count: rows.filter(
        (row) => (MOSCOW_ORDER.includes(row.moscow) ? row.moscow : "open") === level.id,
      ).length,
    }))
    .filter((level) => level.count > 0);
  if (!levels.length) return "";

  const WIDTH = 720;
  const HEIGHT = 34;
  const total = rows.length;
  let x = 0;
  const bands = levels
    .map((level) => {
      const width = (level.count / total) * WIDTH;
      const band =
        `<rect class="moscow-band ${moscowClass(level.id)}" x="${x}" y="0" width="${Math.max(1, width - 2)}"` +
        ` height="${HEIGHT}" rx="3" data-tip="${escapeHTML(`${level.name}: ${level.count}`)}"></rect>` +
        (width > 26
          ? `<text class="band-value${level.id === "open" ? " dim" : ""}" x="${x + width / 2 - 1}" y="${HEIGHT / 2 + 3.5}"` +
            ` text-anchor="middle">${level.count}</text>`
          : "");
      x += width;
      return band;
    })
    .join("");

  const legend =
    `<div class="chart-legend moscow">` +
    levels
      .map(
        (level) =>
          `<span class="${moscowClass(level.id)}"><i></i>${escapeHTML(level.name)}</span>`,
      )
      .join("") +
    `</div>`;

  const summary = t("summaryMoscow", {
    total,
    levels: levels.map((level) => `${level.name}: ${level.count}`).join(", "),
  });

  return (
    `<div class="chart-head"><h3 id="moscow-title">${t("chartMoscowTitle")}</h3>` +
    `<button type="button" class="button-quiet" data-svg="moscow" data-file="moscow-distribution.svg">${t("saveAsSvg")}</button></div>` +
    legend +
    chartSummaryHTML("moscow", summary) +
    `<figure class="chart" id="moscow">` +
    `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="moscow-title"` +
    ` aria-describedby="moscow-summary" preserveAspectRatio="xMinYMin meet">` +
    bands +
    `</svg>` +
    `<div class="chart-tip" hidden></div>` +
    `<figcaption class="column-note">${t("chartMoscowCaption")}</figcaption>` +
    `</figure>` +
    chartFiguresHTML("moscow", {
      caption: t("moscowFiguresCaption"),
      columns: [t("columnLevel"), t("columnRequirements")],
      rows: levels.map((level) => [level.name, level.count]),
    })
  );
}

/**
 * The prioritization as a field.
 *
 * Both halves of the MoSCoW decision are quantities: how many departments name
 * a requirement, counted from the citations, and how many operations its
 * absence blocks, entered by the author. Plotted against each other they make
 * the decision checkable — a „Must have" in the lower left corner is one that
 * wants explaining, and a requirement in the upper right without a level is one
 * that has been overlooked.
 *
 * Requirements that share a coordinate are laid out side by side instead of on
 * top of each other, because a hidden dot is a lost requirement.
 */
function priorityFieldHTML(rows, departmentCount) {
  if (!rows.length) return "";

  const WIDTH = 720;
  const LEFT = 150;
  const TOP = 16;
  const BOTTOM = 42;
  const CELL = 46;
  const SPREAD = 15;
  const maxX = Math.max(1, departmentCount);
  const maxY = OPERATIONS.length;
  const height = TOP + maxY * CELL + BOTTOM;

  // Group by coordinate, so that overlapping requirements can be spread out.
  const buckets = new Map();
  for (const row of rows) {
    const cx = Math.min(maxX, row.departments.length);
    const cy = Math.min(maxY, (row.blockedOperations ?? []).length);
    const key = `${cx}|${cy}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({ row, cx, cy });
  }

  const maxCitations = Math.max(1, ...rows.map((row) => row.citations.length));
  const radius = (count) => 5 + Math.round((count / maxCitations) * 5);

  /* The right-hand margin has to hold whatever sits on the last gridline, and
     that is the common case rather than the exception: a requirement every
     department named lands exactly there. With a fixed margin such a dot was
     drawn half outside the picture and over the axis label beneath it — so the
     margin is measured from the widest dot and the widest fan of dots sharing a
     coordinate. */
  const widestFan = Math.max(0, ...[...buckets.values()].map((bucket) => bucket.length - 1));
  const RIGHT = Math.ceil(10 + radius(maxCitations) + (widestFan / 2) * SPREAD);

  const track = WIDTH - LEFT - RIGHT;
  const stepX = track / maxX;

  const x = (value) => LEFT + value * stepX;
  const y = (value) => TOP + (maxY - value) * CELL;

  let grid = "";
  for (let value = 0; value <= maxX; value++) {
    grid +=
      `<line class="grid" x1="${x(value)}" y1="${TOP}" x2="${x(value)}" y2="${y(0)}"></line>` +
      // A requirement blocking nothing sits on the baseline, so the labels keep
      // a dot's distance from it instead of being drawn through.
      `<text class="axis" x="${x(value)}" y="${y(0) + 22}" text-anchor="middle">${value}</text>`;
  }
  for (let value = 0; value <= maxY; value++) {
    grid +=
      `<line class="grid" x1="${LEFT}" y1="${y(value)}" x2="${WIDTH - RIGHT}" y2="${y(value)}"></line>` +
      `<text class="axis" x="${LEFT - 8}" y="${y(value) + 4}" text-anchor="end">${value}</text>`;
  }

  const points = [...buckets.values()]
    .flatMap((bucket) =>
      bucket.map((entry, index) => {
        const spread = (index - (bucket.length - 1) / 2) * SPREAD;
        const cx = x(entry.cx) + spread;
        const cy = y(entry.cy);
        const tip = t("priorityTip", {
          title: entry.row.title,
          departments: entry.row.departments.length,
          blocked: (entry.row.blockedOperations ?? []).length,
          citations: entry.row.citations.length,
        });
        return (
          `<circle class="point ${moscowClass(entry.row.moscow)}" cx="${cx}" cy="${cy}"` +
          ` r="${radius(entry.row.citations.length)}" data-tip="${escapeHTML(tip)}"></circle>`
        );
      }),
    )
    .join("");

  const axisTitles =
    `<text class="axis-title" x="${LEFT + track / 2}" y="${height - 8}" text-anchor="middle">${escapeHTML(t("axisDepartmentsNaming"))}</text>` +
    `<text class="axis-title" x="${-(TOP + (maxY * CELL) / 2)}" y="14" text-anchor="middle" transform="rotate(-90)">` +
    `${escapeHTML(t("axisBlockedOperations"))}</text>`;

  const legend =
    `<div class="chart-legend moscow">` +
    [...MOSCOW_ORDER, "open"]
      .map(
        (level) =>
          `<span class="${moscowClass(level)}"><i></i>${escapeHTML(level === "open" ? t("open") : moscowName(level))}</span>`,
      )
      .join("") +
    `</div>`;

  // Upper right is the point of the field: named by many, blocking much.
  const urgent = rows.filter(
    (row) => row.departments.length >= Math.max(2, maxX) && (row.blockedOperations ?? []).length >= 2,
  );
  const summary = t("summaryPriority", {
    rows: rows.length,
    departments: maxX,
    urgent: urgent.length,
    names: urgent.map((row) => row.title).join(", ") || t("summaryNone"),
  });

  return (
    `<div class="chart-head"><h3 id="priority-title">${t("chartPriorityTitle")}</h3>` +
    `<button type="button" class="button-quiet" data-svg="priority" data-file="prioritization.svg">${t("saveAsSvg")}</button></div>` +
    legend +
    chartSummaryHTML("priority", summary) +
    `<figure class="chart" id="priority">` +
    `<svg viewBox="0 0 ${WIDTH} ${height}" role="img" aria-labelledby="priority-title"` +
    ` aria-describedby="priority-summary" preserveAspectRatio="xMinYMin meet">` +
    grid +
    axisTitles +
    points +
    `</svg>` +
    `<div class="chart-tip" hidden></div>` +
    `<figcaption class="column-note">${t("chartPriorityCaption")}</figcaption>` +
    `</figure>` +
    chartFiguresHTML("priority", {
      caption: t("priorityFiguresCaption"),
      columns: [
        t("columnRequirement"),
        t("axisDepartmentsNaming"),
        t("axisBlockedOperations"),
        t("metricCitations"),
        t("columnLevel"),
      ],
      rows: rows.map((row) => [
        row.title,
        row.departments.length,
        (row.blockedOperations ?? []).length,
        row.citations.length,
        MOSCOW_ORDER.includes(row.moscow) ? moscowName(row.moscow) : t("open"),
      ]),
    })
  );
}

function coverageChartHTML(rows, departments) {
  const withCitations = rows.filter((row) => row.citations.length);
  if (!withCitations.length || !departments.length) return "";
  return stackedBarsHTML({
    id: "coverage",
    summaryKey: "summaryCoverage",
    figuresCaption: t("coverageFiguresCaption"),
    title: t("chartCoverageTitle"),
    caption: t("chartCoverageCaption"),
    file: "citations-per-requirement.svg",
    departments,
    rows: withCitations.map((row) => ({
      name: row.title,
      child: false,
      values: departments.map(
        (department) =>
          row.citations.filter((citation) => citation.department === department).length,
      ),
      sum: row.citations.length,
    })),
  });
}

/** The catalog, worked up graphically before it is worked through row by row. */
function catalogChartsHTML(rows, departments) {
  const cited = rows.filter((row) => row.citations.length).length;
  const prioritized = rows.filter((row) => MOSCOW_ORDER.includes(row.moscow)).length;
  const metrics =
    `<div class="metrics">` +
    `<div class="metric"><div class="value">${rows.length}</div><span class="label">${t("metricRequirements")}</span></div>` +
    `<div class="metric"><div class="value">${cited}</div><span class="label">${t("metricCited")}</span></div>` +
    `<div class="metric"><div class="value">${prioritized}</div><span class="label">${t("metricPrioritized")}</span></div>` +
    `<div class="metric"><div class="value">${rows.reduce((n, row) => n + row.citations.length, 0)}</div>` +
    `<span class="label">${t("citationMany")}</span></div>` +
    `</div>`;

  const charts =
    moscowBandHTML(rows) +
    priorityFieldHTML(rows, departments.length) +
    coverageChartHTML(rows, departments);

  return metrics + (charts || `<p class="empty-state">${t("catalogChartsEmpty")}</p>`);
}

/** Only the graphic part; the cards stay as they are, focus included. */
async function drawCatalogCharts() {
  await loadRequirements();
  const part = document.getElementById("catalog-charts");
  if (!part) return;
  part.innerHTML = catalogChartsHTML(state.requirements, state.departments);
}

async function drawCatalog() {
  await loadRequirements();
  const root = $("#catalog");

  const head =
    `<h2>${t("catalogTitle")}</h2>` +
    `<p class="lead">${t("catalogLead")}</p>` +
    `<form class="new-requirement" id="new-requirement">` +
    `<input type="text" id="new-requirement-title" placeholder="${escapeHTML(t("requirementSentencePlaceholder"))}"` +
    ` aria-label="${escapeHTML(t("requirementTitleAria"))}" autocomplete="off">` +
    `<button type="submit" class="button">${t("add")}</button></form>`;

  if (!state.requirements.length) {
    root.innerHTML = head + `<p class="empty-state">${t("catalogEmpty")}</p>`;
    return;
  }

  const cards = state.requirements
    .map((requirement) => {
      const levels = state.moscow
        .map(
          (level) =>
            `<option value="${level.id}"${requirement.moscow === level.id ? " selected" : ""}>${level.name}</option>`,
        )
        .join("");
      const operations = OPERATIONS.map(
        (operation) =>
          `<label><input type="checkbox" data-blocked="${operation.id}"` +
          `${(requirement.blockedOperations ?? []).includes(operation.id) ? " checked" : ""}> ${t(operation.key)}</label>`,
      ).join("");
      const categories = requirement.categories
        .map(
          (category) =>
            `<span class="category-tag" style="--mark-color:${state.propositions[category.proposition]?.color ?? NEUTRAL_COLOR}">` +
            `${escapeHTML(category.name)}</span>`,
        )
        .join("");
      const citations = requirement.citations
        .map(
          (citation) =>
            `<li><span class="head-row"><span>${escapeHTML(citation.department)}</span>` +
            `<span>${t("turn")} ${citation.turn}</span><span>${escapeHTML(citation.categoryName)}</span>` +
            `<button type="button" class="button-quiet goto" data-passage="${citation.id}"` +
            ` data-interview="${escapeHTML(citation.interview)}">${t("viewInTranscript")}</button></span>` +
            `<blockquote>„${escapeHTML(citation.text)}“</blockquote></li>`,
        )
        .join("");

      return (
        `<article class="requirement" data-id="${requirement.id}" data-title="${escapeHTML(requirement.title)}">` +
        `<header>` +
        `<input type="text" class="title" value="${escapeHTML(requirement.title)}" aria-label="${escapeHTML(t("title"))}">` +
        `<select class="level" aria-label="${escapeHTML(t("moscowAria"))}"><option value="">${t("open")}</option>${levels}</select>` +
        `<button type="button" class="button-quiet remove" data-remove>${t("remove")}</button>` +
        `</header>` +
        (state.requirements.length > 1
          ? `<div class="row requirement-merge"><span class="field-label">${t("mergeInto")}</span>` +
            `<select class="requirement-target" aria-label="${escapeHTML(t("targetRequirementAria"))}">` +
            `<option value="">${t("chooseTarget")}</option>` +
            state.requirements
              .filter((other) => other.id !== requirement.id)
              .map((other) => `<option value="${other.id}">${escapeHTML(other.title)}</option>`)
              .join("") +
            `</select>` +
            `<button type="button" class="button-quiet" data-requirement-merge>${t("merge")}</button></div>`
          : "") +
        `<p class="numbers"><b>${requirement.departments.length}</b> ` +
        `${plural(requirement.departments.length, "departmentOne", "departmentMany")}` +
        `<span class="separator">·</span><b>${requirement.citations.length}</b> ` +
        `${plural(requirement.citations.length, "citationOne", "citationMany")}` +
        (requirement.departments.length
          ? `<span class="separator">·</span>${escapeHTML(requirement.departments.join(", "))}`
          : "") +
        `</p>` +
        (categories ? `<p class="category-tags">${categories}</p>` : "") +
        `<div class="row blocked"><span class="field-label">${t("blocks")}</span>${operations}</div>` +
        `<textarea class="description" rows="2" placeholder="${escapeHTML(t("descriptionPlaceholder"))}">${escapeHTML(requirement.description ?? "")}</textarea>` +
        (citations
          ? `<details class="citation-list"><summary>${requirement.citations.length} ` +
            `${plural(requirement.citations.length, "citationOne", "citationMany")}</summary><ul>${citations}</ul></details>`
          : `<p class="column-note">${t("noCitationYet")}</p>`) +
        `</article>`
      );
    })
    .join("");

  root.innerHTML =
    head +
    `<div id="catalog-charts">${catalogChartsHTML(state.requirements, state.departments)}</div>` +
    `<div class="catalog-list">${cards}</div>` +
    `<div class="exports"><a class="button-quiet" href="${exportHref("/api/export/requirements-catalog.md")}" download>` +
    `${t("catalogTitle")}</a></div>`;

  markScrollableTables(root);
}

/* Reading position -------------------------------------------------------- */

/**
 * Where in the transcript one last read, across a reload.
 *
 * What is remembered is not the scroll height but the topmost visible turn and
 * the offset within it. A height in pixels points somewhere else after the next
 * coding, because every margin mark makes the page longer; the turn number by
 * contrast names the same place as everywhere else in the tool. One position
 * per interview, so that switching back arrives where one left off.
 */
function readingPosition() {
  const container = $(".edition");
  if (!container) return null;
  const boundary = container.getBoundingClientRect().top;
  for (const element of $$("#transcript .turn")) {
    const box = element.getBoundingClientRect();
    if (box.bottom > boundary + 4) {
      return {
        turn: Number(element.dataset.turn),
        offset: Math.max(0, Math.round(boundary - box.top)),
      };
    }
  }
  return null;
}

function rememberReadingPosition() {
  if (!state.current || state.view !== "code") return;
  const position = readingPosition();
  if (!position) return;
  try {
    localStorage.setItem(STORAGE.readingPosition(state.current), JSON.stringify(position));
  } catch {
    /* Full or blocked storage must not hold up the coding. */
  }
}

function restoreReadingPosition() {
  const container = $(".edition");
  if (!container || !state.current) return;
  let position = null;
  try {
    position = JSON.parse(localStorage.getItem(STORAGE.readingPosition(state.current)) ?? "null");
  } catch {
    /* Unreadable remembered state is like nothing remembered. */
  }
  const element = position?.turn ? document.getElementById(`turn-${position.turn}`) : null;
  if (!element) {
    // Without a remembered place, start at the top. When switching interviews
    // the container would otherwise keep the scroll height of the previous one
    // and one would land in the middle of a transcript never seen before.
    container.scrollTo({ top: 0, behavior: "instant" });
    return;
  }
  const top =
    element.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop;
  // The offset cannot overtake the turn: if it gets shorter, because a coding
  // unit was removed, one lands at its start and not in the next turn.
  const offset = Math.min(position.offset ?? 0, Math.max(0, element.offsetHeight - 40));
  container.scrollTo({ top: Math.max(0, top + offset), behavior: "instant" });
  state.inFocus = position.turn;
  showFocus();
}

/* Putting it together ----------------------------------------------------- */

/** Shows in the bar which section the eye currently rests in. */
function watchSections() {
  const container = $(".edition");
  let requested = false;
  const check = () => {
    requested = false;
    const heads = $$(".section-head");
    if (!heads.length) return;
    const boundary = container.getBoundingClientRect().top + 80;
    let active = 0;
    heads.forEach((head, index) => {
      if (head.getBoundingClientRect().top <= boundary) active = index;
    });
    $$("#sections .section-entry").forEach((button) =>
      button.setAttribute("aria-current", String(Number(button.dataset.section) === active)),
    );
  };
  let timer = null;
  // Whoever scrolls and reloads right away would otherwise be cheated of the
  // waiting time.
  addEventListener("pagehide", rememberReadingPosition);
  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") rememberReadingPosition();
  });
  container.addEventListener("scroll", () => {
    // Write the reading position only after things settle, not on every scroll.
    clearTimeout(timer);
    timer = setTimeout(rememberReadingPosition, 200);
    if (requested) return;
    requested = true;
    requestAnimationFrame(check);
  });
  check();
}

/**
 * Reviewing an assignment suggested by a machine.
 *
 * A coding unit that did not come about by hand is a suggestion and not a
 * coding — it must cite nothing in the paper as long as it is unconfirmed. The
 * review is therefore a working step of its own: look at the passage, confirm
 * with Enter, on to the next. Whoever changes the assignment confirms it
 * anyway, because then the decision is theirs.
 */
function unreviewedQueue() {
  return state.codings
    .filter((coding) => coding.reviewed !== true && coding.state !== "lost")
    .sort((a, b) => a.turn - b.turn || a.start - b.start);
}

function jumpToUnreviewed(afterId = null) {
  const queue = unreviewedQueue();
  if (!queue.length) {
    state.selected = null;
    drawAll();
    return notify(t("everyUnitReviewed"));
  }
  // After a confirmation the next one in the queue, not back to the start.
  const previousId = afterId ?? state.selected;
  const reference = state.codings.find((coding) => coding.id === previousId);
  const next = reference
    ? (queue.find(
        (coding) =>
          coding.turn > reference.turn ||
          (coding.turn === reference.turn && coding.start > reference.start),
      ) ?? queue[0])
    : queue[0];

  state.selected = next.id;
  state.inFocus = next.turn;
  drawAll();
  document
    .querySelector(`#transcript .segment[data-id="${CSS.escape(next.id)}"]`)
    ?.scrollIntoView({ behavior: "smooth", block: "center" });
  notify(queue.length === 1 ? t("oneUnreviewed") : t("manyUnreviewed", { n: queue.length }));
}

/**
 * Confirmations run one after another.
 *
 * Reviewing a hundred and ten passages, Enter is pressed faster than the save
 * answers. Without an order the second keystroke would still confirm the same
 * passage and one would be skipped — unnoticed, because the count drops anyway.
 */
let reviewChain = Promise.resolve();

function confirmAndContinue() {
  reviewChain = reviewChain.then(() => confirmNow());
  return reviewChain;
}

async function confirmNow() {
  const id = state.selected;
  const unit = state.codings.find((coding) => coding.id === id);
  if (!unit) return jumpToUnreviewed();
  try {
    if (unit.reviewed !== true) {
      await api(`/api/interviews/${encodeURIComponent(state.current)}/codings/${id}`, {
        method: "PATCH",
        body: { reviewed: true },
      });
      unit.reviewed = true;
    }
    jumpToUnreviewed(id);
  } catch (error) {
    notify(error.message, "error");
  }
}

/** First respondent turn that carries no coding unit yet. */
function nextUntouchedTurn() {
  const touched = new Set(state.codings.map((coding) => coding.turn));
  const container = $(".edition");
  const boundary = container.getBoundingClientRect().top + 4;
  const open = state.transcript.turns.filter(
    (turn) => !turn.interviewer && !touched.has(turn.number),
  );
  const below = open.find((turn) => {
    const element = document.getElementById(`turn-${turn.number}`);
    return element && element.getBoundingClientRect().top > boundary + 8;
  });
  return below ?? open[0] ?? null;
}

function drawAll() {
  drawTranscript();
  drawDrift();
  drawSections();
  drawCategories();
  drawDetail();
}

function setView(name) {
  state.view = name;
  $$(".tab").forEach((tab) => tab.setAttribute("aria-current", String(tab.dataset.view === name)));
  $("#view-code").hidden = name !== "code";
  $("#view-catalog").hidden = name !== "catalog";
  $("#view-analysis").hidden = name !== "analysis";
  if (name === "analysis") drawAnalysis().catch((error) => notify(error.message, "error"));
  if (name === "catalog") drawCatalog().catch((error) => notify(error.message, "error"));
}

function setTheme(value) {
  document.documentElement.dataset.theme = value;
  localStorage.setItem(STORAGE.theme, value);
}

function connectEvents() {
  $("#interview-choice").addEventListener("change", async (event) => {
    state.current = event.target.value;
    await loadTranscript();
    drawAll();
    restoreReadingPosition();
  });

  $$(".tab").forEach((tab) => tab.addEventListener("click", () => setView(tab.dataset.view)));

  $("#theme").addEventListener("click", () => {
    const now = document.documentElement.dataset.theme;
    setTheme(now === "dark" ? "light" : now === "light" ? "auto" : "dark");
  });

  const transcript = $("#transcript");

  transcript.addEventListener("mouseup", () => {
    setTimeout(() => {
      const selection = readSelection();
      if (selection?.error) return notify(selection.error, "error");
      if (!selection) return;
      if (state.reanchoring) return reanchor(selection);
      select(selection);
    }, 0);
  });

  // Margin mark and segment belong together but stand far apart. On hover both
  // light up, so that one does not have to match them via the superscript.
  const emphasize = (id, on) => {
    for (const element of transcript.querySelectorAll(`[data-id="${CSS.escape(id)}"]`)) {
      element.classList.toggle("emphasized", on);
    }
  };
  transcript.addEventListener("mouseover", (event) => {
    const part = event.target.closest(".segment, .mark");
    if (part?.dataset.id) emphasize(part.dataset.id, true);
  });
  transcript.addEventListener("mouseout", (event) => {
    const part = event.target.closest(".segment, .mark");
    if (part?.dataset.id) emphasize(part.dataset.id, false);
  });

  transcript.addEventListener("dblclick", (event) => {
    if (event.target.closest(".segment")) return;
    selectSentence(event);
  });

  transcript.addEventListener("click", (event) => {
    const segment = event.target.closest(".segment");
    const mark = event.target.closest(".mark");
    const id = segment?.dataset.id ?? mark?.dataset.id;
    if (id) {
      event.preventDefault();
      releaseSelection();
      state.selected = id;
      drawAll();
      return;
    }
    // A click beside it clears the choice, as long as it is not a new selection.
    if (state.selected && document.getSelection()?.isCollapsed !== false) {
      state.selected = null;
      drawAll();
    }
  });

  $("#coding-bar").addEventListener("click", (event) => {
    const choice = event.target.closest(".choice");
    if (choice) code(choice.dataset.category);
  });
  $("#coding-bar-cancel").addEventListener("click", releaseSelection);

  const searchField = $("#search");
  searchField.addEventListener("input", () => {
    state.search = searchField.value;
    state.matchIndex = 0;
    // Like searching in a browser: the first location comes into view while
    // typing, otherwise one does not know whether anything happened at all.
    highlightMatches(true);
    searchElsewhere(searchField.value);
  });

  $("#search-elsewhere").addEventListener("click", async (event) => {
    const button = event.target.closest(".elsewhere");
    if (!button) return;
    state.current = button.dataset.interview;
    $("#interview-choice").value = state.current;
    await loadTranscript();
    drawAll();
    searchElsewhere(state.search);
  });

  const noteField = $("#note");
  noteField.addEventListener("change", async () => {
    try {
      await api(`/api/interviews/${encodeURIComponent(state.current)}`, {
        method: "PATCH",
        body: { memo: noteField.value },
      });
      state.transcript.memo = noteField.value;
      notify(t("interviewNoteSaved"));
    } catch (error) {
      notify(error.message, "error");
    }
  });

  searchField.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    jumpMatch(event.shiftKey ? -1 : 1);
  });
  $("#search-next").addEventListener("click", () => jumpMatch(1));
  $("#search-previous").addEventListener("click", () => jumpMatch(-1));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (document.activeElement === searchField) {
        clearSearch();
        searchField.blur();
        return;
      }
      if (state.reanchoring) {
        state.reanchoring = null;
        document.body.classList.remove("anchoring");
        return notify(t("reanchorCancelled"));
      }
      if (state.selection) {
        // First take back the filter, then the selection — otherwise a typo
        // loses the whole highlight.
        if (state.filter) {
          state.filter = "";
          return drawBarChoices();
        }
        return releaseSelection();
      }
      if (state.selected) {
        state.selected = null;
        return drawAll();
      }
    }
    if (event.target.matches("input, textarea, select")) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    // With the coding bar open the keys belong to it: otherwise „k" would not
    // filter but jump to the previous turn.
    if (!state.selection) {
      if (event.key === "/") {
        event.preventDefault();
        return searchField.focus();
      }
      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        return jumpTurn(event.key === "j" ? 1 : -1);
      }
      // Review: Enter confirms the chosen passage and moves on; without a
      // chosen one it starts at the first unreviewed.
      if (event.key === "Enter" && state.view === "code") {
        event.preventDefault();
        return state.selected ? confirmAndContinue() : jumpToUnreviewed();
      }
      return;
    }

    if (/^[1-9]$/.test(event.key)) {
      const category = barCategories()[Number(event.key) - 1];
      if (category) {
        event.preventDefault();
        code(category.id);
      }
      return;
    }
    if (event.key === "Enter") {
      const rest = barCategories();
      if (rest.length === 1) {
        event.preventDefault();
        code(rest[0].id);
      }
      return;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      state.filter = state.filter.slice(0, -1);
      return drawBarChoices();
    }
    if (event.key.length === 1 && /\p{L}/u.test(event.key)) {
      event.preventDefault();
      state.filter += event.key;
      drawBarChoices();
    }
  });

  $("#status").addEventListener("click", (event) => {
    if (event.target.id === "review") return jumpToUnreviewed();
    if (event.target.id !== "jump") return;
    const turn = nextUntouchedTurn();
    if (!turn) return notify(t("everyTurnCoded"));
    state.inFocus = turn.number;
    showFocus();
    document
      .getElementById(`turn-${turn.number}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  $("#sections").addEventListener("click", (event) => {
    const button = event.target.closest(".section-entry");
    if (!button) return;
    document
      .getElementById(`section-${button.dataset.section}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("#drift").addEventListener("click", async (event) => {
    const again = event.target.closest("[data-reanchor]");
    if (again) {
      state.reanchoring = again.dataset.reanchor;
      document.body.classList.add("anchoring");
      notify(t("markPassage"));
      return;
    }
    const remove = event.target.closest("[data-drift-remove]");
    if (!remove) return;
    const id = remove.dataset.driftRemove;
    try {
      await api(`/api/interviews/${encodeURIComponent(state.current)}/codings/${id}`, {
        method: "DELETE",
      });
      state.codings = state.codings.filter((coding) => coding.id !== id);
      drawAll();
      notify(t("unitDeleted"));
    } catch (error) {
      notify(error.message, "error");
    }
  });

  $("#categories").addEventListener("click", (event) => {
    const button = event.target.closest(".category");
    if (button) {
      const id = button.dataset.category;
      state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
      return drawCategories();
    }
    const remove = event.target.closest("[data-category-remove]");
    if (remove) {
      api(`/api/categories/${encodeURIComponent(remove.dataset.categoryRemove)}`, {
        method: "DELETE",
      })
        .then(async () => {
          await loadCategories();
          drawCategories();
          notify(t("categoryRemoved"));
        })
        .catch((error) => notify(error.message, "error"));
      return;
    }

    const ruleRemove = event.target.closest("[data-rule-remove]");
    if (ruleRemove) {
      const index = Number(ruleRemove.dataset.index);
      return updateCategory(
        ruleRemove.dataset.ruleRemove,
        (category) => ({
          codingRules: (category.codingRules ?? []).map(ruleText).filter((_, i) => i !== index),
        }),
        t("ruleRemoved"),
      );
    }

    const merge = event.target.closest("[data-merge]");
    if (merge) {
      const source = merge.dataset.merge;
      const target = $(`[data-merge-target="${CSS.escape(source)}"]`)?.value;
      if (!target) return notify(t("chooseTargetCategory"), "error");
      return mergeCategories(source, target);
    }

    const reset = event.target.closest("[data-definition-reset]");
    if (reset) {
      return updateCategory(
        reset.dataset.definitionReset,
        (category) =>
          category.initialDefinition ? { definition: category.initialDefinition } : null,
        t("definitionResetDone"),
      );
    }
  });

  $("#categories").addEventListener("input", (event) => {
    const form = event.target.closest("[data-rule]");
    if (form) state.ruleDraft.set(form.dataset.rule, event.target.value);
  });

  // Definition, name and the individual coding rules are saved when the field
  // is left, not while typing: otherwise every half sentence would stand in the
  // file and the coding guide would carry intermediate states.
  $("#categories").addEventListener("change", (event) => {
    const definition = event.target.closest("[data-definition]");
    if (definition) {
      const category = categoryById(definition.dataset.definition);
      if (definition.value.trim() === (category.definition ?? "")) return;
      return updateCategory(category.id, { definition: definition.value }, t("definitionSaved"));
    }

    const note = event.target.closest("[data-category-memo]");
    if (note) {
      const category = categoryById(note.dataset.categoryMemo);
      if (note.value === (category.memo ?? "")) return;
      return updateCategory(category.id, { memo: note.value }, t("noteSaved"));
    }

    const name = event.target.closest("[data-category-name]");
    if (name) {
      const category = categoryById(name.dataset.categoryName);
      if (!name.value.trim() || name.value.trim() === category.name) return drawCategories();
      return updateCategory(category.id, { name: name.value.trim() }, t("categoryRenamed"));
    }

    const parent = event.target.closest("[data-category-parent]");
    if (parent) return subordinateCategory(parent.dataset.categoryParent, parent.value);

    const rule = event.target.closest("[data-rule-text]");
    if (rule) {
      const index = Number(rule.dataset.index);
      const value = rule.value;
      if (value.trim() === ruleText(categoryById(rule.dataset.ruleText).codingRules?.[index])) {
        return;
      }
      return updateCategory(
        rule.dataset.ruleText,
        (category) => {
          const rules = (category.codingRules ?? []).map(ruleText);
          rules[index] = value;
          return { codingRules: rules };
        },
        value.trim() ? t("ruleChanged") : t("emptyRuleRemoved"),
      );
    }
  });

  $("#categories").addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-rule]");
    if (!form) return;
    event.preventDefault();
    const input = form.querySelector("input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    state.ruleDraft.delete(form.dataset.rule);
    await updateCategory(
      form.dataset.rule,
      (category) => ({ codingRules: [...(category.codingRules ?? []).map(ruleText), text] }),
      t("ruleSaved"),
    );
  });

  connectCategoryDragging();

  $("#inductive").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = $("#inductive-name").value.trim();
    if (!name) return;
    try {
      await api("/api/categories", {
        method: "POST",
        body: {
          name,
          definition: $("#inductive-definition").value.trim(),
          parent: $("#inductive-parent").value || null,
        },
      });
      $("#inductive-name").value = "";
      $("#inductive-definition").value = "";
      await loadCategories();
      drawCategories();
      notify(t("inductiveAdded", { name }));
    } catch (error) {
      notify(error.message, "error");
    }
  });

  const catalog = $("#catalog");

  catalog.addEventListener("submit", async (event) => {
    if (event.target.id !== "new-requirement") return;
    event.preventDefault();
    const field = $("#new-requirement-title");
    const title = field.value.trim();
    if (!title) return;
    try {
      await api("/api/requirements", { method: "POST", body: { title } });
      field.value = "";
      await drawCatalog();
      notify(t("requirementCreated"));
    } catch (error) {
      notify(error.message, "error");
    }
  });

  catalog.addEventListener("change", async (event) => {
    const card = event.target.closest(".requirement");
    if (!card) return;
    const id = card.dataset.id;
    const fields = {};
    if (event.target.classList.contains("level")) fields.moscow = event.target.value || null;
    if (event.target.classList.contains("title")) fields.title = event.target.value.trim();
    if (event.target.classList.contains("description")) fields.description = event.target.value;
    if (event.target.dataset.blocked) {
      fields.blockedOperations = [...card.querySelectorAll("[data-blocked]")]
        .filter((box) => box.checked)
        .map((box) => box.dataset.blocked);
    }
    if (!Object.keys(fields).length) return;
    try {
      await api(`/api/requirements/${id}`, { method: "PATCH", body: fields });
      // The order hangs off the level, so a level change redraws everything.
      // Anything else only moves the charts — and redrawing the cards under a
      // hand that is still working in them would pull the field away.
      if ("moscow" in fields) await drawCatalog();
      else await drawCatalogCharts();
    } catch (error) {
      notify(error.message, "error");
    }
  });

  // Both analysis views lead from a citation back to its place.
  for (const field of [$("#analysis"), catalog]) {
    field.addEventListener("click", (event) => {
      const goto = event.target.closest("[data-passage]");
      if (goto) showPassage(goto.dataset.interview, goto.dataset.passage);
    });
  }

  // Slices through the citations. They apply to the state already computed,
  // so without a refetch and without redrawing the cross table.
  const setFilter = (field) => {
    state.citationFilter[field.dataset.filter] =
      field.type === "checkbox" ? field.checked : field.value;
    drawCitations();
  };
  $("#analysis").addEventListener("change", (event) => {
    if (event.target.dataset?.filter) return setFilter(event.target);
    if (event.target.id === "note-kind") {
      state.noteKind = event.target.value;
      return drawNotes();
    }
    if (event.target.id === "note-category") {
      state.noteCategory = event.target.value;
      return drawNotes();
    }
  });
  $("#analysis").addEventListener("input", (event) => {
    if (event.target.dataset?.filter === "word") return setFilter(event.target);
    if (event.target.id === "note-filter") {
      state.noteFilter = event.target.value;
      drawNotes();
    }
  });
  $("#analysis").addEventListener("change", async (event) => {
    const choice = event.target.closest(".requirement-choice");
    if (!choice || !choice.value) return;
    const { citation, interview } = choice.dataset;
    const value = choice.value;
    choice.value = "";
    if (value === "new") return createRequirementFrom(interview, citation);
    await assign(interview, citation, (before) => [...before, value]);
  });

  // Tooltips of the charts: follow the mouse over anything that carries one.
  const HOVERABLE = ".segment, .cell, .point, .moscow-band";
  for (const view of [$("#analysis"), catalog]) {
    view.addEventListener("mousemove", (event) => {
      const mark = event.target.closest?.(HOVERABLE);
      if (!mark) {
        for (const tip of view.querySelectorAll(".chart-tip")) tip.hidden = true;
        return;
      }
      const tip = mark.closest(".chart")?.querySelector(".chart-tip");
      if (!tip) return;
      tip.textContent = mark.dataset.tip ?? "";
      tip.hidden = false;
      const frame = tip.parentElement.getBoundingClientRect();
      tip.style.left = `${event.clientX - frame.left + 14}px`;
      tip.style.top = `${event.clientY - frame.top - 30}px`;
    });
    view.addEventListener("mouseleave", () => {
      for (const tip of view.querySelectorAll(".chart-tip")) tip.hidden = true;
    });
    view.addEventListener("click", (event) => {
      const button = event.target.closest("[data-svg]");
      if (button) saveChart(button.dataset.svg, button.dataset.file);
    });
  }

  $("#analysis").addEventListener("click", async (event) => {
    const unlink = event.target.closest("[data-unlink]");
    if (unlink) {
      const { unlink: id, citation, interview } = unlink.dataset;
      return assign(interview, citation, (before) => before.filter((other) => other !== id));
    }
    if (event.target.id !== "filter-clear") return;
    state.citationFilter = { ...EMPTY_SLICE };
    drawCitations();
  });

  catalog.addEventListener("click", async (event) => {
    const merge = event.target.closest("[data-requirement-merge]");
    if (merge) {
      const card = merge.closest(".requirement");
      const target = card.querySelector(".requirement-target")?.value;
      if (!target) return notify(t("chooseTargetRequirement"), "error");
      const name = card.dataset.title;
      try {
        const answer = await api(`/api/requirements/${card.dataset.id}/merge`, {
          method: "POST",
          body: { target },
        });
        await loadTranscript();
        await drawCatalog();
        notify(
          t("requirementMerged", {
            source: name,
            target: answer.target.title,
            n: answer.moved,
            word: plural(answer.moved, "citationOne", "citationMany"),
          }),
        );
      } catch (error) {
        notify(error.message, "error");
      }
      return;
    }

    const remove = event.target.closest("[data-remove]");
    if (!remove) return;
    const card = remove.closest(".requirement");
    try {
      await api(`/api/requirements/${card.dataset.id}`, { method: "DELETE" });
      await loadTranscript();
      await drawCatalog();
      notify(t("requirementRemoved"));
    } catch (error) {
      notify(error.message, "error");
    }
  });

  $("#detail").addEventListener("change", async (event) => {
    const coding = state.codings.find((other) => other.id === state.selected);
    if (!coding) return;
    const fields = {};
    // Whoever changes the category has decided — the passage is reviewed by it.
    if (event.target.id === "detail-category") {
      fields.category = event.target.value;
      if (coding.reviewed !== true) fields.reviewed = true;
    }
    if (event.target.id === "detail-anchor") fields.anchor = event.target.checked;
    if (event.target.id === "detail-reviewed") fields.reviewed = event.target.checked;
    if (event.target.id === "detail-memo") fields.memo = event.target.value;
    if (!Object.keys(fields).length) return;
    try {
      const updated = await api(
        `/api/interviews/${encodeURIComponent(state.current)}/codings/${coding.id}`,
        { method: "PATCH", body: fields },
      );
      Object.assign(coding, updated);
      drawAll();
    } catch (error) {
      notify(error.message, "error");
    }
  });

  $("#detail").addEventListener("submit", async (event) => {
    if (event.target.id !== "detail-new-requirement") return;
    event.preventDefault();
    const input = event.target.querySelector("input");
    const title = input.value.trim();
    const coding = state.codings.find((other) => other.id === state.selected);
    if (!title || !coding) return;
    try {
      const created = await api("/api/requirements", { method: "POST", body: { title } });
      await link(coding, created.id, true);
      await loadRequirements();
      drawDetail();
      notify(t("requirementCreatedCited", { title }));
    } catch (error) {
      notify(error.message, "error");
    }
  });

  $("#detail").addEventListener("click", async (event) => {
    const box = event.target.closest("[data-requirement]");
    if (box) {
      const coding = state.codings.find((other) => other.id === state.selected);
      if (coding) await link(coding, box.dataset.requirement, box.checked);
      return;
    }
    if (event.target.id !== "detail-remove") return;
    await removeCoding(state.selected);
  });

  $("#message").addEventListener("click", (event) => {
    if (event.target.id !== "message-action" || !offer) return;
    const run = offer.run;
    $("#message").hidden = true;
    offer = null;
    run();
  });
}

/* Start ------------------------------------------------------------------- */

async function start() {
  setTheme(localStorage.getItem(STORAGE.theme) ?? "auto");
  translateChrome();
  try {
    await loadCategories();
    await loadRequirements();
    await loadInterviews();
    await loadTranscript();
    drawAll();
    connectEvents();
    watchSections();
    restoreReadingPosition();
  } catch (error) {
    notify(error.message, "error");
    $("#transcript").innerHTML = `<p class="empty-state">${escapeHTML(error.message)}</p>`;
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

start();
