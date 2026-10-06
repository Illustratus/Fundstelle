/**
 * Rounds, the interview guide of each, and the criteria of a proposition.
 *
 * A study that asks the same people twice needs three things written down
 * before the second round begins: which rounds there are and which interview
 * belongs to which, what the guide of the new round asks, and when a
 * proposition counts as supported or falsified. All three are study instrument
 * work, done once and then rarely touched, so they live folded away beside the
 * other instrument settings — the rounds and the guide in the catalog view,
 * the criteria beside the propositions they belong to — and not in a view of
 * their own.
 *
 * The rest of the interface rebuilds its markup whole on every change. The
 * guide editor is one long form, and a rebuild in the middle of it would throw
 * away the place and the half-typed sentence; so it keeps one element of its
 * own, which the catalog only gives a place to. Every field saves when it is
 * left (or on Enter), and says so — a field that answers nothing looks exactly
 * like a field that did not save.
 */

import { t } from "./texts.js";

/** What app.js lends this module: its request helper, its messages, its state. */
let deps = null;

const local = {
  rounds: [],
  // The round whose guide is being edited.
  current: null,
  guide: null,
  // Disclosures opened by hand, which every rebuild has to honour.
  open: new Set(),
  // Criteria shown open, per proposition, and a criterion being put together.
  criteriaOpen: new Set(),
  drafts: new Map(),
  node: null,
  // The field last focused in the editor, to hand the focus back after the
  // catalog was rebuilt around it.
  lastKey: null,
};

// Saves wait for each other: a list is sent whole, so the second of two quick
// edits has to be built on what the first one left.
let chain = Promise.resolve();

const enc = encodeURIComponent;
const esc = (value) => deps.escapeHTML(value ?? "");
const attr = (value) => esc(value);

/* Loading ------------------------------------------------------------------ */

async function reload() {
  local.rounds = (await deps.api("/api/rounds")).rounds;
  if (!local.rounds.some((round) => round.id === local.current)) {
    local.current = local.rounds.at(-1)?.id ?? null;
  }
  local.guide = local.current ? await deps.api(`/api/rounds/${enc(local.current)}/guide`) : null;
}

/** The study's rounds as last read; empty while it has none. */
export const studyRounds = () => local.rounds;

/* Re-rendering without losing the place ------------------------------------ */

/**
 * Replace the markup of an element and put the reader back where they were:
 * the same field focused, the same caret, and — unless the field is one whose
 * save just came back — the words they were typing in it.
 */
function refill(element, html, { fresh = [], focus = null } = {}) {
  const active = document.activeElement;
  const held =
    active && element.contains(active) && active.dataset.key
      ? {
          key: active.dataset.key,
          value: active.value,
          start: active.selectionStart,
          end: active.selectionEnd,
          typed: active.matches("input:not([type=checkbox]), textarea"),
        }
      : null;
  // The place an action asks for, unless the reader is already typing elsewhere.
  const keep = focus && !(held?.typed && held.key !== focus) && held?.key !== focus ? { key: focus } : held;
  element.innerHTML = html;
  if (!keep) return;
  const find = (key) => element.querySelector(`[data-key="${CSS.escape(key)}"]`);
  // An arrow that moved its row to the end is gone; the other arrow, or the
  // row's own field, keeps the place.
  const again =
    find(keep.key) ??
    (/:(up|down)$/.test(keep.key)
      ? find(keep.key.replace(/:(up|down)$/, (_, way) => (way === "up" ? ":down" : ":up"))) ??
        find(keep.key.replace(/:(up|down)$/, keep.key.startsWith("item:") ? ":text" : ":name"))
      : null);
  if (!again) return;
  again.focus({ preventScroll: true });
  if (keep.typed && !fresh.includes(keep.key) && again.value !== keep.value) again.value = keep.value;
  if (keep.typed) {
    try {
      again.setSelectionRange(keep.start, keep.end);
    } catch {
      // Not every field has a caret.
    }
  }
}

/**
 * One save after the other, each followed by a fresh read: what is on screen
 * is what the file says, including after a refusal.
 */
function save(work, message, { fresh = [], focus = null, after = render } = {}) {
  chain = chain.then(async () => {
    try {
      const said = await work();
      if (message) deps.notify(typeof message === "function" ? message(said) : message);
    } catch (error) {
      deps.complain(error);
    }
    try {
      if (after === render) await reload();
    } catch (error) {
      deps.complain(error);
    }
    await after({ fresh, focus });
  });
  return chain;
}

/* The rounds and the guide (catalog view) ---------------------------------- */

const roundName = (id) => local.rounds.find((round) => round.id === id)?.name ?? id;

const button = (data, label, aria, key, title = "") =>
  `<button type="button" class="button-quiet" ${data} data-key="${attr(key)}"` +
  ` aria-label="${attr(aria)}"${title ? ` title="${attr(title)}"` : ""}>${label}</button>`;

