/**
 * Storage of the codings.
 *
 * Two places, for one reason: the category system holds across all interviews
 * and therefore lives with the tool. The codings belong to their transcript and
 * sit as `coding.json` next to its final version, so that the location and the
 * citation share one provenance.
 *
 * Writing goes through a temporary file and a rename, so that an interruption
 * mid-write never leaves half a file behind.
 *
 * Files written by earlier versions carry German names and German keys. They
 * are read as they are and rewritten in the current format on the next write —
 * nobody has to migrate a study by hand.
 */

import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEDUCTIVE,
  PROPOSITIONS,
  normalizeCategory,
  normalizeProposition,
  parentProblem,
  pickText,
  startSystem,
} from "./categories.js";
import { OPERATIONS } from "./analysis.js";
import { FALLBACK, fail, translator } from "./texts.js";
import { parseTranscript, rewriteHeader, safeInterviewId } from "./transcript.js";

const VERSION = 3;

/**
 * The proposition a category falls back to: the one that argues no proposition
 * at all, but is derived from the research interest. Everything that loses its
 * heading lands here, so it is the one entry that cannot be dissolved.
 */
const NO_PROPOSITION = "none";

const LEGACY_CATEGORIES_FILE = "kategoriensystem.json";
const LEGACY_REQUIREMENTS_FILE = "anforderungen.json";
const LEGACY_CODING_FILE = "kodierung.json";

const BLOCKED_OPERATIONS = { ablage: "filing", abruf: "retrieval", transfer: "transfer" };

/**
 * A name turned into an identifier, the same way everywhere.
 *
 * Three places made one of these by hand and they had drifted apart in small
 * ways. The identifier is what a file keeps and what every reference points at,
 * so how it is formed is one decision, not three.
 */
function slug(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[äöüß]/g, (character) => ({ ä: "ae", ö: "oe", ü: "ue", ß: "ss" })[character])
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * A colour the tool may put into an SVG.
 *
 * Propositions carry the colours of every figure the study produces, and those
 * colours are written straight into the drawings — as a fill, and as a custom
 * property in the interface. Anything that is not plainly a colour has no
 * business there, so the shape is checked rather than trusted.
 */
const COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function checkedColor(value) {
  const color = String(value ?? "").trim();
  if (!COLOR.test(color)) {
    throw Object.assign(fail("errorColorShape", { color }), { status: 400 });
  }
  return color.toLowerCase();
}

