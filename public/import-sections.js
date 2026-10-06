/*
  The guide's sections, reviewed before the transcript is written.

  An interview logged while it ran knows when each block of the guide began,
  and the import can put the `## Section:` lines there by itself. What it
  cannot know is whether the recording's clock started with the log's — Teams
  starts recording a few seconds, sometimes a minute, after the button was
  pressed — or whether a block was pressed a turn early. A heading one turn off
  moves every citation of that turn into the neighbouring section, and nothing
  on the screen afterwards would look wrong. So the placement is shown here,
  every heading between the turns it separates, before anything is written:

  - one offset for the whole import shifts every block start (stored nowhere
    unless saved explicitly as a correction of the log's recording start);
  - each heading moves one turn at a time with the arrow keys, or to the next
    question with Shift — the interviewer's turns are the natural openers, but
    any turn is allowed;
  - what the rule could not place is listed with the reason, and can be set by
    hand; a section left empty is marked.

  What is written is exactly the list on the screen. Without a log nothing of
  this appears and the import is what it always was.
*/

import { language, t } from "./texts.js";

const $ = (selector, root = document) => root.querySelector(selector);

/** `M:SS`, the transcript format's own clock. */
function clock(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

const signed = (value) => (value > 0 ? `+${value}` : String(value));

/**
 * The review, bound to the import sheet. The helpers are the app's own, handed
 * in so that this file does not import the app back.
 */
export function sectionReview({ api, escapeHTML, notify, complain }) {
  const state = {
    sessions: [],
    folder: "",
    session: null,
    text: null,
    offset: 0,
    found: null,
    timeline: [],
    headings: [],
    unplaced: [],
    // Moves made by hand, by heading key: the turn index each was put before.
    manual: new Map(),
    use: true,
    asked: 0,
    bound: false,
  };
  let timer = null;

  const box = () => $("#import-sections");
  const interviewer = () => $("#import-interviewer")?.value || null;

  /* Keys ----------------------------------------------------------------- */

  /**
   * A heading's identity across recomputations: the block, and which of its
   * starts it is (a block can be started twice). An offset moves every start
   * alike, so the order of starts — and with it this key — stays put.
   */
  function withKeys(placed, unplaced) {
    const all = [
      ...placed.map((one) => ({ ...one, placed: true })),
      ...unplaced.map((one) => ({ ...one, placed: false })),
    ];
    const ordered = [...all].sort(
      (a, b) => (a.at ?? Number.POSITIVE_INFINITY) - (b.at ?? Number.POSITIVE_INFINITY),
    );
    const seen = new Map();
    for (const one of ordered) {
      const n = seen.get(one.block) ?? 0;
      seen.set(one.block, n + 1);
      one.key = `${one.block}#${n}`;
    }
    return all;
  }

  function rebuild() {
    const sections = state.found ?? { placed: [], unplaced: [] };
    const all = withKeys(sections.placed, sections.unplaced);
    state.headings = [];
    state.unplaced = [];
    for (const one of all) {
      const moved = state.manual.get(one.key);
      if (moved !== undefined && one.name) {
        state.headings.push({ ...one, before: moved, manual: true });
      } else if (one.placed) {
        state.headings.push({ ...one, manual: false });
      } else {
        state.unplaced.push(one);
      }
    }
    sortHeadings();
  }

  function sortHeadings() {
    state.headings.sort(
      (a, b) =>
        a.before - b.before ||
        (a.at ?? Number.POSITIVE_INFINITY) - (b.at ?? Number.POSITIVE_INFINITY),
    );
  }

  /* Talking to the server -------------------------------------------------- */

  async function loadSessions() {
    try {
      const { sessions } = await api("/api/sessions");
      state.sessions = sessions.filter((one) => !one.transcript);
    } catch {
      state.sessions = [];
    }
    const field = $("#import-target-field");
    const select = $("#import-target");
    if (!field || !select) return;
    field.hidden = !state.sessions.length;
    select.innerHTML =
      `<option value="">${escapeHTML(t("importTargetNew"))}</option>` +
      state.sessions
        .map(
          (one) =>
            `<option value="${escapeHTML(one.id)}">${escapeHTML(
              t("importTargetLogged", { folder: one.id, department: one.department || "—" }),
            )}</option>`,
        )
        .join("");
    select.value = state.folder;
  }

  async function refresh() {
    if (!state.folder || state.text === null) return;
    const asked = ++state.asked;
    let found;
    try {
      found = await api("/api/import/read", {
        method: "POST",
        body: {
          text: state.text,
          folder: state.folder,
          interviewer: interviewer() ?? "",
          offset: state.offset,
        },
      });
    } catch (error) {
      if (asked === state.asked) complain(error);
      return;
    }
    // An answer to an older question — the offset moved on meanwhile.
    if (asked !== state.asked) return;
    state.found = found.sections ?? null;
    state.timeline = found.timeline ?? [];
    rebuild();
    drawDynamic();
  }

  function later() {
    clearTimeout(timer);
    timer = setTimeout(refresh, 150);
  }

  /* Drawing ------------------------------------------------------------- */

  function show(on) {
    box().hidden = !on;
    // The log says where the sections go, so the sentence saying the recording
    // carries none is about a different import; the short look at the first
    // turns gives way to the whole list below.
    const note = $("#import-no-sections");
    if (note) note.hidden = on;
    const preview = $("#import-preview");
    if (preview) preview.hidden = on;
  }

  function drawFrame() {
    const session = state.session;
    const starts = session?.blockStarts?.length ?? 0;
    const t0 = session?.t0
      ? new Date(session.t0).toLocaleString(language() === "de" ? "de-DE" : "en-GB")
      : null;
    box().innerHTML =
      `<h3 class="import-sections-title">${escapeHTML(t("importSectionsTitle"))}</h3>` +
      `<p class="import-log" id="import-log">${escapeHTML(
        t("importLogFound", { department: session?.department || "—", starts }),
      )}${t0 ? ` ${escapeHTML(t("importLogStart", { time: t0 }))}` : ""}</p>` +
      `<label class="import-sections-use"><input type="checkbox" id="import-sections-use"${
        state.use ? " checked" : ""
      }> ${escapeHTML(t("importSectionsUse"))}</label>` +
      `<div class="import-sections-body" id="import-sections-body">` +
      `<div class="import-offset" role="group" aria-labelledby="import-offset-label">` +
      `<span class="field-label" id="import-offset-label">${escapeHTML(t("importOffset"))}</span>` +
      `<button type="button" class="button-quiet" id="import-offset-earlier">${escapeHTML(
        t("importOffsetEarlier"),
      )}</button>` +
      `<input type="number" id="import-offset" step="1" value="${state.offset}" aria-labelledby="import-offset-label" aria-describedby="import-offset-note">` +
      `<span class="import-offset-unit">${escapeHTML(t("importOffsetUnit"))}</span>` +
      `<button type="button" class="button-quiet" id="import-offset-later">${escapeHTML(
        t("importOffsetLater"),
      )}</button>` +
      `<button type="button" class="button-quiet" id="import-offset-save" hidden>${escapeHTML(
        t("importOffsetSave"),
      )}</button>` +
      `</div>` +
      `<p class="column-note" id="import-offset-note">${escapeHTML(t("importOffsetNote"))}</p>` +
      `<p class="import-sections-count" id="import-sections-count" aria-live="polite"></p>` +
      `<p class="column-note import-heading-keys" id="import-heading-keys">${escapeHTML(
        t("importHeadingKeys"),
      )}</p>` +
      `<ol class="import-timeline" id="import-timeline"></ol>` +
      `<div class="import-unplaced" id="import-unplaced" hidden></div>` +
      `</div>`;
    drawDynamic();
  }

  function drawDynamic() {
    const body = $("#import-sections-body");
    if (!body) return;
    body.hidden = !state.use;
    const save = $("#import-offset-save");
    if (save) save.hidden = !(state.session?.t0 && state.offset);

    const asks = interviewer();
    const empty = new Set();
    state.headings.forEach((one, index) => {
      const next = state.headings[index + 1];
      if (next && next.before === one.before) empty.add(one.key);
    });

    const count = $("#import-sections-count");
    count.textContent = state.headings.length || state.unplaced.length
      ? t("importSectionsCount", {
          placed: state.headings.length,
          unplaced: state.unplaced.length,
          empty: empty.size,
        })
      : t("importNoStarts");
    count.classList.toggle("warn", Boolean(state.unplaced.length || empty.size));

    const heading = (one) => {
      const opener = state.timeline[one.before];
      const answers = asks && opener && opener.speaker !== asks;
      const notes = [
        one.at === null || one.at === undefined
          ? null
          : escapeHTML(t("importBlockAt", { time: clock(one.at) })),
        one.manual ? escapeHTML(t("importManual")) : null,
      ].filter(Boolean);
      const warnings = [
        empty.has(one.key) ? t("importEmptySection") : null,
        answers ? t("importOpensWithAnswer") : null,
      ].filter(Boolean);
      return (
        `<li class="import-heading${one.manual ? " manual" : ""}${warnings.length ? " warn" : ""}" data-key="${escapeHTML(one.key)}">` +
        `<button type="button" class="import-heading-name" data-key="${escapeHTML(one.key)}" ` +
        `aria-label="${escapeHTML(t("importHeadingAria", { name: one.name, turn: one.before + 1 }))}" ` +
        `aria-describedby="import-heading-keys">${escapeHTML(one.name)}</button>` +
        `<span class="import-heading-meta">${notes.join(" · ")}</span>` +
        `<span class="import-heading-moves">` +
        `<button type="button" class="button-quiet" tabindex="-1" data-move="-1" data-key="${escapeHTML(one.key)}" title="${escapeHTML(t("importMoveUp"))}" aria-label="${escapeHTML(t("importMoveUp"))}">↑</button>` +
        `<button type="button" class="button-quiet" tabindex="-1" data-move="1" data-key="${escapeHTML(one.key)}" title="${escapeHTML(t("importMoveDown"))}" aria-label="${escapeHTML(t("importMoveDown"))}">↓</button>` +
        (one.manual
          ? `<button type="button" class="button-quiet" data-reset="${escapeHTML(one.key)}">${escapeHTML(t("importMoveReset"))}</button>`
          : "") +
        `</span>` +
        (warnings.length
          ? `<span class="import-heading-warn">${warnings.map(escapeHTML).join(" · ")}</span>`
          : "") +
        `</li>`
      );
    };

    const rows = [];
    let next = 0;
    state.timeline.forEach((turn, index) => {
      while (next < state.headings.length && state.headings[next].before === index) {
        rows.push(heading(state.headings[next]));
        next += 1;
      }
      const asking = asks && turn.speaker === asks;
      rows.push(
        `<li class="import-row${asking ? " asks" : ""}" data-turn="${index}">` +
          `<span class="import-row-at">${turn.at === null ? index + 1 : clock(turn.at)}</span>` +
          `<span class="import-row-who">${escapeHTML(turn.speaker ?? t("importNobody"))}</span>` +
          `<span class="import-row-text">${escapeHTML(turn.text)}</span>` +
          `</li>`,
      );
    });
    $("#import-timeline").innerHTML = rows.join("");

    const unplaced = $("#import-unplaced");
    unplaced.hidden = !state.unplaced.length;
    unplaced.innerHTML = state.unplaced.length
      ? `<h4>${escapeHTML(t("importUnplacedTitle"))}</h4><ul>` +
        state.unplaced
          .map(
            (one) =>
              `<li data-key="${escapeHTML(one.key)}"><strong>${escapeHTML(
                one.name ?? t("importUnknownBlock", { block: one.block }),
              )}</strong> — ${escapeHTML(one.why ?? one.reason)}` +
              (one.name && state.timeline.length
                ? ` <button type="button" class="button-quiet" data-place="${escapeHTML(one.key)}">${escapeHTML(
                    t("importPlaceByHand"),
                  )}</button>`
                : "") +
              `</li>`,
          )
          .join("") +
        `</ul>`
      : "";
  }

  function focusHeading(key) {
    const button = box().querySelector(`.import-heading-name[data-key="${CSS.escape(key)}"]`);
    if (!button) return;
    button.focus();
    button.scrollIntoView({ block: "nearest" });
  }

  /* Moving a heading ------------------------------------------------------- */

  function move(key, step, { toQuestion = false } = {}) {
    const one = state.headings.find((each) => each.key === key);
    if (!one) return;
    const last = state.timeline.length - 1;
    let to = one.before + step;
    if (toQuestion && interviewer()) {
      const asks = interviewer();
      to = one.before;
      for (let index = one.before + step; index >= 0 && index <= last; index += step) {
        if (state.timeline[index].speaker === asks) {
          to = index;
          break;
        }
      }
    }
    to = Math.max(0, Math.min(last, to));
    if (to === one.before) return focusHeading(key);
    state.manual.set(key, to);
    rebuild();
    drawDynamic();
    focusHeading(key);
  }

  function place(key) {
    const one = state.unplaced.find((each) => each.key === key);
    if (!one) return;
    // A start after the last turn goes before the last turn; one without a
    // time at the beginning. Either way it is the researcher who moves it on.
    const last = state.timeline.length - 1;
    state.manual.set(key, one.reason === "sectionAfterLastTurn" ? last : 0);
    rebuild();
    drawDynamic();
    focusHeading(key);
  }

  function reset(key) {
    state.manual.delete(key);
    rebuild();
    drawDynamic();
    if (state.headings.some((one) => one.key === key)) focusHeading(key);
  }

  function setOffset(value) {
    const number = Number(value);
    state.offset = Number.isFinite(number) ? Math.round(number * 10) / 10 : 0;
    const input = $("#import-offset");
    if (input && Number(input.value) !== state.offset) input.value = String(state.offset);
    const save = $("#import-offset-save");
    if (save) save.hidden = !(state.session?.t0 && state.offset);
    later();
  }

  async function saveOffset() {
    if (!state.session?.t0 || !state.offset) return;
    /* The recording's second s is the log's second s − offset: the recording
       started `−offset` seconds after the log's t0. Moving t0 there re-bases
       every logged time by exactly the offset, so the offset becomes zero and
       the placement stays where it is. */
    const t0 = new Date(Date.parse(state.session.t0) - state.offset * 1000).toISOString();
    try {
      state.session = await api(`/api/sessions/${encodeURIComponent(state.folder)}`, {
        method: "PATCH",
        body: { op: "start", t0 },
      });
    } catch (error) {
      return complain(error);
    }
    notify(t("importOffsetSaved", { seconds: signed(state.offset) }));
    state.offset = 0;
    drawFrame();
    refresh();
  }

  /* Choosing the folder ------------------------------------------------------ */

  async function choose(folder) {
    state.folder = folder;
    state.manual.clear();
    state.offset = 0;
    state.found = null;
    state.timeline = [];
    state.headings = [];
    state.unplaced = [];
    state.use = true;
    state.session = null;
    if (!folder) {
      show(false);
      return;
    }
    try {
      state.session = await api(`/api/sessions/${encodeURIComponent(folder)}`);
    } catch (error) {
      complain(error);
      show(false);
      return;
    }
    if (state.folder !== folder) return;
    lendDepartment();
    drawFrame();
    show(true);
    await refresh();
  }

  /** The log knows the department; offered unless one was typed already. */
  function lendDepartment() {
    const field = $("#import-department");
    const department = state.session?.department;
    if (!field || !department || field.value.trim()) return;
    field.value = department;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /* Wiring --------------------------------------------------------------- */

  function bind() {
    if (state.bound) return;
    state.bound = true;
    $("#import-target")?.addEventListener("change", (event) => choose(event.target.value));
    $("#import-interviewer")?.addEventListener("change", () => {
      if (state.folder) refresh();
    });
    const root = box();
    root.addEventListener("change", (event) => {
      if (event.target.id === "import-sections-use") {
        state.use = event.target.checked;
        drawDynamic();
      }
    });
    root.addEventListener("input", (event) => {
      if (event.target.id === "import-offset") setOffset(event.target.value);
    });
    root.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.id === "import-offset-earlier") return setOffset(state.offset - 5);
      if (button.id === "import-offset-later") return setOffset(state.offset + 5);
      if (button.id === "import-offset-save") return saveOffset();
      if (button.dataset.move) return move(button.dataset.key, Number(button.dataset.move));
      if (button.dataset.reset) return reset(button.dataset.reset);
      if (button.dataset.place) return place(button.dataset.place);
      if (button.classList.contains("import-heading-name")) focusHeading(button.dataset.key);
    });
    root.addEventListener("keydown", (event) => {
      /* The keys in here are the review's. The app's own shortcuts listen on
         the document — Enter there confirms a coding behind this sheet — so
         nothing but Escape (which closes the sheet) travels further. */
      if (event.key !== "Escape") event.stopPropagation();
      const target = event.target;
      if (target.id === "import-offset") {
        if (event.key === "Enter") event.preventDefault();
        if (event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
          event.preventDefault();
          setOffset(state.offset + (event.key === "ArrowUp" ? 10 : -10));
        }
        return;
      }
      if (target.classList?.contains("import-heading-name")) {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        move(target.dataset.key, event.key === "ArrowUp" ? -1 : 1, { toQuestion: event.shiftKey });
      }
    });
  }

  return {
    /** The sheet opens: the waiting logs are looked up afresh. */
    reset() {
      bind();
      state.text = null;
      state.folder = "";
      state.manual.clear();
      show(false);
      box().innerHTML = "";
      return loadSessions();
    },

    /** A file was read; with a log chosen, its placement is computed. */
    fileRead(text) {
      bind();
      state.text = text;
      state.manual.clear();
      if (!state.folder) return;
      lendDepartment();
      show(true);
      drawFrame();
      return refresh();
    },

    /** What the import request needs on top of the app's own fields. */
    body() {
      if (!state.folder) return {};
      if (!state.use) return { folder: state.folder, sections: false };
      if (!state.found) return { folder: state.folder };
      return {
        folder: state.folder,
        offset: state.offset,
        sections: state.headings.map((one) => ({ block: one.block, before: one.before, at: one.at ?? null })),
      };
    },
  };
}