/** A text field that saves when it is left; `data-was` is what the file holds. */
const field = (data, value, aria, key, { placeholder = "", area = false, rows = 2 } = {}) =>
  area
    ? `<textarea ${data} data-save data-key="${attr(key)}" data-was="${attr(value)}" rows="${rows}"` +
      ` aria-label="${attr(aria)}"${placeholder ? ` placeholder="${attr(placeholder)}"` : ""}>${esc(value)}</textarea>`
    : `<input type="text" ${data} data-save data-key="${attr(key)}" data-was="${attr(value)}"` +
      ` value="${attr(value)}" aria-label="${attr(aria)}" autocomplete="off"` +
      `${placeholder ? ` placeholder="${attr(placeholder)}"` : ""}>`;

function roundsHTML() {
  const rows = local.rounds
    .map(
      (round) =>
        `<div class="guide-round" data-round="${attr(round.id)}">` +
        field("data-round-name", round.name, t("roundsEditorNameAria"), `round:${round.id}:name`) +
        `<span class="count">${esc(
          t("roundsEditorCount", { interviews: round.interviews.length, planned: round.planned.length }),
        )}</span>` +
        button(
          "data-round-remove",
          "×",
          t("roundsEditorRemoveAria", { name: round.name }),
          `round:${round.id}:remove`,
          t("roundsEditorRemoveTitle"),
        ) +
        `</div>`,
    )
    .join("");
  return (
    `<div class="guide-rounds">${rows || `<p class="column-note">${esc(t("roundsEditorNone"))}</p>`}` +
    `<form class="guide-add" data-form="round-new">` +
    `<input type="text" name="name" data-key="round:new" autocomplete="off"` +
    ` placeholder="${attr(t("roundsEditorNewPlaceholder"))}" aria-label="${attr(t("roundsEditorNewAria"))}">` +
    `<button type="submit" class="button-quiet" aria-label="${attr(t("roundsEditorNewAria"))}">＋</button>` +
    `</form></div>`
  );
}

/** Which interview belongs to which round — only worth showing once there is a choice. */
function assignHTML() {
  if (local.rounds.length < 2) return "";
  const titles = new Map((deps.state.interviews ?? []).map((one) => [one.id, one.title]));
  const folders = local.rounds
    .flatMap((round) => [
      ...round.interviews.map((id) => ({ id, round: round.id, planned: false })),
      ...round.planned.map((id) => ({ id, round: round.id, planned: true })),
    ])
    .sort((a, b) => a.id.localeCompare(b.id));
  const options = (chosen) =>
    local.rounds
      .map((round) => `<option value="${attr(round.id)}"${round.id === chosen ? " selected" : ""}>${esc(round.name)}</option>`)
      .join("");
  const rows = folders
    .map(
      (folder) =>
        `<label class="guide-assign-row"><span>${esc(titles.get(folder.id) ?? folder.id)}` +
        (folder.planned ? ` <span class="open-mark">${esc(t("roundsEditorPlanned"))}</span>` : "") +
        `</span><select data-assign="${attr(folder.id)}" data-key="assign:${attr(folder.id)}"` +
        ` aria-label="${attr(t("roundsEditorAssignAria", { folder: titles.get(folder.id) ?? folder.id }))}">` +
        `${options(folder.round)}</select></label>`,
    )
    .join("");
  return (
    `<details class="guide-assign" data-part="assign"${local.open.has("assign") ? " open" : ""}>` +
    `<summary>${esc(t("roundsEditorAssignSummary", { n: folders.length }))}</summary>${rows}</details>`
  );
}

function itemHTML(block, kind, item, index, count) {
  const key = `item:${block.id}:${item.id}`;
  const label = item.text || item.id;
  return (
    `<li class="guide-item" data-kind="${kind}" data-item="${attr(item.id)}">` +
    field('data-item-field="text"', item.text, t("guideEditorItemAria"), `${key}:text`) +
    (kind === "mandatory"
      ? field(
          'data-item-field="condition"',
          item.condition ?? "",
          t("guideEditorConditionAria", { text: label }),
          `${key}:condition`,
          { placeholder: t("guideEditorConditionPlaceholder") },
        )
      : "") +
    field('data-item-field="tag"', item.tag ?? "", t("guideEditorTagAria", { text: label }), `${key}:tag`, {
      placeholder: t("guideEditorTagPlaceholder"),
    }) +
    (index > 0
      ? button('data-item-move="-1"', "↑", t("guideEditorUp", { name: label }), `${key}:up`, t("guideEditorMoveKeys"))
      : `<span class="guide-spacer"></span>`) +
    (index < count - 1
      ? button('data-item-move="1"', "↓", t("guideEditorDown", { name: label }), `${key}:down`, t("guideEditorMoveKeys"))
      : `<span class="guide-spacer"></span>`) +
    button("data-item-remove", "×", t("guideEditorRemove", { name: label }), `${key}:remove`) +
    `</li>`
  );
}

