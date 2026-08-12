/*
  Interface of the coding tool.

  The core is the conversion between the selection in the browser and the
  character positions inside a speaker turn, because only those positions are
  stable enough to be stored next to the transcript. Everything else hangs off
  them: highlight, apparatus, citation and export.
*/

import {
  FONTS,
  categoryChart,
  cityPlot,
  coverageChart,
  estimateWidth,
  heatmapChart,
  moscowBand,
  pillarChart,
  priorityField,
  reachChart,
  saturationChart,
  standalone,
  voicesChart,
} from "./charts.js";
import { effectiveWord, matchesSlice, occurrences, trimStem } from "./search.js";
import { sentenceAt, sentences } from "./sentences.js";
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
  viewPosition: (view) => `fundstelle.viewPosition.${view}`,
};

/* The address ------------------------------------------------------------
   Until now the tool held its place only in memory. A reload landed back in
   the coding view whatever one had been reading, the browser's back button
   left the tool altogether, and a colleague could not be pointed at the
   evaluation — the address said nothing about where one was standing.

   The hash carries it: which of the four views is open, and, where the view
   is about a single interview, which one. The hash and not a path, because
   the same file is served under every address and a path would have to be
   taught to the server, the service worker and the offline cache alike. */

const VIEWS = ["code", "catalog", "roles", "analysis"];

function readRoute() {
  const [, view, interview] = (location.hash || "").split("/");
  return {
    view: VIEWS.includes(view) ? view : null,
    interview: interview ? decodeURIComponent(interview) : null,
  };
}

/**
 * The interview belongs in the address only where the view is about one. The
 * catalogue and the evaluation read the whole study; carrying an id they
 * ignore would promise a narrowing that is not there.
 */
const routeHash = () =>
  state.view === "code" && state.current
    ? `#/code/${encodeURIComponent(state.current)}`
    : `#/${state.view}`;

function writeRoute({ push = false } = {}) {
  const target = routeHash();
  if (location.hash === target) return;
  // Back has to lead out of a view one has just opened, so anything the reader
  // pressed pushes; anything that merely re-states where they already are
  // replaces, or the back button would walk through boot-up.
  history[push ? "pushState" : "replaceState"](null, "", target);
}

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
    /* Assigning an address that differs from the current one only in its hash
       is a jump inside the page, not a reload — and since the views carry a
       hash, that is now the ordinary case. So the address is corrected first
       and the reload asked for separately; the interface is translated on
       start-up and has to run through it again. */
    history.replaceState(null, "", target.href);
    location.reload();
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
  // The operations a requirement can be judged to block. The study's own
  // vocabulary, seeded with three and the author's from then on.
  operations: [],
  categoryRows: [],
  departments: [],
  // The role profiles, as the file has them and joined to the transcripts. Not
  // edited here — they are written while reading, in the study's own document —
  // so there is nothing to hold but what was last fetched.
  roles: null,
  // The specification behind each figure on screen, so the save button has the
  // picture to write out rather than the picture to read back off the page.
  charts: {},
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
  // The catalog is rebuilt whole on every change, so whether the vocabulary of
  // blocked operations stands open has to be remembered outside the markup.
  operationsOpen: false,
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
  /* A sheet opened as a modal lives in the browser's top layer, and nothing
     outside it can be painted over that — no z-index reaches. So the answer to
     a file dropped into the import sheet was reported 251 pixels below the drop
     zone and behind the sheet's own dimming: „this file could not be read",
     said somewhere the reader was not looking, in a place they could not click.
     The reply to something done inside a sheet belongs inside it.

     The one element moves rather than a second one living in every sheet:
     there is one message in this tool and it says the same thing wherever it
     stands. */
  const sheet = document.querySelector("dialog[open]");
  const home = sheet ?? document.body;
  if (element.parentElement !== home) home.append(element);
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

/**
 * A message shown inside a sheet belongs to that sheet, and goes when it does.
 *
 * Otherwise it stays parked in a closed dialog: invisible, because the dialog
 * is, and still standing there when the sheet is opened again — an old answer
 * to an old file, waiting under the drop zone for a new one.
 */
function watchSheets() {
  for (const sheet of $$("dialog")) {
    sheet.addEventListener("close", () => {
      const element = $("#message");
      if (!sheet.contains(element)) return;
      element.hidden = true;
      offer = null;
      document.body.append(element);
    });
  }
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

/**
 * Is somebody writing inside this part of the screen?
 *
 * Everything here redraws everything, and a redraw replaces the markup — so a
 * field with a half-typed sentence in it is thrown away by a coding unit
 * confirmed somewhere else. Only a field counts: a button that has just been
 * pressed also holds the focus, and skipping the redraw there would leave the
 * row it just deleted standing on the screen.
 */
function beingTypedIn(where) {
  const focused = document.activeElement;
  return Boolean(focused?.matches?.("input, textarea") && focused.closest(where));
}

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
  state.operations = data.operations;
  state.departments = data.departments;
}

/**
 * The categories of the study, in the order the category system has them.
 *
 * The catalog needs them for the figure that says which categories a
 * requirement reaches, and needs *all* of the coded ones rather than only those
 * some requirement already touches — a category no requirement reaches is the
 * finding, and a list built from the requirements alone could never contain it.
 */
