/**
 * The study's rounds, which interview belongs to which, and the guide of each.
 *
 * A study that asks the same people twice — once for what they need, once for
 * how what was built for them works — is two rounds of one panel. The tool knew
 * of one undivided set of interviews; this file says which round each folder
 * belongs to and what the interview guide of that round was.
 *
 * ## Where it lives
 *
 * `study.json`, beside `categories.json`, `requirements.json` and `roles.json`.
 * Rounds and guides hold across interviews in the way the category system does,
 * so they belong with it rather than in any one interview folder; and a folder
 * of transcripts copied elsewhere without the study files is, as before, a
 * folder of transcripts. What happened in one particular conversation — the
 * interview log — belongs to that conversation and lives in its folder (see
 * `session.js`).
 *
 * ## What a missing file means
 *
 * That the feature is not used. Nothing here writes on read, so a study that
 * never asked for rounds never gets the file, and every interview simply has no
 * round. Once rounds exist, an interview nobody assigned belongs to the first
 * one: the studies this was built for had all their existing interviews before
 * the second round was thought of.
 *
 * ## The guide
 *
 * Helfferich's form, one block per narrative prompt: the prompt itself, a
 * checklist of keywords asked only when they did not come up on their own,
 * mandatory questions asked of everybody (possibly under a condition), and,
 * where a block reads something out, a list per department. Questions and
 * keywords can carry a tag — the construct a question operationalises — which is
 * what a report ordered by construct is ordered by.
 *
 * Every block and every item has an id that never changes once given: an
 * interview log ticks items by id and a coding unit names its guide question by
 * id, so a reworded question must stay the same question. Block ids are made
 * from the name, because they appear in the interview logs and should be
 * readable there; item ids are short random ones, so that deleting the last
 * item and adding another can never hand the new one an old one's ticks.
 */

import { readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { fail } from "./texts.js";
import { compact, inTurn, read, slug, write } from "./store.js";

export const STUDY_FILE = "study.json";
const VERSION = 1;

const bad = (key, params, status = 400) => Object.assign(fail(key, params), { status });

const text = (value) => String(value ?? "").trim();

/** An object with its keys in sorted order, so a diff of it reads as a change. */
function sorted(object) {
  return Object.fromEntries(Object.entries(object ?? {}).sort(([a], [b]) => a.localeCompare(b)));
}

/* Shapes ------------------------------------------------------------------- */

function shapeItem(raw, kind) {
  return compact({
    id: String(raw.id),
    text: text(raw.text),
    condition: kind === "mandatory" ? text(raw.condition) || undefined : undefined,
    tag: text(raw.tag) || undefined,
  });
}

function shapeReadout(raw) {
  if (!raw) return undefined;
  const perDepartment = {};
  for (const [department, items] of Object.entries(raw.perDepartment ?? {})) {
    const name = text(department);
    if (!name) continue;
    perDepartment[name] = [...new Set((items ?? []).map(text).filter(Boolean))];
  }
  return { label: text(raw.label), perDepartment };
}

function shapeBlock(raw) {
  return compact({
    id: String(raw.id),
    name: text(raw.name),
    prompt: text(raw.prompt),
    checklist: (raw.checklist ?? []).map((item) => shapeItem(item, "checklist")),
    mandatory: (raw.mandatory ?? []).map((item) => shapeItem(item, "mandatory")),
    readout: shapeReadout(raw.readout),
  });
}

function shapeStudy(raw) {
  return {
    version: VERSION,
    rounds: (raw.rounds ?? []).map((round) =>
      compact({
        id: String(round.id),
        name: text(round.name) || String(round.id),
        guide: round.guide ? { blocks: (round.guide.blocks ?? []).map(shapeBlock) } : undefined,
      }),
    ),
    assignments: sorted(raw.assignments),
  };
}

/* Checking what arrives ---------------------------------------------------- */

function freshItemId(kind, taken) {
  for (;;) {
    const id = `${kind === "mandatory" ? "m" : "c"}-${randomUUID().slice(0, 8)}`;
    if (!taken.has(id)) return id;
  }
}

function blockIdFor(name, taken) {
  const stem = slug(name) || "block";
  let id = stem;
  for (let n = 2; taken.has(id); n += 1) id = `${stem}-${n}`;
  return id;
}

function checkedItems(list, kind, taken) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw bad("errorGuideItemsList");
  return list.map((raw) => {
    const item = typeof raw === "string" ? { text: raw } : (raw ?? {});
    if (!text(item.text)) throw bad("errorGuideItemText");
    let id = text(item.id);
    if (id && taken.has(id)) throw bad("errorGuideDuplicateId", { id });
    if (!id) id = freshItemId(kind, taken);
    taken.add(id);
    return shapeItem({ ...item, id }, kind);
  });
}

function checkedReadout(raw) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) throw bad("errorReadoutShape");
  const per = raw.perDepartment ?? {};
  if (typeof per !== "object" || Array.isArray(per)) throw bad("errorReadoutShape");
  for (const items of Object.values(per)) {
    if (!Array.isArray(items) || items.some((item) => typeof item !== "string")) {
      throw bad("errorReadoutShape");
    }
  }
  return shapeReadout(raw);
}

