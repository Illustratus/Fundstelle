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

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEDUCTIVE,
  PROPOSITIONS,
  normalizeCategory,
  normalizeProposition,
  pickText,
  startSystem,
} from "./categories.js";
import { FALLBACK, fail } from "./texts.js";

const VERSION = 3;

const LEGACY_CATEGORIES_FILE = "kategoriensystem.json";
const LEGACY_REQUIREMENTS_FILE = "anforderungen.json";
const LEGACY_CODING_FILE = "kodierung.json";

const BLOCKED_OPERATIONS = { ablage: "filing", abruf: "retrieval", transfer: "transfer" };

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

async function write(path, value) {
  try {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
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

function migrateCategories(data) {
  const propositions = Object.fromEntries(
    Object.entries(data.propositions ?? data.propositionen ?? PROPOSITIONS).map(([id, value]) => [
      id,
      normalizeProposition(value),
    ]),
  );
  const categories = (data.categories ?? data.kategorien ?? []).map((raw) => {
    const { children, ...category } = normalizeCategory(raw);
    return compact({ ...category, codingRules: category.codingRules ?? [] });
  });
  return { version: VERSION, propositions, categories };
}

function migrateCoding(raw) {
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
    description: raw.description ?? raw.beschreibung ?? "",
    blockedOperations: blocked.map((operation) => BLOCKED_OPERATIONS[operation] ?? operation),
    moscow: raw.moscow ?? null,
    created: raw.created ?? raw.angelegt,
  });
}