async function read(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

/** The first of the given files that exists, or the fallback. */
async function readFirst(paths, fallback) {
  for (const path of paths) {
    const data = await read(path, null);
    if (data) return data;
  }
  return fallback;
}

/**
 * Whether a failure is the folder's fault rather than the tool's.
 *
 * A container started against a folder it may not write to is the ordinary
 * first-run mishap, not a bug. It deserves a sentence the reader can act on
 * instead of a stack trace with a temporary file name in it.
 */
const NOT_WRITABLE = new Set(["EACCES", "EPERM", "EROFS", "ENOSPC"]);

/**
 * One change at a time, per file.
 *
 * Every change here reads the whole file, alters it and writes it back — and
 * the read is awaited, so two requests arriving together both read the old
 * state and the second write drops the first one's work. Two browser tabs on
 * one study is the ordinary case, not an exotic one: twenty codings sent at
 * once left two behind.
 *
 * The tool is a single process, so one queue per path is all it takes. A change
 * that fails must not block the ones behind it, hence running the next one
 * either way; the caller still receives the real error.
 */
const queues = new Map();

/**
 * And one process at a time, per file.
 *
 * The queue above is this process's own, which is no help when a second one
 * shares the folder — a container and a local start, or two people on a mounted
 * drive, which the tool invites by design. Twelve codings sent through two
 * servers were all answered with "created" and six of them were gone: the tool
 * reporting success for work it dropped, which is the worst shape a failure can
 * take here.
 *
 * `wx` either creates the file or fails, with no window in between, so it is
 * enough to hold the turn. A lock left behind by a process that died is broken
 * once it is plainly too old to be real work.
 */
const LOCK_STALE = 10_000;
const LOCK_WAIT = 5_000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withFileLock(path, work, { stale = LOCK_STALE, patience = LOCK_WAIT } = {}) {
  const lock = `${path}.lock`;
  const deadline = Date.now() + patience;
  for (;;) {
    try {
      const handle = await open(lock, "wx");
      await handle.writeFile(String(process.pid));
      await handle.close();
      break;
    } catch (error) {
      if (error.code !== "EEXIST") {
        // A folder that cannot be written to is reported by the write itself,
        // in words the reader can act on; the lock steps out of the way.
        if (NOT_WRITABLE.has(error.code)) return work();
        throw error;
      }
      const age = await stat(lock).then(
        (info) => Date.now() - info.mtimeMs,
        () => Infinity,
      );
      if (age > stale) {
        await rm(lock, { force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw Object.assign(fail("errorBusy", { path: dirname(path) }), { status: 503 });
      }
      await wait(20);
    }
  }
  /* A lock is judged stale by its age, and its age was set once when it was
     taken. Work that outlasts the threshold — a large file on a mounted drive,
     say — would therefore have its own lock broken underneath it by the next
     process along, which is exactly the collision the lock is for. So it is
     kept fresh while the work runs: an old lock then really does mean nobody is
     behind it. `unref` so a held lock cannot keep the process alive. */
  const beating = setInterval(() => {
    const now = new Date();
    utimes(lock, now, now).catch(() => {});
  }, Math.max(20, stale / 4));
  beating.unref?.();

  try {
    return await work();
  } finally {
    clearInterval(beating);
    await rm(lock, { force: true });
  }
}

function inTurn(path, work, timing) {
  const previous = queues.get(path) ?? Promise.resolve();
  const running = previous.then(
    () => withFileLock(path, work, timing),
    () => withFileLock(path, work, timing),
  );
  queues.set(
    path,
    running.then(
      () => {},
      () => {},
    ),
  );
  return running;
}

/** A counter, so that two writes at once never share a temporary file. */
let sequence = 0;

async function write(path, value) {
  try {
    await mkdir(dirname(path), { recursive: true });
    // The process id alone was not enough: inside one process every concurrent
    // write used the same name, overwrote each other's contents, and all but
    // one failed on the rename with ENOENT.
    const temporary = `${path}.${process.pid}.${++sequence}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
    await rename(temporary, path);
  } catch (error) {
    if (!NOT_WRITABLE.has(error.code)) throw error;
    throw Object.assign(
      fail(error.code === "ENOSPC" ? "errorDataFull" : "errorDataNotWritable", {
        path: dirname(path),
      }),
      { status: 500, cause: error },
    );
  }
}

/**
 * The same careful write, for a file that is text rather than a record.
 *
 * A transcript is the material, and the material is the one thing here nobody
 * can reconstruct. So it goes through the temporary file and the rename like
 * everything else, and reports an unwritable folder in the same words.
 */
async function writeText(path, text) {
  try {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${++sequence}.tmp`;
    await writeFile(temporary, text, "utf8");
    await rename(temporary, path);
  } catch (error) {
    if (!NOT_WRITABLE.has(error.code)) throw error;
    throw Object.assign(
      fail(error.code === "ENOSPC" ? "errorDataFull" : "errorDataNotWritable", {
        path: dirname(path),
      }),
      { status: 500, cause: error },
    );
  }
}

/** Drop keys without a value, so that nothing writes `undefined` into a file. */
function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

/**
 * Coding rules as a list of sentences.
 *
 * Older states held them as `{ text }`; both are read, only the sentence itself
 * is written. Empty entries drop out, so that an accidentally cleared field
 * deletes the rule instead of leaving a blank line in the coding guide.
 */
function ruleList(value) {
  if (!Array.isArray(value)) {
    throw Object.assign(fail("errorRulesList"), { status: 400 });
  }
  return value
    .map((rule) => (typeof rule === "string" ? rule : (rule?.text ?? "")).trim())
    .filter(Boolean);
}

/* Reading older formats ---------------------------------------------------- */

function migrateCategories(data, language = FALLBACK) {
  const propositions = Object.fromEntries(
    Object.entries(data.propositions ?? data.propositionen ?? PROPOSITIONS).map(([id, value]) => [
      id,
      normalizeProposition(value),
    ]),
  );
  /* The fallback is a proposition like any other and belongs in the list.
     Every category that argues none of the study's own points is put on it by
     the seed, so it has always been referenced; it was simply never written
     down — which showed as a category system whose colour key was one entry
     short, and, once the propositions became editable, as a heading that could
     be pointed at and not named. */
  propositions[NO_PROPOSITION] ??= normalizeProposition(PROPOSITIONS[NO_PROPOSITION], language);
  const categories = (data.categories ?? data.kategorien ?? []).map((raw) => {
    const { children, ...category } = normalizeCategory(raw);
    return compact({ ...category, codingRules: category.codingRules ?? [] });
  });
  return { version: VERSION, propositions, categories };
}

/**
 * One shape for a coding unit, wherever it comes from.
 *
 * The fields used to be written in whatever order the object happened to be
 * built in: one order when a unit was created, another after it had been read
 * back and migrated. So a file held the same kind of record in two different
 * orders at once, and adding a single unit rewrote the lines of a unit that had
 * not changed — for a tool that keeps its codings in the same git history as
 * the transcripts, that is a history nobody can read. The order is settled here
 * and used by both.
 */
function shapeCoding(raw) {
  return compact({
    id: raw.id,
    created: raw.created ?? raw.angelegt,
    turn: raw.turn ?? raw.beitrag,
    start: raw.start,
    end: raw.end ?? raw.ende,
    category: raw.category ?? raw.kategorie,
    text: raw.text,
    memo: raw.memo ?? "",
    anchor: raw.anchor ?? raw.anker ?? false,
    reviewed: raw.reviewed ?? raw.geprueft ?? false,
    requirements: raw.requirements ?? raw.anforderungen ?? [],
  });
}

const migrateCoding = shapeCoding;

function migrateCodings(data, interview) {
  return {
    version: VERSION,
    interview,
    memo: data.memo ?? "",
    changed: data.changed ?? data.geaendert,
    codings: (data.codings ?? data.kodierungen ?? []).map(migrateCoding),
  };
}

function migrateRequirement(raw) {
  const blocked = raw.blockedOperations ?? raw.blockiert ?? [];
  return compact({
    id: raw.id,
    title: raw.title ?? raw.titel,
    /* The definition is what leaves this tool for the written work, and the
       note beside it is the desk it was worked out on. They were one field, and
       one field means either the working thought ends up in the thesis or the
       thesis wording has nowhere to be kept while it is still being found.

       It arrives empty rather than missing. A field that is absent until
       somebody types in it is a field nothing can rely on: an export has to ask
       whether it exists before asking what it says, and a study written by an
       earlier version answers differently from one written today for no reason
       the author can see. `""` is a definition nobody has written yet, which is
       a fact about the requirement; `undefined` is a fact about the file
       format, and that is not the reader's business. */
    definition: raw.definition ?? "",
    description: raw.description ?? raw.beschreibung ?? "",
    blockedOperations: blocked.map((operation) => BLOCKED_OPERATIONS[operation] ?? operation),
    moscow: raw.moscow ?? null,
    created: raw.created ?? raw.angelegt,
  });
}

/**
 * The operations whose blocking a requirement is weighed by.
 *
 * They were three constants in the source — filing, retrieval, transfer — which
 * is the vocabulary of one study and was handed to every other one. A study
 * about something else weighed its requirements against three words it never
 * chose. So they are seeded from those three and belong to the study from then
 * on, like the propositions and the categories.
 *
 * The seeded names are resolved once, into the language the study is set up in.
 * From then on the file holds one wording and the language is not asked again:
 * what the author renamed them to is what every catalog says.
 */
function seededOperations(language) {
  const t = translator(language);
  return OPERATIONS.map(({ id, key }) => ({ id, name: t(key) }));
}

function migrateOperations(raw, language) {
  if (!Array.isArray(raw) || !raw.length) return seededOperations(language);
  return raw
    .map((one) => (typeof one === "string" ? { id: one } : (one ?? {})))
    .filter((one) => one.id)
    .map((one) => ({
      // The German identifiers of the first versions still point at the same
      // three operations, here as much as on a requirement.
      id: BLOCKED_OPERATIONS[one.id] ?? one.id,
      name: String(one.name ?? one.id),
    }));
}

/**
 * The operations a requirement says it blocks, checked against the study's.
 *
 * An identifier that names no operation would be counted by the prioritization
 * field and shown by nothing, so it is refused where it arrives rather than
 * dropped in silence — a checkbox that saves and then is not there next time is
 * the worst way to learn that something went wrong.
 */
function checkedOperations(wanted, operations) {
  if (!Array.isArray(wanted)) {
    throw Object.assign(fail("errorOperationsList"), { status: 400 });
  }
  const known = new Set(operations.map((one) => one.id));
  for (const id of wanted) {
    if (!known.has(id)) throw Object.assign(fail("errorUnknownOperation"), { status: 404 });
  }
  return [...new Set(wanted)];
}

function migrateRequirements(data, language = FALLBACK) {
  return {
    version: VERSION,
    operations: migrateOperations(data.operations ?? data.operationen, language),
    requirements: (data.requirements ?? data.anforderungen ?? []).map(migrateRequirement),
  };
}

/**
 * Subordinate an inductive category to another one, or release it again.
 *
 * Where an inductive category belongs only shows in the material: what began as
 * a case of its own turns out at the fourth citation to be a variant of a start
 * category. The assignment therefore moves without the category having to be
 * created anew and its locations re-hung.
 *
 * The list is sorted along with it: a subordinated category sits directly
 * behind its parent. The order in the file is the order in the interface and in
 * every analysis, and a subcategory far away from its parent reads as a
 * standalone one.
 *
 * The proposition anchoring follows the assignment, as it does on creation: a
 * distinction carries the proposition under which it is drawn.
 */
function subordinate(categories, category, parentId) {
  if (category.origin === "deductive") {
    throw Object.assign(
      fail("errorDeductiveStaysPut"),
      { status: 409 },
    );
  }
  if (parentId === category.id) {
    throw Object.assign(fail("errorSelfParent"), {
      status: 400,
    });
  }
  const parent = parentId ? categories.find((c) => c.id === parentId) : null;
  if (parentId && !parent) {
    throw Object.assign(fail("errorUnknownCategory"), { status: 404 });
  }
  // Two levels, like the start system: neither below a subcategory nor with
  // subcategories of its own in tow. A third level could no longer be rendered
  // in the analysis.
  if (parent?.parent) {
    throw Object.assign(
      fail("errorTwoLevels"),
      { status: 409 },
    );
  }
  if (parent && categories.some((c) => c.parent === category.id)) {
    throw Object.assign(
      fail("errorHasChildren"),
      { status: 409 },
    );
  }

  category.parent = parentId || null;
  category.proposition = parent?.proposition ?? "none";

  categories.splice(categories.indexOf(category), 1);
  if (!parent) {
    categories.push(category);
    return;
  }
  let position = categories.indexOf(parent) + 1;
  while (categories[position]?.parent === parent.id) position += 1;
  categories.splice(position, 0, category);
}

export class Store {
  constructor({
    toolRoot,
    transcriptRoot,
    categoriesFile = null,
    startSystemFile = null,
    // The language the start system is seeded in when nothing states one. A
    // request that reaches the store first overrides it; `START_LANGUAGE` pins
    // it for good, which is what a shared or scripted setup wants.
    seedLanguage = FALLBACK,
    // How long to wait for another process to let go, and how old a lock has to
    // be before nobody can be behind it. A slow mounted drive may want more;
    // the tests want much less than five seconds of waiting.
    lockWait,
    lockStale,
  }) {
    this.seedLanguage = seedLanguage;
    this.locking = { patience: lockWait, stale: lockStale };
    this.categoriesFile = categoriesFile ?? join(toolRoot, "categories.json");
    const dataDirectory = dirname(this.categoriesFile);
    this.legacyCategoriesFile = join(dataDirectory, LEGACY_CATEGORIES_FILE);
    this.requirementsFile = join(dataDirectory, "requirements.json");
    this.legacyRequirementsFile = join(dataDirectory, LEGACY_REQUIREMENTS_FILE);
    this.transcriptRoot = transcriptRoot;
    this.startSystemFile = startSystemFile;
  }

  /**
   * Seeds the category system if it is not there yet, in the given language.
   *
   * Seeding is a bootstrap concern, not something every method should have an
   * opinion about: half the store reaches `categories()` from the inside —
   * adding a category, merging two — and threading a language through all of
   * them would put the decision in five places. The caller settles it once,
   * before anything else runs. Once the file exists this is one read.
   */
  async ensureSeeded(language) {
    await this.categories(language);
  }

  /* Every path this store builds for an interview goes through here, so the
     rule is kept once rather than remembered at eleven call sites. A name that
     could steer the join is refused before it becomes a path — reading or
     writing, and whether the route above remembered to check or not. */
  interviewFolder(interview) {
    if (!safeInterviewId(interview)) {
      throw Object.assign(fail("errorUnknownInterview"), { status: 404 });
    }
    return join(this.transcriptRoot, interview);
  }

  codingFile(interview) {
    return join(this.interviewFolder(interview), "coding.json");
  }

  legacyCodingFile(interview) {
    return join(this.interviewFolder(interview), LEGACY_CODING_FILE);
  }

  /**
   * A second coder's work, read where it was put down and never written to.
   *
   * Intercoder reliability needs a second coding, and the way to get one that
   * costs nobody anything is the one this tool already implies: the second
   * coder runs their own copy on the same transcripts and hands over their
   * `coding.json`. It goes beside the first as `coding.<name>.json` — anna,
   * coder-2, whatever the study calls them — and the name in the file name is
   * the name that appears in the comparison.
   *
   * Read only, deliberately. A second coding that the tool could edit would no
   * longer be independent of it, and independence is the entire point of the
   * exercise.
   */
  async otherCodings(interview) {
    let entries;
    try {
      entries = await readdir(this.interviewFolder(interview));
    } catch {
      return { found: {}, problems: [] };
    }
    const found = {};
    const problems = [];
    for (const entry of entries.sort()) {
      // `coding.json` itself needs no exception: the pattern wants a name
      // between the two dots, and it has none.
      const name = entry.match(/^coding\.(.+)\.json$/)?.[1];
      if (!name) continue;
      try {
        const raw = JSON.parse(await readFile(join(this.interviewFolder(interview), entry), "utf8"));
        found[name] = migrateCodings(raw, interview).codings;
      } catch {
        // A file put there on purpose and then not read would be the worst of
        // both: the comparison silently misses an interview and says the second
        // coder did not do it. It is named instead.
        problems.push({ interview, file: entry, coder: name });
      }
    }
    return { found, problems };
  }

  /**
   * The category system, seeding it on the very first read.
   *
   * The language matters exactly once, for that seed: it decides which wording
   * of the bundled — or of a bilingual own — start system is written out. From
   * then on the file holds one language and the language argument is ignored,
   * because the categories are the author's to name.
   */
  async categories(language = this.seedLanguage) {
    const data = await readFirst([this.categoriesFile, this.legacyCategoriesFile], null);
    if (data) return migrateCategories(data, language);
    const fresh = { version: VERSION, ...(await this.freshSystem(language)) };
    await write(this.categoriesFile, fresh);
    return fresh;
  }

  /**
   * The seed for the first start: your own start system from the configured
   * file, otherwise the bundled one. A configured but unusable file aborts
   * loudly — whoever codes silently with the wrong category system only notices
   * it in the material.
   */
  async freshSystem(language = this.seedLanguage) {
    const resolved = (propositions) =>
      Object.fromEntries(
        Object.entries(propositions).map(([id, value]) => [
          id,
          normalizeProposition(value, language),
        ]),
      );
    if (!this.startSystemFile) {
      return {
        propositions: resolved(PROPOSITIONS),
        categories: startSystem(DEDUCTIVE, language),
      };
    }
    let data;
    try {
      data = JSON.parse(await readFile(this.startSystemFile, "utf8"));
    } catch (error) {
      throw Object.assign(
        fail("errorStartSystemUnreadable", { file: this.startSystemFile, reason: error.message }),
        { status: 500 },
      );
    }
    const raw = data.categories ?? data.kategorien;
    if (!Array.isArray(raw) || !raw.length) {
      throw Object.assign(
        fail("errorStartSystemEmpty"),
        { status: 500 },
      );
    }
    for (const category of raw) {
      if (!category.id || !category.name || !category.definition) {
        // The name may be keyed by language, so it is resolved before it goes
        // into the message — an object there would read as [object Object].
        const named = category.id ?? pickText(category.name, language) ?? "?";
        throw Object.assign(fail("errorStartSystemFields", { name: named }), { status: 500 });
      }
    }
    const categories = startSystem(raw, language);
    // A hierarchy that cannot hold is caught here, before it is written: once
    // seeded, the file is the author's and the tool stops second-guessing it.
    const problem = parentProblem(categories);
    if (problem) throw Object.assign(fail(problem.key, problem.params), { status: 500 });
    return {
      propositions: resolved(data.propositions ?? data.propositionen ?? {}),
      categories,
    };
  }

  /**
   * Writes the category system, with no category left pointing at a ghost.
   *
   * Every change goes through here, so this is where the rule can be kept once
   * rather than argued about at each call site: a `parent` that names a
   * category which is not in the list is cleared. It is a net under the merge
   * and the deletion above — and it quietly repairs a file that a former
   * version of either already broke.
   */
  async setCategories(data) {
    return inTurn(this.categoriesFile, () => this.writeCategories(data), this.locking);
  }

  /** The same write, for callers that already hold this file's turn. */
  async writeCategories(data) {
    const present = new Set(data.categories.map((category) => category.id));
    for (const category of data.categories) {
      if (category.parent && !present.has(category.parent)) category.parent = null;
    }
    await write(this.categoriesFile, { ...data, version: VERSION });
    return data;
  }

  /* Propositions ------------------------------------------------------------
     What a category system argues, and the colour every figure of the study is
     drawn in. They arrive with the seed and were fixed from then on: a study
     whose research interest is not the bundled example's carried two headings
     it never made, and the only way to change them was to edit the file the
     tool writes. They are the author's, like the categories under them. */

  /**
   * A proposition, with an identifier made from its name.
   *
   * The identifier is what every category points at, so it is formed once and
   * never changes afterwards — renaming the proposition leaves it alone, the
   * way renaming a category leaves its own identifier alone.
   */
  async addProposition({ name, color }) {
    return inTurn(this.categoriesFile, async () => {
      const title = String(name ?? "").trim();
      if (!title) throw Object.assign(fail("errorPropositionName"), { status: 400 });
      const data = await this.categories();
      const id = slug(title);
      if (!id || data.propositions[id]) {
        throw Object.assign(fail("errorPropositionExists"), { status: 409 });
      }
      data.propositions[id] = { name: title, color: checkedColor(color) };
      await this.writeCategories(data);
      return { id, ...data.propositions[id] };
    }, this.locking);
  }

  async updateProposition(id, fields) {
    return inTurn(this.categoriesFile, async () => {
      const data = await this.categories();
      const proposition = data.propositions[id];
      if (!proposition) throw Object.assign(fail("errorUnknownProposition"), { status: 404 });
      if ("name" in fields) {
        const title = String(fields.name ?? "").trim();
        if (!title) throw Object.assign(fail("errorPropositionName"), { status: 400 });
        proposition.name = title;
      }
      if ("color" in fields) proposition.color = checkedColor(fields.color);
      await this.writeCategories(data);
      return { id, ...proposition };
    }, this.locking);
  }

  /**
   * Dissolve a proposition; whatever argued it is derived from the research
   * interest instead.
   *
   * `none` is that fallback and therefore stays: it is where a category lands
   * when its proposition goes, and a system with nowhere to land would leave
   * categories pointing at something that is not there. Its wording and colour
   * can be changed like any other's.
   *
   * The categories are not asked about first. A proposition is a heading over
   * them, not a thing they are made of — dissolving it says the study no longer
   * argues that point, and every category that argued it now argues none.
   */
  async removeProposition(id) {
    return inTurn(this.categoriesFile, async () => {
      const data = await this.categories();
      if (!data.propositions[id]) {
        throw Object.assign(fail("errorUnknownProposition"), { status: 404 });
      }
      if (id === NO_PROPOSITION) {
        throw Object.assign(fail("errorPropositionStays"), { status: 409 });
      }
      delete data.propositions[id];
      let moved = 0;
      for (const category of data.categories) {
        if (category.proposition !== id) continue;
        category.proposition = NO_PROPOSITION;
        moved += 1;
      }
      await this.writeCategories(data);
      return { moved };
    }, this.locking);
  }

  /**
   * A category, deductive or inductive.
   *
   * `beforeCoding` is the caller's answer to one question: does the study hold
   * any coding at all? While it holds none, the deductive system is still being
   * written — that is exactly what "fixed before the material is worked" means —
   * and a category may be created as one. From the first coding onwards the
   * system that was coded against is settled, and everything new is inductive
   * by definition; the tool does not need to be told, it can tell.
   *
   * Without this, a fresh installation was stuck with the three categories of
   * the bundled example forever, since a deductive one cannot be removed, and
   * everything the author added was labelled inductive — which misreports the
   * method in the coding guide the paper carries.
   */
  async addCategory({ name, definition, parent, origin }, { beforeCoding = false } = {}) {
    return inTurn(this.categoriesFile, async () => {
    const data = await this.categories();
    const deductive = origin === "deductive" && beforeCoding;
    const stem = slug(name);
    // The prefix says where a category came from at a glance in the file, and a
    // deductive one did not come from the material.
    const id = deductive ? stem : `ind.${stem}`;
    if (!stem || data.categories.some((c) => c.id === id)) {
      throw Object.assign(fail("errorCategoryExists"), { status: 409 });
    }
    const parentId = parent || null;
    const parentCategory = parentId ? data.categories.find((c) => c.id === parentId) : null;
    const category = {
      id,
      name,
      abbreviation: name.slice(0, 3),
      definition: definition ?? "",
      proposition: parentCategory?.proposition ?? "none",
      origin: deductive ? "deductive" : "inductive",
      parent: parentId,
      codingRules: [],
      created: new Date().toISOString(),
    };
    data.categories.push(category);
    await this.writeCategories(data);
    return category;
    }, this.locking);
  }

  async updateCategory(id, fields) {
    return inTurn(this.categoriesFile, async () => {
    const data = await this.categories();
    const category = data.categories.find((c) => c.id === id);
    if (!category) throw Object.assign(fail("errorUnknownCategory"), { status: 404 });

    if ("definition" in fields) {
      const next = String(fields.definition ?? "").trim();
      if (!next) {
        throw Object.assign(fail("errorDefinitionRequired"), {
          status: 400,
        });
      }
      fields = { ...fields, definition: next };
      // Re-checking the definitions against the material is part of the
      // method — for the categories formed on the material just as much as for
      // the ones fixed beforehand. Whenever a definition is sharpened, the tool
      // keeps the wording it started from: for a deductive category the wording
      // the study went into the field with, for an inductive one the wording it
      // was created with. Without that record the change could not be reported
      // afterwards, and the coding guide would drift silently.
      const initial = category.initialDefinition ?? category.definition;
      if (next === initial) delete category.initialDefinition;
      else category.initialDefinition = initial;
    }

    if ("codingRules" in fields) {
      fields = { ...fields, codingRules: ruleList(fields.codingRules) };
    }

    if ("parent" in fields) subordinate(data.categories, category, fields.parent || null);

    /* Which proposition a category argues, said rather than inherited.
       It followed the parent and nothing else, so a top-level category was
       stuck with whatever it was seeded under and the colour of every figure
       with it. A subcategory keeps following: the distinction is drawn under
       the proposition its parent argues, and two colours inside one branch
       would make the key say something the system does not. */
    if ("proposition" in fields) {
      const wanted = fields.proposition || NO_PROPOSITION;
      if (!data.propositions[wanted]) {
        throw Object.assign(fail("errorUnknownProposition"), { status: 404 });
      }
      if (category.parent) {
        throw Object.assign(fail("errorPropositionFollowsParent"), { status: 409 });
      }
      category.proposition = wanted;
      for (const child of data.categories) {
        if (child.parent === category.id) child.proposition = wanted;
      }
    }

    for (const field of ["name", "definition", "abbreviation", "codingRules", "memo"]) {
      if (field in fields) category[field] = fields[field];
    }
    await this.writeCategories(data);
    return category;
    }, this.locking);
  }

  /**
   * Checks whether two categories may become one.
   *
   * Separate from the act itself, so that the locations can be re-hung first
   * and the dissolved category disappears afterwards — otherwise a coding would
   * point for a moment at something that no longer exists.
   */
  async checkMerge(sourceId, targetId, { beforeCoding = false } = {}) {
    const { categories } = await this.categories();
    const source = categories.find((c) => c.id === sourceId);
    const target = categories.find((c) => c.id === targetId);
    if (!source || !target) {
      throw Object.assign(fail("errorUnknownCategory"), { status: 404 });
    }
    if (sourceId === targetId) {
      throw Object.assign(
        fail("errorSelfMergeCategory"),
        { status: 400 },
      );
    }
    if (source.origin === "deductive" && !beforeCoding) {
      throw Object.assign(
        fail("errorDeductiveStays"),
        { status: 409 },
      );
    }
    return { source, target };
  }

  /**
   * Make two categories one.
   *
   * While forming categories inductively it regularly turns out at the fourth
   * citation that two of them name the same thing. Without this move every
   * location would have to be re-hung one by one, and the temptation to leave
   * the duplication standing would be strong.
   *
   * What emerged from the material is not lost: coding rules and notes from
   * both sides stay on the target. The definition remains the target's and
   * wants to be pulled along by hand — it now describes one thing more than it
   * did before.
   */
  async mergeCategories(sourceId, targetId, options = {}) {
    await this.checkMerge(sourceId, targetId, options);
    return inTurn(this.categoriesFile, async () => {
    const data = await this.categories();
    const source = data.categories.find((c) => c.id === sourceId);
    const target = data.categories.find((c) => c.id === targetId);

    // Copied before the first change, or the record of "how it was" would be a
    // record of how it turned out.
    const before = {
      source: {
        at: data.categories.indexOf(source),
        category: structuredClone(source),
      },
      target: structuredClone(target),
    };
    const reparented = [];

    target.codingRules = [
      ...new Set(ruleList([...(target.codingRules ?? []), ...(source.codingRules ?? [])])),
    ];
    const notes = [target.memo, source.memo].map((text) => (text ?? "").trim()).filter(Boolean);
    if (notes.length) target.memo = notes.join("\n\n");

    /* Subordinate categories attach to the target. If the target itself sits
       under a category they go there — the system stays two-level.

       The target may be one of those subordinates: merging a category into its
       own subcategory is a reasonable thing to do when the distinction turns
       out to have been the main point all along. The target then takes the
       place of the category being dissolved, and its former siblings attach to
       it. Without that step it kept pointing at a parent that no longer
       existed, and was drawn as a subcategory of nothing. */
    if (target.parent === sourceId) target.parent = source.parent ?? null;
    for (const category of data.categories) {
      if (category.id === targetId || category.parent !== sourceId) continue;
      reparented.push({ id: category.id, parent: category.parent });
      category.parent = target.parent ?? targetId;
    }

    data.categories = data.categories.filter((c) => c.id !== sourceId);
    await this.writeCategories(data);
    /* Everything this touched, in the shape it was in before: the dissolved
       category whole, the target's own rules and note and place, and every
       subcategory that was re-hung. Enough to put the system back exactly, so
       that the most destructive move in the tool can be taken back like the
       smallest one. */
    return { source, target, undo: { source: before.source, target: before.target, reparented } };
    }, this.locking);
  }

  /**
   * Put back what a merge took apart.
   *
   * The dissolved category returns whole — same identifier, so the units that
   * move back point at something that exists — and the target gives up the
   * rules, the note and the place it inherited. Anything the author changed
   * about the target in between is overwritten, which is what taking back a
   * step means; the undo is offered on the message and is gone as soon as it is.
   */
  async undoCategoryMerge({ source, target, reparented = [] }) {
    return inTurn(this.categoriesFile, async () => {
      const data = await this.categories();
      if (data.categories.some((one) => one.id === source.category.id)) {
        throw Object.assign(fail("errorCategoryExists"), { status: 409 });
      }
      const back = data.categories.find((one) => one.id === target.id);
      if (!back) throw Object.assign(fail("errorUnknownCategory"), { status: 404 });
      back.codingRules = ruleList(target.codingRules ?? []);
      back.memo = target.memo ?? "";
      back.parent = target.parent ?? null;
      for (const one of reparented) {
        const child = data.categories.find((each) => each.id === one.id);
        if (child) child.parent = one.parent;
      }
      // Back where it stood, not appended at the end: a category system is read
      // in its order, and the order is part of what the author built.
      data.categories.splice(Math.min(source.at, data.categories.length), 0, { ...source.category });
      await this.writeCategories(data);
      return data;
    }, this.locking);
  }

  /**
   * Re-hang the locations of one category onto another.
   *
   * Returns which ones moved, not how many. The count is what the message
   * needs; the identifiers are what an undo needs, so that taking the merge
   * back moves exactly these units and not the ones that were already there.
   */
  async replaceCategory(interview, source, target) {
    return inTurn(this.codingFile(interview), async () => {
    const data = await this.codings(interview);
    const moved = [];
    for (const coding of data.codings) {
      if (coding.category === source) {
        coding.category = target;
        moved.push(coding.id);
      }
    }
    if (moved.length) await this.writeCodings(interview, data.codings);
    return moved;
    }, this.locking);
  }

  /** Hang named locations on a category, for the way back from a merge. */
  async recategorise(interview, ids, category) {
    const wanted = new Set(ids);
    return inTurn(this.codingFile(interview), async () => {
    const data = await this.codings(interview);
    let moved = 0;
    for (const coding of data.codings) {
      if (wanted.has(coding.id)) {
        coding.category = category;
        moved += 1;
      }
    }
    if (moved) await this.writeCodings(interview, data.codings);
    return moved;
    }, this.locking);
  }

  async removeCategory(id, used, { beforeCoding = false } = {}) {
    return inTurn(this.categoriesFile, async () => {
    const data = await this.categories();
    const category = data.categories.find((c) => c.id === id);
    if (!category) throw Object.assign(fail("errorUnknownCategory"), { status: 404 });
    // A deductive category stands once the material has been worked against it.
    // Before that the start system is still being written, and the bundled
    // example is the first thing anybody wants out of the way.
    if (category.origin === "deductive" && !beforeCoding) {
      throw Object.assign(
        fail("errorDeductiveStays"),
        { status: 409 },
      );
    }
    if (used > 0) {
      throw Object.assign(
        fail("errorCategoryInUse", { used }),
        { status: 409 },
      );
    }
    // Whatever sat under it moves up into its place rather than being left
    // pointing at something that is gone.
    for (const other of data.categories) {
      if (other.parent === id) other.parent = category.parent ?? null;
    }
    data.categories = data.categories.filter((c) => c.id !== id);
    await this.writeCategories(data);
    }, this.locking);
  }

  async codings(interview) {
    const data = await readFirst(
      [this.codingFile(interview), this.legacyCodingFile(interview)],
      null,
    );
    if (!data) return { version: VERSION, interview, memo: "", codings: [] };
    return migrateCodings(data, interview);
  }

  /**
   * A second coder's whole study, put down beside the first.
   *
   * The comparison has always worked from `coding.<name>.json` next to
   * `coding.json`, and getting one there was a manual copy per interview folder
   * with an exact name — eighteen of them for a study of eighteen, and a name
   * typed wrong is silently "no second coding". Nothing about where the files
   * live changes; this only does the copying, which is the part a person should
   * not be doing by hand.
   *
   * `coding.json` itself can never be the target: the name goes between the two
   * dots, and an empty one is refused before anything is written.
   */
  async putSecondCoding(interview, name, data) {
    const coder = slug(name);
    if (!coder) throw Object.assign(fail("errorCoderName"), { status: 400 });
    const file = join(this.interviewFolder(interview), `coding.${coder}.json`);
    return inTurn(file, async () => {
      await write(file, {
        version: VERSION,
        interview,
        memo: data.memo ?? "",
        changed: new Date().toISOString(),
        codings: (data.codings ?? []).map(shapeCoding),
      });
      return { interview, coder };
    }, this.locking);
  }

  async setCodings(interview, codings) {
    return inTurn(this.codingFile(interview), () => this.writeCodings(interview, codings), this.locking);
  }

  /**
   * The same write, for callers that already hold this file's turn.
   *
   * The queue is not re-entrant, so anything that has taken a turn must use
   * this rather than `setCodings` — otherwise it waits for itself.
   */
  async writeCodings(interview, codings) {
    // The note on the interview lives in the same file and must not be lost
    // when the codings are written.
    const previous = await this.codings(interview);
    await write(this.codingFile(interview), {
      version: VERSION,
      interview,
      memo: previous.memo ?? "",
      changed: new Date().toISOString(),
      /* Shaped here, at the one place every write passes through, so no caller
         can put a unit into the file in an order of its own — and so the marks
         the anchor check hangs on a unit while it works never reach the file. */
      codings: codings.map(shapeCoding),
    });
  }

  async setInterviewMemo(interview, memo) {
    return inTurn(this.codingFile(interview), async () => {
    const data = await this.codings(interview);
    await write(this.codingFile(interview), {
      ...data,
      version: VERSION,
      interview,
      memo: String(memo ?? ""),
      changed: new Date().toISOString(),
    }, this.locking);
    return memo;
    });
  }

  /* The interview itself ----------------------------------------------------
     Its folder and the transcript in it. The tool made both — the import writes
     a folder and a file — and could then do nothing further with either: a
     folder named after a working title kept that name for the whole study, and
     an interview brought in twice had to be deleted from outside the tool. */

  transcriptFile(interview) {
    return join(this.interviewFolder(interview), "final.md");
  }

  /**
   * Write the transcript's own description back: title, department, header
   * lines. The turns are read, rewritten and written unchanged, so no citation
   * moves.
   */
  async setTranscriptHeader(interview, changes) {
    const file = this.transcriptFile(interview);
    return inTurn(file, async () => {
      let text;
      try {
        text = await readFile(file, "utf8");
      } catch {
        throw Object.assign(fail("errorUnknownInterview"), { status: 404 });
      }
      await writeText(file, rewriteHeader(text, changes));
      return parseTranscript(await readFile(file, "utf8"), interview);
    }, this.locking);
  }

  /**
   * Give an interview another folder name.
   *
   * The folder name is the identifier: it stands in every coding file, in the
   * exports and in the git history. It comes out of the title at import time,
   * which is the moment one knows least about the study — "interview-1" from a
   * file dropped in a hurry, or a name that turned out to say the wrong thing.
   * The codings travel with it, because they live in the same folder. Their
   * file names the interview in a line of its own — nothing reads it, since the
   * folder is what the tool goes by, but a file that says the old name after
   * the folder has been renamed is a file that lies to whoever opens it in the
   * history. So it is written once with the new one. A second coder's file is
   * not touched: theirs stays theirs, which is the whole point of it.
   */
  async renameInterview(from, to) {
    const source = this.interviewFolder(from);
    const target = this.interviewFolder(to);
    if (from === to) return { id: to };
    try {
      await stat(source);
    } catch {
      throw Object.assign(fail("errorUnknownInterview"), { status: 404 });
    }
    if (await stat(target).then(() => true, () => false)) {
      throw Object.assign(fail("errorInterviewExists", { folder: to }), { status: 409 });
    }
    await rename(source, target);
    if (await stat(this.codingFile(to)).then(() => true, () => false)) {
      await this.setCodings(to, (await this.codings(to)).codings);
    }
    return { id: to };
  }

  /**
   * Take an interview out of the study, transcript and codings together.
   *
   * The most destructive thing the tool can be asked to do, and it does it
   * without a copy: these files are version-controlled beside the transcripts —
   * that is what the folder layout is for — and a tool keeping its own private
   * undo of the material would be a second truth about the study. The interface
   * asks first; here it is carried out.
   */
  async removeInterview(interview) {
    const folder = this.interviewFolder(interview);
    try {
      await stat(folder);
    } catch {
      throw Object.assign(fail("errorUnknownInterview"), { status: 404 });
    }
    await rm(folder, { recursive: true, force: true });
    return { id: interview };
  }

  async addCoding(interview, entry) {
    return inTurn(this.codingFile(interview), async () => {
    const data = await this.codings(interview);
    // Exactly one category per coding unit: overlaps within the same turn are
    // therefore ruled out, not merely undesirable.
    const conflict = data.codings.find(
      (coding) =>
        coding.turn === entry.turn && entry.start < coding.end && coding.start < entry.end,
    );
    if (conflict) {
      throw Object.assign(
        fail("errorOverlap"),
        { status: 409, conflict },
      );
    }
    // `reviewed` defaults to false on purpose: what is created programmatically
    // — a machine pre-coding, say — is a suggestion until the author confirms
    // it. The interface sets the field explicitly when coding by hand, because
    // there the act itself is the review.
    const coding = shapeCoding({
      id: randomUUID(),
      created: new Date().toISOString(),
      // `reviewed` stays false unless the caller says otherwise; `shapeCoding`
      // fills the rest in the one order every unit is written in.
      ...entry,
    });
    data.codings.push(coding);
    await this.writeCodings(interview, data.codings);
    return coding;
    }, this.locking);
  }

  async updateCoding(interview, id, fields) {
    return inTurn(this.codingFile(interview), async () => {
    const data = await this.codings(interview);
    const coding = data.codings.find((c) => c.id === id);
    if (!coding) throw Object.assign(fail("errorUnknownCoding"), { status: 404 });

    // Re-anchoring: the same rule as on creation, exactly one category per
    // place, so the new position must not overlap another unit.
    if ("start" in fields && "end" in fields) {
      const conflict = data.codings.find(
        (other) =>
          other.id !== id &&
          other.turn === (fields.turn ?? coding.turn) &&
          fields.start < other.end &&
          other.start < fields.end,
      );
      if (conflict) {
        throw Object.assign(
          fail("errorOverlap"),
          { status: 409, conflict },
        );
      }
    }
    for (const field of ["category", "memo", "anchor", "reviewed", "requirements", "turn", "start", "end", "text"]) {
      if (field in fields) coding[field] = fields[field];
    }
    await this.writeCodings(interview, data.codings);
    return coding;
    }, this.locking);
  }

  async removeCoding(interview, id) {
    return inTurn(this.codingFile(interview), async () => {
    const data = await this.codings(interview);
    const remaining = data.codings.filter((coding) => coding.id !== id);
    if (remaining.length === data.codings.length) {
      throw Object.assign(fail("errorUnknownCoding"), { status: 404 });
    }
    await this.writeCodings(interview, remaining);
    }, this.locking);
  }

  /* Requirements ------------------------------------------------------
     They are the result of the first phase, not of the coding. A requirement
     bundles coding units across interviews; from that follows the number of
     departments naming it, and with it one half of the prioritization. The
     other half — which of the study's operations its absence blocks — is
     entered by the author, against a vocabulary the study owns. */

  async requirements(language = this.seedLanguage) {
    const data = await readFirst([this.requirementsFile, this.legacyRequirementsFile], null);
    if (data) return migrateRequirements(data, language);
    const fresh = { version: VERSION, operations: seededOperations(language), requirements: [] };
    await write(this.requirementsFile, fresh);
    return fresh;
  }

  /* Blocked operations ------------------------------------------------------
     Half of the prioritization: how many departments name a requirement is
     counted from the material, and what its absence blocks is the judgement the
     author makes. Which operations there are to block was the tool's opinion
     until now, and it should never have been. */

  async addOperation({ name }) {
    return inTurn(this.requirementsFile, async () => {
      const title = String(name ?? "").trim();
      if (!title) throw Object.assign(fail("errorOperationName"), { status: 400 });
      const data = await this.requirements();
      const id = slug(title);
      if (!id || data.operations.some((one) => one.id === id)) {
        throw Object.assign(fail("errorOperationExists"), { status: 409 });
      }
      const operation = { id, name: title };
      data.operations.push(operation);
      await write(this.requirementsFile, data);
      return operation;
    }, this.locking);
  }

  async updateOperation(id, fields) {
    return inTurn(this.requirementsFile, async () => {
      const data = await this.requirements();
      const operation = data.operations.find((one) => one.id === id);
      if (!operation) throw Object.assign(fail("errorUnknownOperation"), { status: 404 });
      if ("name" in fields) {
        const title = String(fields.name ?? "").trim();
        if (!title) throw Object.assign(fail("errorOperationName"), { status: 400 });
        operation.name = title;
      }
      await write(this.requirementsFile, data);
      return operation;
    }, this.locking);
  }

  /**
   * Take an operation out of the study, and off every requirement with it.
   *
   * A requirement that still named it would be weighed against something the
   * study no longer knows: the prioritization field counts blocked operations,
   * and a count including a ghost is a count nobody can check. How many
   * requirements gave it up comes back, because that is the size of the change.
   */
  async removeOperation(id) {
    return inTurn(this.requirementsFile, async () => {
      const data = await this.requirements();
      const remaining = data.operations.filter((one) => one.id !== id);
      if (remaining.length === data.operations.length) {
        throw Object.assign(fail("errorUnknownOperation"), { status: 404 });
      }
      let dropped = 0;
      for (const requirement of data.requirements) {
        if (!requirement.blockedOperations?.includes(id)) continue;
        requirement.blockedOperations = requirement.blockedOperations.filter(
          (other) => other !== id,
        );
        dropped += 1;
      }
      await write(this.requirementsFile, { ...data, operations: remaining });
      return { dropped };
    }, this.locking);
  }

  /**
   * Bring a requirements file written by an earlier version up to this shape.
   *
   * Reading migrates, which is what keeps an old study working; but reading
   * alone leaves the file as it was until somebody happens to edit something,
   * so a field added today would appear in the interface and be missing from
   * the file for as long as nobody touched that study. Anything else reading
   * the file — a script, a backup, the author in an editor — would see the old
   * shape and be right to be confused.
   *
   * So it is written back once, at startup, and only if migrating actually
   * changed anything: a study already in this shape is not rewritten, and the
   * modification date of a folder nobody has worked in stays where it was. The
   * comparison is on the serialized form, which also catches the key order, so
   * the file converges after one pass rather than being rewritten every start.
   */
  async upgradeRequirements() {
    const raw = await readFirst([this.requirementsFile, this.legacyRequirementsFile], null);
    if (!raw) return { upgraded: 0 };
    const migrated = migrateRequirements(raw, this.seedLanguage);
    if (JSON.stringify(raw) === JSON.stringify(migrated)) return { upgraded: 0 };
    return inTurn(
      this.requirementsFile,
      async () => {
        await write(this.requirementsFile, migrated);
        return { upgraded: migrated.requirements.length };
      },
      this.locking,
    );
  }

  async addRequirement({
    title,
    definition = "",
    description = "",
    blockedOperations = [],
    moscow = null,
  }) {
    return inTurn(this.requirementsFile, async () => {
    if (!title?.trim()) {
      throw Object.assign(fail("errorRequirementTitle"), { status: 400 });
    }
    const data = await this.requirements();
    const requirement = {
      id: randomUUID(),
      title: title.trim(),
      definition,
      description,
      blockedOperations: checkedOperations(blockedOperations, data.operations),
      moscow,
      created: new Date().toISOString(),
    };
    data.requirements.push(requirement);
    await write(this.requirementsFile, data);
    return requirement;
    }, this.locking);
  }

  async updateRequirement(id, fields) {
    return inTurn(this.requirementsFile, async () => {
    const data = await this.requirements();
    const requirement = data.requirements.find((r) => r.id === id);
    if (!requirement) throw Object.assign(fail("errorUnknownRequirement"), { status: 404 });
    if ("blockedOperations" in fields) {
      fields = {
        ...fields,
        blockedOperations: checkedOperations(fields.blockedOperations, data.operations),
      };
    }
    for (const field of ["title", "definition", "description", "blockedOperations", "moscow"]) {
      if (field in fields) requirement[field] = fields[field];
    }
    await write(this.requirementsFile, data);
    return requirement;
    }, this.locking);
  }

  /**
   * Make two requirements one.
   *
   * When they emerge one by one from citations, duplication is the rule and not
   * the exception: two passages carry the same demand before one notices it at
   * the third. The citations move along, description and blocked operations are
   * united; title and level stay the target's, because that is exactly the
   * decision that was made.
   */
  async checkRequirementMerge(sourceId, targetId) {
    const { requirements } = await this.requirements();
    const source = requirements.find((r) => r.id === sourceId);
    const target = requirements.find((r) => r.id === targetId);
    if (!source || !target) {
      throw Object.assign(fail("errorUnknownRequirement"), { status: 404 });
    }
    if (sourceId === targetId) {
      throw Object.assign(
        fail("errorSelfMergeRequirement"),
        { status: 400 },
      );
    }
    return { source, target };
  }

  async mergeRequirements(sourceId, targetId) {
    await this.checkRequirementMerge(sourceId, targetId);
    return inTurn(this.requirementsFile, async () => {
    const data = await this.requirements();
    const source = data.requirements.find((r) => r.id === sourceId);
    const target = data.requirements.find((r) => r.id === targetId);

    const descriptions = [target.description, source.description]
      .map((text) => (text ?? "").trim())
      .filter(Boolean);
    if (descriptions.length) target.description = descriptions.join("\n\n");
    target.blockedOperations = [
      ...new Set([...(target.blockedOperations ?? []), ...(source.blockedOperations ?? [])]),
    ];
    target.moscow = target.moscow ?? source.moscow ?? null;

    data.requirements = data.requirements.filter((r) => r.id !== sourceId);
    await write(this.requirementsFile, data);
    return { source, target };
    }, this.locking);
  }

  /** Re-hang the citations of one requirement onto another, without duplicates. */
  async replaceRequirement(interview, source, target) {
    return inTurn(this.codingFile(interview), async () => {
    const data = await this.codings(interview);
    let moved = 0;
    for (const coding of data.codings) {
      if (!coding.requirements?.includes(source)) continue;
      coding.requirements = [
        ...new Set(coding.requirements.map((id) => (id === source ? target : id))),
      ];
      moved += 1;
    }
    if (moved) await this.writeCodings(interview, data.codings);
    return moved;
    }, this.locking);
  }

  async removeRequirement(id) {
    return inTurn(this.requirementsFile, async () => {
    const data = await this.requirements();
    const remaining = data.requirements.filter((r) => r.id !== id);
    if (remaining.length === data.requirements.length) {
      throw Object.assign(fail("errorUnknownRequirement"), { status: 404 });
    }
    await write(this.requirementsFile, { ...data, requirements: remaining });
    }, this.locking);
  }

  /** Take references to a deleted requirement out of the codings. */
  async detachRequirement(interview, id) {
    return inTurn(this.codingFile(interview), async () => {
    const data = await this.codings(interview);
    let touched = false;
    for (const coding of data.codings) {
      if (coding.requirements?.includes(id)) {
        coding.requirements = coding.requirements.filter((other) => other !== id);
        touched = true;
      }
    }
    if (touched) await this.writeCodings(interview, data.codings);
    }, this.locking);
  }
}
