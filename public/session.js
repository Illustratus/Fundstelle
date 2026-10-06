/*
  Interview mode: the guide beside a live conversation.

  During an interview the researcher listens, and the screen next to the call
  window has to ask as little as possible of them: where in the guide the
  conversation is, what has been addressed, which mandatory question is still
  open, and a line of note now and then. Everything here is one key away and is
  written the moment it happens — through the interview log (`session.json`),
  whose times are seconds after the recording started. The transcript arrives
  days later and is imported into the same folder; the block starts kept here
  then put the guide's sections where they began.

  The screen is a mode of the coding view, not a view of its own: a log lives
  in an interview folder before that folder is an interview, and the coding
  view is where interviews are opened. It hides the three columns while it
  stands, takes the keyboard for itself, and gives both back when it is left.

  Nothing here keeps time on its own. The clock is computed from `t0` and the
  wall clock every time it is drawn, so a sleeping laptop or a busy tab cannot
  make it drift; every time that is stored is measured by the server.
*/

import { language, t } from "./texts.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const STORAGE = "fundstelle.live";

const escapeHTML = (text) =>
  String(text ?? "").replace(
    /[&<>"]/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character],
  );

/** Seconds as the recording's own timestamps write them: m:ss, h:mm:ss. */
export function clockText(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const wallTime = (iso) =>
  new Date(iso).toLocaleTimeString(language() === "de" ? "de-DE" : "en-GB");

let deps = null;

const live = {
  rounds: [],
  sessions: [],
  // The open log as the server last answered it, or null outside the mode.
  session: null,
  // The block on screen; not necessarily the one the conversation is in.
  shown: null,
  summary: false,
  saving: "idle",
  savedAt: null,
  // Half-typed notes per block, so moving through the guide loses none.
  drafts: new Map(),
  editing: null,
  correcting: null,
  keysOpen: false,
  queue: Promise.resolve(),
  clock: null,
  listed: 0,
};

/* Persistence of the mode itself ------------------------------------------- */

function remember() {
  try {
    if (!live.session) localStorage.removeItem(STORAGE);
    else {
      localStorage.setItem(
        STORAGE,
        JSON.stringify({ id: live.session.id, shown: live.shown, summary: live.summary }),
      );
    }
  } catch {
    /* A browser without storage loses the mode on reload, nothing else. */
  }
}

function remembered() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE) ?? "null");
  } catch {
    return null;
  }
}

/* The guide, read for one block --------------------------------------------- */

const blocks = () => live.session?.blocks ?? [];
const blockById = (id) => blocks().find((block) => block.id === id) ?? null;
const shownBlock = () => blockById(live.shown) ?? blocks()[0] ?? null;

/** Mandatory questions first: they are what must not be missed. */
function itemsOf(block) {
  if (!block) return [];
  return [
    ...(block.mandatory ?? []).map((item) => ({ ...item, kind: "mandatory" })),
    ...(block.checklist ?? []).map((item) => ({ ...item, kind: "checklist" })),
  ];
}

const ticked = (item) => Object.hasOwn(live.session?.ticks ?? {}, item.id);
const keyOf = (index) => (index < 9 ? String(index + 1) : index === 9 ? "0" : null);

const openMandatory = (block) => (block.mandatory ?? []).filter((item) => !ticked(item));

function startsOf(id) {
  return (live.session?.blockStarts ?? []).filter((one) => one.block === id);
}

function elapsed() {
  const t0 = live.session?.t0;
  return t0 ? (Date.now() - Date.parse(t0)) / 1000 : null;
}

/* Talking to the server ------------------------------------------------------ */

async function refreshLists() {
  try {
    const [rounds, sessions] = await Promise.all([
      deps.api("/api/rounds"),
      deps.api("/api/sessions"),
    ]);
    live.rounds = rounds.rounds;
    live.sessions = sessions.sessions;
  } catch {
    /* The button simply stays as it was; the sheet says what failed. */
  }
  drawButton();
}