function listHTML(block, kind) {
  const items = block[kind];
  const heading = t(kind === "checklist" ? "guideEditorChecklist" : "guideEditorMandatory");
  const add = t(kind === "checklist" ? "guideEditorAddChecklist" : "guideEditorAddMandatory");
  return (
    `<div class="guide-list"><span class="field-label">${esc(heading)}</span>` +
    (items.length
      ? `<ol>${items.map((item, index) => itemHTML(block, kind, item, index, items.length)).join("")}</ol>`
      : "") +
    `<form class="guide-add" data-form="item-new" data-kind="${kind}">` +
    `<input type="text" name="text" data-key="new:${attr(block.id)}:${kind}" autocomplete="off"` +
    ` placeholder="${attr(add)}" aria-label="${attr(add)}">` +
    `<button type="submit" class="button-quiet" aria-label="${attr(add)}">＋</button></form></div>`
  );
}

function readoutHTML(block) {
  const key = `readout:${block.id}`;
  if (!block.readout) {
    return (
      `<div class="guide-readout">` +
      button("data-readout-create", esc(t("guideEditorReadoutAdd")), t("guideEditorReadoutAdd"), `${key}:create`) +
      `</div>`
    );
  }
  const rows = Object.entries(block.readout.perDepartment)
    .map(
      ([department, items]) =>
        `<div class="guide-readout-row" data-department="${attr(department)}">` +
        field("data-readout-department", department, t("guideEditorReadoutDepartmentAria"), `${key}:dep:${department}`) +
        field(
          "data-readout-items",
          items.join("\n"),
          t("guideEditorReadoutItemsAria", { department }),
          `${key}:items:${department}`,
          { area: true, rows: Math.max(2, items.length + 1) },
        ) +
        button(
          "data-readout-department-remove",
          "×",
          t("guideEditorRemove", { name: department }),
          `${key}:dep:${department}:remove`,
        ) +
        `</div>`,
    )
    .join("");
  return (
    `<div class="guide-readout"><span class="field-label">${esc(t("guideEditorReadout"))}</span>` +
    `<p class="column-note">${esc(t("guideEditorReadoutNote"))}</p>` +
    field("data-readout-label", block.readout.label, t("guideEditorReadoutLabelAria"), `${key}:label`, {
      placeholder: t("guideEditorReadoutLabelPlaceholder"),
    }) +
    rows +
    `<form class="guide-add" data-form="readout-department-new">` +
    `<input type="text" name="department" data-key="${attr(key)}:new" autocomplete="off" list="guide-departments"` +
    ` placeholder="${attr(t("guideEditorReadoutNewDepartment"))}" aria-label="${attr(t("guideEditorReadoutNewDepartment"))}">` +
    `<button type="submit" class="button-quiet" aria-label="${attr(t("guideEditorReadoutNewDepartment"))}">＋</button></form>` +
    button("data-readout-drop", esc(t("guideEditorReadoutDrop")), t("guideEditorReadoutDrop"), `${key}:drop`) +
    `</div>`
  );
}

function blockHTML(block, index, count) {
  const key = `block:${block.id}`;
  return (
    `<li class="guide-block" data-block="${attr(block.id)}">` +
    `<div class="guide-block-head">` +
    field('data-block-field="name"', block.name, t("guideEditorBlockNameAria"), `${key}:name`) +
    (index > 0
      ? button('data-block-move="-1"', "↑", t("guideEditorUp", { name: block.name }), `${key}:up`, t("guideEditorMoveKeys"))
      : `<span class="guide-spacer"></span>`) +
    (index < count - 1
      ? button('data-block-move="1"', "↓", t("guideEditorDown", { name: block.name }), `${key}:down`, t("guideEditorMoveKeys"))
      : `<span class="guide-spacer"></span>`) +
    button("data-block-remove", "×", t("guideEditorRemove", { name: block.name }), `${key}:remove`) +
    `</div>` +
    `<label class="field-block"><span class="field-label">${esc(t("guideEditorPrompt"))}</span>` +
    field('data-block-field="prompt"', block.prompt, t("guideEditorPrompt"), `${key}:prompt`, { area: true }) +
    `</label>` +
    listHTML(block, "checklist") +
    listHTML(block, "mandatory") +
    readoutHTML(block) +
    `</li>`
  );
}