function migrateRequirements(data) {
  return {
    version: VERSION,
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
  }) {
    this.seedLanguage = seedLanguage;
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

  codingFile(interview) {
    return join(this.transcriptRoot, interview, "coding.json");
  }

  legacyCodingFile(interview) {
    return join(this.transcriptRoot, interview, LEGACY_CODING_FILE);
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
    if (data) return migrateCategories(data);
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
    return {
      propositions: resolved(data.propositions ?? data.propositionen ?? {}),
      categories: startSystem(raw, language),
    };
  }

  async setCategories(data) {
    await write(this.categoriesFile, { ...data, version: VERSION });
    return data;
  }

  async addCategory({ name, definition, parent }) {
    const data = await this.categories();
    const id = "ind." + name
      .toLowerCase()
      .replace(/[äöüß]/g, (character) => ({ ä: "ae", ö: "oe", ü: "ue", ß: "ss" })[character])
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (data.categories.some((c) => c.id === id)) {
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
      origin: "inductive",
      parent: parentId,
      codingRules: [],
      created: new Date().toISOString(),
    };
    data.categories.push(category);
    await this.setCategories(data);
    return category;
  }

  async updateCategory(id, fields) {
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

    for (const field of ["name", "definition", "abbreviation", "codingRules", "memo"]) {
      if (field in fields) category[field] = fields[field];
    }
    await this.setCategories(data);
    return category;
  }

  /**
   * Checks whether two categories may become one.
   *
   * Separate from the act itself, so that the locations can be re-hung first
   * and the dissolved category disappears afterwards — otherwise a coding would
   * point for a moment at something that no longer exists.
   */
  async checkMerge(sourceId, targetId) {
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
    if (source.origin === "deductive") {
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
  async mergeCategories(sourceId, targetId) {
    await this.checkMerge(sourceId, targetId);
    const data = await this.categories();
    const source = data.categories.find((c) => c.id === sourceId);
    const target = data.categories.find((c) => c.id === targetId);

    target.codingRules = [
      ...new Set(ruleList([...(target.codingRules ?? []), ...(source.codingRules ?? [])])),
    ];
    const notes = [target.memo, source.memo].map((text) => (text ?? "").trim()).filter(Boolean);
    if (notes.length) target.memo = notes.join("\n\n");

    // Subordinate categories attach to the target. If the target itself sits
    // under a category they go there — the system stays two-level.
    for (const category of data.categories) {
      if (category.parent === sourceId) category.parent = target.parent ?? targetId;
    }

    data.categories = data.categories.filter((c) => c.id !== sourceId);
    await this.setCategories(data);
    return { source, target };
  }

  /** Re-hang the locations of one category onto another. */
  async replaceCategory(interview, source, target) {
    const data = await this.codings(interview);
    let moved = 0;
    for (const coding of data.codings) {
      if (coding.category === source) {
        coding.category = target;
        moved += 1;
      }
    }
    if (moved) await this.setCodings(interview, data.codings);
    return moved;
  }

  async removeCategory(id, used) {
    const data = await this.categories();
    const category = data.categories.find((c) => c.id === id);
    if (!category) throw Object.assign(fail("errorUnknownCategory"), { status: 404 });
    if (category.origin === "deductive") {
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
    data.categories = data.categories.filter((c) => c.id !== id);
    await this.setCategories(data);
  }

  async codings(interview) {
    const data = await readFirst(
      [this.codingFile(interview), this.legacyCodingFile(interview)],
      null,
    );
    if (!data) return { version: VERSION, interview, memo: "", codings: [] };
    return migrateCodings(data, interview);
  }

  async setCodings(interview, codings) {
    // The note on the interview lives in the same file and must not be lost
    // when the codings are written.
    const previous = await this.codings(interview);
    await write(this.codingFile(interview), {
      version: VERSION,
      interview,
      memo: previous.memo ?? "",
      changed: new Date().toISOString(),
      codings,
    });
  }

  async setInterviewMemo(interview, memo) {
    const data = await this.codings(interview);
    await write(this.codingFile(interview), {
      ...data,
      version: VERSION,
      interview,
      memo: String(memo ?? ""),
      changed: new Date().toISOString(),
    });
    return memo;
  }

  async addCoding(interview, entry) {
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
    const coding = {
      id: randomUUID(),
      created: new Date().toISOString(),
      anchor: false,
      memo: "",
      requirements: [],
      reviewed: false,
      ...entry,
    };
    data.codings.push(coding);
    await this.setCodings(interview, data.codings);
    return coding;
  }

  async updateCoding(interview, id, fields) {
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
    await this.setCodings(interview, data.codings);
    return coding;
  }

  async removeCoding(interview, id) {
    const data = await this.codings(interview);
    const remaining = data.codings.filter((coding) => coding.id !== id);
    if (remaining.length === data.codings.length) {
      throw Object.assign(fail("errorUnknownCoding"), { status: 404 });
    }
    await this.setCodings(interview, remaining);
  }

  /* Requirements ------------------------------------------------------
     They are the result of the first phase, not of the coding. A requirement
     bundles coding units across interviews; from that follows the number of
     departments naming it, and with it one half of the prioritization. The
     other half — how strongly its absence blocks filing, retrieval or transfer
     — is entered by the author. */

  async requirements() {
    const data = await readFirst([this.requirementsFile, this.legacyRequirementsFile], null);
    if (data) return migrateRequirements(data);
    const fresh = { version: VERSION, requirements: [] };
    await write(this.requirementsFile, fresh);
    return fresh;
  }

  async addRequirement({ title, description = "", blockedOperations = [], moscow = null }) {
    if (!title?.trim()) {
      throw Object.assign(fail("errorRequirementTitle"), { status: 400 });
    }
    const data = await this.requirements();
    const requirement = {
      id: randomUUID(),
      title: title.trim(),
      description,
      blockedOperations,
      moscow,
      created: new Date().toISOString(),
    };
    data.requirements.push(requirement);
    await write(this.requirementsFile, data);
    return requirement;
  }

  async updateRequirement(id, fields) {
    const data = await this.requirements();
    const requirement = data.requirements.find((r) => r.id === id);
    if (!requirement) throw Object.assign(fail("errorUnknownRequirement"), { status: 404 });
    for (const field of ["title", "description", "blockedOperations", "moscow"]) {
      if (field in fields) requirement[field] = fields[field];
    }
    await write(this.requirementsFile, data);
    return requirement;
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
  }

  /** Re-hang the citations of one requirement onto another, without duplicates. */
  async replaceRequirement(interview, source, target) {
    const data = await this.codings(interview);
    let moved = 0;
    for (const coding of data.codings) {
      if (!coding.requirements?.includes(source)) continue;
      coding.requirements = [
        ...new Set(coding.requirements.map((id) => (id === source ? target : id))),
      ];
      moved += 1;
    }
    if (moved) await this.setCodings(interview, data.codings);
    return moved;
  }

  async removeRequirement(id) {
    const data = await this.requirements();
    const remaining = data.requirements.filter((r) => r.id !== id);
    if (remaining.length === data.requirements.length) {
      throw Object.assign(fail("errorUnknownRequirement"), { status: 404 });
    }
    await write(this.requirementsFile, { ...data, requirements: remaining });
  }

  /** Take references to a deleted requirement out of the codings. */
  async detachRequirement(interview, id) {
    const data = await this.codings(interview);
    let touched = false;
    for (const coding of data.codings) {
      if (coding.requirements?.includes(id)) {
        coding.requirements = coding.requirements.filter((other) => other !== id);
        touched = true;
      }
    }
    if (touched) await this.setCodings(interview, data.codings);
  }
}