/**
 * One block as it arrives, checked and given the ids it lacks.
 *
 * `taken` holds every id the rest of the guide already uses, so that an id is
 * unique across the guide and not only inside its block: an interview log
 * ticks an item by its id alone.
 */
function checkedBlock(raw, taken) {
  const name = text(raw?.name);
  if (!name) throw bad("errorBlockName");
  let id = text(raw.id);
  if (id && taken.has(id)) throw bad("errorGuideDuplicateId", { id });
  if (!id) id = blockIdFor(name, taken);
  taken.add(id);
  return shapeBlock({
    id,
    name,
    prompt: raw.prompt,
    checklist: checkedItems(raw.checklist, "checklist", taken),
    mandatory: checkedItems(raw.mandatory, "mandatory", taken),
    readout: checkedReadout(raw.readout),
  });
}

/** Every item id in a list of blocks. */
export function itemIds(blocks) {
  return new Set(blocks.flatMap((block) => [...block.checklist, ...block.mandatory].map((item) => item.id)));
}

/** Every item in a guide, with the block and the kind it belongs to. */
export function guideItems(blocks) {
  return blocks.flatMap((block) => [
    ...block.checklist.map((item) => ({ ...item, block: block.id, kind: "checklist" })),
    ...block.mandatory.map((item) => ({ ...item, block: block.id, kind: "mandatory" })),
  ]);
}

/**
 * Refuse to drop what the material already refers to.
 *
 * An item ticked in a conversation or named by a coding unit is part of the
 * record: rewording it is fine, removing it would leave a tick on nothing.
 */
function keepUsed(before, after, used) {
  if (!used?.size) return;
  const kept = itemIds(after);
  for (const item of guideItems(before)) {
    if (used.has(item.id) && !kept.has(item.id)) {
      throw bad("errorGuideItemInUse", { text: item.text }, 409);
    }
  }
}

/* The file ----------------------------------------------------------------- */

export class Study {
  constructor(store) {
    this.store = store;
    this.file = join(dirname(store.categoriesFile), STUDY_FILE);
  }

  /** The study as it stands; without a file, a study with no rounds. */
  async read() {
    const raw = await read(this.file, null);
    return shapeStudy(raw ?? {});
  }

  /** Read, change, write — in this file's turn, like every other file here. */
  async change(work) {
    return inTurn(
      this.file,
      async () => {
        const data = await this.read();
        const result = await work(data);
        await write(this.file, shapeStudy(data));
        return result;
      },
      this.store.locking,
    );
  }

  /** The round an interview folder belongs to, or null while there are none. */
  static roundOf(data, folder) {
    return data.assignments[folder] ?? data.rounds[0]?.id ?? null;
  }

  static round(data, id) {
    const round = data.rounds.find((one) => one.id === id);
    if (!round) throw bad("errorUnknownRound", undefined, 404);
    return round;
  }