function guideHTML() {
  if (!local.current || !local.guide) return "";
  const blocks = local.guide.blocks;
  const departments = [...new Set((deps.state.interviews ?? []).map((one) => one.department).filter(Boolean))];
  const choices = local.rounds
    .map((round) => `<option value="${attr(round.id)}"${round.id === local.current ? " selected" : ""}>${esc(round.name)}</option>`)
    .join("");
  return (
    `<div class="guide-pick">` +
    `<label class="field"><span class="field-label">${esc(t("guideEditorRound"))}</span>` +
    `<select data-guide-round data-key="guide-round">${choices}</select></label>` +
    `<a class="button-quiet" id="guide-export" download href="${attr(
      deps.exportHref("/api/export/guide.md", `round=${enc(local.current)}`),
    )}">${esc(t("guideEditorExport"))}</a>` +
    `</div>` +
    `<datalist id="guide-departments">${departments.map((one) => `<option value="${attr(one)}">`).join("")}</datalist>` +
    (blocks.length
      ? `<ol class="guide-blocks">${blocks.map((block, index) => blockHTML(block, index, blocks.length)).join("")}</ol>`
      : `<p class="column-note">${esc(t("guideEditorEmpty"))}</p>`) +
    `<form class="guide-add guide-block-new" data-form="block-new">` +
    `<input type="text" name="name" data-key="block:new" autocomplete="off"` +
    ` placeholder="${attr(t("guideEditorNewBlockPlaceholder"))}" aria-label="${attr(t("guideEditorNewBlockPlaceholder"))}">` +
    `<button type="submit" class="button-quiet">${esc(t("guideEditorAddBlock"))}</button></form>`
  );
}

function editorHTML() {
  return (
    `<details class="guide-shell" data-part="shell"${local.open.has("shell") ? " open" : ""}>` +
    `<summary>${esc(t("guideEditorSummary", { n: local.rounds.length }))}</summary>` +
    `<p class="column-note guide-note">${esc(t("guideEditorNote"))}</p>` +
    roundsHTML() +
    assignHTML() +
    guideHTML() +
    `</details>`
  );
}

function render(options = {}) {
  if (!local.node) return;
  refill(local.node, editorHTML(), options);
  // The rounds are what the criteria choose from.
  redrawAllCriteria();
}

/**
 * Give the editor its place in the catalog. The catalog rebuilds itself whole;
 * the editor is the same element every time, so it keeps what was open and
 * what was being typed.
 */
export function placeGuide(slot) {
  if (!slot || !local.node) return;
  slot.replaceWith(local.node);
  // Taken out of the page and put back, the field in hand lost the focus; it
  // is the same field, with the same words in it, so it gets it back.
  const lost = !document.activeElement || document.activeElement === document.body;
  if (lost && local.lastKey) {
    local.node.querySelector(`[data-key="${CSS.escape(local.lastKey)}"]`)?.focus({ preventScroll: true });
  }
  // Read again: a log opened in the interview mode is a planned interview here.
  save(async () => {}, null);
}

/** The guide of every round that has one, for the row of appendix exports. */
export function guideExportLinks(exportHref) {
  return local.rounds
    .filter((round) => round.blocks)
    .map(
      (round) =>
        `<a class="button-quiet" href="${attr(exportHref("/api/export/guide.md", `round=${enc(round.id)}`))}" download>` +
        `${esc(t("guideEditorExportLink"))} · ${esc(round.name)}</a>`,
    )
    .join("");
}

/* Editing the guide -------------------------------------------------------- */

const roundPath = (round) => `/api/rounds/${enc(round)}`;
const blockPath = (round, block) => `${roundPath(round)}/guide/blocks/${enc(block)}`;
const blockOf = (id) => local.guide?.blocks.find((block) => block.id === id);

function patchBlock(round, block, body) {
  return deps.api(blockPath(round, block), { method: "PATCH", body });
}

/** A list of items as it is sent back: the same ids, so a rewording stays the same item. */
const itemsOf = (block, kind) => block[kind].map((item) => ({ ...item }));

function moved(list, index, by) {
  const to = index + by;
  if (to < 0 || to >= list.length) return null;
  const copy = [...list];
  const [one] = copy.splice(index, 1);
  copy.splice(to, 0, one);
  return copy;
}

function changeReadout(round, blockId, change) {
  return save(async () => {
    const block = blockOf(blockId);
    const readout = { label: block.readout?.label ?? "", perDepartment: { ...(block.readout?.perDepartment ?? {}) } };
    change(readout);
    return patchBlock(round, blockId, { readout });
  }, t("guideEditorSaved"));
}

