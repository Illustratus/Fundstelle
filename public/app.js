/*
  Interface of the coding tool.

  The core is the conversion between the selection in the browser and the
  character positions inside a speaker turn, because only those positions are
  stable enough to be stored next to the transcript. Everything else hangs off
  them: highlight, apparatus, citation and export.
*/

import { effectiveWord, matchesSlice, occurrences, trimStem } from "./search.js";
import { sentenceAt, sentences } from "./sentences.js";
import { layoutBucket } from "./scatter.js";
import { language, plural, quoted, setLanguage, t } from "./texts.js";

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
  // Where the keyboard stands in the material: turn, sentence, and how many
  // sentences the run holds. Null whenever the choice came from the mouse.
  sentence: null,
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
  // The comparison with a second coding, if one lies beside the first.
  agreement: null,
  // A transcript file read but not yet written out.
  importing: null,
  citationFilter: { ...EMPTY_SLICE },
  // Categories whose citations are shown in full rather than the first few.
  citationsShown: new Set(),
  // Groups a reader has opened or closed by hand, which outrank the default.
  citationsOpen: new Map(),
  // Which requirements the catalog is showing. At twenty of them the list runs
  // to several screens, and the counts above it say how many are still
  // undecided without offering any way to reach them.
  catalogFilter: { open: false, unsupported: false, unreviewed: false },
  noteFilter: "",
  noteKind: "",
  noteCategory: "",
  matches: [],
  matchIndex: 0,
  inFocus: null,
};

/* Helpers --------------------------------------------------------------- */

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      // The server answers in the language of the request, so an error message
      // arrives in the language the interface is set to and not in the one the
      // browser happens to prefer.
      headers: { "content-type": "application/json", "accept-language": language() },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    /* The request never reached anybody: the machine went to sleep, or the
       terminal running the tool was closed. What the browser throws for that is
       „Failed to fetch" — its own words, in its own language, in a tool that is
       otherwise bilingual to the last file, and it answers neither of the two
       questions the reader actually has. */
    throw Object.assign(new Error(t("errorNoServer")), { data: { code: "offline" }, offline: true });
  }
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
function notify(text, kind = "info", handle = null, { keep = false } = {}) {
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
  /* A message that goes away by itself is right for something that happened
     once. A server that is not answering is a state, not an event: every next
     thing the reader tries will fail the same way, and a notice that fades
     after six seconds leaves them wondering whether it was real. */
  if (keep) return;
  messageTimer = setTimeout(
    () => {
      element.hidden = true;
      offer = null;
    },
    handle ? 15000 : kind === "error" ? 6000 : 3200,
  );
}

/** What to say about a failure, and whether to leave it standing. */
function complain(error) {
  notify(error.message, "error", null, { keep: Boolean(error.offline) });
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

/**
 * The list of interviews, with what each still has open.
 *
 * The counts come from the server when the list is loaded and then go out of
 * date the moment anybody confirms a unit — so the picker went on offering
 * „6 offen" for an interview whose last suggestion had just been confirmed, and
 * anything else reading those counts was wrong in the same way. The interview
 * on screen is counted from what is actually in hand instead.
 */
function drawInterviewList() {
  const choice = $("#interview-choice");
  const open = (interview) =>
    interview.id === state.current && state.transcript
      ? state.codings.filter((coding) => coding.reviewed !== true && coding.state !== "lost").length
      : (interview.unreviewed ?? 0);
  for (const interview of state.interviews) {
    if (interview.id === state.current && state.transcript) interview.unreviewed = open(interview);
  }
  choice.innerHTML = state.interviews
    .map(
      (i) =>
        `<option value="${escapeHTML(i.id)}">${escapeHTML(i.title)}` +
        `${open(i) ? ` · ${t("openMark", { n: open(i) })}` : ""}</option>`,
    )
    .join("");
  // A dropdown with nothing in it is a control that cannot be used and a
  // question the reader cannot answer.
  choice.closest(".field").hidden = !state.interviews.length;
  if (state.current) choice.value = state.current;
}

async function loadInterviews() {
  state.interviews = await api("/api/interviews");
  const choice = $("#interview-choice");
  // An interview that still holds suggestions says so in the list, so that the
  // next one to work through can be picked without opening each in turn.
  drawInterviewList();
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
  /* What to do first, then how the files look — not the other way round.
     The screen used to open with a folder path, fourteen lines of Markdown and
     a paragraph about asterisks and middle dots, and put the buttons under all
     of it. For the common arrival — somebody holding a WebVTT out of Teams —
     that is a lesson about a format the tool will write for them, standing
     between them and the thing that does it. The format still matters to
     whoever writes files by hand, so it is one click away rather than gone. */
  root.innerHTML =
    `<div class="onboarding">` +
    `<h2>${t("onboardingTitle")}</h2>` +
    `<p class="onboarding-lead">${t("onboardingLead")}</p>` +
    `<p class="onboarding-actions">` +
    `<button type="button" class="button" id="onboarding-import">${t("importFromFile")}</button>` +
    `<button type="button" class="button-quiet" id="onboarding-example">${t("writeExample")}</button>` +
    `<button type="button" class="button-quiet" id="onboarding-reload">${t("reload")}</button></p>` +
    `<p class="column-note">${t("writeExampleNote")}</p>` +
    `<details class="onboarding-format"><summary>${t("onboardingFormat")}</summary>` +
    `<p>${t("onboardingReads")}</p>` +
    `<p class="onboarding-path"><code id="onboarding-path">…/my-interview/final.md</code></p>` +
    `<pre class="onboarding-sample">${escapeHTML(t("onboardingSample"))}</pre>` +
    `<p>${t("onboardingContract")}</p></details>` +
    `<p class="column-note">${t("onboardingStartSystem")}</p>` +
    `</div>`;
  api("/api/environment")
    .then((environment) => {
      const field = document.getElementById("onboarding-path");
      if (field) field.textContent = `${environment.transcripts}/my-interview/final.md`;
    })
    .catch(() => {});
  document.getElementById("onboarding-reload")?.addEventListener("click", () => location.reload());
  /* The likeliest thing a reader has in hand on this screen is a recording's
     transcript, not the patience to type the format out. */
  document.getElementById("onboarding-import")?.addEventListener("click", openImport);
  document.getElementById("onboarding-example")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api("/api/example", { method: "POST" });
      location.reload();
    } catch (error) {
      button.disabled = false;
      complain(error);
    }
  });
}

/**
 * The screen for a tool that could not start.
 *
 * Pointing START_SYSTEM at a file with a stray comma in it is the likeliest
 * first-run failure there is once anybody brings a category system of their
 * own — which is the whole point of the thing being configurable. What that
 * produced was the application drawn around nothing: an empty interview
 * picker, a search bar over a transcript that is not there, a column
 * explaining percentages per guide block, and a button offering to create a
 * category in a system that could not be read. The reason for all of it sat in
 * a red message that faded after six seconds.
 *
 * A configuration that cannot be read is a state, not an event. So it takes
 * the screen, it stays, and it says the one thing the message never did: what
 * to do about it.
 */
function cannotStart(error) {
  document.body.classList.add("cannot-start");
  /* No toast beside it. The panel carries the reason permanently and in full,
     and the same sentence twice on one screen reads as two problems. */
  const code = String(error.data?.code ?? "");
  $("#transcript").innerHTML =
    `<div class="onboarding halt" role="alert">` +
    `<h2>${t("haltTitle")}</h2>` +
    `<p class="halt-reason">${escapeHTML(error.message)}</p>` +
    // Only where the tool knows which knob it is: a generic "check your
    // configuration" is the sentence that helps nobody.
    (code.startsWith("errorStartSystem")
      ? `<p>${t("haltStartSystem")}</p><p class="column-note">${t("haltStartSystemExample")}</p>`
      : `<p>${t("haltGeneral")}</p>`) +
    `<p class="onboarding-actions">` +
    `<button type="button" class="button" id="halt-reload">${t("tryAgain")}</button></p>` +
    `</div>`;
  document.getElementById("halt-reload")?.addEventListener("click", () => location.reload());
}