let refreshing = null;
function refreshSoon() {
  lastRefresh = Date.now();
  refreshing ??= refreshLists().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/**
 * One change to the log. Changes go out one after the other, in the order
 * they were made — a tick and its untick must not overtake each other — and
 * the screen is drawn from what the server answers, never from a guess.
 */
function send(op) {
  const id = live.session?.id;
  if (!id) return Promise.resolve(null);
  const run = live.queue.then(async () => {
    setSaving("saving");
    try {
      const view = await deps.api(`/api/sessions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: op,
      });
      if (live.session?.id === id) {
        live.session = view;
        setSaving("saved");
        draw();
      }
      return view;
    } catch (error) {
      setSaving("failed");
      deps.complain(error);
      return null;
    }
  });
  live.queue = run;
  return run;
}

function setSaving(state) {
  live.saving = state;
  if (state === "saved") live.savedAt = new Date().toISOString();
  const element = $("#live-saved");
  if (!element) return;
  element.dataset.state = state;
  element.textContent =
    state === "saving"
      ? t("liveSaving")
      : state === "saved"
        ? t("liveSaved", { time: wallTime(live.savedAt) })
        : state === "failed"
          ? t("liveSaveFailed")
          : "";
}

/* Entering and leaving -------------------------------------------------------- */

async function openLive(id, { shown = null, summary = false } = {}) {
  const view = await deps.api(`/api/sessions/${encodeURIComponent(id)}`);
  live.session = view;
  live.shown = blockById(shown)?.id ?? view.current ?? view.blocks[0]?.id ?? null;
  live.summary = summary;
  live.editing = null;
  live.correcting = null;
  live.saving = "idle";
  $("#view-code").classList.add("live");
  $("#live-view").hidden = false;
  buildBlockShell();
  draw();
  remember();
  clearInterval(live.clock);
  // A quarter second: the display never lags a second behind the recording,
  // and the number shown is always computed afresh rather than counted up.
  live.clock = setInterval(drawClock, 250);
  drawSubtitle();
  // The keys belong to this screen from the first moment: a header button
  // left holding the focus would take the space bar for itself.
  $("#live-view").focus({ preventScroll: true });
}

function closeLive() {
  clearInterval(live.clock);
  live.clock = null;
  live.session = null;
  live.summary = false;
  live.editing = null;
  live.correcting = null;
  $("#view-code").classList.remove("live");
  $("#live-view").hidden = true;
  remember();
  drawSubtitle();
  refreshSoon();
}

const isLive = () => Boolean(live.session) && !$("#view-code").hidden;

/* The header button ----------------------------------------------------------- */

const openCount = () => live.sessions.filter((one) => !one.transcript).length;

function drawButton() {
  const button = $("#live-open");
  if (!button) return;
  const count = openCount();
  // Only for a study that has rounds: a study asked once never sees it.
  button.dataset.available = String(live.rounds.length > 0 || live.sessions.length > 0);
  button.textContent = count ? t("liveButtonCount", { n: count }) : t("liveButton");
}

/**
 * Called whenever the header is drawn. The button belongs to the coding view
 * like the import does; the subtitle says which conversation is open.
 */
export function liveChrome(perInterview) {
  const button = $("#live-open");
  if (!button || !deps) return;
  button.hidden = !perInterview;
  // The header is drawn after every coding; asking the disk each time would
  // be two requests per keystroke for a count that changes a few times a day.
  // Coming back to the view, or a while later, is when it may have changed.
  const arriving = perInterview && !wasPerInterview;
  wasPerInterview = perInterview;
  if (arriving || (perInterview && Date.now() - lastRefresh > 30000)) refreshSoon();
  drawSubtitle();
}

let wasPerInterview = false;
let lastRefresh = 0;

function drawSubtitle() {
  if (!live.session || $("#view-code").hidden) return;
  const round = live.rounds.find((one) => one.id === live.session.round)?.name ?? live.session.round;
  $("#header-subtitle").textContent = [t("liveSubtitle"), live.session.department, round]
    .filter(Boolean)
    .join(" · ");
}

/* The sheet: which conversation ------------------------------------------------- */

async function openSheet() {
  const sheet = $("#live-sheet");
  if (!sheet.open) sheet.showModal();
  $("#live-sheet-body").innerHTML = `<p class="keys-note">${escapeHTML(t("liveLoading"))}</p>`;
  await refreshLists();
  let departments = [];
  try {
    const interviews = await deps.api("/api/interviews");
    departments = interviews.map((one) => one.department);
    for (const round of live.rounds) {
      const guide = await deps.api(`/api/rounds/${encodeURIComponent(round.id)}/guide`);
      for (const block of guide.blocks) {
        departments.push(...Object.keys(block.readout?.perDepartment ?? {}));
      }
    }
  } catch (error) {
    deps.complain(error);
  }
  drawSheet([...new Set(departments.filter(Boolean))].sort((a, b) => a.localeCompare(b)));
}

function sessionLine(one) {
  const round = live.rounds.find((each) => each.id === one.round)?.name ?? one.round ?? "";
  const status = one.transcript
    ? t("liveStatusImported")
    : one.t0
      ? t("liveStatusRecorded", { time: wallTime(one.t0) })
      : t("liveStatusPlanned");
  const counts = t("liveSessionCounts", { blocks: one.blocks, ticks: one.ticks, notes: one.notes });
  const empty = !one.transcript && !one.t0 && !one.blocks && !one.ticks && !one.notes;
  return (
    `<li class="live-session">` +
    `<button type="button" class="live-session-open" data-id="${escapeHTML(one.id)}">` +
    `<b>${escapeHTML(one.department || "—")}</b>` +
    `<span>${escapeHTML([round, one.id].filter(Boolean).join(" · "))}</span>` +
    `<span>${escapeHTML(status)} · ${escapeHTML(counts)}</span>` +
    `</button>` +
    (empty
      ? `<button type="button" class="button-quiet live-session-discard" data-id="${escapeHTML(one.id)}">${escapeHTML(t("liveDiscard"))}</button>`
      : "") +
    `</li>`
  );
}

function drawSheet(departments) {
  const body = $("#live-sheet-body");
  const open = live.sessions.filter((one) => !one.transcript);
  const done = live.sessions.filter((one) => one.transcript);
  // The guide a conversation follows is the round's; the last round with one
  // is the round being asked right now, almost always.
  const guided = live.rounds.filter((one) => one.blocks > 0);
  const preferred = (guided.at(-1) ?? live.rounds.at(-1))?.id;

  let html = "";
  if (open.length) {
    html += `<h3 class="live-sheet-heading">${escapeHTML(t("liveOpenSessions"))}</h3>`;
    html += `<ul class="live-sessions" id="live-sessions">${open.map(sessionLine).join("")}</ul>`;
  }
  if (!live.rounds.length) {
    html += `<p class="keys-note live-no-round">${escapeHTML(t("liveNoRound"))}</p>`;
  } else {
    html +=
      `<h3 class="live-sheet-heading">${escapeHTML(t("liveNewHeading"))}</h3>` +
      `<form id="live-new" class="live-new">` +
      `<label class="field"><span class="field-label">${escapeHTML(t("liveRound"))}</span>` +
      `<select id="live-round">${live.rounds
        .map(
          (round) =>
            `<option value="${escapeHTML(round.id)}"${round.id === preferred ? " selected" : ""}>` +
            `${escapeHTML(round.name)}${round.blocks ? "" : ` · ${escapeHTML(t("liveRoundNoGuide"))}`}</option>`,
        )
        .join("")}</select></label>` +
      `<label class="field"><span class="field-label">${escapeHTML(t("department"))}</span>` +
      `<input type="text" id="live-department" required autocomplete="off" list="live-departments"></label>` +
      `<datalist id="live-departments">${departments
        .map((name) => `<option value="${escapeHTML(name)}"></option>`)
        .join("")}</datalist>` +
      `<label class="field"><span class="field-label">${escapeHTML(t("liveFolder"))}</span>` +
      `<input type="text" id="live-folder" autocomplete="off" placeholder="${escapeHTML(t("liveFolderPlaceholder"))}"></label>` +
      `<p class="column-note">${escapeHTML(t("liveNewNote"))}</p>` +
      `<button type="submit" class="button">${escapeHTML(t("liveCreate"))}</button>` +
      `</form>`;
  }
  if (done.length) {
    html +=
      `<details class="live-done"><summary>${escapeHTML(t("liveImportedSessions", { n: done.length }))}</summary>` +
      `<ul class="live-sessions">${done.map(sessionLine).join("")}</ul></details>`;
  }
  body.innerHTML = html;
  const first = $(".live-session-open", body) ?? $("#live-department", body);
  first?.focus();
}

async function createSession(event) {
  event.preventDefault();
  const department = $("#live-department").value.trim();
  if (!department) return $("#live-department").focus();
  const wanted = { department, round: $("#live-round").value };
  const folder = $("#live-folder").value.trim();
  if (folder) wanted.folder = folder;
  try {
    const made = await deps.api("/api/sessions", { method: "POST", body: wanted });
    $("#live-sheet").close();
    await openLive(made.id);
    refreshSoon();
  } catch (error) {
    deps.complain(error);
  }
}

async function discardSession(id) {
  try {
    await deps.api(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
    deps.notify(t("liveDiscarded"));
    await openSheet();
  } catch (error) {
    deps.complain(error);
  }
}

/* Drawing the live screen ------------------------------------------------------ */

/**
 * The parts that hold a caret are built once and never replaced: the note
 * field of the block on screen. Everything around it is redrawn from the log.
 */
function buildBlockShell() {
  const view = $("#live-view");
  if ($("#live-note", view)) return;
  view.innerHTML =
    `<div class="live-bar">` +
    `<button type="button" class="button-quiet" id="live-close">${escapeHTML(t("liveClose"))}</button>` +
    `<div class="live-who" id="live-who"></div>` +
    `<span class="live-saved" id="live-saved" role="status" aria-live="polite"></span>` +
    `<button type="button" class="button-quiet" id="live-summary-open"></button>` +
    `</div>` +
    `<div class="live-record" id="live-record-area"></div>` +
    `<div class="live-body" id="live-body">` +
    `<nav class="live-overview" aria-label="${escapeHTML(t("liveOverview"))}">` +
    `<h2 class="column-title">${escapeHTML(t("liveOverview"))}</h2>` +
    `<ol id="live-overview"></ol></nav>` +
    `<article class="live-block" id="live-block">` +
    `<div id="live-block-main"></div>` +
    `<section class="live-notes">` +
    `<label class="live-label" for="live-note">${escapeHTML(t("liveNoteLabel"))} <kbd>n</kbd></label>` +
    `<input type="text" id="live-note" autocomplete="off" spellcheck="true" placeholder="${escapeHTML(t("liveNotePlaceholder"))}">` +
    `<ol class="live-note-list" id="live-note-list"></ol>` +
    `</section>` +
    `</article>` +
    `</div>` +
    `<section class="live-summary" id="live-summary" hidden></section>` +
    `<details class="live-keys" id="live-keys"><summary>${escapeHTML(t("liveKeysSummary"))}</summary>` +
    `<dl>${LIVE_KEYS.map(
      ([keys, what]) =>
        `<dt>${keys.map((key) => `<kbd>${escapeHTML(key)}</kbd>`).join("")}</dt><dd>${escapeHTML(t(what))}</dd>`,
    ).join("")}</dl></details>`;
}

const LIVE_KEYS = [
  [["␣"], "liveKeyRecord"],
  [["b"], "liveKeyBlock"],
  [["⇧B"], "liveKeyUnblock"],
  [["←", "→"], "liveKeyMove"],
  [["1", "…", "9", "0"], "liveKeyTick"],
  [["r"], "liveKeyReadout"],
  [["n"], "liveKeyNote"],
  [["t"], "liveKeyCorrect"],
  [["e"], "liveKeySummary"],
  [["Esc"], "liveKeyEscape"],
  [["?"], "liveKeyHelp"],
];

function draw() {
  if (!live.session) return;
  const focused = document.activeElement?.closest?.("#live-view")
    ? document.activeElement.dataset.focus
    : null;

  const session = live.session;
  const round = live.rounds.find((one) => one.id === session.round)?.name ?? session.round ?? "";
  $("#live-who").innerHTML =
    `<b>${escapeHTML(session.department || "—")}</b>` +
    `<span>${escapeHTML([round, session.id].filter(Boolean).join(" · "))}</span>` +
    (session.transcript ? `<span class="live-badge">${escapeHTML(t("liveStatusImported"))}</span>` : "");
  $("#live-summary-open").innerHTML = live.summary
    ? `${escapeHTML(t("liveBackToTalk"))} <kbd>e</kbd>`
    : `${escapeHTML(t("liveSummaryOpen"))} <kbd>e</kbd>`;
  setSaving(live.saving);

  drawRecord();
  $("#live-body").hidden = live.summary;
  $("#live-summary").hidden = !live.summary;
  if (live.summary) drawSummary();
  else {
    drawOverview();
    drawBlock();
    drawNotes();
  }

  if (focused) $(`#live-view [data-focus="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  remember();
}

function drawRecord() {
  const area = $("#live-record-area");
  const t0 = live.session.t0;
  if (!t0) {
    area.innerHTML =
      `<button type="button" class="live-record-button" id="live-record" data-focus="record">` +
      `<span class="live-dot" aria-hidden="true"></span>` +
      `<span><b>${escapeHTML(t("liveRecord"))}</b>` +
      `<small>${escapeHTML(t("liveRecordHint"))}</small></span></button>`;
    return;
  }
  area.innerHTML =
    `<div class="live-clock" role="timer" aria-label="${escapeHTML(t("liveClockAria"))}">` +
    `<span class="live-dot live-dot-on" aria-hidden="true"></span>` +
    `<span class="live-clock-time" id="live-clock">${clockText(elapsed())}</span></div>` +
    `<div class="live-t0">` +
    `<span>${escapeHTML(t("liveRecordingSince", { time: wallTime(t0) }))}</span>` +
    `<button type="button" class="button-quiet" id="live-correct-open" data-focus="correct-open">` +
    `${escapeHTML(t("liveCorrect"))} <kbd>t</kbd></button></div>` +
    (live.correcting !== null
      ? `<form class="live-correct" id="live-correct">` +
        `<label>${escapeHTML(t("liveCorrectBefore"))} ` +
        `<input type="number" step="0.1" id="live-correct-seconds" data-focus="correct" value="${escapeHTML(live.correcting)}"> ` +
        `${escapeHTML(t("liveCorrectAfter"))}</label>` +
        `<button type="submit" class="button">${escapeHTML(t("liveCorrectApply"))}</button>` +
        `<button type="button" class="button-quiet" id="live-correct-cancel">${escapeHTML(t("cancel"))}</button>` +
        `<p class="column-note">${escapeHTML(t("liveCorrectNote"))}</p>` +
        `</form>`
      : "");
}

function drawClock() {
  const element = $("#live-clock");
  if (!element) return;
  const text = clockText(elapsed());
  if (element.textContent !== text) element.textContent = text;
}

function drawOverview() {
  const list = $("#live-overview");
  const current = live.session.current;
  list.innerHTML = blocks()
    .map((block) => {
      const starts = startsOf(block.id);
      const open = openMandatory(block).length;
      const meta = [
        starts.length ? clockText(starts.at(-1).at) : t("liveNotStarted"),
        open ? t("liveOpenMandatoryShort", { n: open }) : "",
      ].filter(Boolean);
      return (
        `<li><button type="button" data-show="${escapeHTML(block.id)}" data-focus="show-${escapeHTML(block.id)}"` +
        ` class="${[current === block.id ? "is-current" : "", starts.length ? "is-started" : "", open ? "has-open" : ""].join(" ").trim()}"` +
        `${block.id === live.shown ? ' aria-current="step"' : ""}>` +
        `<span class="live-overview-name">${escapeHTML(block.name)}</span>` +
        `<span class="live-overview-meta">${meta.map((part) => `<span>${escapeHTML(part)}</span>`).join("")}</span>` +
        `</button></li>`
      );
    })
    .join("");
}

function itemHTML(item, index) {
  const done = ticked(item);
  const at = done ? live.session.ticks[item.id] : null;
  const key = keyOf(index);
  const mandatory = item.kind === "mandatory";
  return (
    `<button type="button" class="live-item ${mandatory ? "live-mandatory" : "live-chip"}"` +
    ` data-item="${escapeHTML(item.id)}" data-focus="item-${escapeHTML(item.id)}" aria-pressed="${done}">` +
    (key ? `<kbd>${key}</kbd>` : "") +
    `<span class="live-item-text">` +
    (item.condition ? `<span class="live-condition">${escapeHTML(item.condition)}</span> ` : "") +
    `${escapeHTML(item.text)}</span>` +
    (item.tag ? `<span class="live-tag">${escapeHTML(item.tag)}</span>` : "") +
    `<span class="live-item-state">${done ? `✓ ${escapeHTML(clockText(at) === "—" ? "" : clockText(at))}` : ""}</span>` +
    `</button>`
  );
}

function readoutHTML(block) {
  if (!block.readout) return "";
  const items = live.session.readoutItems?.[block.id];
  const label = block.readout.label || t("liveReadout");
  if (!items?.length) {
    return (
      `<section class="live-section live-readout"><h3 class="live-label">${escapeHTML(label)}</h3>` +
      `<p class="column-note">${escapeHTML(t("liveReadoutNone", { department: live.session.department || "—" }))}</p></section>`
    );
  }
  const states = live.session.readout?.[block.id] ?? {};
  const counts = readoutCounts(block.id);
  return (
    `<section class="live-section live-readout"><h3 class="live-label">${escapeHTML(label)} <kbd>r</kbd>` +
    `<span class="live-readout-count">${escapeHTML(t("liveReadoutCounts", counts))}</span></h3>` +
    `<p class="column-note">${escapeHTML(t("liveReadoutNote"))}</p>` +
    `<ul class="live-readout-list">${items
      .map((item, row) => {
        const state = states[item] ?? null;
        const option = (value, text) =>
          `<button type="button" class="live-readout-state" data-item="${escapeHTML(item)}" data-state="${value}"` +
          ` data-row="${row}" data-focus="readout-${row}-${value}" aria-pressed="${state === value}">${escapeHTML(text)}</button>`;
        return (
          `<li class="live-readout-row" data-state="${state ?? "open"}">` +
          `<span class="live-readout-item">${escapeHTML(item)}</span>` +
          option("still", t("liveStill")) +
          option("no-longer", t("liveNoLonger")) +
          `</li>`
        );
      })
      .join("")}</ul></section>`
  );
}

function readoutCounts(blockId) {
  const items = live.session.readoutItems?.[blockId] ?? [];
  const states = live.session.readout?.[blockId] ?? {};
  const still = items.filter((item) => states[item] === "still").length;
  const noLonger = items.filter((item) => states[item] === "no-longer").length;
  return { listed: items.length, still, noLonger, open: items.length - still - noLonger };
}

function drawBlock() {
  const main = $("#live-block-main");
  const block = shownBlock();
  if (!block) {
    main.innerHTML = `<p class="live-empty">${escapeHTML(t("liveNoGuide"))}</p>`;
    return;
  }
  const all = blocks();
  const position = all.indexOf(block);
  const starts = startsOf(block.id);
  const current = live.session.current;
  const items = itemsOf(block);
  const mandatory = items.filter((item) => item.kind === "mandatory");
  const checklist = items.filter((item) => item.kind === "checklist");

  const startLine = starts.length
    ? `<span class="live-started">${escapeHTML(
        t("liveStartedAt", { times: starts.map((one) => clockText(one.at)).join(", ") }),
      )}</span>` +
      `<button type="button" class="button-quiet" id="live-unblock" data-focus="unblock">${escapeHTML(t("liveUnblock"))} <kbd>⇧B</kbd></button>`
    : "";
  const elsewhere =
    current && current !== block.id
      ? `<p class="live-elsewhere">${escapeHTML(t("liveConversationIn", { name: blockById(current)?.name ?? current }))}</p>`
      : "";

  main.innerHTML =
    `<header class="live-block-head">` +
    `<span class="live-position">${escapeHTML(t("liveBlockOf", { n: position + 1, total: all.length }))}</span>` +
    `<h2 class="live-block-name${current === block.id ? " is-current" : ""}">${escapeHTML(block.name)}</h2>` +
    `<div class="live-start-row">` +
    `<button type="button" class="live-start${current === block.id ? " is-current" : ""}" id="live-block-start" data-focus="block-start">` +
    `${escapeHTML(current === block.id ? t("liveBlockRunning") : t("liveBlockStart"))} <kbd>b</kbd></button>` +
    startLine +
    `</div>` +
    elsewhere +
    `</header>` +
    (block.prompt ? `<p class="live-prompt">${escapeHTML(block.prompt)}</p>` : "") +
    (mandatory.length
      ? `<section class="live-section"><h3 class="live-label">${escapeHTML(t("liveMandatory"))}</h3>` +
        `<div class="live-mandatory-list">${mandatory.map((item) => itemHTML(item, items.indexOf(item))).join("")}</div></section>`
      : "") +
    (checklist.length
      ? `<section class="live-section"><h3 class="live-label">${escapeHTML(t("liveChecklist"))}</h3>` +
        `<p class="column-note">${escapeHTML(t("liveChecklistNote"))}</p>` +
        `<div class="live-chips">${checklist.map((item) => itemHTML(item, items.indexOf(item))).join("")}</div></section>`
      : "") +
    readoutHTML(block);
}

function drawNotes() {
  const block = shownBlock();
  const field = $("#live-note");
  const id = block?.id ?? null;
  if (field.dataset.block !== String(id)) {
    field.dataset.block = String(id);
    field.value = live.drafts.get(id) ?? "";
  }
  const notes = live.session.notes.filter((note) => note.block === id);
  $("#live-note-list").innerHTML = notes.map(noteHTML).join("");
  if (live.editing) {
    const input = $(`#live-note-list [data-edit="${CSS.escape(live.editing.id)}"]`);
    if (input && document.activeElement !== input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }
}

function noteHTML(note) {
  const editing = live.editing?.id === note.id;
  return (
    `<li class="live-note" data-note="${escapeHTML(note.id)}">` +
    `<time>${escapeHTML(clockText(note.at))}</time>` +
    (editing
      ? `<input type="text" class="live-note-input" data-edit="${escapeHTML(note.id)}" value="${escapeHTML(live.editing.text)}"` +
        ` aria-label="${escapeHTML(t("liveNoteEditAria"))}">`
      : `<span class="live-note-text">${escapeHTML(note.text)}</span>` +
        `<button type="button" class="button-quiet live-note-edit" data-note="${escapeHTML(note.id)}" data-focus="edit-${escapeHTML(note.id)}"` +
        ` title="${escapeHTML(t("liveNoteEdit"))}" aria-label="${escapeHTML(t("liveNoteEdit"))}">✎</button>` +
        `<button type="button" class="button-quiet live-note-delete" data-note="${escapeHTML(note.id)}" data-focus="delete-${escapeHTML(note.id)}"` +
        ` title="${escapeHTML(t("liveNoteDelete"))}" aria-label="${escapeHTML(t("liveNoteDelete"))}">×</button>`) +
    `</li>`
  );
}

/* After the conversation ----------------------------------------------------------- */

function drawSummary() {
  const session = live.session;
  const all = blocks();
  const openItems = all.flatMap((block) =>
    openMandatory(block).map((item) => ({ block, item })),
  );
  const unstarted = all.filter((block) => !startsOf(block.id).length);
  const readouts = all.filter((block) => live.session.readoutItems?.[block.id]?.length);
  const names = new Map(all.map((block) => [block.id, block.name]));
  const notes = [...session.notes].sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));

  $("#live-summary").innerHTML =
    `<h2 class="live-summary-title">${escapeHTML(t("liveSummaryTitle"))}</h2>` +
    `<section class="live-section"><h3 class="live-label">${escapeHTML(t("liveSummaryMandatory"))}</h3>` +
    (openItems.length
      ? `<ul class="live-summary-open">${openItems
          .map(
            ({ block, item }) =>
              `<li><button type="button" class="live-summary-goto" data-show="${escapeHTML(block.id)}">${escapeHTML(block.name)}</button> ` +
              (item.condition ? `<span class="live-condition">${escapeHTML(item.condition)}</span> ` : "") +
              `${escapeHTML(item.text)}</li>`,
          )
          .join("")}</ul>`
      : `<p class="live-all-done">${escapeHTML(t("liveSummaryAllAsked"))}</p>`) +
    `</section>` +
    (unstarted.length
      ? `<section class="live-section"><h3 class="live-label">${escapeHTML(t("liveSummaryUnstarted"))}</h3>` +
        `<p>${unstarted.map((block) => escapeHTML(block.name)).join(" · ")}</p></section>`
      : "") +
    readouts
      .map((block) => {
        const counts = readoutCounts(block.id);
        return (
          `<section class="live-section"><h3 class="live-label">${escapeHTML(block.readout.label || t("liveReadout"))}</h3>` +
          `<p class="live-summary-readout">${escapeHTML(t("liveReadoutCounts", counts))}</p></section>`
        );
      })
      .join("") +
    `<section class="live-section"><h3 class="live-label">${escapeHTML(t("liveSummaryNotes", { n: notes.length }))}</h3>` +
    (notes.length
      ? `<ol class="live-summary-notes">${notes
          .map(
            (note) =>
              `<li><time>${escapeHTML(clockText(note.at))}</time> ` +
              `<span class="live-summary-block">${escapeHTML(names.get(note.block) ?? t("liveNoBlock"))}</span> ` +
              `${escapeHTML(note.text)}</li>`,
          )
          .join("")}</ol>`
      : `<p class="column-note">${escapeHTML(t("liveSummaryNoNotes"))}</p>`) +
    `</section>` +
    `<p class="live-import-hint">${escapeHTML(
      session.transcript
        ? t("liveImportDone")
        : session.t0
          ? t("liveImportHint", { folder: session.id })
          : t("liveImportNoT0", { folder: session.id }),
    )}</p>`;
}

/* Acting ---------------------------------------------------------------------------- */

function show(id) {
  if (!blockById(id)) return;
  const field = $("#live-note");
  if (field) live.drafts.set(live.shown, field.value);
  live.shown = id;
  live.editing = null;
  if (live.summary) live.summary = false;
  draw();
  $("#live-block").scrollTop = 0;
}

function step(direction) {
  const all = blocks();
  const at = all.findIndex((block) => block.id === live.shown);
  const next = all[Math.min(all.length - 1, Math.max(0, at + direction))];
  if (next) show(next.id);
}

function toggleItem(id) {
  return send(ticked({ id }) ? { op: "untick", item: id } : { op: "tick", item: id });
}

function toggleReadout(item, state) {
  const block = shownBlock();
  const now = live.session.readout?.[block.id]?.[item] ?? null;
  return send({ op: "readout", block: block.id, item, state: now === state ? null : state });
}

async function saveNote() {
  const field = $("#live-note");
  const text = field.value.trim();
  if (!text) return;
  const block = shownBlock();
  const answer = await send(block ? { op: "note", text, block: block.id } : { op: "note", text, block: null });
  if (answer) {
    // Only what was sent goes: anything typed while it was on its way stays.
    if (field.value.trim() === text) field.value = "";
    live.drafts.set(block?.id ?? null, field.value);
  }
}

async function saveEdit() {
  const editing = live.editing;
  if (!editing) return;
  const text = editing.text.trim();
  if (!text) return deleteNote(editing.id);
  live.editing = null;
  await send({ op: "edit-note", note: editing.id, text });
  $(`#live-note-list [data-focus="edit-${CSS.escape(editing.id)}"]`)?.focus();
}

async function deleteNote(id) {
  const note = live.session.notes.find((one) => one.id === id);
  if (!note) return;
  live.editing = null;
  const answer = await send({ op: "delete-note", note: id });
  if (!answer) return;
  deps.notify(t("liveNoteDeleted"), "info", {
    label: t("undo"),
    // Back with its own time and block: a note restored is the same note.
    run: () => send({ op: "note", text: note.text, block: note.block, at: note.at ?? undefined }),
  });
  $("#live-note").focus();
}

async function correctT0(event) {
  event.preventDefault();
  const seconds = Number($("#live-correct-seconds").value);
  if (!Number.isFinite(seconds)) return;
  const t0 = new Date(Date.parse(live.session.t0) - seconds * 1000).toISOString();
  live.correcting = null;
  await send({ op: "start", t0 });
  $("#live-correct-open")?.focus();
}

function openCorrection() {
  if (!live.session.t0) return;
  live.correcting = live.correcting ?? "";
  draw();
  $("#live-correct-seconds")?.focus();
}

function toggleSummary() {
  live.summary = !live.summary;
  live.editing = null;
  draw();
  $("#live-summary-open").focus();
}

function focusReadout() {
  const rows = $$("#live-block-main .live-readout-row");
  if (!rows.length) return;
  const row = rows.find((one) => one.dataset.state === "open") ?? rows[0];
  $(".live-readout-state", row)?.focus();
}

/* The keyboard ---------------------------------------------------------------------- */

/**
 * The keys of the live screen, taken before the coding view sees them: an
 * „s" or „j" meant for the guide must not walk the transcript hidden behind it.
 */
function onKey(event) {
  if (!isLive()) return;
  if (document.querySelector("dialog[open]")) return;
  const target = event.target;
  const typing = target.matches?.("input, textarea, select");

  if (typing) {
    if (event.key !== "Escape") return;
    event.stopImmediatePropagation();
    event.preventDefault();
    if (target.matches(".live-note-input")) {
      live.editing = null;
      draw();
      return;
    }
    if (target.id === "live-correct-seconds") {
      live.correcting = null;
      draw();
      $("#live-correct-open")?.focus();
      return;
    }
    target.blur();
    $("#live-view").focus({ preventScroll: true });
    return;
  }

  if (event.metaKey || event.ctrlKey || event.altKey) return;
  // From here on, nothing reaches the coding view.
  event.stopImmediatePropagation();
  const onButton = target.matches?.("button, summary, a");
  if ((event.key === " " || event.key === "Enter") && onButton) return;

  const key = event.key;
  const handled = () => event.preventDefault();

  if (key === "?") {
    handled();
    const legend = $("#live-keys");
    legend.open = !legend.open;
    return;
  }
  if (key === "e") {
    handled();
    return toggleSummary();
  }
  if (key === "Escape") {
    handled();
    if (live.summary) return toggleSummary();
    if ($("#live-keys").open) $("#live-keys").open = false;
    return;
  }
  if (key === " ") {
    // Once the recording runs, the space bar does nothing at all: a second
    // press must neither move the start nor scroll the guide away.
    handled();
    if (!live.session.t0) send({ op: "start" });
    return;
  }
  if (key === "t") {
    handled();
    return openCorrection();
  }
  if (live.summary) return;

  if (target.matches?.(".live-readout-state") && (key === "ArrowDown" || key === "ArrowUp")) {
    handled();
    const row = Number(target.dataset.row) + (key === "ArrowDown" ? 1 : -1);
    $(`#live-block-main [data-focus="readout-${row}-${target.dataset.state}"]`)?.focus();
    return;
  }
  if (key === "ArrowRight" || key === "j") {
    handled();
    return step(1);
  }
  if (key === "ArrowLeft" || key === "k") {
    handled();
    return step(-1);
  }
  const block = shownBlock();
  if (!block) return;
  if (key === "b") {
    handled();
    return send({ op: "block", block: block.id });
  }
  if (key === "B") {
    handled();
    if (startsOf(block.id).length) send({ op: "unblock", block: block.id });
    return;
  }
  if (key === "n") {
    handled();
    return $("#live-note").focus();
  }
  if (key === "r") {
    handled();
    return focusReadout();
  }
  if (/^[0-9]$/.test(key)) {
    const index = key === "0" ? 9 : Number(key) - 1;
    const item = itemsOf(block)[index];
    if (!item) return;
    handled();
    return toggleItem(item.id);
  }
}

/* Wiring ---------------------------------------------------------------------------- */

function connect() {
  window.addEventListener("keydown", onKey, true);

  $("#live-open").addEventListener("click", () => openSheet().catch(deps.complain));
  $("#live-sheet-close").addEventListener("click", () => $("#live-sheet").close());
  $("#live-sheet").addEventListener("close", () => {
    // A message shown inside the sheet belongs to it, as in the other sheets.
    const element = $("#message");
    if ($("#live-sheet").contains(element)) {
      element.hidden = true;
      document.body.append(element);
    }
  });
  $("#live-sheet").addEventListener("submit", (event) => {
    if (event.target.id === "live-new") createSession(event);
  });
  $("#live-sheet").addEventListener("click", (event) => {
    const open = event.target.closest(".live-session-open");
    if (open) {
      $("#live-sheet").close();
      openLive(open.dataset.id).catch(deps.complain);
      return;
    }
    const discard = event.target.closest(".live-session-discard");
    if (discard) discardSession(discard.dataset.id);
  });

  const view = $("#live-view");
  view.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || !live.session) return;
    if (button.id === "live-close") return closeLive();
    if (button.id === "live-summary-open") return toggleSummary();
    if (button.id === "live-record") return send({ op: "start" });
    if (button.id === "live-correct-open") return openCorrection();
    if (button.id === "live-correct-cancel") {
      live.correcting = null;
      return draw();
    }
    if (button.id === "live-block-start") return send({ op: "block", block: shownBlock().id });
    if (button.id === "live-unblock") return send({ op: "unblock", block: shownBlock().id });
    if (button.dataset.show) return show(button.dataset.show);
    if (button.matches(".live-item")) return toggleItem(button.dataset.item);
    if (button.matches(".live-readout-state")) return toggleReadout(button.dataset.item, button.dataset.state);
    if (button.matches(".live-note-edit")) {
      const note = live.session.notes.find((one) => one.id === button.dataset.note);
      live.editing = { id: note.id, text: note.text };
      return draw();
    }
    if (button.matches(".live-note-delete")) return deleteNote(button.dataset.note);
  });
  view.addEventListener("submit", (event) => {
    if (event.target.id === "live-correct") correctT0(event);
  });
  view.addEventListener("input", (event) => {
    if (event.target.id === "live-note") live.drafts.set(shownBlock()?.id ?? null, event.target.value);
    if (event.target.matches(".live-note-input") && live.editing) live.editing.text = event.target.value;
    if (event.target.id === "live-correct-seconds") live.correcting = event.target.value;
  });
  view.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    if (event.target.id === "live-note") {
      event.preventDefault();
      saveNote();
    } else if (event.target.matches(".live-note-input")) {
      event.preventDefault();
      saveEdit();
    }
  });

  // Picking an interview in the header means: back to coding.
  $("#interview-choice").addEventListener("change", () => {
    if (live.session) closeLive();
  });
}