/** Leaving a field, or Enter in it: save what changed, say so, nothing if nothing did. */
function commit(target) {
  if (!target.matches("[data-save]") || target.value === target.dataset.was) return;
  const value = target.value;
  const key = target.dataset.key;
  target.dataset.was = value;
  const fresh = [key];

  const round = target.closest("[data-round]");
  if (target.matches("[data-round-name]") && round) {
    const id = round.dataset.round;
    if (!value.trim()) return render({ fresh });
    return save(
      () => deps.api(roundPath(id), { method: "PATCH", body: { name: value } }),
      (said) => t("roundsEditorRenamed", { name: said.name }),
      { fresh },
    );
  }

  const roundId = local.current;
  const blockId = target.closest("[data-block]")?.dataset.block;
  if (!blockId) return;

  if (target.matches("[data-block-field]")) {
    const name = target.dataset.blockField;
    return save(() => patchBlock(roundId, blockId, { [name]: value }), t("guideEditorSaved"), { fresh });
  }

  const item = target.closest("[data-item]");
  if (item && target.matches("[data-item-field]")) {
    const { kind, item: itemId } = item.dataset;
    const name = target.dataset.itemField;
    return save(
      () => {
        const list = itemsOf(blockOf(blockId), kind).map((one) =>
          one.id === itemId ? { ...one, [name]: value } : one,
        );
        return patchBlock(roundId, blockId, { [kind]: list });
      },
      t("guideEditorSaved"),
      { fresh },
    );
  }

  if (target.matches("[data-readout-label]")) {
    return changeReadout(roundId, blockId, (readout) => {
      readout.label = value;
    });
  }
  const row = target.closest("[data-department]");
  if (row && target.matches("[data-readout-department]")) {
    const before = row.dataset.department;
    const after = value.trim();
    if (!after) return render({ fresh });
    return changeReadout(roundId, blockId, (readout) => {
      readout.perDepartment = Object.fromEntries(
        Object.entries(readout.perDepartment).flatMap(([name, items]) => {
          if (name === before) return [[after, [...new Set([...(readout.perDepartment[after] ?? []), ...items])]]];
          if (name === after) return [];
          return [[name, items]];
        }),
      );
    });
  }
  if (row && target.matches("[data-readout-items]")) {
    const department = row.dataset.department;
    return changeReadout(roundId, blockId, (readout) => {
      readout.perDepartment[department] = value.split("\n").map((one) => one.trim()).filter(Boolean);
    });
  }
}

function moveBlock(blockId, by, focus) {
  const round = local.current;
  return save(
    () => {
      const at = local.guide.blocks.findIndex((one) => one.id === blockId);
      const to = Math.max(0, Math.min(at + by, local.guide.blocks.length - 1));
      return patchBlock(round, blockId, { position: to });
    },
    t("guideEditorSaved"),
    { focus },
  );
}

function moveItem(blockId, kind, itemId, by, focus) {
  const round = local.current;
  return save(
    () => {
      const list = itemsOf(blockOf(blockId), kind);
      const next = moved(list, list.findIndex((one) => one.id === itemId), by);
      if (!next) return null;
      return patchBlock(round, blockId, { [kind]: next });
    },
    t("guideEditorSaved"),
    { focus },
  );
}

async function onSubmit(event) {
  const form = event.target.closest("[data-form]");
  if (!form) return;
  event.preventDefault();
  const input = form.querySelector("input");
  const value = input.value.trim();
  if (!value) return;
  const key = input.dataset.key;
  const clear = () => {
    input.value = "";
  };
  const round = local.current;
  const blockId = form.closest("[data-block]")?.dataset.block;

  switch (form.dataset.form) {
    case "round-new":
      clear();
      return save(
        async () => {
          const made = await deps.api("/api/rounds", { method: "POST", body: { name: value } });
          local.current = made.id;
          return made;
        },
        (made) => t("roundsEditorAdded", { name: made.name }),
        { focus: key },
      );
    case "block-new":
      clear();
      return save(
        () => deps.api(`${roundPath(round)}/guide/blocks`, { method: "POST", body: { name: value } }),
        (made) => t("guideEditorBlockAdded", { name: made.name }),
        { focus: key },
      );
    case "item-new": {
      const kind = form.dataset.kind;
      clear();
      return save(
        () => patchBlock(round, blockId, { [kind]: [...itemsOf(blockOf(blockId), kind), { text: value }] }),
        t("guideEditorSaved"),
        { focus: key },
      );
    }
    case "readout-department-new":
      clear();
      return changeReadout(round, blockId, (readout) => {
        if (!(value in readout.perDepartment)) readout.perDepartment[value] = [];
      });
    default:
      return undefined;
  }
}

function onClick(event) {
  const target = event.target.closest("button");
  if (!target || !local.node.contains(target)) return;
  const key = target.dataset.key;
  const round = local.current;
  const blockId = target.closest("[data-block]")?.dataset.block;

  if (target.matches("[data-round-remove]")) {
    const id = target.closest("[data-round]").dataset.round;
    const name = roundName(id);
    return save(
      () => deps.api(roundPath(id), { method: "DELETE" }),
      t("roundsEditorRemoved", { name }),
    );
  }
  if (target.matches("[data-block-move]")) {
    return moveBlock(blockId, Number(target.dataset.blockMove), key);
  }
  if (target.matches("[data-block-remove]")) {
    const name = blockOf(blockId)?.name ?? blockId;
    return save(
      () => deps.api(blockPath(round, blockId), { method: "DELETE" }),
      t("guideEditorBlockRemoved", { name }),
    );
  }
  const item = target.closest("[data-item]");
  if (item && target.matches("[data-item-move]")) {
    return moveItem(blockId, item.dataset.kind, item.dataset.item, Number(target.dataset.itemMove), key);
  }
  if (item && target.matches("[data-item-remove]")) {
    const { kind, item: itemId } = item.dataset;
    return save(
      () =>
        patchBlock(round, blockId, {
          [kind]: itemsOf(blockOf(blockId), kind).filter((one) => one.id !== itemId),
        }),
      t("guideEditorSaved"),
    );
  }
  if (target.matches("[data-readout-create]")) {
    return changeReadout(round, blockId, () => {});
  }
  if (target.matches("[data-readout-drop]")) {
    return save(() => patchBlock(round, blockId, { readout: null }), t("guideEditorSaved"));
  }
  if (target.matches("[data-readout-department-remove]")) {
    const department = target.closest("[data-department]").dataset.department;
    return changeReadout(round, blockId, (readout) => {
      delete readout.perDepartment[department];
    });
  }
  return undefined;
}