  /**
   * Every folder under the transcript root that is part of the study: those
   * with a transcript, and those with only an interview log so far — a
   * conversation that is planned or under way and not yet transcribed.
   */
  async folders() {
    let entries;
    try {
      entries = await readdir(this.store.transcriptRoot, { withFileTypes: true });
    } catch {
      return [];
    }
    const found = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const here = join(this.store.transcriptRoot, entry.name);
      const has = (name) => stat(join(here, name)).then(() => true, () => false);
      const transcript = await has("final.md");
      const session = await has("session.json");
      if (transcript || session) found.push({ id: entry.name, transcript, session });
    }
    return found;
  }

  /* Rounds ------------------------------------------------------------------ */

  async addRound({ id, name }) {
    const title = text(name);
    if (!title) throw bad("errorRoundName");
    const wanted = slug(text(id) || title);
    if (!wanted) throw bad("errorRoundName");
    return this.change((data) => {
      if (data.rounds.some((one) => one.id === wanted)) throw bad("errorRoundExists", undefined, 409);
      const round = { id: wanted, name: title };
      data.rounds.push(round);
      return round;
    });
  }

  async updateRound(id, fields) {
    return this.change((data) => {
      const round = Study.round(data, id);
      if ("name" in fields) {
        const title = text(fields.name);
        if (!title) throw bad("errorRoundName");
        round.name = title;
      }
      return { id: round.id, name: round.name };
    });
  }

  /**
   * Remove a round nobody belongs to.
   *
   * Whatever still resolves to it — assigned explicitly, or by falling to the
   * first round — would otherwise move to another round without anybody having
   * said so, and the round an interview belongs to decides which numbers it
   * ends up in.
   */
  async removeRound(id) {
    const folders = await this.folders();
    return this.change((data) => {
      Study.round(data, id);
      const count = folders.filter((one) => Study.roundOf(data, one.id) === id).length;
      if (count) throw bad("errorRoundInUse", { count }, 409);
      data.rounds = data.rounds.filter((one) => one.id !== id);
      for (const [folder, round] of Object.entries(data.assignments)) {
        if (round === id) delete data.assignments[folder];
      }
    });
  }

  /** Put interview folders into a round. Written explicitly, also for the first. */
  async assign(id, interviews) {
    if (!Array.isArray(interviews) || !interviews.length) throw bad("errorInterviewList");
    const known = new Set((await this.folders()).map((one) => one.id));
    for (const folder of interviews) {
      this.store.interviewFolder(folder);
      if (!known.has(folder)) throw bad("errorUnknownInterview", undefined, 404);
    }
    return this.change((data) => {
      Study.round(data, id);
      for (const folder of interviews) data.assignments[folder] = id;
      return { round: id, interviews };
    });
  }

  /** A folder renamed carries its round along; one removed takes it away. */
  async renameFolder(from, to) {
    const data = await this.read();
    if (!(from in data.assignments)) return;
    await this.change((fresh) => {
      if (!(from in fresh.assignments)) return;
      fresh.assignments[to] = fresh.assignments[from];
      delete fresh.assignments[from];
    });
  }

  async forget(folder) {
    const data = await this.read();
    if (!(folder in data.assignments)) return;
    await this.change((fresh) => {
      delete fresh.assignments[folder];
    });
  }

  /* The guide --------------------------------------------------------------- */

  async guide(id) {
    const data = await this.read();
    const round = Study.round(data, id);
    return { round: round.id, name: round.name, blocks: round.guide?.blocks ?? [] };
  }

  /**
   * The whole guide at once — for bringing one in from a file, or for writing
   * it back after it was worked on somewhere else. Ids that are given are kept;
   * those that are missing are made. `used` holds the item ids the material
   * refers to, which may be reworded but not dropped.
   */
  async setGuide(id, guide, { used, startedBlocks } = {}) {
    if (!guide || typeof guide !== "object" || !Array.isArray(guide.blocks)) {
      throw bad("errorGuideShape");
    }
    const taken = new Set();
    const blocks = guide.blocks.map((block) => checkedBlock(block, taken));
    return this.change((data) => {
      const round = Study.round(data, id);
      const before = round.guide?.blocks ?? [];
      keepUsed(before, blocks, used);
      const kept = new Set(blocks.map((block) => block.id));
      for (const block of before) {
        const count = startedBlocks?.get(block.id) ?? 0;
        if (count && !kept.has(block.id)) throw bad("errorBlockInUse", { count }, 409);
      }
      round.guide = { blocks };
      return { round: round.id, name: round.name, blocks };
    });
  }

  async addBlock(id, raw, { position } = {}) {
    return this.change((data) => {
      const round = Study.round(data, id);
      const blocks = round.guide?.blocks ?? [];
      const block = checkedBlock(raw ?? {}, new Set([...blocks.map((one) => one.id), ...itemIds(blocks)]));
      const at = Number.isInteger(position) ? Math.max(0, Math.min(position, blocks.length)) : blocks.length;
      blocks.splice(at, 0, block);
      round.guide = { blocks };
      return block;
    });
  }

  /**
   * Change one block. Lists are replaced whole: an item that comes back with
   * its id is the same item reworded, one without an id is new, and one that
   * does not come back is dropped — unless the material refers to it.
   */
  async updateBlock(id, blockId, fields, { used } = {}) {
    return this.change((data) => {
      const round = Study.round(data, id);
      const blocks = round.guide?.blocks ?? [];
      const at = blocks.findIndex((one) => one.id === blockId);
      if (at < 0) throw bad("errorUnknownBlock", undefined, 404);
      const old = blocks[at];
      const others = blocks.filter((one) => one.id !== blockId);
      const taken = new Set([...others.map((one) => one.id), ...itemIds(others), blockId]);
      const next = {
        ...old,
        ...("name" in fields ? { name: text(fields.name) } : {}),
        ...("prompt" in fields ? { prompt: text(fields.prompt) } : {}),
      };
      if (!next.name) throw bad("errorBlockName");
      next.checklist = "checklist" in fields
        ? checkedItems(fields.checklist, "checklist", taken)
        : checkedItems(old.checklist, "checklist", taken);
      next.mandatory = "mandatory" in fields
        ? checkedItems(fields.mandatory, "mandatory", taken)
        : checkedItems(old.mandatory, "mandatory", taken);
      if ("readout" in fields) next.readout = checkedReadout(fields.readout);
      const block = shapeBlock(next);
      keepUsed([old], [block], used);
      blocks.splice(at, 1);
      const to = Number.isInteger(fields.position)
        ? Math.max(0, Math.min(fields.position, blocks.length))
        : at;
      blocks.splice(to, 0, block);
      round.guide = { blocks };
      return block;
    });
  }

  async removeBlock(id, blockId, { started = 0, used } = {}) {
    return this.change((data) => {
      const round = Study.round(data, id);
      const blocks = round.guide?.blocks ?? [];
      const block = blocks.find((one) => one.id === blockId);
      if (!block) throw bad("errorUnknownBlock", undefined, 404);
      if (started) throw bad("errorBlockInUse", { count: started }, 409);
      keepUsed([block], [], used);
      round.guide = { blocks: blocks.filter((one) => one.id !== blockId) };
    });
  }
}