function drawTranscript() {
  const root = $("#transcript");
  if (!state.transcript) {
    drawOnboarding(root);
    return;
  }
  /* The one act this screen exists for, said once, on the screen where it is
     wanted. Walking the first run end to end — empty folder, a recording read
     in, a transcript open — the tool showed a reading surface and a column of
     zeroes, and nothing anywhere said how to make a coding. The keys are all in
     the sheet behind `?`, which is no help to somebody who does not yet know
     there is a sheet. It goes as soon as anything is coded. */
  $("#how-to-code").hidden = state.codings.length > 0;
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
    const stem = trimStem(input, language());
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
        (state.instead ? ` · ${quoted(state.instead)}` : "")
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
    `${data.instead ? ` · ${quoted(escapeHTML(data.instead))}` : ""}</span>` +
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

/**
 * What could not be read out of the transcript file.
 *
 * A turn without a timestamp used to fall through in silence and take its text
 * with it; two turns carrying the same number made every citation on it
 * ambiguous without a word. The file is the contract, and where it is not kept
 * the tool says which line and what was expected instead of showing a short
 * interview and leaving the reader to wonder.
 */
function drawTranscriptProblems() {
  const field = $("#transcript-problems");
  const problems = state.transcript?.problems ?? [];
  if (!problems.length) {
    field.hidden = true;
    field.innerHTML = "";
    return;
  }
  field.hidden = false;
  field.innerHTML =
    `<h2>${problems.length === 1 ? t("fileProblemOne") : t("fileProblemMany", { n: problems.length })}</h2>` +
    `<p>${t("fileProblemNote")}</p><ul>` +
    problems.map((problem) => `<li><span class="reason">${escapeHTML(problem.text)}</span></li>`).join("") +
    `</ul>`;
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
          `<blockquote>${quoted(escapeHTML(withoutTimestamps(coding.text)))}</blockquote>` +
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
  /* With no interview at all the column stood there explaining percentages per
     guide section, above two rules and a disclosure for a note on an interview
     that does not exist. Furniture around nothing teaches the reader that parts
     of this screen mean nothing, which is a poor first lesson. */
  const column = $(".column-left");
  column.dataset.empty = String(!state.transcript);
  // Searching a transcript that is not there is a control with nothing behind
  // it, and the first screen is a poor place to learn that some are.
  $(".search-bar").hidden = !state.transcript;
  if (!state.transcript) return (list.innerHTML = "");

  /* A transcript that carries no guide sections is the ordinary case for one
     that came out of a recording — the sections belong to the interview guide,
     not to the tape. The column then explained percentages for a thing that
     does not exist, said "0 blocks" as though it were a shortfall, and left the
     reader to work out whether they had done something wrong. */
  const explains = $("#sections-note");
  const bare = !state.transcript.sections.length;
  explains.textContent = t(bare ? "sectionsNoneNote" : "sectionsNote");
  if (bare) {
    list.innerHTML = "";
    return;
  }

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
          ? `<span class="coverage" title="${t("sectionCoverageTitle", { n: share.toFixed(0) })}">` +
            `<i style="width:${share.toFixed(1)}%"></i></span>`
          : "") +
        `</button></li>`
      );
    })
    .join("");

  const codable = state.transcript.turns.filter((turn) => !turn.interviewer);
  const touched = new Set(state.codings.map((coding) => coding.turn));
  const touchedCount = codable.filter((turn) => touched.has(turn.number)).length;
  const open = state.codings.filter(
    (coding) => coding.reviewed !== true && coding.state !== "lost",
  ).length;
  // The list was counted when it was fetched; what happens here is newer than
  // that, so the entry for the interview on screen is kept level with it.
  const listed = state.interviews.find((interview) => interview.id === state.current);
  if (listed) listed.unreviewed = open;
  $("#status").innerHTML =
    `<div>${t("statusUnits", { n: state.codings.length })}</div>` +
    `<div>${t("statusTouched", { n: touchedCount, m: codable.length })}</div>` +
    `<div>${t("statusSections", { n: state.transcript.sections.length })}</div>` +
    /* "All reviewed" was said about the interview on screen while the study
       still carried suggestions elsewhere — and that is the sentence somebody
       reads just before they start writing up. It now says which of the two it
       means, and points at the interview that is still open. */
    (open
      ? `<div class="open-status">${t("statusUnreviewed", { n: open })}</div>` +
        `<button type="button" class="button-quiet jump" id="review">${t("nextUnreviewed")}</button>`
      : state.codings.length
        ? `<div class="open-status reviewed">${t("allReviewed")}</div>` +
          (elsewhereUnreviewed()
            ? `<div class="open-status">${t("openElsewhere", { n: elsewhereUnreviewed() })}</div>` +
              `<button type="button" class="button-quiet jump" id="review-elsewhere">` +
              `${t("toThatInterview")}</button>`
            : "")
        : "") +
    `<button type="button" class="button-quiet jump" id="jump">${t("nextUntouched")}</button>`;

  const conducted = state.transcript.meta.Erhebung ?? state.transcript.meta.Conducted ?? "";
  $("#header-subtitle").textContent = `${state.transcript.department} · ${conducted}`.trim();

  /* Everything else the transcript's header records. The format has parsed
     these lines from the beginning and exactly one of them was ever shown, so a
     role or a tenure written into a file was read and dropped — and then typed
     out again by hand for the sample table of the thesis. */
  const about = Object.entries(state.transcript.meta ?? {});
  $("#interview-meta").innerHTML = about.length
    ? about
        .map(
          ([key, value]) =>
            `<div><span class="field-label">${escapeHTML(key)}</span>` +
            `<span>${escapeHTML(value)}</span></div>`,
        )
        .join("")
    : "";
  $("#interview-meta").hidden = !about.length;

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
      complain(error);
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
/**
 * Is the deductive start system still being written?
 *
 * "Fixed before the material is worked" is a statement about a moment. While
 * the study holds no coding at all, that moment has not passed: the start
 * system can still be built, and the three categories of the bundled example
 * can be put aside. From the first coding onwards it stands.
 *
 * The server settles this for itself on every request; this only decides what
 * the interface offers, so a stale count costs a refused request with a clear
 * message rather than a wrong file.
 */
function startSystemOpen() {
  if (state.codings.length) return false;
  return state.interviews.every((one) => (one.id === state.current ? 0 : one.codings) === 0);
}