function onChange(event) {
  const target = event.target;
  if (target.matches("[data-guide-round]")) {
    local.current = target.value;
    return save(async () => {}, null, { focus: target.dataset.key });
  }
  if (target.matches("[data-assign]")) {
    const folder = target.dataset.assign;
    const round = target.value;
    return save(
      async () => {
        await deps.api(`${roundPath(round)}/assign`, { method: "POST", body: { interviews: [folder] } });
        // The interview list carries the round too; it is not read again for one field.
        const known = (deps.state.interviews ?? []).find((one) => one.id === folder);
        if (known) known.round = round;
      },
      t("roundsEditorAssigned", {
        folder: (deps.state.interviews ?? []).find((one) => one.id === folder)?.title ?? folder,
        name: roundName(round),
      }),
      { focus: target.dataset.key },
    );
  }
  return undefined;
}

/**
 * Alt+↑ and Alt+↓ move the block or the item whose field holds the focus — the
 * same as the arrow buttons beside it, without leaving the keyboard's place.
 */
function onKeydown(event) {
  const target = event.target;
  if (event.key === "Enter" && target.matches("input[data-save]")) {
    event.preventDefault();
    return commit(target);
  }
  if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return undefined;
  if (!target.matches("input[data-save]")) return undefined;
  const by = event.key === "ArrowUp" ? -1 : 1;
  const item = target.closest("[data-item]");
  const blockId = target.closest("[data-block]")?.dataset.block;
  if (!blockId) return undefined;
  event.preventDefault();
  commit(target);
  if (item) return moveItem(blockId, item.dataset.kind, item.dataset.item, by, target.dataset.key);
  if (target.closest(".guide-block-head")) return moveBlock(blockId, by, target.dataset.key);
  return undefined;
}

function onToggle(event) {
  const part = event.target.dataset?.part;
  if (!part) return;
  if (event.target.open) local.open.add(part);
  else local.open.delete(part);
}

/* Criteria of a proposition (coding view, beside the propositions) --------- */

const VERDICTS = ["supported", "falsified"];
const STANCES = ["", "supports", "contradicts"];
const CHOICE_TEXT = {
  supported: "criteriaEditorSupported",
  falsified: "criteriaEditorFalsified",
  any: "criteriaEditorAny",
  supports: "criteriaEditorSupports",
  contradicts: "criteriaEditorContradicts",
};

function thresholdText(threshold) {
  if (!threshold) return "";
  if (threshold.atLeast !== undefined) return String(threshold.atLeast);
  return String(threshold.fraction ?? "");
}

/**
 * „3" is three persons, „2/3" two thirds of the round's persons. Whatever
 * else is typed goes to the server as it is, which says what is wrong with it.
 */
function parseThreshold(text) {
  const value = String(text).trim();
  if (/^\d+$/.test(value)) return { atLeast: Number(value) };
  if (/^\d+\s*\/\s*\d+$/.test(value)) return { fraction: value.replace(/\s+/g, "") };
  if (/^(0?[.,]\d+|1([.,]0+)?)$/.test(value)) return { fraction: Number(value.replace(",", ".")) };
  return { atLeast: value };
}