/**
 * Set the mode up. Called once the coding view stands; reopens a conversation
 * that was open when the page was last left, so a reload in the middle of an
 * interview lands back where it was.
 */
export async function installLiveMode({ api, notify, complain }) {
  deps = { api, notify, complain };

  const button = document.createElement("button");
  button.type = "button";
  button.id = "live-open";
  button.className = "button-quiet";
  button.title = t("liveButtonTitle");
  button.setAttribute("aria-label", t("liveButtonTitle"));
  button.textContent = t("liveButton");
  button.hidden = $("#view-code").hidden;
  // Absent until the study is known to have rounds: a button that appears and
  // vanishes again would shift the tabs under a pointer on its way to them.
  button.dataset.available = "false";
  $("#import").after(button);

  const sheet = document.createElement("dialog");
  sheet.className = "keys-sheet live-sheet";
  sheet.id = "live-sheet";
  sheet.setAttribute("aria-label", t("liveSheetTitle"));
  sheet.innerHTML =
    `<div class="keys-head"><h2>${escapeHTML(t("liveSheetTitle"))}</h2>` +
    `<button type="button" class="button-quiet" id="live-sheet-close">${escapeHTML(t("keysClose"))}</button></div>` +
    `<p class="keys-note">${escapeHTML(t("liveSheetNote"))}</p>` +
    `<div id="live-sheet-body"></div>`;
  document.body.append(sheet);

  const view = document.createElement("section");
  view.id = "live-view";
  view.className = "live-view";
  view.hidden = true;
  view.tabIndex = -1;
  view.setAttribute("aria-label", t("liveSheetTitle"));
  $("#view-code").append(view);

  connect();
  await refreshLists();

  const before = remembered();
  if (before?.id) {
    try {
      await openLive(before.id, { shown: before.shown, summary: Boolean(before.summary) });
    } catch {
      live.session = null;
      remember();
    }
  }
}
