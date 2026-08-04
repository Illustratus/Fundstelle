/**
 * The deductive start category system that seeds a fresh installation.
 *
 * The bundled system is deliberately generic: it is a worked example of the
 * format, not a category system for any particular study. Bring your own via
 * the `START_SYSTEM` environment variable (see the README) — that file goes
 * through the same flattening and inherits the same defaults.
 *
 * Names and definitions are written in both languages here, because the first
 * screen of a fresh installation should not be in a language the reader did not
 * ask for. Any text in a start system may be a plain string or an object keyed
 * by language; seeding resolves it once and writes the plain string, so from
 * the first edit onwards the categories belong to whoever is coding and can be
 * renamed freely.
 *
 * Anchor examples and coding rules are absent on purpose. Mayring has both
 * emerge from the material, so the tool records them while coding rather than
 * shipping them.
 *
 * Color encodes the anchoring proposition, never the category itself. Two
 * categories that argue the same point therefore look alike, and the key stays
 * recognizable between the tool and whatever the study writes up.
 */

import { FALLBACK } from "./texts.js";

export const PROPOSITIONS = {
  practice: {
    name: {
      de: "Proposition 1: Werkzeuge prägen den Arbeitsalltag",
      en: "Proposition 1: Tools shape the working day",
    },
    color: "#6C8EBF",
  },
  coordination: {
    name: {
      de: "Proposition 2: Absprachen bleiben informell",
      en: "Proposition 2: Agreements stay informal",
    },
    color: "#D79B00",
  },
  none: {
    name: {
      de: "Aus dem Erkenntnisinteresse abgeleitet",
      en: "Derived from the research interest",
    },
    color: "#8A9299",
  },
};

export const DEDUCTIVE = [
  {
    id: "routine",
    name: { de: "Arbeitsalltag", en: "Everyday work" },
    abbreviation: { de: "Arb", en: "Eve" },
    proposition: "practice",
    definition: {
      de: "Aussagen über wiederkehrende Abläufe im Arbeitstag, die zeigen, welche Tätigkeit mit welchem Werkzeug in welcher Reihenfolge erledigt wird.",
      en: "Statements about recurring sequences in the working day that show which task is done with which tool in which order.",
    },
    children: [
      {
        id: "routine.disruption",
        name: { de: "Störungen", en: "Disruptions" },
        abbreviation: { de: "Stö", en: "Dis" },
        definition: {
          de: "Aussagen über Unterbrechungen des Arbeitsflusses, ihre Auslöser und ihre Folgen.",
          en: "Statements about interruptions of the workflow, what triggers them and what follows from them.",
        },
      },
    ],
  },
  {
    id: "agreement",
    name: { de: "Absprachen", en: "Agreements" },
    abbreviation: { de: "Abs", en: "Agr" },
    proposition: "coordination",
    definition: {
      de: "Aussagen über getroffene oder gescheiterte Absprachen, die zeigen, worüber, mit wem und auf welchem Weg abgestimmt wird.",
      en: "Statements about agreements made or missed that show what is coordinated, with whom and through which channel.",
    },
  },
];

/**
 * One language out of a text that may carry several.
 *
 * A plain string is a text in one language and passes through untouched — which
 * is what every start system written by hand and every stored category system
 * looks like. Only the bundled example, and whoever wants to hand the same file
 * to a team working in two languages, uses the keyed form.
 */
export function pickText(value, language) {
  if (value == null || typeof value === "string") return value;
  return value[language] ?? value[FALLBACK] ?? Object.values(value)[0];
}

/**
 * A category system as written by an author, in the shape the store keeps it.
 *
 * Older files and hand-written start systems may still use the German field
 * names the tool started out with. They are accepted on the way in so that no
 * existing category system has to be rewritten by hand.
 */
export function normalizeCategory(raw) {
  const children = raw.children ?? raw.unter;
  return {
    id: raw.id,
    name: raw.name,
    abbreviation: raw.abbreviation ?? raw.kuerzel,
    definition: raw.definition,
    initialDefinition: raw.initialDefinition ?? raw.definitionStart,
    proposition: raw.proposition,
    origin: normalizeOrigin(raw.origin ?? raw.herkunft),
    parent: raw.parent ?? raw.eltern ?? null,
    codingRules: raw.codingRules ?? raw.kodierregeln,
    memo: raw.memo,
    created: raw.created ?? raw.angelegt,
    children,
  };
}