function criterionHTML(pid, criterion, draft) {
  const key = `crit:${pid}:${draft ? "draft" : criterion.id}`;
  const options = (values, chosen, name) =>
    values
      .map((value) => `<option value="${attr(value)}"${value === (chosen ?? "") ? " selected" : ""}>${esc(name(value))}</option>`)
      .join("");
  const select = (name, values, chosen, label) =>
    `<label class="criterion-field"><span class="field-label">${esc(label)}</span>` +
    `<select data-c="${name}" data-key="${attr(`${key}:${name}`)}">` +
    `${options(values, chosen, (value) => (name === "round" ? roundName(value) : t(CHOICE_TEXT[value || "any"])))}` +
    `</select></label>`;
  const chosen = new Set(criterion.categories ?? []);
  const categories = (deps.state.categories ?? [])
    .map(
      (category) =>
        `<label class="criterion-category${category.parent ? " child" : ""}">` +
        `<input type="checkbox" data-c="category" value="${attr(category.id)}" data-key="${attr(`${key}:cat:${category.id}`)}"` +
        `${chosen.has(category.id) ? " checked" : ""}> ${esc(category.name)}</label>`,
    )
    .join("");
  const threshold = thresholdText(criterion.threshold);
  const textField = (name, value, label, placeholder) =>
    `<label class="criterion-field${name === "text" ? " wide" : ""}"><span class="field-label">${esc(label)}</span>` +
    `<input type="text" data-c="${name}" data-key="${attr(`${key}:${name}`)}" data-was="${attr(value)}"` +
    ` value="${attr(value)}" autocomplete="off" placeholder="${attr(placeholder)}"` +
    ` title="${attr(name === "threshold" ? t("criteriaEditorThresholdTitle") : "")}"></label>`;
  return (
    `<div class="criterion"${draft ? " data-draft" : ` data-criterion="${attr(criterion.id)}"`}>` +
    `<div class="criterion-row">` +
    select("verdict", VERDICTS, criterion.verdict, t("criteriaEditorVerdict")) +
    select("round", local.rounds.map((round) => round.id), criterion.round, t("criteriaEditorRound")) +
    (draft
      ? ""
      : button("data-criterion-remove", "×", t("criteriaEditorRemoveAria"), `${key}:remove`)) +
    `</div><div class="criterion-row">` +
    textField("threshold", threshold, t("criteriaEditorThreshold"), t("criteriaEditorThresholdPlaceholder")) +
    select("stance", STANCES, criterion.stance ?? "", t("criteriaEditorStance")) +
    `</div>` +
    `<fieldset class="criterion-categories"><legend class="field-label">${esc(t("criteriaEditorCategories"))}</legend>` +
    `${categories}</fieldset>` +
    textField("text", criterion.text ?? "", t("criteriaEditorText"), t("criteriaEditorTextPlaceholder")) +
    (draft
      ? `<div class="criterion-row">` +
        `<button type="button" class="button" data-criterion-keep data-key="${attr(`${key}:keep`)}">${esc(t("criteriaEditorKeep"))}</button>` +
        `<button type="button" class="button-quiet" data-criterion-discard data-key="${attr(`${key}:discard`)}">${esc(t("criteriaEditorDiscard"))}</button>` +
        `</div>`
      : "") +
    `</div>`
  );
}

function criteriaInner(pid) {
  const list = deps.state.propositions[pid]?.criteria ?? [];
  const draft = local.drafts.get(pid);
  return (
    `<summary>${esc(t("criteriaEditorSummary", { n: list.length }))}</summary>` +
    `<p class="column-note">${esc(t("criteriaEditorNote"))}</p>` +
    list.map((criterion) => criterionHTML(pid, criterion, false)).join("") +
    (draft
      ? criterionHTML(pid, draft, true)
      : `<button type="button" class="button-quiet" data-criterion-add data-key="${attr(`crit:${pid}:add`)}">` +
        `${esc(t("criteriaEditorAdd"))}</button>`)
  );
}

/**
 * The criteria of one proposition, folded under its row. Nothing at all while
 * the study has no rounds: a criterion is counted in the persons of a round,
 * and a study asked once has nothing to count it in.
 */
export function criteriaHTML(pid) {
  if (!deps || !local.rounds.length) return "";
  return (
    `<details class="criteria" data-criteria-for="${attr(pid)}"${local.criteriaOpen.has(pid) ? " open" : ""}>` +
    `${criteriaInner(pid)}</details>`
  );
}

function redrawCriteria(pid, options) {
  const element = document.querySelector(`#propositions [data-criteria-for="${CSS.escape(pid)}"]`);
  if (element) refill(element, criteriaInner(pid), options);
}

function redrawAllCriteria() {
  const present = [...document.querySelectorAll("#propositions [data-criteria-for]")].map(
    (element) => element.dataset.criteriaFor,
  );
  // Rounds appeared or went away: the propositions are drawn again with or
  // without their criteria. Otherwise only the criteria are refilled.
  const wanted = Object.keys(deps.state.propositions ?? {}).filter((id) => id !== "none");
  if (Boolean(local.rounds.length) !== Boolean(present.length) && wanted.length) {
    deps.redrawPropositions();
    return;
  }
  for (const pid of present) redrawCriteria(pid);
}

function saveCriteria(pid, change, message, { fresh = [], focus = null } = {}) {
  return save(
    async () => {
      const list = (deps.state.propositions[pid]?.criteria ?? []).map((one) => ({ ...one }));
      const next = change(list);
      await deps.api(`/api/propositions/${enc(pid)}`, { method: "PATCH", body: { criteria: next } });
    },
    message,
    {
      fresh,
      focus,
      after: async (options) => {
        await deps.reloadCategories().catch(deps.complain);
        redrawCriteria(pid, options);
      },
    },
  );
}

/** One field of a criterion, as a value of the criterion. */
function criterionValue(target, criterion) {
  const name = target.dataset.c;
  if (name === "category") {
    const set = new Set(criterion.categories ?? []);
    if (target.checked) set.add(target.value);
    else set.delete(target.value);
    // In the order of the category system, not the order of clicking.
    const order = (deps.state.categories ?? []).map((category) => category.id);
    return { categories: order.filter((id) => set.has(id)) };
  }
  if (name === "threshold") return { threshold: parseThreshold(target.value) };
  if (name === "stance") return { stance: target.value || undefined };
  return { [name]: target.value };
}