async function loadCategoryRows() {
  state.categoryRows = (await api("/api/analysis")).rows;
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
  // question the reader cannot answer. Whether it belongs on this screen at
  // all is one decision, and it is made in drawChrome.
  choice.closest(".field").hidden = state.view !== "code" || !state.interviews.length;
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

  /* Two arrows that step between hits are only worth their place once there is
     a second hit to step to. Before that they sat in the bar all day offering
     to move a coder from the one place they were already at. */
  const steppable = count > 1;
  $("#search-previous").hidden = !steppable;
  $("#search-next").hidden = !steppable;
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

/**
 * Where a word turns up when nobody said it.
 *
 * The search covers what people said, which is right: a guide prompt is the
 * question, not the answer, and a category name is the tool's word rather than
 * the respondent's. But those two share their vocabulary with the material by
 * the nature of the method — that is what a deductive category *is* — so
 * searching for "Ablage" in a study whose first guide prompt is called Ablage
 * gives "kein Treffer" while the word stands on the screen three times. Correct,
 * and it reads like a broken search.
 */
function alsoKnownAs(word) {
  const wanted = word.trim().toLowerCase();
  if (wanted.length < 2) return "";
  const sections = (state.transcript?.sections ?? [])
    .filter((section) => section.name.toLowerCase().includes(wanted))
    .map((section) => section.name);
  const categories = (state.categories ?? [])
    .filter((category) => category.name.toLowerCase().includes(wanted))
    .map((category) => category.name);
  if (!sections.length && !categories.length) return "";
  const parts = [];
  if (sections.length) parts.push(t("searchInGuide", { names: sections.join(", ") }));
  if (categories.length) parts.push(t("searchInCategories", { names: categories.join(", ") }));
  return `<p class="column-note">${t("searchNotSpoken")} ${parts.join(" ")}</p>`;
}

function showElsewhere(data) {
  const field = $("#search-elsewhere");
  const others = (data.interviews ?? []).filter((i) => i.id !== state.current);
  if (!others.length) {
    // Nothing anybody said, anywhere — but the word may still be on the screen,
    // and a dead end that explains itself is not a dead end.
    const elsewhere = state.matches.length ? "" : alsoKnownAs(data.word ?? state.search ?? "");
    field.hidden = !elsewhere;
    field.innerHTML = elsewhere;
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
  if (!state.transcript) {
    /* Nothing open: after the last interview was taken out of the study, the
       column would otherwise go on describing it — its sections, its counts,
       the lines out of its header — beside a screen that says there is nothing
       here yet. */
    list.innerHTML = "";
    $("#status").innerHTML = "";
    $("#interview-meta").innerHTML = "";
    $("#interview-meta").hidden = true;
    return;
  }

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
    /* Only while there is one to go to. The two buttons above it already come
       and go with what is left open; this one stood there to the end of an
       interview and answered the click with „every turn is coded" — a button
       whose whole purpose, once the work is done, is to say it has none. */
    (touchedCount < codable.length
      ? `<button type="button" class="button-quiet jump" id="jump">${t("nextUntouched")}</button>`
      : "");

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

/* What the interview says about itself -------------------------------------
   Title, department and the header lines. All three have been read since the
   first version and shown ever since; none of them could be written. Correcting
   a department spelled two ways meant leaving the tool and editing the file the
   citations hang on, which is the one file nobody wants to open by hand. */

function drawAbout() {
  const form = $("#about-form");
  if (!state.transcript) {
    form.innerHTML = "";
    return;
  }
  if (beingTypedIn("#about-form")) return;
  const entries = Object.entries(state.transcript.meta ?? {});
  const field = (label, id, value, note = "") =>
    `<label class="field"><span class="field-label">${label}</span>` +
    `<input type="text" data-about="${id}" value="${escapeHTML(value ?? "")}" autocomplete="off"></label>` +
    (note ? `<p class="column-note">${note}</p>` : "");

  form.innerHTML =
    field(t("fieldTitle"), "title", state.transcript.title) +
    field(t("fieldDepartment"), "department", state.transcript.department, t("departmentNote")) +
    `<span class="field-label">${t("headerLines")}</span>` +
    `<div class="meta-lines">` +
    entries
      .map(
        ([key, value]) =>
          `<div class="meta-line">` +
          `<input type="text" data-meta-key value="${escapeHTML(key)}"` +
          ` aria-label="${escapeHTML(t("headerFieldAria"))}">` +
          `<input type="text" data-meta-value value="${escapeHTML(value)}"` +
          ` aria-label="${escapeHTML(t("headerValueAria"))}">` +
          `<button type="button" class="button-quiet remove" data-meta-remove` +
          ` title="${escapeHTML(t("headerRemoveTitle"))}"` +
          ` aria-label="${escapeHTML(t("headerRemoveAria", { field: key }))}">×</button></div>`,
      )
      .join("") +
    `</div>` +
    `<form id="meta-new">` +
    `<input type="text" id="meta-new-key" autocomplete="off" placeholder="${escapeHTML(t("headerFieldPlaceholder"))}"` +
    ` aria-label="${escapeHTML(t("headerFieldAria"))}">` +
    `<input type="text" id="meta-new-value" autocomplete="off" placeholder="${escapeHTML(t("headerValuePlaceholder"))}"` +
    ` aria-label="${escapeHTML(t("headerValueAria"))}">` +
    `<button type="submit" class="button-quiet">＋</button></form>` +
    /* The folder name is the identifier: it stands in the coding file beside
       the transcript, in every export and in the git history. It is made from a
       working title at the moment one knows least about the study. */
    `<label class="field"><span class="field-label">${t("fieldFolder")}</span>` +
    `<input type="text" id="about-folder" value="${escapeHTML(state.transcript.id)}" autocomplete="off"></label>` +
    `<p class="column-note">${t("folderNote")}</p>` +
    `<button type="button" class="button-quiet" id="about-rename">${t("renameFolder")}</button>` +
    `<button type="button" class="button-quiet remove" id="about-remove">${t("removeInterview")}</button>`;
}

/** Write the header back and take the answer as the new truth about it. */
async function updateAbout(fields, message) {
  try {
    const answer = await api(`/api/interviews/${encodeURIComponent(state.current)}`, {
      method: "PATCH",
      body: fields,
    });
    Object.assign(state.transcript, {
      title: answer.title ?? state.transcript.title,
      department: answer.department ?? state.transcript.department,
      meta: answer.meta ?? state.transcript.meta,
    });
    await loadInterviewList();
    drawAll();
    notify(message);
  } catch (error) {
    // Back to what the file says, so a field does not keep showing what was
    // not saved.
    await loadTranscript();
    drawAll();
    complain(error);
  }
}

/**
 * The list of interviews again, without losing which one is open.
 *
 * `loadInterviews` picks a current interview, which is right at startup and
 * wrong afterwards: a title changed in the header would have sent the reader
 * back to the first interview in the study.
 */
async function loadInterviewList() {
  const here = state.current;
  state.interviews = await api("/api/interviews");
  state.current = here;
  drawInterviewList();
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
    /* Which proposition the category argues — the one thing about it that
       decides how it is coloured in every figure. A subcategory takes its
       parent's and says so instead of offering a choice that would be refused:
       the distinction is drawn under the proposition standing above it. */
    (category.parent
      ? `<p class="column-note">` +
        `${t("propositionFromParent", { name: propositionName(category.proposition) })}</p>`
      : `<label class="field"><span class="field-label">${t("fieldProposition")}</span>` +
        `<select data-category-proposition="${id}">` +
        Object.entries(state.propositions)
          .map(
            ([key, proposition]) =>
              `<option value="${escapeHTML(key)}"` +
              `${key === (category.proposition ?? NO_PROPOSITION) ? " selected" : ""}>` +
              `${escapeHTML(proposition.name ?? key)}</option>`,
          )
          .join("") +
        `</select></label>`) +
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
  // Pushed, so that the back button leads to the table the citation was read
  // in — comparing two places means going back and forth between them.
  setView("code", { push: true });
  state.selected = id;
  const coding = state.codings.find((other) => other.id === id);
  if (coding) state.inFocus = coding.turn;
  drawAll();
  const place = document.querySelector(`#transcript .segment[data-id="${CSS.escape(id)}"]`);
  if (place) place.scrollIntoView({ behavior: "smooth", block: "center" });
  else notify(t("passageNotVisible"), "error");
}

/**
 * The same movement, from a locator rather than from a coding unit.
 *
 * A role profile cites a speaker turn, not a passage somebody marked: the
 * sentence in the study's document was read out of the turn as a whole, and
 * often out of two of them at once. So the turn is what is opened, and the
 * focus mark — the one the keyboard walk uses — says which one it was.
 */
async function showTurn(interview, turn) {
  if (interview !== state.current) {
    state.current = interview;
    $("#interview-choice").value = interview;
    await loadTranscript();
  }
  setView("code", { push: true });
  state.selected = null;
  state.inFocus = turn;
  drawAll();
  const place = document.getElementById(`turn-${turn}`);
  if (place) place.scrollIntoView({ behavior: "smooth", block: "center" });
  else notify(t("turnNotInTranscript"), "error");
}

/* Propositions ------------------------------------------------------------
   The colour key of the whole study, and until now the one thing in the
   category system that could only be changed by editing the file the tool
   writes. A study whose research interest is not the bundled example's carried
   two headings it never made — into every figure, and into the appendix. */

/**
 * The fallback: where a category lands that argues none of the study's own
 * propositions. It can be worded and coloured like any other and cannot be
 * dissolved, because something has to be there to land on.
 */
const NO_PROPOSITION = "none";

const propositionName = (id) =>
  state.propositions[id ?? NO_PROPOSITION]?.name ?? state.propositions[NO_PROPOSITION]?.name ?? "";

function drawPropositions() {
  // A redraw while a wording is being typed would pull the field away, and
  // everything in the tool redraws everything: one confirmed coding unit
  // elsewhere and the sentence in hand is gone. Only a field being written in
  // is protected — a button that has just been pressed wants its redraw.
  if (beingTypedIn("#propositions")) return;
  const used = new Map();
  for (const category of state.categories) {
    const id = category.proposition ?? NO_PROPOSITION;
    used.set(id, (used.get(id) ?? 0) + 1);
  }
  $("#propositions").innerHTML = Object.entries(state.propositions)
    .map(([id, proposition]) => {
      const count = used.get(id) ?? 0;
      return (
        `<div class="proposition" data-proposition="${escapeHTML(id)}">` +
        `<input type="color" data-proposition-color value="${escapeHTML(proposition.color ?? NEUTRAL_COLOR)}"` +
        ` aria-label="${escapeHTML(t("propositionColorOf", { name: proposition.name ?? id }))}">` +
        `<input type="text" data-proposition-name value="${escapeHTML(proposition.name ?? id)}"` +
        ` aria-label="${escapeHTML(t("propositionNameAria"))}">` +
        `<span class="count">${count}</span>` +
        // Dissolving takes the heading away and leaves the categories; the
        // fallback is what they fall to, so it has no such button.
        (id === NO_PROPOSITION
          ? ""
          : `<button type="button" class="button-quiet remove" data-proposition-remove` +
            ` title="${escapeHTML(t("propositionRemoveTitle"))}"` +
            ` aria-label="${escapeHTML(t("propositionRemoveAria", { name: proposition.name ?? id }))}">×</button>`) +
        `</div>`
      );
    })
    .join("");
}

/** Save a change to a proposition and redraw: it is a colour in every figure. */
async function updateProposition(id, fields, message) {
  try {
    await api(`/api/propositions/${encodeURIComponent(id)}`, { method: "PATCH", body: fields });
    await loadCategories();
    drawAll();
    notify(message);
  } catch (error) {
    await loadCategories();
    drawAll();
    complain(error);
  }
}

function drawCategories() {
  drawPropositions();
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
    `<label class="field"><span class="field-label">${t("memo")}</span>` +
    `<textarea id="detail-memo" rows="2" placeholder="${escapeHTML(t("memoPlaceholder"))}">${escapeHTML(coding.memo ?? "")}</textarea></label>` +
    `<div class="row">` +
    `<label><input type="checkbox" id="detail-anchor"${coding.anchor ? " checked" : ""}> ${t("anchorExample")}</label>` +
    `<label><input type="checkbox" id="detail-reviewed"${coding.reviewed === true ? " checked" : ""}> ${t("reviewed")}</label>` +
    `<button type="button" class="button-quiet remove" id="detail-remove">${t("delete")}</button>` +
    `</div>` +
    /* Where the unit sits, changeable. A citation that begins one sentence too
       early was a delete and a fresh coding — which threw away the note on it,
       the anchor-example mark and every requirement it was evidence for, and
       the passage most likely to need cutting again is the one that has just
       been worked on. The move already existed for a unit that had lost its
       place after a transcript edit; it was simply never offered for one that
       still had a place. */
    (state.reanchoring === coding.id
      ? `<p class="column-note recutting">${t("recutWaiting")} ` +
        `<button type="button" class="button-quiet" id="detail-recut-cancel">${t("cancel")}</button></p>`
      : `<button type="button" class="button-quiet" id="detail-recut">${t("recut")}</button>`) +
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
            `<span class="choice-name">${escapeHTML(category.name)}</span></button>`,
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
  // say, the bar still has to stay on screen — but below the header, not over
  // it. Coding a passage near the top of the sheet used to bury the interview
  // picker and the tabs under the bar, which reads as a broken overlay rather
  // than as a panel that ran out of room.
  const floor = ($(".header")?.getBoundingClientRect().bottom ?? 0) + 8;
  const top = Math.min(
    Math.max(floor, wanted),
    Math.max(floor, window.innerHeight - height - 8),
  );
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
    /* The four marks on a row of their own, and the count and the export at the
       end of it. Loose in the bar they were laid out by whatever room the three
       fields happened to leave: two of them ended up beside the search field,
       looking like something it does, and the other two dropped to the left
       edge of the next line — four controls of one kind standing in four
       different columns, and the split moved with the language. */
    `<div class="filter-row">` +
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
    `</div></div>`;

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
   The cross table stays the citable number; the chart is the overview.

   The drawing itself is not here. It lives in `charts.js`, where it is plain
   arithmetic over the data the API already serves, so that the same figure can
   be had from the screen, from the save button and from `/api/figures/…`
   without three drawings that agree only by accident. What is here is the
   wrapping: the heading, the key as HTML, the summary a screen reader hears,
   and the figures behind it as a table. */

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
  /* Which columns are number columns, read off the numbers rather than assumed
     from the position. Every column but the first counted as one, while the
     cells under it decided per value — so a column of levels („Must have") or
     of category names hung its heading against the right edge over text set
     against the left one, and the heading stood over the column beside it. */
  const numeric = columns.map(
    (column, index) => index > 0 && rows.every((row) => typeof row[index] === "number"),
  );
  const head = columns
    .map(
      (column, index) =>
        `<th scope="col"${numeric[index] ? ' class="num"' : ""}>${escapeHTML(String(column))}</th>`,
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

/**
 * A figure on the page: heading, key, summary, picture, caption, figures.
 *
 * The picture comes from `charts.js` as a body and a size; everything around it
 * is HTML, because everything around it is interface — a key that can be read
 * by a screen reader, a disclosure that opens the numbers, a button that saves
 * the file. `null` for a chart there is nothing to draw yet.
 */
function chartHTML(spec) {
  if (!spec) return "";
  state.charts[spec.id] = spec;
  const legend = spec.legend ? keyHTML(spec.legend) : "";
  return (
    `<div class="chart-head"><h3 id="${spec.id}-title">${escapeHTML(spec.title)}</h3>` +
    `<button type="button" class="button-quiet" data-svg="${spec.id}" data-file="${spec.file}">` +
    `${t("saveAsSvg")}</button></div>` +
    legend +
    chartSummaryHTML(spec.id, spec.summary) +
    `<figure class="chart" id="${spec.id}"${spec.figuresRef ? ` data-figures="${spec.figuresRef}"` : ""}>` +
    `<svg viewBox="0 0 ${spec.width} ${spec.height}" role="img" aria-labelledby="${spec.id}-title"` +
    ` aria-describedby="${spec.id}-summary"` +
    (spec.angle ? ` data-angle="${spec.angle}" data-baseline="${spec.baseline}"` : "") +
    ` preserveAspectRatio="xMinYMin meet">` +
    spec.body +
    `</svg>` +
    `<div class="chart-tip" hidden></div>` +
    `<figcaption class="column-note">${escapeHTML(spec.caption)}</figcaption>` +
    `</figure>` +
    (spec.figures ? chartFiguresHTML(spec.id, spec.figures) : "")
  );
}

/** The key beside a figure. A ramp is two ends and the steps between them. */
function keyHTML(legend) {
  if (legend.kind === "ramp") {
    return (
      `<div class="chart-legend ramp"><span>${legend.from}</span>` +
      legend.entries.map((entry) => `<i class="${entry.paint}"></i>`).join("") +
      `<span>${legend.to}</span><span class="ramp-label">${escapeHTML(legend.note)}</span></div>`
    );
  }
  const classed = legend.kind === "moscow";
  /* Entries that belong together, wrapped as one. „Punktgröße in Belegen:" and
     the two dots after it are one statement, and both this key and the one
     drawn into the saved file used to break between them — a small dot at the
     end of a line and a large one alone on the next reads as two scales. */
  const runs = [];
  for (const entry of legend.entries) {
    if (entry.keepWith && runs.length) runs[runs.length - 1].push(entry);
    else runs.push([entry]);
  }

  return (
    `<div class="chart-legend${classed ? " moscow" : ""}">` +
    runs
      .map((run) => (run.length > 1 ? `<span class="key-run">${run.map(one).join("")}</span>` : one(run[0])))
      .join("") +
    `</div>`
  );

  function one(entry) {
    // An outline rather than a colour: the entry is about a shape drawn around
    // a dot, so the key has to show that shape and not a swatch.
    if (entry.shape === "ring") {
      return `<span class="ring-key"><i></i>${escapeHTML(entry.label)}</span>`;
    }
    /* A size drawn at the size it means. A swatch would say nothing about it,
       and a number beside a word even less: what the reader has to be able to
       do is hold the key against the picture. */
    if (entry.shape === "dot") {
      const box = Math.ceil(entry.radius * 2);
      return (
        `<span class="dot-key"><svg width="${box}" height="${box}"` +
        ` viewBox="0 0 ${box} ${box}" aria-hidden="true">` +
        `<circle cx="${box / 2}" cy="${box / 2}" r="${entry.radius.toFixed(2)}"></circle>` +
        `</svg>${escapeHTML(entry.label)}</span>`
      );
    }
    // A word on its own — what the scale beside it is a scale of.
    if (!entry.paint) return `<span class="key-note">${escapeHTML(entry.label)}</span>`;
    return (
      `<span${classed ? ` class="${entry.paint}"` : ""}>` +
      `<i${classed ? "" : ` class="${entry.paint}"`}></i>${escapeHTML(entry.label)}</span>`
    );
  }
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

/**
 * The chart, saved as a file that stands on its own.
 *
 * It used to be built by scraping: the laid-out picture was cloned, every
 * element was asked what colour, face and size it had come out, and the answers
 * were written onto the copy as inline styles. That worked, and it was the only
 * way to get a file out of a drawing whose colours lived in custom properties —
 * but it meant the file existed only where a browser had already drawn it, and
 * that a second drawing for the API would have been a second drawing.
 *
 * Now the picture declares its own paint in `charts.js`, so the same
 * `standalone()` that answers `/api/figures/…` builds the file here. What the
 * browser still contributes is measurement: real glyph widths, for where the
 * key wraps and how far the angled headings of the heatmap reach down. The
 * server can only estimate those, and estimates there run wide on purpose.
 */
function currentTheme() {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === "light" || chosen === "dark") return chosen;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * How wide a piece of text is, in the font the file will be set in.
 *
 * Not the font of the page: the figure carries its own stack, and measuring in
 * one face to lay out another is how a key comes out overlapping.
 */
const measureText = (() => {
  let context;
  return (text, { size = 10, mono = false } = {}) => {
    context = context ?? document.createElement("canvas").getContext("2d");
    if (!context) return estimateWidth(text, { size, mono });
    context.font = `${size}px ${mono ? FONTS.mono : FONTS.sans}`;
    return context.measureText(String(text)).width;
  };
})();

function saveChart(id, file) {
  const spec = state.charts[id];
  if (!spec) return;
  /* The height as drawn, not as reckoned: the foot under the heatmap's angled
     headings is grown after layout by `fitAngledHeadings`, which knows how wide
     the headings really came out. The file inherits that answer instead of
     working it out a second time. */
  const drawn = document.querySelector(`#${id} svg`);
  const height = drawn ? Number(drawn.getAttribute("viewBox").split(/\s+/)[3]) : undefined;
  /* Measured by the same arithmetic as the endpoint, although a browser could
     do better. The key is the one part of a file whose layout is worked out
     rather than inherited from the body, and handing it the real width of the
     text here and an estimate there produced two files that were the same
     picture and not the same file: the same key wrapped in one and not in the
     other. Which is the promise this whole arrangement is for — what a reader
     saves from the screen and what a script fetches from the endpoint are one
     figure. A few pixels of unused white space in a key is the cheapest thing
     in the tool to give up for it. */
  const blob = new Blob([standalone(spec, { theme: currentTheme(), height })], {
    type: "image/svg+xml",
  });
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

  /* A share of nothing is not a hundred per cent, and this is the one place
     where saying so costs the most: a study with no coding in it yet opened on
     „100 % reviewed" over „0 coding units", which reads as a finished check
     rather than as work not begun. The dash the block list already uses for the
     same situation says what is true — there is nothing here to have reviewed. */
  const allCitations = Object.values(data.citations).flat();
  const reviewedShare = allCitations.length
    ? `${Math.round(
        (allCitations.filter((citation) => citation.reviewed).length / allCitations.length) * 100,
      )} %`
    : "—";
  const metrics =
    `<div class="metrics">` +
    `<div class="metric"><div class="value">${data.total}</div><span class="label">${t("metricUnits")}</span></div>` +
    `<div class="metric"><div class="value">${reviewedShare}</div><span class="label">${t("reviewed")}</span></div>` +
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

  /* Five column headings over nothing at all is a table that looks broken
     rather than one that has nothing to report yet. */
  const progress = !data.progress.length
    ? `<h3>${t("progressPerInterview")}</h3>` +
      `<p class="empty-state">${t("noInterviewYet")}</p>`
    : `<h3>${t("progressPerInterview")}</h3><div class="table-frame"><table><thead><tr>` +
    `<th>${t("interview")}</th><th>${t("department")}</th><th class="num">${t("metricUnits")}</th>` +
    // Right, like the cells under it: the column is numbers, and a heading set
    // to the other edge of a column reads as a heading over a different one.
    `<th class="num">${t("turnsTouched")}</th><th class="num">${t("materialCoded")}</th></tr></thead><tbody>` +
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
    chartHTML(categoryChart(data, t)) +
    chartHTML(heatmapChart(data, t, { measure: measureText })) +
    matrix +
    progress +
    chartHTML(saturationChart(data, t)) +
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
  /* Handing over nothing is not a handover. Before the first coding the export
     wrote a file of sixty-two bytes — `"interviews":{}` — and whoever received
     it had nothing to code against and no way to tell that from a file that
     failed to save. The way in stays: reading a second coding is what somebody
     does with a file that arrived, and it does not depend on this side having
     coded anything yet. */
  const anything = (state.analysis?.total ?? 0) > 0;
  return (
    `<div class="handover">` +
    `<p class="column-note">${t("handoverNote")}</p>` +
    // Its own class: `exports` belongs to the documents block above, and
    // borrowing it here put these two buttons into that block's counts.
    `<p class="handover-actions">` +
    (anything
      ? `<a class="button-quiet" id="handover-out" download href="${exportHref("/api/export/coding.json")}">` +
        `${t("handoverExport")}</a>`
      : "") +
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
  // A unit that had lost its place is put back; one that had a place is cut
  // differently. Same request, and two quite different things to be told.
  const lost = state.codings.find((coding) => coding.id === id)?.state === "lost";
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
    notify(t(lost ? "reanchored" : "recutDone"));
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

/* Which operations there are to block is the study's vocabulary and comes with
   the catalog. It used to be three words compiled into the tool — filing,
   retrieval, transfer — so a study about something else weighed its
   requirements against a triple it never chose. */

const MOSCOW_ORDER = ["must", "should", "could", "wont"];

const moscowClass = (level) => `moscow-${MOSCOW_ORDER.includes(level) ? level : "open"}`;
const moscowName = (level) =>
  state.moscow.find((one) => one.id === level)?.name ?? t("open");


/**
 * The counts, which belong at the top, and the figures, which do not.
 *
 * The catalog is a list of things to work through, and the figures are a review
 * of that work. Drawn above the list they put the first requirement card at
 * 1438px on a 1000px screen: after making six requirements you could not see
 * one of them. The counts are one compact row and answer "how far along is
 * this", so they stay; the figures go under the list they are about.
 */
function catalogMetricsHTML(rows) {
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

  return metrics;
}

function catalogFiguresHTML(rows, departments) {
  /* Two of these three can only show something after a judgment nobody has made
     yet — the MoSCoW level and the blocked operations are entered on each card
     below. Drawn anyway they are not empty but misleading: six requirements
     with no level at all came out as one grey bar labelled 6, which reads as a
     finding. And they pushed the first card to 1438px on a 1000px screen, so
     the answer to "I just made six requirements, where are they" was: below
     three figures about work you have not done.

     The third counts citations, which exist from the first one, so it stays. */
  const judged = rows.some((row) => row.moscow || (row.blockedOperations ?? []).length);
  const shared = { moscow: state.moscow, operationCount: state.operations.length };
  const charts =
    (judged
      ? chartHTML(moscowBand(rows, t, shared)) +
        chartHTML(
          priorityField(rows, t, { ...shared, departmentCount: departments.length }),
        )
      : "") +
    chartHTML(coverageChart(rows, departments, t)) +
    /* This one needs no judgment either — it is made of citations, which exist
       from the first requirement onwards — so it keeps the coverage chart
       company below rather than waiting with the two above. */
    chartHTML(reachChart(rows, state.categoryRows ?? [], t, shared)) +
    chartHTML(cityPlot(rows, state.categoryRows ?? [], t, shared));

  return (
    (charts || `<p class="empty-state">${t("catalogChartsEmpty")}</p>`) +
    // Said once, where the figures would have been, rather than left as an
    // absence somebody has to interpret.
    (judged || !rows.length ? "" : `<p class="column-note">${t("catalogNotJudgedYet")}</p>`)
  );
}

/** Only the graphic part; the cards stay as they are, focus included. */
async function drawCatalogCharts() {
  await Promise.all([loadRequirements(), loadCategoryRows()]);
  const part = document.getElementById("catalog-charts");
  if (!part) return;
  part.innerHTML = catalogFiguresHTML(state.requirements, state.departments);
  const counts = document.getElementById("catalog-metrics");
  if (counts) counts.innerHTML = catalogMetricsHTML(state.requirements);
}

/**
 * The operations a requirement is judged to block, as a list one can work on.
 *
 * Folded away, because it is the sort of thing settled once for a study and
 * then left alone — but reachable, which it was not: the three the tool seeds
 * are named after one study's filing, retrieval and transfer, and a study about
 * something else had to weigh its requirements against them anyway. The number
 * beside each says how many requirements name it, so that dissolving one is a
 * decision made with the size of it in view.
 */
function operationsHTML() {
  const used = new Map();
  for (const requirement of state.requirements) {
    for (const id of requirement.blockedOperations ?? []) {
      used.set(id, (used.get(id) ?? 0) + 1);
    }
  }
  return (
    `<details class="operations" id="operations-shell"${state.operationsOpen ? " open" : ""}>` +
    `<summary>${t("operationsSummary", { n: state.operations.length })}</summary>` +
    `<p class="column-note">${t("operationsNote")}</p>` +
    state.operations
      .map(
        (operation) =>
          `<div class="operation" data-operation="${escapeHTML(operation.id)}">` +
          `<input type="text" data-operation-name value="${escapeHTML(operation.name)}"` +
          ` aria-label="${escapeHTML(t("operationNameAria"))}">` +
          `<span class="count">${used.get(operation.id) ?? 0}</span>` +
          `<button type="button" class="button-quiet remove" data-operation-remove` +
          ` title="${escapeHTML(t("operationRemoveTitle"))}"` +
          ` aria-label="${escapeHTML(t("operationRemoveAria", { name: operation.name }))}">×</button>` +
          `</div>`,
      )
      .join("") +
    `<form id="operation-new">` +
    `<input type="text" id="operation-name" autocomplete="off"` +
    ` placeholder="${escapeHTML(t("operationPlaceholder"))}"` +
    ` aria-label="${escapeHTML(t("operationNewAria"))}">` +
    `<button type="submit" class="button-quiet">＋</button></form>` +
    `</details>`
  );
}

async function drawCatalog() {
  await Promise.all([loadRequirements(), loadCategoryRows()]);
  const root = $("#catalog");

  const head =
    `<h2>${t("catalogTitle")}</h2>` +
    `<p class="lead">${t("catalogLead")}</p>` +
    `<form class="new-requirement" id="new-requirement">` +
    `<input type="text" id="new-requirement-title" placeholder="${escapeHTML(t("requirementSentencePlaceholder"))}"` +
    ` aria-label="${escapeHTML(t("requirementTitleAria"))}" autocomplete="off">` +
    `<button type="submit" class="button">${t("add")}</button></form>` +
    operationsHTML();

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
      const operations = state.operations
        .map(
          (operation) =>
            `<label><input type="checkbox" data-blocked="${escapeHTML(operation.id)}"` +
            `${(requirement.blockedOperations ?? []).includes(operation.id) ? " checked" : ""}> ` +
            `${escapeHTML(operation.name)}</label>`,
        )
        .join("");
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
        /* Two fields, because they are two audiences. The definition is what
           leaves this tool for the written work; the note beside it is the desk
           it was worked out on. As one field it was neither: either a working
           thought ended up in the thesis, or the wording had nowhere to live
           while it was still being found. Labelled rather than left to a
           placeholder, since a placeholder is gone the moment either is
           written in and the difference between them is the whole point. */
        `<label class="field-block"><span class="field-label">${t("requirementDefinitionLabel")}</span>` +
        `<textarea class="definition" rows="2" placeholder="${escapeHTML(t("requirementDefinitionPlaceholder"))}">${escapeHTML(requirement.definition ?? "")}</textarea>` +
        `</label>` +
        `<label class="field-block"><span class="field-label">${t("requirementNoteLabel")}</span>` +
        `<textarea class="description" rows="2" placeholder="${escapeHTML(t("descriptionPlaceholder"))}">${escapeHTML(requirement.description ?? "")}</textarea>` +
        `</label>` +
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
    `<div id="catalog-metrics">${catalogMetricsHTML(state.requirements)}</div>` +
    /* Figures first, as in the analysis: both views open on the overview and
       then give the detail under it, and two views of one tool that order
       themselves differently make the reader learn the tool twice.

       What keeps this from becoming the wall it once was is the rule below it
       rather than the position: a figure that needs a judgment nobody has made
       is not drawn at all. So a catalog somebody has just started shows one
       compact row of counts and its requirements; the field and the level
       distribution appear when there is something in them to read. */
    `<div id="catalog-charts">${catalogFiguresHTML(state.requirements, state.departments)}</div>` +
    filter +
    `<div class="catalog-list">${cards || `<p class="empty-state">${t("noRequirementInSlice")}</p>`}</div>` +
    `<div class="exports"><a class="button-quiet" href="${exportHref("/api/export/requirements-catalog.md")}" download>` +
    `${t("catalogTitle")}</a></div>`;

  markScrollableTables(root);
}

/* Role profiles ------------------------------------------------------------
   The catalog is made here: citations are assigned to a requirement and the
   view counts what came of it. A role profile is not. It is written while
   reading a department's citations — what its work is, what it files, what it
   retrieves, what it hands over, in which shape it wants what it receives — and
   that reading happens in the study's own document, where the sentences end up.

   What that document cannot do is stand behind its own claims. It carries the
   locators as bracketed keys, which nobody follows, and it cannot count. This
   view does both: every paraphrase gets its evidence as buttons into the
   transcript, and the two figures say what the prose leaves unsaid — whose
   voice a profile is written from, and how much each of its pillars rests on.

   Read-only for the same reason the catalog is not: writing a profile is
   reading work, and a text field here would only invite it to be done in the
   wrong place. */

async function loadRoles() {
  state.roles = await api("/api/roles");
}

function roleFiguresHTML(data) {
  const charts =
    chartHTML(voicesChart(data.voices, data.departments, t)) +
    chartHTML(pillarChart(data.evidencePerPillar, data.departments, t));
  return charts || `<p class="empty-state">${t("roleChartsEmpty")}</p>`;
}

/**
 * One profile.
 *
 * The head carries the count that decides how far the profile may be trusted:
 * how much of it the department said about itself and how much came from
 * others. A profile with nothing of its own is not an error — two departments
 * were never interviewed — but it is a different kind of statement, and it says
 * so where it is read rather than in a footnote somewhere else.
 */
function roleHTML(role) {
  const pillars = role.pillars
    .map((pillar) => {
      const entries = role.entries.filter((entry) => entry.pillar === pillar.id);
      if (!entries.length) {
        return (
          `<section class="pillar empty"><h4>${escapeHTML(pillar.name)}` +
          `<span class="open-mark">${t("pillarOpen")}</span></h4></section>`
        );
      }
      const written = entries
        .map((entry) => {
          const citations = entry.citations
            .map(
              (citation) =>
                `<button type="button" class="citation-chip${citation.self ? " self" : ""}` +
                `${citation.missing ? " missing" : ""}"` +
                ` data-role-turn="${citation.turn}" data-interview="${escapeHTML(citation.interview)}"` +
                ` title="${escapeHTML(citation.missing ? t("turnNotInTranscript") : quoted(citation.text.slice(0, 240)))}">` +
                `${escapeHTML(citation.department)} · ${t("turn")} ${citation.turn}</button>`,
            )
            .join("");
          return (
            `<li class="role-entry"><p>${escapeHTML(entry.reading)}</p>` +
            `<div class="citation-chips">${citations}</div></li>`
          );
        })
        .join("");
      return (
        `<section class="pillar"><h4>${escapeHTML(pillar.name)}` +
        `<span class="count">${pillar.entries} ` +
        `${plural(pillar.entries, "roleEntryOne", "roleEntryMany")}` +
        `<span class="separator">·</span>${pillar.evidence} ` +
        `${plural(pillar.evidence, "citationOne", "citationMany")}</span></h4>` +
        `<ul>${written}</ul></section>`
      );
    })
    .join("");

  return (
    `<article class="role" data-id="${escapeHTML(role.id)}">` +
    `<header><h3>${escapeHTML(role.name)}</h3>` +
    `<p class="numbers"><b>${role.entries.length}</b> ` +
    `${plural(role.entries.length, "roleEntryOne", "roleEntryMany")}` +
    `<span class="separator">·</span><b>${role.evidence}</b> ` +
    `${plural(role.evidence, "citationOne", "citationMany")}` +
    `<span class="separator">·</span>${t("roleOwnVoice", { own: role.own, others: role.others })}` +
    (role.own ? "" : `<span class="open-mark">${t("roleWithoutOwnVoice")}</span>`) +
    (role.missing ? `<span class="open-mark">${t("roleMissingTurns", { n: role.missing })}</span>` : "") +
    `</p></header>${pillars}</article>`
  );
}

async function drawRoles() {
  await loadRoles();
  const root = $("#roles");
  const data = state.roles;

  const head = `<h2>${t("rolesTitle")}</h2><p class="lead">${t("rolesLead")}</p>`;
  if (!data.roles.length) {
    root.innerHTML = head + `<p class="empty-state">${t("rolesEmpty")}</p>`;
    return;
  }

  const evidence = data.roles.reduce((n, role) => n + role.evidence, 0);
  const metrics =
    `<div class="metrics">` +
    `<div class="metric"><div class="value">${data.roles.length}</div>` +
    `<span class="label">${t("metricProfiles")}</span></div>` +
    `<div class="metric"><div class="value">${data.roles.reduce((n, role) => n + role.entries.length, 0)}</div>` +
    `<span class="label">${t("metricRoleEntries")}</span></div>` +
    `<div class="metric"><div class="value">${evidence}</div>` +
    `<span class="label">${t("citationMany")}</span></div>` +
    /* The number that decides whether the profiles may carry a design decision:
       everything said about a department by somebody other than itself. */
    `<div class="metric"><div class="value">${data.roles.reduce((n, role) => n + role.others, 0)}</div>` +
    `<span class="label">${t("metricFromOthers")}</span></div>` +
    `</div>`;

  root.innerHTML =
    head +
    metrics +
    `<div id="role-charts">${roleFiguresHTML(data)}</div>` +
    `<div class="role-list">${data.roles.map(roleHTML).join("")}</div>` +
    `<div class="exports"><a class="button-quiet" href="${exportHref("/api/export/role-profiles.md")}" download>` +
    `${t("rolesTitle")}</a></div>`;

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

/* Notes at the height of what is in them ------------------------------------
   A textarea lets its overflow show through its own bottom padding, so a
   working note longer than its rows came out as two whole lines and the upper
   halves of a third — a row of decapitated letters that reads as a broken font
   rather than as „there is more here". Every note in this tool is prose
   somebody wrote in order to read it again: the definition of a requirement,
   what was noticed while coding, why a category was cut this way. None of it
   is served by being shown two lines at a time.

   One observer rather than a call at the end of every draw: the notes are
   written into eight different places and the ninth would have been forgotten.
   A box the reader has dragged to a height of their own keeps it — the drag
   says more than the measurement does. */

function fitNote(field) {
  if (field.dataset.height === "by-hand") return;
  // Everything here is border-box, and scrollHeight counts the padding but not
  // the border. Without the two the last line sat on the frame.
  const style = getComputedStyle(field);
  const frame =
    Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
  field.style.height = "auto";
  field.style.height = `${field.scrollHeight + frame}px`;
}

function fitNotes(root) {
  if (root.nodeType !== 1) return;
  if (root.matches?.("textarea")) fitNote(root);
  root.querySelectorAll?.("textarea").forEach(fitNote);
}

function watchNotes() {
  fitNotes(document.body);
  new MutationObserver((records) => {
    for (const record of records) record.addedNodes.forEach(fitNotes);
  }).observe(document.body, { childList: true, subtree: true });

  document.addEventListener("input", (event) => {
    if (event.target.matches("textarea")) fitNote(event.target);
  });
  // The resize handle is a statement of intent, and honouring it costs one
  // comparison: a height that no longer matches the measured one was dragged.
  document.addEventListener("pointerup", (event) => {
    const field = event.target.closest?.("textarea");
    if (!field) return;
    const measured = Math.round(Number.parseFloat(field.style.height) || 0);
    if (measured && Math.abs(field.offsetHeight - measured) > 2) {
      field.dataset.height = "by-hand";
    }
  });
}

/* Reading position in the generated views ----------------------------------
   Catalog, roles and evaluation are built from scratch on every visit, and
   until now every visit began at the top. Someone checking the eleventh
   requirement against the figure two screens below it scrolled back down
   after every reload, after every step into a transcript and back, and after
   every edit that redrew the page — while the coding view, the one place that
   did remember, made the loss of it obvious.

   A heading and an offset, not a scroll height, for the same reason as in the
   transcript: these pages get longer with every coding, and a height then
   points at something else, whereas „under Categories by department" is still
   the same place. No heading above the fold means the top, which is where one
   was. */

const SCROLLING_VIEWS = { catalog: "#view-catalog", roles: "#view-roles", analysis: "#view-analysis" };

function viewScroller(view) {
  const selector = SCROLLING_VIEWS[view];
  return selector ? $(selector) : null;
}

function viewPosition(container) {
  const boundary = container.getBoundingClientRect().top;
  let mark = null;
  for (const heading of container.querySelectorAll("h2, h3, h4")) {
    if (heading.getBoundingClientRect().top > boundary + 4) break;
    mark = heading;
  }
  if (!mark) return null;
  return {
    heading: mark.textContent.trim(),
    offset: Math.max(0, Math.round(boundary - mark.getBoundingClientRect().top)),
  };
}

function rememberViewPosition(view = state.view) {
  const container = viewScroller(view);
  if (!container || container.hidden) return;
  try {
    const position = viewPosition(container);
    if (position) localStorage.setItem(STORAGE.viewPosition(view), JSON.stringify(position));
    else localStorage.removeItem(STORAGE.viewPosition(view));
  } catch {
    /* Full or blocked storage must not hold up the reading. */
  }
}

function restoreViewPosition(view) {
  const container = viewScroller(view);
  if (!container) return;
  let position = null;
  try {
    position = JSON.parse(localStorage.getItem(STORAGE.viewPosition(view)) ?? "null");
  } catch {
    /* Unreadable remembered state is like nothing remembered. */
  }
  const place = () => {
    if (!position?.heading) return container.scrollTo({ top: 0, behavior: "instant" });
    const mark = [...container.querySelectorAll("h2, h3, h4")].find(
      (heading) => heading.textContent.trim() === position.heading,
    );
    // The heading is gone — a requirement deleted, a coder's agreement no
    // longer there. Landing somewhere near where it used to be would be a
    // guess; the top is honest.
    if (!mark) return container.scrollTo({ top: 0, behavior: "instant" });
    const top =
      mark.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop;
    container.scrollTo({ top: Math.max(0, top + (position.offset ?? 0)), behavior: "instant" });
  };
  place();
  // The figures draw after the page does and every one of them makes it
  // longer, so the place is taken again once they have.
  requestAnimationFrame(() => requestAnimationFrame(place));
}

/** Each generated view keeps its own place while it is being read. */
function watchViews() {
  for (const view of Object.keys(SCROLLING_VIEWS)) {
    const container = viewScroller(view);
    if (!container) continue;
    let timer = null;
    container.addEventListener("scroll", () => {
      clearTimeout(timer);
      timer = setTimeout(() => rememberViewPosition(view), 200);
    });
  }
  addEventListener("pagehide", () => rememberViewPosition());
  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") rememberViewPosition();
  });
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
  drawChrome();
  drawTranscript();
  drawTranscriptProblems();
  drawDrift();
  drawSections();
  drawAbout();
  drawCategories();
  drawDetail();
  // The picker carries a count, and a count that is only right until the next
  // confirmation is worse than none.
  drawInterviewList();
}

/**
 * The line under the name of the tool. In the coding view it says which
 * interview is open; the other two views read the whole study, and a
 * department printed above a study-wide table has been read as its scope.
 *
 * The parts are joined rather than glued to a separator: a transcript without
 * a department used to leave the dot standing at the front of the line.
 */
function headerSubtitle() {
  if (state.view !== "code" || !state.transcript) return t("headerSubtitle");
  const conducted = state.transcript.meta.Erhebung ?? state.transcript.meta.Conducted ?? "";
  const parts = [state.transcript.department, conducted].map((part) => (part ?? "").trim());
  return parts.filter(Boolean).join(" · ") || t("headerSubtitle");
}

/**
 * What the header offers, given the view standing in front of it. A picker
 * that changes nothing on screen is worse than a missing one: it invites the
 * reader to believe the evaluation below it is about the one interview named
 * in it. The same for reading in a transcript, which only the coding view has
 * anywhere to put.
 *
 * The key sheet stays, though the keys it lists hold in one view: it is the
 * only way into them from anywhere else, because the `?` that opens it is
 * itself one of those keys. A reference about the tool is not the same kind of
 * thing as a control over the material.
 */
function drawChrome() {
  const perInterview = state.view === "code";
  $("#interview-choice").closest(".field").hidden = !perInterview || !state.interviews.length;
  $("#import").hidden = !perInterview;
  $("#header-subtitle").textContent = headerSubtitle();
}

function setView(name, { route = true, push = false } = {}) {
  // The place in the view being left has to be taken before it is hidden: a
  // hidden element has no geometry to read it from.
  if (state.view !== name) rememberViewPosition(state.view);
  state.view = name;
  $$(".tab").forEach((tab) => tab.setAttribute("aria-current", String(tab.dataset.view === name)));
  $("#view-code").hidden = name !== "code";
  $("#view-catalog").hidden = name !== "catalog";
  $("#view-roles").hidden = name !== "roles";
  $("#view-analysis").hidden = name !== "analysis";
  drawChrome();
  if (route) writeRoute({ push });
  const drawn = { analysis: drawAnalysis, catalog: drawCatalog, roles: drawRoles }[name];
  if (drawn) {
    drawn()
      .then(() => restoreViewPosition(name))
      .catch((error) => complain(error));
  }
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
    writeRoute({ push: true });
    restoreReadingPosition();
  });

  $$(".tab").forEach((tab) =>
    tab.addEventListener("click", () => setView(tab.dataset.view, { push: true })),
  );

  /* Back and forward. The hash is the only thing history moves here, so
     hashchange is enough — and it is the same entry point the address bar
     uses when somebody pastes a link. Anything the address asks for that is
     not there is ignored rather than corrected: a mistyped id should not
     silently open a different interview than the one that was sent. */
  window.addEventListener("hashchange", async () => {
    const route = readRoute();
    if (!route.view) return writeRoute();
    if (
      route.interview &&
      route.interview !== state.current &&
      state.interviews.some((interview) => interview.id === route.interview)
    ) {
      state.current = route.interview;
      $("#interview-choice").value = route.interview;
      await loadTranscript();
      drawAll();
      restoreReadingPosition();
    }
    if (route.view !== state.view) setView(route.view, { route: false });
  });

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
        // The detail panel is showing that it is waiting for a passage; taking
        // that back has to take the sentence back with it.
        drawDetail();
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
      writeRoute({ push: true });
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

    const proposition = event.target.closest("[data-category-proposition]");
    if (proposition) {
      const category = categoryById(proposition.dataset.categoryProposition);
      if ((category.proposition ?? NO_PROPOSITION) === proposition.value) return;
      return updateCategory(
        category.id,
        { proposition: proposition.value },
        t("categoryNowArgues", {
          name: category.name,
          proposition: propositionName(proposition.value),
        }),
      );
    }

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

  /* The interview's own description. Everything here writes the header of the
     transcript and nothing writes its turns, so no citation moves. */
  const about = $("#about-form");

  const metaFromForm = () =>
    Object.fromEntries(
      [...about.querySelectorAll(".meta-line")]
        .map((line) => [
          line.querySelector("[data-meta-key]").value.trim(),
          line.querySelector("[data-meta-value]").value.trim(),
        ])
        .filter(([key, value]) => key && value),
    );

  about.addEventListener("change", (event) => {
    const line = event.target.closest(".meta-line");
    if (line) return updateAbout({ meta: metaFromForm() }, t("headerSaved"));
    const which = event.target.dataset?.about;
    if (which === "title") {
      const title = event.target.value.trim();
      if (!title || title === state.transcript.title) return drawAbout();
      return updateAbout({ title }, t("interviewRenamed", { title }));
    }
    if (which === "department") {
      const department = event.target.value.trim();
      if (!department || department === state.transcript.department) return drawAbout();
      return updateAbout({ department }, t("departmentSet", { department }));
    }
  });

  about.addEventListener("submit", (event) => {
    if (event.target.id !== "meta-new") return;
    event.preventDefault();
    const key = $("#meta-new-key").value.trim();
    const value = $("#meta-new-value").value.trim();
    if (!key || !value) return;
    updateAbout({ meta: { ...metaFromForm(), [key]: value } }, t("headerSaved"));
  });

  about.addEventListener("click", async (event) => {
    if (event.target.closest("[data-meta-remove]")) {
      const line = event.target.closest(".meta-line");
      const key = line.querySelector("[data-meta-key]").value.trim();
      line.remove();
      return updateAbout({ meta: metaFromForm() }, t("headerRemoved", { field: key }));
    }

    if (event.target.id === "about-rename") {
      const wanted = $("#about-folder").value.trim();
      if (!wanted || wanted === state.current) return;
      try {
        const moved = await api(
          `/api/interviews/${encodeURIComponent(state.current)}/rename`,
          { method: "POST", body: { to: wanted } },
        );
        // Everything that remembers where one was is keyed by the folder name,
        // so the reading position moves along rather than pointing at a folder
        // that is gone.
        const position = localStorage.getItem(STORAGE.readingPosition(state.current));
        localStorage.removeItem(STORAGE.readingPosition(state.current));
        if (position) localStorage.setItem(STORAGE.readingPosition(moved.id), position);
        state.current = moved.id;
        localStorage.setItem(STORAGE.interview, moved.id);
        await loadInterviewList();
        $("#interview-choice").value = moved.id;
        await loadTranscript();
        drawAll();
        // Replaced, not pushed: the folder under the old name no longer
        // exists, and back would lead to an address that cannot be opened.
        writeRoute();
        notify(t("folderRenamed", { folder: moved.id }));
      } catch (error) {
        complain(error);
      }
      return;
    }

    if (event.target.id !== "about-remove") return;
    /* The most destructive thing the tool can be asked to do, and the one place
       it asks first: transcript and codings go together, and there is no copy
       anywhere — they are version-controlled beside each other, which is what
       the folder layout is for and where they can be got back from. */
    const said = t("removeInterviewConfirm", {
      title: state.transcript.title,
      n: state.codings.length,
    });
    if (!confirm(said)) return;
    try {
      await api(`/api/interviews/${encodeURIComponent(state.current)}`, { method: "DELETE" });
      const gone = state.current;
      localStorage.removeItem(STORAGE.readingPosition(gone));
      state.current = null;
      state.transcript = null;
      state.codings = [];
      await loadInterviews();
      await loadTranscript();
      drawAll();
      writeRoute();
      notify(t("interviewRemoved", { title: gone }));
    } catch (error) {
      complain(error);
    }
  });

  const propositions = $("#propositions");

  propositions.addEventListener("change", (event) => {
    const row = event.target.closest("[data-proposition]");
    if (!row) return;
    const id = row.dataset.proposition;
    const proposition = state.propositions[id];
    if (!proposition) return;
    if (event.target.matches("[data-proposition-name]")) {
      const name = event.target.value.trim();
      if (!name || name === proposition.name) return drawPropositions();
      return updateProposition(id, { name }, t("propositionRenamed", { name }));
    }
    if (event.target.matches("[data-proposition-color]")) {
      if (event.target.value === proposition.color) return;
      return updateProposition(id, { color: event.target.value }, t("propositionRecoloured"));
    }
  });

  propositions.addEventListener("click", async (event) => {
    const remove = event.target.closest("[data-proposition-remove]");
    if (!remove) return;
    const id = remove.closest("[data-proposition]").dataset.proposition;
    const name = state.propositions[id]?.name ?? id;
    try {
      await api(`/api/propositions/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadCategories();
      drawAll();
      notify(t("propositionRemoved", { name }));
    } catch (error) {
      complain(error);
    }
  });

  $("#proposition-new").addEventListener("submit", async (event) => {
    event.preventDefault();
    const field = $("#proposition-name");
    const name = field.value.trim();
    if (!name) return;
    try {
      await api("/api/propositions", {
        method: "POST",
        body: { name, color: $("#proposition-color").value },
      });
      field.value = "";
      await loadCategories();
      drawAll();
      notify(t("propositionAdded", { name }));
    } catch (error) {
      complain(error);
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
    if (event.target.id === "operation-new") {
      event.preventDefault();
      const field = $("#operation-name");
      const name = field.value.trim();
      if (!name) return;
      try {
        await api("/api/operations", { method: "POST", body: { name } });
        field.value = "";
        state.operationsOpen = true;
        await drawCatalog();
        notify(t("operationAdded", { name }));
      } catch (error) {
        complain(error);
      }
      return;
    }
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

  catalog.addEventListener("toggle", (event) => {
    if (event.target.id === "operations-shell") state.operationsOpen = event.target.open;
  }, true);

  catalog.addEventListener("change", async (event) => {
    const operation = event.target.closest("[data-operation]");
    if (operation && event.target.matches("[data-operation-name]")) {
      const id = operation.dataset.operation;
      const name = event.target.value.trim();
      const before = state.operations.find((one) => one.id === id);
      if (!name || name === before?.name) return drawCatalog();
      try {
        await api(`/api/operations/${encodeURIComponent(id)}`, { method: "PATCH", body: { name } });
        await drawCatalog();
        notify(t("operationRenamed", { name }));
      } catch (error) {
        complain(error);
      }
      return;
    }

    const card = event.target.closest(".requirement");
    if (!card) return;
    const id = card.dataset.id;
    const fields = {};
    let said = t("requirementSaved");
    if (event.target.classList.contains("level")) {
      fields.moscow = event.target.value || null;
      said = t("requirementLevelSet", { level: moscowName(fields.moscow) });
    }
    if (event.target.classList.contains("title")) {
      fields.title = event.target.value.trim();
      said = t("requirementRenamed", { title: fields.title });
    }
    if (event.target.classList.contains("definition")) {
      fields.definition = event.target.value;
      said = t("requirementDefinitionSaved");
    }
    if (event.target.classList.contains("description")) {
      fields.description = event.target.value;
      said = t("noteSaved");
    }
    if (event.target.dataset.blocked) {
      fields.blockedOperations = [...card.querySelectorAll("[data-blocked]")]
        .filter((box) => box.checked)
        .map((box) => box.dataset.blocked);
      said = fields.blockedOperations.length
        ? t("requirementBlocks", {
            operations: fields.blockedOperations
              .map((one) => state.operations.find((each) => each.id === one)?.name ?? one)
              .join(", "),
          })
        : t("requirementBlocksNothing");
    }
    if (!Object.keys(fields).length) return;
    try {
      await api(`/api/requirements/${id}`, { method: "PATCH", body: fields });
      // The order hangs off the level, so a level change redraws everything.
      // Anything else only moves the charts — and redrawing the cards under a
      // hand that is still working in them would pull the field away.
      if ("moscow" in fields) await drawCatalog();
      else await drawCatalogCharts();
      /* Said out loud, because it is the only sign there is. The category panel
         has confirmed every change since it existed; the catalog saved in
         silence, and a field that answers nothing looks exactly like a field
         that did not save. */
      notify(said);
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

  /* The profiles lead back the same way, only by turn rather than by coding
     unit: a profile cites what was said, and the study's own document names it
     by the number of the speaker turn. That number is the one address every
     part of this tool shares, so it is enough to land on the passage. */
  $("#roles").addEventListener("click", (event) => {
    const goto = event.target.closest("[data-role-turn]");
    if (goto) showTurn(goto.dataset.interview, Number(goto.dataset.roleTurn));
  });

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

  /**
   * A tip beside the pointer, inside the window whatever the pointer is doing.
   *
   * Three things in order, because each one can only be decided once the one
   * before it is settled. First how wide it may be: the window less a margin,
   * which is what makes a long tip wrap instead of running off — the figures
   * now take the whole column, so hovering the last cell of a heatmap means
   * hovering a few pixels from the right edge, and that is the ordinary case
   * rather than the awkward one. Then which side of the pointer it goes: the
   * right if it fits there, otherwise the left, and clamped to the margin if
   * neither — which can only happen when the tip is as wide as the window, and
   * then it is already wrapped. Then above or below, by the same rule.
   *
   * Measured after the text is in and the width is capped, because a box that
   * has not been laid out yet has no width to place.
   */
  function place(tip, event) {
    const EDGE = 8;
    const GAP = 14;
    const room = document.documentElement.clientWidth - 2 * EDGE;
    tip.style.maxWidth = `${room}px`;

    const box = tip.getBoundingClientRect();
    let x = event.clientX + GAP;
    if (x + box.width > document.documentElement.clientWidth - EDGE) {
      x = event.clientX - GAP - box.width;
    }
    x = Math.max(EDGE, x);

    let y = event.clientY - box.height - 10;
    if (y < EDGE) y = event.clientY + 18;

    const frame = tip.parentElement.getBoundingClientRect();
    tip.style.left = `${x - frame.left}px`;
    tip.style.top = `${y - frame.top}px`;
  }

  /* Tooltips of the charts: follow the mouse over anything that carries one.
     Which is the trouble with this list — a mark carries `data-tip` where it is
     drawn and is named again here, three hundred lines away, so a new figure
     hovers and lights up and says nothing. The reach dots and the towers of the
     city did exactly that: both have a `:hover` rule, so they promised a
     tooltip and had none. Anything carrying a tip qualifies now; the classes
     stay only for marks whose tip sits on a parent. */
  const HOVERABLE = "[data-tip], .segment, .cell, .point, .moscow-band, .part-swatch, .bar-badge";
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
      place(tip, event);
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
    const dissolve = event.target.closest("[data-operation-remove]");
    if (dissolve) {
      const row = dissolve.closest("[data-operation]");
      const id = row.dataset.operation;
      const name = state.operations.find((one) => one.id === id)?.name ?? id;
      const used = state.requirements.filter((requirement) =>
        (requirement.blockedOperations ?? []).includes(id),
      ).length;
      /* Asked, and only when there is something to lose: the operation goes off
         every requirement that names it, and that judgement was made one card
         at a time. With nothing hanging on it there is nothing to warn about. */
      if (used && !confirm(t("operationRemoveConfirm", { name, n: used }))) return;
      try {
        const gone = await api(`/api/operations/${encodeURIComponent(id)}`, { method: "DELETE" });
        await drawCatalog();
        notify(
          gone.dropped
            ? t("operationRemovedFrom", { name, n: gone.dropped })
            : t("operationRemoved", { name }),
        );
      } catch (error) {
        complain(error);
      }
      return;
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
    let said = null;
    // Whoever changes the category has decided — the passage is reviewed by it.
    if (event.target.id === "detail-category") {
      fields.category = event.target.value;
      if (coding.reviewed !== true) fields.reviewed = true;
      said = t("codedAs", { name: categoryById(fields.category)?.name });
    }
    if (event.target.id === "detail-anchor") {
      fields.anchor = event.target.checked;
      said = t(fields.anchor ? "anchorSet" : "anchorUnset");
    }
    if (event.target.id === "detail-reviewed") {
      fields.reviewed = event.target.checked;
      said = t(fields.reviewed ? "unitReviewed" : "unitUnreviewed");
    }
    if (event.target.id === "detail-memo") {
      fields.memo = event.target.value;
      said = t("noteSaved");
    }
    if (!Object.keys(fields).length) return;
    try {
      const updated = await api(
        `/api/interviews/${encodeURIComponent(state.current)}/codings/${coding.id}`,
        { method: "PATCH", body: fields },
      );
      Object.assign(coding, updated);
      drawAll();
      if (said) notify(said);
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
      if (!coding) return;
      await link(coding, box.dataset.requirement, box.checked);
      const requirement = state.requirements.find((one) => one.id === box.dataset.requirement);
      return notify(
        t(box.checked ? "citationLinked" : "citationUnlinked", { title: requirement?.title ?? "" }),
      );
    }
    // The same move the drift panel offers for a unit that lost its place, from
    // the unit that still has one: mark the passage it should have instead.
    if (event.target.id === "detail-recut") {
      state.reanchoring = state.selected;
      document.body.classList.add("anchoring");
      drawDetail();
      return notify(t("recutMark"));
    }
    if (event.target.id === "detail-recut-cancel") {
      state.reanchoring = null;
      document.body.classList.remove("anchoring");
      drawDetail();
      return notify(t("reanchorCancelled"));
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
  // Read before anything is loaded: an address that names an interview
  // outranks the one this browser happened to have open last, or a link would
  // open whatever the recipient was working on instead of what was sent.
  const route = readRoute();
  try {
    await loadCategories();
    await loadRequirements();
    await loadInterviews();
    if (route.interview && state.interviews.some((i) => i.id === route.interview)) {
      state.current = route.interview;
    }
    await loadTranscript();
    drawAll();
    connectEvents();
    watchSections();
    watchViews();
    watchNotes();
    watchSheets();
    setView(route.view ?? "code");
    if (state.view === "code") restoreReadingPosition();
  } catch (error) {
    cannotStart(error);
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

start();