export function normalizeOrigin(value) {
  if (value === "deduktiv") return "deductive";
  if (value === "induktiv") return "inductive";
  return value;
}

export function normalizeProposition(raw, language) {
  return { name: pickText(raw.name, language), color: raw.color ?? raw.farbe };
}

/** The texts of one category, resolved to the language being seeded. */
function inLanguage(category, language) {
  return {
    ...category,
    name: pickText(category.name, language),
    abbreviation: pickText(category.abbreviation, language),
    definition: pickText(category.definition, language),
    initialDefinition: pickText(category.initialDefinition, language),
    memo: pickText(category.memo, language),
  };
}

/**
 * Flat list of all deductive categories, subcategories included.
 *
 * Without an argument it yields the bundled system above. A start system of
 * your own goes through the same flattening and has missing abbreviations and
 * propositions filled in.
 *
 * The language is resolved here and only here: what the store writes is a
 * category system in one language, the way an author would have typed it.
 */
export function startSystem(deductive = DEDUCTIVE, language = FALLBACK) {
  const flat = [];
  const push = (category, parent) => {
    const { children: _ignored, ...rest } = category;
    flat.push({
      abbreviation: rest.name.slice(0, 3),
      proposition: parent?.proposition ?? "none",
      ...strip(rest),
      origin: "deductive",
      parent: parent?.id ?? null,
      codingRules: [],
    });
  };

  for (const category of deductive.map((raw) => inLanguage(normalizeCategory(raw), language))) {
    /* Two shapes reach here and both are meant to work. A start system written
       by hand usually nests its sub-categories under `children`. But the file
       the tool itself writes is flat and says `parent`, and copying one study's
       categories.json into another study as its start system is the most
       obvious thing anyone would do with it — that shape used to come out
       flattened, the sub-categories quietly promoted to top level, and nothing
       said so. */
    push(category, null);
    for (const child of (category.children ?? []).map((raw) =>
      inLanguage(normalizeCategory(raw), language),
    )) {
      push(child, category);
    }
  }

  /* The declared parents, applied once everything is in: a flat file may well
     name a parent that stands further down the list, so they cannot be resolved
     while reading. A sub-category that names no proposition of its own takes
     its parent's, the way a nested one does. */
  const byId = new Map(flat.map((category) => [category.id, category]));
  for (const raw of deductive) {
    const declared = normalizeCategory(raw).parent;
    if (!declared) continue;
    const own = byId.get(raw.id);
    if (!own) continue;
    own.parent = declared;
    if (!raw.proposition) own.proposition = byId.get(declared)?.proposition ?? own.proposition;
  }
  return flat;
}

/**
 * What a declared parent may not be.
 *
 * The category system is two levels deep everywhere else — the store refuses a
 * third when a category is moved by hand — so a start system must not be able
 * to smuggle one in through the back door. Nor a parent that does not exist:
 * the category would sit under a ghost and disappear from the panel it belongs
 * in. Both are reported by name rather than repaired, because either one means
 * the file says something its author did not intend.
 */
export function parentProblem(categories) {
  const byId = new Map(categories.map((category) => [category.id, category]));
  for (const category of categories) {
    if (!category.parent) continue;
    // Itself first: a category under itself also satisfies "its parent has a
    // parent", and would otherwise be reported as a third level, which is not
    // what the file says.
    if (category.parent === category.id) {
      return { key: "errorStartSystemSelfParent", params: { name: category.id } };
    }
    const parent = byId.get(category.parent);
    if (!parent) {
      return {
        key: "errorStartSystemUnknownParent",
        params: { name: category.id, parent: category.parent },
      };
    }
    if (parent.parent) {
      return { key: "errorStartSystemThreeLevels", params: { name: category.id, parent: parent.id } };
    }
  }
  return null;
}

/** Drop keys that carry no value, so defaults above are not overwritten by them. */
function strip(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}