function criteriaChange(target) {
  const shell = target.closest("[data-criteria-for]");
  if (!shell || !target.dataset.c) return undefined;
  const pid = shell.dataset.criteriaFor;
  const name = (deps.state.propositions[pid]?.name ?? pid);
  if (target.closest("[data-draft]")) {
    const draft = local.drafts.get(pid);
    if (draft) Object.assign(draft, criterionValue(target, draft));
    return undefined;
  }
  const id = target.closest("[data-criterion]")?.dataset.criterion;
  if (!id) return undefined;
  if (target.type === "text") {
    if (target.value === target.dataset.was) return undefined;
    target.dataset.was = target.value;
  }
  return saveCriteria(
    pid,
    (list) => list.map((one) => (one.id === id ? { ...one, ...criterionValue(target, one) } : one)),
    t("criteriaEditorSaved", { name }),
    { fresh: [target.dataset.key] },
  );
}

function connectCriteria(root) {
  root.addEventListener("change", (event) => {
    if (event.target.type === "text") return;
    criteriaChange(event.target);
  });
  root.addEventListener("focusout", (event) => {
    if (event.target.matches?.('input[type="text"][data-c]')) criteriaChange(event.target);
  });
  root.addEventListener("input", (event) => {
    if (event.target.closest?.("[data-draft]")) criteriaChange(event.target);
  });
  root.addEventListener("keydown", (event) => {
    // In the coding view Enter confirms the passage in hand; on a button or a
    // disclosure of the criteria it is that control's own Enter.
    if (event.key === "Enter" && event.target.closest?.("[data-criteria-for]")?.contains(event.target)) {
      if (event.target.matches("button, summary")) event.stopPropagation();
    }
    if (event.key !== "Enter" || !event.target.matches?.('input[type="text"][data-c]')) return;
    event.preventDefault();
    criteriaChange(event.target);
  });
  root.addEventListener(
    "toggle",
    (event) => {
      const pid = event.target.dataset?.criteriaFor;
      if (!pid) return;
      if (event.target.open) local.criteriaOpen.add(pid);
      else local.criteriaOpen.delete(pid);
    },
    true,
  );
  root.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    const shell = target?.closest("[data-criteria-for]");
    if (!shell) return undefined;
    const pid = shell.dataset.criteriaFor;
    const name = deps.state.propositions[pid]?.name ?? pid;
    if (target.matches("[data-criterion-add]")) {
      local.drafts.set(pid, { verdict: "supported", round: local.rounds.at(-1)?.id, categories: [], text: "" });
      return redrawCriteria(pid, { focus: `crit:${pid}:draft:verdict` });
    }
    if (target.matches("[data-criterion-discard]")) {
      local.drafts.delete(pid);
      return redrawCriteria(pid, { focus: `crit:${pid}:add` });
    }
    if (target.matches("[data-criterion-keep]")) {
      const draft = local.drafts.get(pid);
      return save(
        async () => {
          const list = (deps.state.propositions[pid]?.criteria ?? []).map((one) => ({ ...one }));
          await deps.api(`/api/propositions/${enc(pid)}`, {
            method: "PATCH",
            body: { criteria: [...list, { ...draft, threshold: draft.threshold ?? {} }] },
          });
          local.drafts.delete(pid);
        },
        t("criteriaEditorAdded", { name }),
        {
          after: async (options) => {
            await deps.reloadCategories().catch(deps.complain);
            redrawCriteria(pid, options);
          },
          focus: `crit:${pid}:add`,
        },
      );
    }
    if (target.matches("[data-criterion-remove]")) {
      const id = target.closest("[data-criterion]").dataset.criterion;
      return saveCriteria(pid, (list) => list.filter((one) => one.id !== id), t("criteriaEditorRemoved", { name }), {
        focus: `crit:${pid}:add`,
      });
    }
    return undefined;
  });
}

/* Start -------------------------------------------------------------------- */

/**
 * @param {object} dependencies — `api`, `notify`, `complain`, `escapeHTML`,
 *   `exportHref`, `state`, `reloadCategories`, `redrawPropositions` from app.js.
 */
export function initGuide(dependencies) {
  deps = dependencies;
  const node = document.createElement("div");
  node.className = "guide-editor";
  node.id = "guide-editor";
  node.addEventListener("submit", onSubmit);
  node.addEventListener("click", onClick);
  node.addEventListener("change", onChange);
  node.addEventListener("keydown", onKeydown);
  node.addEventListener("focusout", (event) => commit(event.target));
  node.addEventListener("toggle", onToggle, true);
  document.addEventListener("focusin", (event) => {
    local.lastKey = node.contains(event.target) ? (event.target.dataset?.key ?? null) : null;
  });
  local.node = node;
  connectCriteria(document.querySelector("#propositions"));
  // Read once at the start, so the criteria know whether there are rounds.
  return reload()
    .then(() => {
      render();
      deps.redrawPropositions();
    })
    .catch(deps.complain);
}