function categoryDetail(category) {
  const id = category.id;
  /* Two different questions, and conflating them was a real mistake: where a
     category came from decides how its definition history is labelled — „before
     the survey" for one fixed beforehand, „on creation" for one formed on the
     material — while whether it can still be renamed away or dissolved depends
     only on whether anything has been coded yet. Sharing one flag labelled a
     deductive category's original wording as the wording it was created with,
     which is false about the study. */
  const inductive = category.origin === "inductive";
  const stillOpen = inductive || startSystemOpen();
  const rules = (category.codingRules ?? []).map(ruleText);
  return (
    `<li class="category-detail" data-detail="${id}">` +
    (stillOpen
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
        `${quoted(escapeHTML(category.initialDefinition))} ` +
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
    (stillOpen ? mergeHTML(category) : "") +
    (stillOpen
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
      "info",
      /* The largest thing a single click does here — a category gone, every one
         of its units re-hung — and it was the only one with no way back, while
         deleting a single unit had one. The offer sits on the message, the way
         it does there, and goes when the message goes. */
      answer.undo ? { label: t("undo"), run: () => undoMerge(answer.undo) } : undefined,
    );
  } catch (error) {
    complain(error);
  }
}

/** Put the dissolved category back, with exactly the units that moved. */
async function undoMerge(undo) {
  try {
    const back = await api("/api/categories/merge/undo", { method: "POST", body: undo });
    await loadCategories();
    await loadTranscript();
    state.expanded.add(back.restored.id);
    drawAll();
    notify(t("mergeUndone", { name: back.restored.name }));
  } catch (error) {
    notify(t("restoreFailed", { error: error.message }), "error");
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

  /* Before the first coding the panel is building the start system, after it
     the panel is recording what the material demanded. Same form, different
     act — and the difference is exactly what the coding guide reports, so it
     is said rather than left to be inferred from a heading. */
  const open = startSystemOpen();
  $("#inductive-shell").dataset.deductive = String(open);
  $("#inductive-summary").textContent = t(open ? "startSystemSummary" : "inductiveSummary");
  $("#inductive-note").textContent = t(open ? "startSystemNote" : "inductiveNote");
  $("#inductive-submit").textContent = t(open ? "startSystemAdd" : "add");

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
  showSentences(number, sentenceAt(turn.text, middle), 1, false);
}

/**
 * Put the choice on a run of sentences, from wherever it came.
 *
 * The double click points at one with the mouse, the keyboard walks from one to
 * the next; both end here, so both save the same passage. `span` is how many
 * sentences the run holds — a coding unit is often two or three, and picking
 * them up one at a time is the difference between a keyboard that can code and
 * one that can only pretend to.
 */
function showSentences(number, index, span, byKey) {
  const turn = state.transcript?.turns.find((other) => other.number === number);
  const field = document.getElementById(`turn-${number}`)?.querySelector(".text");
  if (!turn || !field) return false;
  const all = sentences(turn.text);
  const first = Math.max(0, Math.min(index, all.length - 1));
  const last = Math.max(first, Math.min(first + span - 1, all.length - 1));

  const { start, end } = sharpenEdges(turn.text, all[first][0], all[last][1]);
  if (end - start < 2) return false;
  const shown = showSelection(field, start, end);
  if (!shown) return false;
  select({
    turn: number,
    start,
    end,
    text: turn.text.slice(start, end),
    rect: shown.getBoundingClientRect(),
    interviewer: turn.interviewer,
  });
  // The interviewer's turn is refused inside `select`, and then there is no
  // cursor to leave behind either.
  if (!state.selection) return false;
  state.sentence = { turn: number, index: first, span: last - first + 1, byKey };
  // The arrows only mean something while a sentence is held, so the bar says so
  // only then.
  $("#coding-bar-walk").hidden = !byKey;
  return true;
}

/** The turns that may be coded at all, in reading order. */
function codableTurns() {
  return (state.transcript?.turns ?? []).filter((turn) => !turn.interviewer);
}

/**
 * Walk the material sentence by sentence, across the turn boundary.
 *
 * Stopping at the end of a turn would make the keyboard a half measure: the
 * next passage is usually in the next turn, and the interviewer's turns in
 * between are not codable anyway, so they are stepped over rather than offered
 * and then refused.
 */
function walkSentence(direction) {
  const codable = codableTurns();
  if (!codable.length) return;
  const here = state.sentence;
  if (!here) {
    const start = codable.find((turn) => turn.number >= (state.inFocus ?? turnInWindow() ?? 0));
    const turn = start ?? codable[0];
    return holdSentence(turn.number, direction < 0 ? sentences(turn.text).length - 1 : 0);
  }
  const at = codable.findIndex((turn) => turn.number === here.turn);
  const text = codable[at]?.text ?? "";
  // Extending downwards and then stepping on continues after the whole run.
  const from = direction > 0 ? here.index + here.span - 1 : here.index;
  const next = from + direction;
  if (next >= 0 && next < sentences(text).length) return holdSentence(here.turn, next);

  const neighbour = codable[at + direction];
  if (!neighbour) return;
  holdSentence(neighbour.number, direction > 0 ? 0 : sentences(neighbour.text).length - 1);
}

/** Take up a sentence, follow it with the focus and bring it into view. */
function holdSentence(number, index) {
  if (!showSentences(number, index, 1, true)) return;
  state.inFocus = number;
  showFocus();
  const field = document.getElementById(`turn-${number}`);
  const box = field?.getBoundingClientRect();
  if (box && (box.top < 96 || box.bottom > window.innerHeight - 160)) {
    field.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

/** Take one sentence more or one less into the run. */
function stretchSentence(by) {
  const here = state.sentence;
  if (!here) return;
  showSentences(here.turn, here.index, Math.max(1, here.span + by), true);
}

/**
 * The categories the coding bar currently shows.
 *
 * The digits 1 to 9 cover exactly the deductive start system — the first
 * inductive category would only be reachable with the mouse, which is precisely
 * the one that is new and unfamiliar. Instead of binding further keys, typed
 * letters filter the list; the digit always means the n-th *shown* category.
 */
/**
 * What the keys do, written down where the keys are.
 *
 * The tool has been keyboard-first from the start and said so only in its
 * README — which is the one place a person sitting in front of it is not
 * looking. Every shortcut that exists is listed here, in the language of the
 * interface, one keystroke away from every screen.
 */
const KEYS = [
  {
    title: "keysMove",
    rows: [
      [["j"], "keyTurnNext"],
      [["k"], "keyTurnBack"],
      [["/"], "keySearch"],
      [["Enter"], "keySearchNext"],
    ],
  },
  {
    title: "keysChoose",
    rows: [
      [["s"], "keySentence"],
      [["↓", "↑"], "keyWalk"],
      [["⇧↓", "⇧↑"], "keyStretch"],
      [["2×"], "keyDouble"],
    ],
  },
  {
    title: "keysAssign",
    rows: [
      [["1", "…", "9"], "keyDigit"],
      [["a", "…", "z"], "keyLetters"],
      [["Enter"], "keyEnterOne"],
    ],
  },
  {
    title: "keysGeneral",
    rows: [
      [["Enter"], "keyReview"],
      [["Esc"], "keyEscape"],
      [["?"], "keyHelp"],
    ],
  },
];

/**
 * Bringing a recording's transcript in, without a command line.
 *
 * The converter existed first as a script, which is the right shape for a
 * batch of twenty and the wrong one for the first interview somebody tries:
 * asking a researcher to open a terminal is where a tool gets put aside.
 *
 * Two steps, the same discipline the script keeps. The file is read first and
 * nothing is written; what comes back is how it was read, how many turns it
 * became and who is speaking in it — with the first few turns to look at, so a
 * misreading is visible before a folder exists. Only then is the one question
 * asked that cannot be guessed: which of those speakers was asking.
 */
function openImport() {
  const sheet = $("#import-sheet");
  state.importing = null;
  $("#import-found").hidden = true;
  $("#import-file").value = "";
  $("#import-drop").classList.remove("over");
  if (!sheet.open) sheet.showModal();
}

async function readImport(file) {
  if (!file) return;
  const text = await file.text();
  try {
    const found = await api("/api/import/read", { method: "POST", body: { text } });
    state.importing = { text, ...found, name: file.name };
    showImport(found, file.name);
  } catch (error) {
    notify(error.data?.code === "importNothingRead" ? t("importUnreadable") : error.message, "error");
  }
}

function showImport(found, name) {
  $("#import-summary").textContent = found.speakers.length
    ? t("importFound", {
        format: found.format,
        turns: found.turns,
        speakers: found.speakers.length,
      })
    : t("importFoundNoSpeakers", { format: found.format, turns: found.turns });

  // The first few turns as they will stand in the file. A subtitle file read
  // the wrong way looks obviously wrong here, and costs nothing to look at.
  $("#import-preview").innerHTML = found.preview
    .map(
      (turn) =>
        `<div class="import-turn"><span class="apart-where">${escapeHTML(
          turn.speaker ?? t("importNobody"),
        )}</span><span class="apart-text">${escapeHTML(turn.text)}</span></div>`,
    )
    .join("");

  const who = $("#import-interviewer");
  who.innerHTML =
    `<option value="">${escapeHTML(t("importNobody"))}</option>` +
    found.speakers
      .map((speaker) => `<option value="${escapeHTML(speaker)}">${escapeHTML(speaker)}</option>`)
      .join("");
  // The first voice is usually the one asking, so it is offered — but it is
  // offered, not applied, and the sentence underneath says why that matters.
  if (found.speakers.length) who.value = found.speakers[0];

  /* The file name is the only title anyone has handed over, so it is the
     default — but „Besprechung-2026-08-04" makes a poor heading and a worse
     folder name. Typing a department improves it, as long as the heading has
     not been edited by hand: then it is the author's and stays put. */
  const stem = name.replace(/\.[^.]+$/, "");
  const heading = $("#import-title");
  $("#import-department").value = "";
  heading.value = stem;
  heading.dataset.untouched = "true";
  $("#import-date").value = "";
  $("#import-found").hidden = false;
}

async function writeImport(event) {
  event.preventDefault();
  if (!state.importing) return;
  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const made = await api("/api/import", {
      method: "POST",
      body: {
        text: state.importing.text,
        interviewer: $("#import-interviewer").value,
        department: $("#import-department").value,
        title: $("#import-title").value,
        date: $("#import-date").value,
      },
    });
    $("#import-sheet").close();
    notify(t("importDone", { title: made.title, turns: made.turns }));
    // Straight into what was just made: the point of it was to start coding.
    await loadInterviews();
    state.current = made.interview;
    $("#interview-choice").value = made.interview;
    await loadTranscript();
    setView("code");
    drawAll();
  } catch (error) {
    complain(error);
  } finally {
    button.disabled = false;
  }
}

function openKeys() {
  const sheet = $("#keys-sheet");
  $("#keys-groups").innerHTML = KEYS.map(
    (group) =>
      `<section><h3>${escapeHTML(t(group.title))}</h3><dl>` +
      group.rows
        .map(
          ([keys, what]) =>
            `<dt>${keys
              .map((key) =>
                key === "…" ? `<span class="key-to">…</span>` : `<kbd>${escapeHTML(key)}</kbd>`,
              )
              .join("")}</dt>` + `<dd>${escapeHTML(t(what))}</dd>`,
        )
        .join("") +
      `</dl></section>`,
  ).join("");
  /* Which version this is, where somebody looking for "what is this" already
     goes. It was nowhere in the interface — a person filing an issue had to
     guess, or read a label off a container image. Fetched when the sheet opens
     rather than at boot: it is worth one request when asked for and none of the
     startup path. */
  const stamp = $("#keys-version");
  if (stamp && !stamp.dataset.asked) {
    stamp.dataset.asked = "1";
    api("/api/version")
      .then((about) => {
        stamp.textContent = t("versionLine", { version: about.version, node: about.node });
      })
      .catch(() => {
        stamp.remove();
      });
  }
  if (!sheet.open) sheet.showModal();
}

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
  // Whoever selects afresh — with the mouse, say — puts down the sentence
  // cursor; the arrow keys must not go on walking from somewhere else.
  state.sentence = null;
  $("#coding-bar-walk").hidden = true;
  const bar = $("#coding-bar");
  $("#coding-bar-quote").textContent = quoted(withoutTimestamps(selection.text));
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
  state.sentence = null;
  state.filter = "";
  $("#coding-bar-walk").hidden = true;
  $("#coding-bar").hidden = true;
  document.getSelection()?.removeAllRanges();
}

async function code(categoryId) {
  if (!state.selection) return;
  const { turn, start, end, text } = state.selection;
  // Coding from the keyboard is coding in a row: the cursor goes on to the
  // sentence after the run, so the next unit is one keystroke away instead of
  // sending the hand back to the mouse. A double click keeps its passage.
  const walkOn = state.sentence?.byKey ? { ...state.sentence } : null;
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
    if (walkOn) {
      state.sentence = walkOn;
      walkSentence(1);
      // At the end of the material there is nothing to go on to, and a cursor
      // without a selection would only mislead the next keystroke.
      if (!state.selection) state.sentence = null;
    }
  } catch (error) {
    // On an overlap the message only helps if it says with what.
    const conflict = error.data?.conflict;
    if (!conflict) return complain(error);
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
    complain(error);
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
  // Every note the search could reach, so the ending is trimmed once for all of
  // them rather than note by note — the same rule the transcript search follows.
  const searchable = [
    ...data.progress.map((entry) => entry.memo ?? ""),
    ...(data.categories ?? []).map((category) => category.memo ?? ""),
    ...Object.values(data.citations ?? {})
      .flat()
      .map((citation) => citation.memo ?? ""),
  ].filter((text) => text.trim());
  const wording = effectiveWord(searchable, wanted, language());
  const fits = (text) => !wording.word || occurrences(text, wording.word).length > 0;
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
    `placeholder="${escapeHTML(t("filterPlaceholder"))}">` +
    (wording.instead ? `<span class="instead">${t("searchedInstead", { word: escapeHTML(wording.instead) })}</span>` : "") +
    `</label>` +
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
    complain(error);
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
    complain(error);
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
  const fits = (citation) => matchesSlice(citation, { ...filter, word: wording.word });

  const all = data.rows.flatMap((row) => data.citations[row.category] ?? []);
  const sections = [...new Set(all.map((citation) => citation.sectionName).filter(Boolean))];
  // The wording is settled once across the whole set, exactly as the transcript
  // search settles it: if it finds nothing anywhere, its ending is trimmed and
  // the slice says which term it actually ran with.
  const wording = effectiveWord(
    all.map((citation) => `${citation.text} ${citation.memo ?? ""}`),
    filter.word,
    language(),
  );
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
    `<input type="search" data-filter="word" value="${escapeHTML(filter.word)}" placeholder="${escapeHTML(t("filterPlaceholder"))}">` +
    // Trimming the ending is only allowed if it is said out loud.
    (wording.instead ? `<span class="instead">${t("searchedInstead", { word: escapeHTML(wording.instead) })}</span>` : "") +
    `</label>` +
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

  /* A study of twenty interviews reaches a thousand citations, and the list
     drawn in full is a hundred and thirty metres of scrolling with a select on
     every card. So each category shows its first few and says how many it is
     holding back; the count in the heading is always the true one, and the
     filter above still cuts the whole set. Opening a category keeps it open. */
  const FIRST_FEW = 12;

  /* That cap is per category, and the page is the sum of them. A study with
     twenty categories drew two hundred and forty cards — thirty thousand pixels,
     five sixths of the analysis screen — and put the notes below all of it,
     where nobody was going to scroll. So the categories are groups that fold,
     and they open from the top until this many citations are on the page. One
     category behaves exactly as it did; twenty become a list you can see at
     once and read in the order you choose. A heading that is closed still
     carries its count, so nothing is hidden, only folded. */
  const OPEN_BUDGET = 24;
  let budget = OPEN_BUDGET;
  let folded = false;

  const lists = data.rows
    .map((row) => {
      const own = (data.citations[row.category] ?? []).filter(fits);
      if (!own.length) return "";
      const whole = state.citationsShown.has(row.category) || own.length <= FIRST_FEW;
      const shownHere = whole ? own : own.slice(0, FIRST_FEW);
      // A reader's own click outranks the budget, in both directions.
      const chosen = state.citationsOpen.get(row.category);
      const open = chosen === undefined ? budget > 0 : chosen;
      if (!open) folded = true;
      budget -= shownHere.length;
      return (
        `<details class="citation-group"${open ? " open" : ""}>` +
        `<summary class="citation-head" data-group="${escapeHTML(row.category)}">` +
        `${escapeHTML(row.name)} · ${own.length}` +
        (own.length !== row.sum ? ` <span class="of">${t("ofCount", { n: row.sum })}</span>` : "") +
        `</summary><div class="citations">` +
        shownHere
          .map(
            (citation) =>
              `<div class="citation" style="--mark-color:${color(row.category)}">` +
              `<div class="head-row"><span>${escapeHTML(citation.department)}</span>` +
              `<span>${t("turn")} ${citation.turn}${citation.time ? ` · ${citation.time}` : ""}</span>` +
              `${citation.sectionName ? `<span>${escapeHTML(citation.sectionName)}</span>` : ""}` +
              `${citation.anchor ? `<span>${t("anchorExample")}</span>` : ""}` +
              // This is the list a requirement is built from, one citation at a
              // time. A suggestion nobody has confirmed looked exactly like
              // evidence here, which is the decision it must not be mistaken in.
              `${citation.reviewed ? "" : `<span class="open-mark">${t("unreviewed")}</span>`}` +
              /* The most repeated act of the writing phase, and the tool did
                 nothing for it: quoting a passage meant selecting the words by
                 hand and reassembling the source from the line above, thirty
                 times over a results chapter. */
              `<button type="button" class="button-quiet copy" data-copy="${citation.id}">` +
              `${t("copyCitation")}</button>` +
              `<button type="button" class="button-quiet goto" data-passage="${citation.id}"` +
              ` data-interview="${escapeHTML(citation.interview)}">${t("viewInTranscript")}</button></div>` +
              `<blockquote>${quoted(escapeHTML(citation.text))}</blockquote>` +
              `${citation.memo ? `<p class="memo">${escapeHTML(citation.memo)}</p>` : ""}` +
              requirementRowHTML(citation) +
              `</div>`,
          )
          .join("") +
        (whole
          ? ""
          : `<button type="button" class="button-quiet show-rest" data-show="${escapeHTML(row.category)}">` +
            `${t("showAllCitations", { n: own.length })}</button>`) +
        `</div></details>`
      );
    })
    .join("");

  return (
    `<h3>${t("citationsTitle")}</h3>` +
    controls +
    // Said once, and only when something is actually folded away.
    (folded ? `<p class="column-note">${t("citationGroupsNote")}</p>` : "") +
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
/**
 * Where the material stopped producing anything new.
 *
 * Every qualitative study is asked how it knows it had enough interviews, and
 * the answer expected is that the categories stopped arriving. That is a claim
 * about the coding, and the coding is right here — so it is drawn rather than
 * asserted: how many categories turn up for the first time in each interview,
 * and how many are in play by then.
 *
 * It stops at showing. Where a curve has flattened far enough is a judgement
 * about the material, and no arithmetic makes it — a tool that printed
 * "saturated" would be putting words in a supervisor's mouth.
 */
function saturationChartHTML(data) {
  const points = data.saturation ?? [];
  /* Two interviews cannot show a curve flattening, and a chart that suggests
     one on two points invites a claim the material does not carry. */
  if (points.length < 3 || !points.some((one) => one.total)) return "";

  const WIDTH = 720;
  const LEFT = 42;
  const RIGHT = 16;
  const TOP = 12;
  const PLOT = 150;
  const LABELS = 30;
  const height = TOP + PLOT + LABELS;

  const end = Math.max(1, Math.ceil(Math.max(...points.map((one) => one.total))));
  const step = axisStep(end);
  // One step of headroom, always: the last point carries a "+2" above it, and a
  // curve drawn against the ceiling reads as clipped even when it is not.
  const top = Math.ceil(end / step) * step + (Math.ceil(end / step) * step === end ? step : 0);
  const track = WIDTH - LEFT - RIGHT;
  const gap = points.length > 1 ? track / (points.length - 1) : 0;
  const x = (index) => LEFT + index * gap;
  const y = (value) => TOP + PLOT - (value / top) * PLOT;

  let grid = "";
  for (let tick = 0; tick <= top; tick += step) {
    grid +=
      `<line class="grid" x1="${LEFT}" y1="${y(tick)}" x2="${WIDTH - RIGHT}" y2="${y(tick)}"></line>` +
      `<text class="axis" x="${LEFT - 8}" y="${y(tick) + 4}" text-anchor="end">${tick}</text>`;
  }

  /* A step rather than a straight line between the points: the count changes at
     an interview, not gradually across the space between two of them. */
  let path = `M ${x(0)} ${y(points[0].total)}`;
  points.forEach((one, index) => {
    if (!index) return;
    path += ` L ${x(index)} ${y(points[index - 1].total)} L ${x(index)} ${y(one.total)}`;
  });

  const dots = points
    .map((one, index) => {
      const tip = t("saturationTip", {
        title: one.title,
        fresh: one.fresh,
        total: one.total,
        names: one.names.join(", ") || t("summaryNone"),
      });
      return (
        `<circle class="point saturation-point" cx="${x(index)}" cy="${y(one.total)}" r="${one.fresh ? 5 : 3.5}"` +
        ` data-tip="${escapeHTML(tip)}"></circle>` +
        (one.fresh
          ? `<text class="value" x="${x(index)}" y="${y(one.total) - 10}" text-anchor="middle">+${one.fresh}</text>`
          : "")
      );
    })
    .join("");

  /* Numbered, not named. Two interviews in the same department are ordinary,
     and a department name on the axis twice says nothing about which of them
     stopped adding categories. The position is unambiguous, always fits, and
     the title travels with the dot and stands in the figures below. */
  const marks = points
    .map(
      (one, index) =>
        `<text class="axis" x="${x(index)}" y="${TOP + PLOT + 18}" text-anchor="middle">${index + 1}</text>`,
    )
    .join("");

  const last = points[points.length - 1];
  const quiet = [...points].reverse().findIndex((one) => one.fresh);
  const summary = t("summarySaturation", {
    interviews: points.length,
    total: last.total,
    since: quiet > 0 ? quiet : 0,
  });

  return (
    `<div class="chart-head"><h3 id="saturation-title">${t("chartSaturationTitle")}</h3>` +
    `<button type="button" class="button-quiet" data-svg="saturation" data-file="saturation.svg">${t("saveAsSvg")}</button></div>` +
    chartSummaryHTML("saturation", summary) +
    `<figure class="chart" id="saturation">` +
    `<svg viewBox="0 0 ${WIDTH} ${height}" role="img" aria-labelledby="saturation-title"` +
    ` aria-describedby="saturation-summary" preserveAspectRatio="xMinYMin meet">` +
    grid +
    `<path class="saturation-line" d="${path}" fill="none"></path>` +
    dots +
    marks +
    `</svg>` +
    `<div class="chart-tip" hidden></div>` +
    `<figcaption class="column-note">${t("chartSaturationCaption")}</figcaption>` +
    `</figure>` +
    chartFiguresHTML("saturation", {
      caption: t("saturationFiguresCaption"),
      columns: [
        t("interview"),
        t("saturationFresh"),
        t("saturationTotal"),
        t("saturationWhich"),
      ],
      rows: points.map((one) => [one.title, one.fresh, one.total, one.names.join(", ") || "·"]),
    })
  );
}

/**
 * Which categories keep turning up in the same breath.
 *
 * A category system is meant to separate things, and two categories that are
 * almost never used apart are a question about that system: either the material
 * does not make the distinction, or the coding rule that should keep them apart
 * has not been written yet. That is the one place Mayring asks for such a rule,
 * so this is the tool saying where to look.
 *
 * Ranked, not a matrix: a square of categories is half redundant and the reader
 * has to hunt for the two cells that matter. And ranked by the share rather
 * than the count, because "seven turns" means one thing for a category used
 * eight times and another for one used ninety.
 */
function cooccurrenceHTML(data) {
  const found = data.cooccurrence ?? { pairs: [], turns: {} };
  if (!data.rows.some((row) => row.sum) || data.rows.length < 2) return "";

  if (!found.pairs.length) {
    return (
      `<h3>${t("meetTitle")}</h3>` +
      `<p class="column-note">${t("meetNone")}</p>`
    );
  }

  const shown = found.pairs.slice(0, 12);
  const rows = shown.map((pair) => {
    const rarer = pair.aTurns <= pair.bTurns ? pair : { ...pair, aName: pair.bName, bName: pair.aName, aTurns: pair.bTurns, bTurns: pair.aTurns };
    return [
      `${pair.aName} · ${pair.bName}`,
      pair.together,
      `${Math.round(pair.share * 100)} %`,
      t("meetOfWhich", { name: rarer.aName, n: rarer.aTurns }),
    ];
  });

  return (
    `<h3>${t("meetTitle")}</h3>` +
    `<p class="column-note">${t("meetNote")}</p>` +
    `<div class="table-frame"><table id="meet-table"><thead><tr>` +
    `<th>${t("meetPair")}</th><th class="num">${t("meetTogether")}</th>` +
    `<th class="num">${t("meetShare")}</th><th>${t("meetOf")}</th>` +
    `</tr></thead><tbody>` +
    rows
      .map(
        ([pair, together, share, of]) =>
          `<tr><th scope="row">${escapeHTML(pair)}</th>` +
          `<td class="num">${together}</td><td class="num">${share}</td>` +
          `<td>${escapeHTML(of)}</td></tr>`,
      )
      .join("") +
    `</tbody></table></div>` +
    (found.pairs.length > shown.length
      ? `<p class="column-note">${escapeHTML(t("meetMore", { n: found.pairs.length - shown.length }))}</p>`
      : "")
  );
}

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
/**
 * The key of a chart, read off the legend beside it.
 *
 * The legend is HTML above the picture, so the saved file had three colours and
 * nothing saying which department each one is — a stacked bar chart without a
 * key is not a figure anybody can put in a paper. It is drawn into the copy
 * instead, in the order it stands on screen: an `i` is a swatch, a `span` is
 * what it means, and the ramp of the heatmap is both in turn.
 */
function legendEntriesFor(figure) {
  // Not the immediate sibling: the summary for a screen reader sits between the
  // legend and the picture, and looking only one step back found nothing.
  let legend = figure?.previousElementSibling ?? null;
  while (legend && !legend.classList.contains("chart-legend")) {
    legend = legend.classList.contains("chart-head") ? null : legend.previousElementSibling;
  }
  if (!legend) return [];
  const entries = [];
  for (const child of legend.children) {
    if (child.tagName === "I") {
      entries.push({ colour: getComputedStyle(child).backgroundColor, label: "", width: 14 });
      continue;
    }
    const swatch = child.querySelector("i");
    entries.push({
      colour: swatch ? getComputedStyle(swatch).backgroundColor : null,
      label: child.textContent.trim(),
      width: Math.ceil(child.getBoundingClientRect().width),
    });
  }
  return entries.filter((entry) => entry.colour || entry.label);
}

/**
 * The key drawn into the copy, and how much room it took.
 *
 * Built as elements rather than as a string of markup: a font stack carries
 * quotation marks of its own, and putting one inside a `style="…"` attribute
 * tears the attribute in half — which is exactly what happened, and showed up
 * as a legend set in the wrong face at the wrong size.
 *
 * The widths come from the legend on screen, which has already been laid out by
 * the browser, rather than from a guess at how wide a character is.
 */
function drawLegendInto(copy, entries, width, ink, font) {
  if (!entries.length) return 0;
  const SVG = "http://www.w3.org/2000/svg";
  const SIZE = 9;
  const GAP = 14;
  const LINE = 18;
  let x = 0;
  let y = 12;

  for (const entry of entries) {
    if (x && x + entry.width > width) {
      x = 0;
      y += LINE;
    }
    if (entry.colour) {
      const swatch = document.createElementNS(SVG, "rect");
      swatch.setAttribute("x", x);
      swatch.setAttribute("y", y - SIZE + 1);
      swatch.setAttribute("width", SIZE);
      swatch.setAttribute("height", SIZE);
      swatch.setAttribute("rx", 2);
      swatch.style.setProperty("fill", entry.colour);
      copy.append(swatch);
      x += SIZE + 5;
    }
    if (entry.label) {
      const text = document.createElementNS(SVG, "text");
      text.setAttribute("x", x);
      text.setAttribute("y", y);
      text.style.setProperty("fill", ink);
      text.style.setProperty("font-family", font);
      text.style.setProperty("font-size", "10px");
      text.textContent = entry.label;
      copy.append(text);
      x += entry.width - (entry.colour ? SIZE + 5 : 0);
    }
    x += GAP;
  }
  return y + 8;
}

/**
 * What a stylesheet can change about a drawn element.
 *
 * The saved file used to carry a hand-picked six — fill, stroke, stroke width
 * and three font properties — and a hand-picked list is exactly the kind of
 * thing that falls behind the stylesheet it was written for. It had:
 * `stroke-linejoin` was not on it, so a line drawn with round joins was saved
 * with mitred ones, and nothing about the file looked wrong.
 *
 * This is the closed set from the SVG specification instead of the set this
 * stylesheet happens to use today, so a rule added tomorrow is carried without
 * anyone remembering to add it here.
 */
const PAINTED = [
  "fill", "fill-opacity", "fill-rule",
  "stroke", "stroke-opacity", "stroke-width", "stroke-linecap", "stroke-linejoin",
  "stroke-dasharray", "stroke-dashoffset", "stroke-miterlimit",
  "opacity", "color", "visibility", "display", "mix-blend-mode", "paint-order",
  "font-family", "font-size", "font-weight", "font-style", "font-variant",
  "letter-spacing", "word-spacing",
  "text-anchor", "text-decoration", "text-transform", "dominant-baseline",
];

function saveChart(id, file) {
  const svg = document.querySelector(`#${id} svg`);
  if (!svg) return;
  const copy = svg.cloneNode(true);
  const originals = svg.querySelectorAll("*");
  const copies = copy.querySelectorAll("*");
  originals.forEach((element, index) => {
    const style = getComputedStyle(element);
    /* Every one of them on every element, rather than only where the value
       looks unusual. Leaving a property out is safe only if nothing in the
       saved file would give the element a different one, and inheritance makes
       that a question about ancestors — a cleverness that would be one more
       thing to get subtly wrong in a file nobody checks by eye. */
    for (const property of PAINTED) {
      const value = style.getPropertyValue(property);
      if (value) copies[index].style.setProperty(property, value);
    }
  });
  /* The key goes into the file, because it is not in the picture: it is HTML
     next to it, and a saved chart has to say what its colours mean on its own.
     What was already drawn moves down to make room. */
  const page = getComputedStyle(document.body);
  const [, , width, height] = copy.getAttribute("viewBox").split(/\s+/).map(Number);
  const entries = legendEntriesFor(document.getElementById(id));
  if (entries.length) {
    const moved = document.createElementNS("http://www.w3.org/2000/svg", "g");
    while (copy.firstChild) moved.append(copy.firstChild);
    const used = drawLegendInto(copy, entries, width, page.color, page.fontFamily);
    moved.setAttribute("transform", `translate(0 ${used})`);
    copy.append(moved);
    copy.setAttribute("viewBox", `0 0 ${width} ${height + used}`);
  }

  // A ground plane in the theme color, so that the file is readable on its own.
  const ground = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  ground.setAttribute("width", "100%");
  ground.setAttribute("height", "100%");
  ground.setAttribute("fill", page.backgroundColor);
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

/* Paper is a document, and nothing on it can be clicked open. A folded group
   would print as a heading with nothing under it, and a capped list as twelve
   of forty without saying which. So everything opens for the print and folds
   back the way the reader had it. */
let foldsBeforePrint = null;

addEventListener("beforeprint", () => {
  if (!document.getElementById("citations-part") || foldsBeforePrint) return;
  foldsBeforePrint = {
    shown: new Set(state.citationsShown),
    open: new Map(state.citationsOpen),
  };
  for (const row of document.querySelectorAll("summary[data-group]")) {
    state.citationsShown.add(row.dataset.group);
    state.citationsOpen.set(row.dataset.group, true);
  }
  drawCitations();
});

addEventListener("afterprint", () => {
  if (!foldsBeforePrint) return;
  state.citationsShown = foldsBeforePrint.shown;
  state.citationsOpen = foldsBeforePrint.open;
  foldsBeforePrint = null;
  drawCitations();
});

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

  /* The figures below leave out whatever lost its place, and a total that
     quietly got smaller is the kind of thing nobody notices until a reviewer
     does. So it is said, with the number, above everything it affects. */
  const heading =
    `<h2>${t("analysis")}</h2><p class="lead">${t("analysisLead")}</p>` +
    (data.displaced
      ? `<p class="drift-line" role="status">${escapeHTML(t("analysisDisplaced", { n: data.displaced }))}</p>`
      : "");

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

  /* Named here rather than left to be found in the appendix. Mayring asks every
     category for a definition, an anchor example and — where the boundary is
     unclear — a coding rule; the guide writes the gap where one is missing, and
     the gap is far cheaper to close before the export than after it. A category
     nothing has been coded with yet is not counted: there is nothing it could
     have been anchored in. */
  const unanchored = data.rows.filter((row) => row.sum > 0 && !row.anchors);

  /* What would make the documents about to be written incomplete, said where
     somebody is standing when they think they are finished. Each of these is
     already visible somewhere — in the status bar, in the category panel — but
     scattered across three views, and the question "am I done" is asked once,
     here, with a hand on the export button. Nothing is repeated from the top of
     this page: what lost its place is named there and does not need saying
     twice on the same screen. */
  const open = [];
  const unreviewed = Object.values(data.citations)
    .flat()
    .filter((citation) => citation.reviewed !== true).length;
  // One of a thing is not "1 things"; the tool speaks two languages and a
  // number glued to a plural is the first place that shows.
  if (unreviewed) {
    open.push(t(unreviewed === 1 ? "openUnreviewedOne" : "openUnreviewed", { n: unreviewed }));
  }
  if (unanchored.length) {
    const names = unanchored.map((row) => row.name).join(", ");
    open.push(
      t(unanchored.length === 1 ? "anchorsMissingOne" : "anchorsMissing", {
        n: unanchored.length,
        names,
      }),
    );
  }
  const silent = data.progress.filter((entry) => !entry.codings);
  if (silent.length) {
    open.push(
      t(silent.length === 1 ? "openUncodedOne" : "openUncoded", {
        n: silent.length,
        names: silent.map((entry) => entry.title).join(", "),
      }),
    );
  }
  const missing = open.length
    ? `<ul class="still-open">${open.map((line) => `<li>${escapeHTML(line)}</li>`).join("")}</ul>`
    : "";

  /* Grouped by where each document goes.
     Eight buttons in a row said nothing about which of them belong in the
     methods chapter and which in the appendix, so the reader had to open each
     one to find out — and the two that describe how the study was done are
     exactly the ones a first-time author does not know to look for. */
  const link = (file, label) =>
    `<a class="button-quiet" href="${exportHref(`/api/export/${file}`)}" download>${label}</a>`;

  const forMethod =
    link("sample.md", t("exportSample")) +
    link("coding-guide.md", t("exportCodingGuide")) +
    link("analysis.md", t("exportAnalysis")) +
    link("agreement.md", t("exportAgreement"));

  /* Named by department, this row read "Kodiertabelle Marketing" three times in
     a study with three interviews from marketing: three links to three
     different documents, and nothing on any of them to say which. The title is
     what names an interview everywhere else in the tool, so it names it here. */
  const forAppendix =
    data.progress
      .map((entry) =>
        link(
          `coding-table/${encodeURIComponent(entry.interview)}.md`,
          `${t("exportCodingTable")} · ${escapeHTML(entry.title)}`,
        ),
      )
      .join("") + link("notes.md", t("exportNotes"));

  /* Everything above leaves as a document for a reader. This leaves as a
     project for a program: the study whole, in the format MAXQDA, ATLAS.ti,
     NVivo and QualCoder read. It is the check on the promise the README makes
     — that the work is not locked in here — and a promise nobody can test is
     not one. */
  const forElsewhere =
    `<a class="button-quiet" href="${exportHref("/api/export/project.qdpx")}" download>` +
    `${t("exportProject")}</a>`;

  const exports =
    // Marked as one block so that printing can drop the heading with the links;
    // a heading whose only content is buttons is not a section on paper.
    `<div class="exports-part"><h3>${t("exports")}</h3>${missing}` +
    `<p class="column-note exports-where">${t("exportsForMethod")}</p>` +
    `<div class="exports">${forMethod}</div>` +
    `<p class="column-note exports-where">${t("exportsForAppendix")}</p>` +
    `<div class="exports">${forAppendix}</div>` +
    `<p class="column-note exports-where">${t("exportsForElsewhere")}</p>` +
    `<div class="exports">${forElsewhere}</div></div>`;

  root.innerHTML =
    heading +
    metrics +
    categoryChartHTML(data) +
    heatmapHTML(data) +
    matrix +
    progress +
    saturationChartHTML(data) +
    cooccurrenceHTML(data) +
    `<section id="agreement-part"></section>` +
    exports +
    `<section id="citations-part">${citationsHTML(data, color)}</section>` +
    `<section id="notes-part">${notesHTML(data)}</section>`;

  fitAngledHeadings(root.querySelector("#heatmap svg"));
  markScrollableTables(root);
  drawAgreement();
}

/**
 * How far a second coder read the material the same way.
 *
 * Fetched on its own and filled in afterwards, because it reads another file
 * per interview folder and most studies have none: the analysis must not wait
 * on a question that, for them, has no answer.
 *
 * The percentage of the material a study can show as independently coded is the
 * quality criterion Mayring asks for, and the number is worthless without its
 * unit. So the unit stands in the panel, not in a footnote, and beside kappa
 * are the raw agreement and the four counts it was computed from — a kappa near
 * zero on a table that is almost all „neither" says more about the measure than
 * about the coders.
 */
async function drawAgreement() {
  const root = $("#agreement-part");
  if (!root) return;
  let data;
  try {
    data = await api("/api/agreement");
  } catch {
    return;
  }
  state.agreement = data;
  if (!data.coders.length && !data.problems.length) {
    // Nothing to compare is the normal case, and it is where the feature has to
    // explain itself: whoever has never done a second coding does not know that
    // dropping one file in the folder is all it takes.
    root.innerHTML =
      `<h3>${t("agreementTitle")}</h3>` +
      `<p class="lead">${t("agreementNone")}</p>` +
      handoverHTML();
    connectHandover();
    return;
  }

  root.innerHTML =
    `<h3>${t("agreementTitle")}</h3>` +
    `<p class="lead">${t("agreementUnit")}</p>` +
    data.problems.map((problem) => `<p class="drift-line">${escapeHTML(problem.text)}</p>`).join("") +
    data.comparisons.map(comparisonHTML).join("") +
    handoverHTML();
  connectHandover();
  markScrollableTables(root);
}

/**
 * Handing a coding over, and taking one in.
 *
 * The comparison reads `coding.<name>.json` beside `coding.json`, and getting
 * one there was a copy per interview folder with an exact name: eighteen of them
 * for a study of eighteen, and one typed wrong is silently "no second coding".
 * Nothing about where the files live changes — this only does the copying.
 */
function handoverHTML() {
  return (
    `<div class="handover">` +
    `<p class="column-note">${t("handoverNote")}</p>` +
    // Its own class: `exports` belongs to the documents block above, and
    // borrowing it here put these two buttons into that block's counts.
    `<p class="handover-actions">` +
    `<a class="button-quiet" id="handover-out" download href="${exportHref("/api/export/coding.json")}">` +
    `${t("handoverExport")}</a>` +
    `<button type="button" class="button-quiet" id="handover-choose">${t("handoverImport")}</button>` +
    `</p>` +
    `<input type="file" id="handover-file" accept=".json,application/json" hidden>` +
    `</div>`
  );
}

function connectHandover() {
  $("#handover-choose")?.addEventListener("click", () => $("#handover-file").click());
  $("#handover-file")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const bundle = JSON.parse(await file.text());
      /* The name comes from the file it was handed over in, or from the file
         name it arrived as — `coding.anna.json` from a mail attachment still
         says who it was. */
      const name = bundle.coder || file.name.replace(/^coding\.?/i, "").replace(/\.json$/i, "");
      const answer = await api("/api/codings/second", { method: "POST", body: { bundle, name } });
      await drawAgreement();
      notify(
        answer.missing.length
          ? t("handoverSome", { n: answer.written.length, missing: answer.missing.length })
          : t("handoverDone", { n: answer.written.length }),
      );
    } catch (error) {
      complain(error.key ? error : Object.assign(error, { message: t("errorBundleUnreadable") }));
    }
  });
}

/** A number that may not exist, said as such rather than as a nought. */
const asShare = (value) => (value == null ? "—" : `${(value * 100).toFixed(0)} %`);
const asKappa = (value) => (value == null ? "—" : value.toFixed(2));

function comparisonHTML(one) {
  const { cells } = one;
  const named = t(`agreementBand${one.band ? one.band[0].toUpperCase() + one.band.slice(1) : "None"}`);
  const covered = one.covered.map((entry) => entry.title).join(", ");

  const summary =
    `<div class="metrics agreement-metrics">` +
    `<div class="metric"><div class="value">${asKappa(one.kappa)}</div>` +
    `<span class="label">${t("agreementKappa")}</span></div>` +
    `<div class="metric"><div class="value">${asShare(one.agreement)}</div>` +
    `<span class="label">${t("agreementRaw")}</span></div>` +
    `<div class="metric"><div class="value">${one.units}</div>` +
    `<span class="label">${t("agreementUnits")}</span></div>` +
    `<div class="metric"><div class="value">${one.covered.length}</div>` +
    `<span class="label">${t("agreementInterviews")}</span></div>` +
    `</div>`;

  // The four counts, because kappa alone cannot be read: the same coefficient
  // means different things on a balanced table and on a nearly empty one.
  const counts =
    `<div class="table-frame"><table class="agreement-cells"><thead><tr>` +
    `<th>${t("agreementCell")}</th><th class="num">${t("agreementCount")}</th></tr></thead><tbody>` +
    [
      ["agreementBoth", cells.both],
      ["agreementNeither", cells.neither],
      ["agreementOnlyFirst", cells.onlyFirst],
      ["agreementOnlySecond", cells.onlySecond],
    ]
      .map(
        ([key, value]) =>
          `<tr><th scope="row">${escapeHTML(t(key, { coder: one.coder }))}</th>` +
          `<td class="num">${value}</td></tr>`,
      )
      .join("") +
    `</tbody></table></div>`;

  const byCategory =
    `<div class="table-frame"><table><thead><tr><th>${t("category")}</th>` +
    `<th class="num">${t("agreementApart")}</th><th class="num">${t("agreementKappa")}</th>` +
    `</tr></thead><tbody>` +
    one.byCategory
      .map(
        (row) =>
          `<tr><th scope="row">${escapeHTML(row.name)}</th>` +
          `<td class="num">${row.disagreed}</td>` +
          `<td class="num">${asKappa(row.kappa)}</td></tr>`,
      )
      .join("") +
    `</tbody></table></div>`;

  const apart = one.disagreements.length
    ? `<details class="agreement-apart"><summary>${escapeHTML(
        t("agreementApartOpen", { n: one.disagreements.length }),
      )}</summary><p class="column-note">${t("agreementApartNote")}</p><ul class="apart-list">` +
      one.disagreements
        .slice(0, 60)
        .map(
          (entry) =>
            `<li><span class="apart-where">${escapeHTML(entry.interviewTitle)} · ` +
            `${t("turn")} ${entry.turn}</span>` +
            // Both readings side by side: that is the question the round settles.
            `<span class="apart-what">${escapeHTML(
              t("agreementSideHere", { categories: entry.first.join(", ") || t("agreementNothing") }),
            )} · ${escapeHTML(
              t("agreementSideThere", {
                coder: one.coder,
                categories: entry.second.join(", ") || t("agreementNothing"),
              }),
            )}</span>` +
            `<span class="apart-text">${escapeHTML(passage(entry.text, 160))}</span></li>`,
        )
        .join("") +
      `</ul>${
        one.disagreements.length > 60
          ? `<p class="column-note">${escapeHTML(
              t("agreementApartMore", { n: one.disagreements.length - 60 }),
            )}</p>`
          : ""
      }</details>`
    : `<p class="column-note">${t("agreementApartNone")}</p>`;

  return (
    `<section class="agreement-one"><h4>${escapeHTML(t("agreementWith", { coder: one.coder }))}</h4>` +
    `<p class="column-note">${escapeHTML(t("agreementReads", { band: named }))}</p>` +
    summary +
    `<p class="column-note">${escapeHTML(t("agreementCovered", { interviews: covered }))}</p>` +
    (one.skipped.length
      ? `<p class="column-note">${escapeHTML(
          t("agreementSkipped", { interviews: one.skipped.map((e) => e.title).join(", ") }),
        )}</p>`
      : "") +
    `<div class="agreement-tables">${counts}${byCategory}</div>` +
    apart +
    `</section>`
  );
}

/** A quotation cut to length without cutting a word in half. */
function passage(text, length) {
  const clean = text.replace(/\s*\[\d+:\d{2}\]\s*/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length <= length) return clean;
  const cut = clean.slice(0, length);
  return `${cut.slice(0, cut.lastIndexOf(" "))} …`;
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
    complain(error);
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
    complain(error);
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
  const maxX = Math.max(1, departmentCount);
  const maxY = OPERATIONS.length;

  // Group by coordinate. Both axes count whole things, so several requirements
  // sharing one point is the normal case rather than the exception.
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
  // One slot for the widest dot in the chart plus a gap, so the packing is the
  // same everywhere and two piles can be compared by eye.
  const slot = radius(maxCitations) * 2 + 3;

  /* The right-hand margin has to hold whatever sits on the last gridline, and
     that is the common case rather than the exception: a requirement every
     department named lands exactly there. The margin and the step depend on
     each other — a pile may be no wider than its own cell — so they are settled
     by running the layout twice, which is enough to converge. */
  let RIGHT = Math.ceil(10 + radius(maxCitations));
  let stepX = (WIDTH - LEFT - RIGHT) / maxX;
  let placed = new Map();
  for (let pass = 0; pass < 2; pass += 1) {
    stepX = (WIDTH - LEFT - RIGHT) / maxX;
    placed = new Map(
      [...buckets].map(([key, bucket]) => [key, layoutBucket(bucket.length, { slot, stepX })]),
    );
    const onLastLine = [...buckets.keys()].filter((key) => Number(key.split("|")[0]) === maxX);
    const reach = Math.max(0, ...onLastLine.map((key) => placed.get(key).width / 2));
    RIGHT = Math.ceil(10 + radius(maxCitations) + reach);
  }

  // A pile that wrapped into rows needs the room to do it in; the cell grows
  // rather than the dots being drawn on top of each other.
  const tallest = Math.max(0, ...[...placed.values()].map((one) => one.height));
  const CELL = Math.max(46, Math.ceil(tallest + 8));
  const height = TOP + maxY * CELL + BOTTOM;

  const track = WIDTH - LEFT - RIGHT;
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

  const points = [...buckets.entries()]
    .flatMap(([key, bucket]) =>
      bucket.map((entry, index) => {
        const place = placed.get(key).places[index];
        const cx = x(entry.cx) + place.dx;
        const cy = y(entry.cy) + place.dy;
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

  /* The counts above name what is unfinished — without a level, without a
     citation, resting on suggestions — and at twenty requirements the list is
     several screens long. Naming them without a way to reach them is only half
     the job, so the same three are also a filter. */
  const slice = state.catalogFilter;
  const fitsSlice = (requirement) =>
    (!slice.open || !MOSCOW_ORDER.includes(requirement.moscow)) &&
    (!slice.unsupported || requirement.citations.length === 0) &&
    (!slice.unreviewed || requirement.citations.some((citation) => !citation.reviewed));
  const showing = state.requirements.filter(fitsSlice);
  const active = slice.open || slice.unsupported || slice.unreviewed;

  const box = (name, label) =>
    `<label class="box"><input type="checkbox" data-catalog-filter="${name}"` +
    `${slice[name] ? " checked" : ""}> ${label}</label>`;
  const filter =
    `<div class="citation-filter" id="catalog-filter">` +
    box("open", t("withoutLevel")) +
    box("unsupported", t("withoutCitation")) +
    box("unreviewed", t("restingOnSuggestions")) +
    (active
      ? `<button type="button" class="button-quiet" id="catalog-filter-clear">` +
        `${t("clearSlice", { shown: showing.length, all: state.requirements.length })}</button>`
      : `<span class="filter-status">${state.requirements.length} ` +
        `${plural(state.requirements.length, "requirementOne", "requirementMany")}</span>`) +
    `</div>`;

  const cards = showing
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
            // What the export says, the screen says too: evidence nobody has
            // confirmed is a suggestion and carries no weight.
            (citation.reviewed ? "" : `<span class="open-mark">${t("unreviewed")}</span>`) +
            `<button type="button" class="button-quiet goto" data-passage="${citation.id}"` +
            ` data-interview="${escapeHTML(citation.interview)}">${t("viewInTranscript")}</button></span>` +
            `<blockquote>${quoted(escapeHTML(citation.text))}</blockquote></li>`,
        )
        .join("");

      return (
        `<article class="requirement" data-id="${requirement.id}" data-title="${escapeHTML(requirement.title)}">` +
        `<header>` +
        `<input type="text" class="title" value="${escapeHTML(requirement.title)}" aria-label="${escapeHTML(t("title"))}">` +
        `<select class="level" aria-label="${escapeHTML(t("moscowAria"))}"><option value="">${t("open")}</option>${levels}</select>` +
        `<button type="button" class="button-quiet remove" data-remove>${t("remove")}</button>` +
        `</header>` +
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
        /* Last on the card, after what the requirement is: an action reads as
           an action there, and between the title and the figures it read as
           part of the description of the thing. */
        /* Folded away, the way the category panel folds its own merge.
           Dissolving one requirement into another is the thing you do once,
           when you notice two of them are one — and it stood open on every card
           in the catalog, two lines apiece, pushing the evidence and the
           description down the screen. At twenty requirements that is forty
           lines of a control nobody was reaching for. */
        (state.requirements.length > 1
          ? `<details class="requirement-merge"><summary>${t("mergeInto")}</summary>` +
            `<div class="row">` +
            `<select class="requirement-target" aria-label="${escapeHTML(t("targetRequirementAria"))}">` +
            `<option value="">${t("chooseTarget")}</option>` +
            state.requirements
              .filter((other) => other.id !== requirement.id)
              .map((other) => `<option value="${other.id}">${escapeHTML(other.title)}</option>`)
              .join("") +
            `</select>` +
            `<button type="button" class="button-quiet" data-requirement-merge>${t("merge")}</button>` +
            `</div></details>`
          : "") +
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
    filter +
    `<div class="catalog-list">${cards || `<p class="empty-state">${t("noRequirementInSlice")}</p>`}</div>` +
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
/** Suggestions still open in the other interviews of the study. */
function elsewhereUnreviewed() {
  return state.interviews
    .filter((interview) => interview.id !== state.current)
    .reduce((n, interview) => n + (interview.unreviewed ?? 0), 0);
}

/** The next interview that still holds suggestions, in the order of the list. */
function nextOpenInterview() {
  const order = state.interviews;
  const from = order.findIndex((interview) => interview.id === state.current);
  for (let step = 1; step <= order.length; step++) {
    const candidate = order[(from + step) % order.length];
    if (candidate.id !== state.current && candidate.unreviewed > 0) return candidate.id;
  }
  return null;
}

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
    /* „Every coding unit is reviewed" is the sentence somebody reads just
       before they start writing up, and it was said about the interview on
       screen while the study still carried suggestions elsewhere. The status
       bar has said which of the two it means for a while; the message that is
       actually in the reader's eye at that moment did not. */
    const elsewhere = elsewhereUnreviewed();
    return notify(
      elsewhere ? t("interviewReviewedOthersOpen", { n: elsewhere }) : t("everyUnitReviewed"),
    );
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
    complain(error);
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
  drawTranscriptProblems();
  drawDrift();
  drawSections();
  drawCategories();
  drawDetail();
  // The picker carries a count, and a count that is only right until the next
  // confirmation is worse than none.
  drawInterviewList();
}

function setView(name) {
  state.view = name;
  $$(".tab").forEach((tab) => tab.setAttribute("aria-current", String(tab.dataset.view === name)));
  $("#view-code").hidden = name !== "code";
  $("#view-catalog").hidden = name !== "catalog";
  $("#view-analysis").hidden = name !== "analysis";
  if (name === "analysis") drawAnalysis().catch((error) => complain(error));
  if (name === "catalog") drawCatalog().catch((error) => complain(error));
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

  $("#keys").addEventListener("click", openKeys);

  $("#import").addEventListener("click", openImport);
  $("#import-close").addEventListener("click", () => $("#import-sheet").close());
  $("#import-file").addEventListener("change", (event) => readImport(event.target.files[0]));
  $("#import-form").addEventListener("submit", writeImport);
  $("#import-title").addEventListener("input", (event) => {
    delete event.target.dataset.untouched;
  });
  $("#import-department").addEventListener("input", (event) => {
    const heading = $("#import-title");
    if (heading.dataset.untouched !== "true") return;
    const named = event.target.value.trim();
    heading.value = named ? t("importHeadingFor", { department: named }) : "";
  });

  const drop = $("#import-drop");
  for (const name of ["dragenter", "dragover"]) {
    drop.addEventListener(name, (event) => {
      event.preventDefault();
      drop.classList.add("over");
    });
  }
  for (const name of ["dragleave", "drop"]) {
    drop.addEventListener(name, () => drop.classList.remove("over"));
  }
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    readImport(event.dataTransfer?.files?.[0]);
  });
  /* A category system from another program. The export sends a study out; this
     brings back the one part of a study that can honestly come back, so the
     answer only ever mentions categories. */
  $("#codebook-choose").addEventListener("click", () => $("#codebook-file").click());
  $("#codebook-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      // In chunks: a whole .qdpx spread over the argument list of one call is
      // how you find the stack limit of somebody else's browser.
      for (let at = 0; at < bytes.length; at += 8192) {
        binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
      }
      const answer = await api("/api/categories/codebook", {
        method: "POST",
        body: { file: btoa(binary) },
      });
      state.categories = answer.categories;
      state.propositions = answer.propositions;
      $("#codebook-shell").open = false;
      drawAll();
      const skipped = answer.skipped.length;
      notify(
        answer.added.length === 0
          ? t("codebookNothingNew", { skipped })
          : skipped
            ? t("codebookReadSome", { n: answer.added.length, skipped })
            : t("codebookRead", { n: answer.added.length }),
      );
    } catch (error) {
      complain(error);
    }
  });

  $("#keys-close").addEventListener("click", () => $("#keys-sheet").close());

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
      complain(error);
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
    // While the sheet is open the keys are the dialog's: Escape closes it, and
    // nothing behind it may quietly act on a keystroke meant for the list.
    if ($("#keys-sheet").open) return;
    if (event.key === "?" && !event.target.matches("input, textarea, select")) {
      event.preventDefault();
      return openKeys();
    }
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
      // The one act the tool exists for used to need a mouse: a passage can
      // only be chosen by dragging over it. „s" takes up the first sentence of
      // the turn in focus, and from there the arrows do the walking.
      if (event.key === "s" && state.view === "code") {
        event.preventDefault();
        return walkSentence(1);
      }
      // Review: Enter confirms the chosen passage and moves on; without a
      // chosen one it starts at the first unreviewed.
      if (event.key === "Enter" && state.view === "code") {
        event.preventDefault();
        return state.selected ? confirmAndContinue() : jumpToUnreviewed();
      }
      return;
    }

    // Walking and stretching belong to the sentence cursor. A selection dragged
    // with the mouse has no cursor, and the arrows then stay the browser's.
    if (state.sentence && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const forward = event.key === "ArrowDown";
      return event.shiftKey ? stretchSentence(forward ? 1 : -1) : walkSentence(forward ? 1 : -1);
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

  $("#status").addEventListener("click", async (event) => {
    if (event.target.id === "review") return jumpToUnreviewed();
    if (event.target.id === "review-elsewhere") {
      const next = nextOpenInterview();
      if (!next) return drawAll();
      state.current = next;
      $("#interview-choice").value = next;
      localStorage.setItem(STORAGE.interview, next);
      await loadTranscript();
      drawAll();
      return jumpToUnreviewed();
    }
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
      complain(error);
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
        .catch((error) => complain(error));
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
          // Asked for, not assumed: the server decides whether it may be
          // granted, because only it knows whether anything has been coded.
          origin: startSystemOpen() ? "deductive" : "inductive",
        },
      });
      $("#inductive-name").value = "";
      $("#inductive-definition").value = "";
      await loadCategories();
      drawCategories();
      notify(t(startSystemOpen() ? "startSystemAdded" : "inductiveAdded", { name }));
    } catch (error) {
      complain(error);
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
      complain(error);
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
      complain(error);
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

/**
 * A citation on the clipboard, in the shape it goes into a text.
 *
 * The same wording the exports use — the quotation, then where it is from —
 * because a quotation copied from the screen and one lifted from the appendix
 * have to be the same string, or the two disagree in the finished document.
 */
async function copyCitation(id) {
  const citation = Object.values(state.analysis?.citations ?? {})
    .flat()
    .find((one) => one.id === id);
  if (!citation) return;
  const text = `${quoted(citation.text)} (${citation.department}, ${t("turn")} ${citation.turn})`;
  try {
    await navigator.clipboard.writeText(text);
    notify(t("citationCopied"));
  } catch {
    // Refused by the browser, which happens over plain HTTP on another host.
    // Saying so beats a button that looks as though it worked.
    notify(t("citationNotCopied"), "error");
  }
}

  $("#analysis").addEventListener("click", async (event) => {
    const rest = event.target.closest("[data-show]");
    if (rest) {
      state.citationsShown.add(rest.dataset.show);
      return drawCitations();
    }
    /* The browser folds the group itself; this only records the choice so the
       next redraw — a filter, a requirement linked — keeps it that way. */
    const group = event.target.closest("summary[data-group]");
    if (group) {
      const details = group.parentElement;
      state.citationsOpen.set(group.dataset.group, !details.open);
      return;
    }
    const copy = event.target.closest("[data-copy]");
    if (copy) return copyCitation(copy.dataset.copy);
    const unlink = event.target.closest("[data-unlink]");
    if (unlink) {
      const { unlink: id, citation, interview } = unlink.dataset;
      return assign(interview, citation, (before) => before.filter((other) => other !== id));
    }
    if (event.target.id !== "filter-clear") return;
    state.citationFilter = { ...EMPTY_SLICE };
    drawCitations();
  });

  catalog.addEventListener("change", (event) => {
    const box = event.target.closest("[data-catalog-filter]");
    if (!box) return;
    state.catalogFilter[box.dataset.catalogFilter] = box.checked;
    drawCatalog().catch((error) => complain(error));
  });

  catalog.addEventListener("click", async (event) => {
    if (event.target.id === "catalog-filter-clear") {
      state.catalogFilter = { open: false, unsupported: false, unreviewed: false };
      return drawCatalog().catch((error) => complain(error));
    }
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
        complain(error);
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
      complain(error);
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
      complain(error);
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
      complain(error);
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
    cannotStart(error);
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

start();
