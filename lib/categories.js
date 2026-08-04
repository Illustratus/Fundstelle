/**
 * The deductive start category system that seeds a fresh installation.
 *
 * The bundled system is deliberately generic: it is a worked example of the
 * format, not a category system for any particular study. Bring your own via
 * the `START_SYSTEM` environment variable (see the README) — that file goes
 * through the same flattening and inherits the same defaults.
 *
 * Anchor examples and coding rules are absent on purpose. Mayring has both
 * emerge from the material, so the tool records them while coding rather than
 * shipping them.
 *
 * Color encodes the anchoring proposition, never the category itself. Two
 * categories that argue the same point therefore look alike, and the key stays
 * recognizable between the tool and whatever the study writes up.
 */

export const PROPOSITIONS = {
  practice: { name: "Proposition 1: Tools shape the working day", color: "#6C8EBF" },
  coordination: { name: "Proposition 2: Agreements stay informal", color: "#D79B00" },
  none: { name: "Derived from the research interest", color: "#8A9299" },
};

export const DEDUCTIVE = [
  {
    id: "routine",
    name: "Arbeitsalltag",
    abbreviation: "Arb",
    proposition: "practice",
    definition:
      "Aussagen über wiederkehrende Abläufe im Arbeitstag, die zeigen, welche Tätigkeit mit welchem Werkzeug in welcher Reihenfolge erledigt wird.",
    children: [
      {
        id: "routine.disruption",
        name: "Störungen",
        abbreviation: "Stö",
        definition:
          "Aussagen über Unterbrechungen des Arbeitsflusses, ihre Auslöser und ihre Folgen.",
      },
    ],
  },
  {
    id: "agreement",
    name: "Absprachen",
    abbreviation: "Abs",
    proposition: "coordination",
    definition:
      "Aussagen über getroffene oder gescheiterte Absprachen, die zeigen, worüber, mit wem und auf welchem Weg abgestimmt wird.",
  },
];

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

export function normalizeProposition(raw) {
  return { name: raw.name, color: raw.color ?? raw.farbe };
}

/**
 * Flat list of all deductive categories, subcategories included.
 *
 * Without an argument it yields the bundled system above. A start system of
 * your own goes through the same flattening and has missing abbreviations and
 * propositions filled in.
 */
export function startSystem(deductive = DEDUCTIVE) {
  const flat = [];
  for (const category of deductive.map(normalizeCategory)) {
    const { children, ...rest } = category;
    flat.push({
      abbreviation: rest.name.slice(0, 3),
      proposition: "none",
      ...strip(rest),
      origin: "deductive",
      parent: null,
      codingRules: [],
    });
    for (const child of (children ?? []).map(normalizeCategory)) {
      const { children: _ignored, ...childRest } = child;
      flat.push({
        abbreviation: child.name.slice(0, 3),
        ...strip(childRest),
        proposition: category.proposition ?? "none",
        origin: "deductive",
        parent: category.id,
        codingRules: [],
      });
    }
  }
  return flat;
}

/** Drop keys that carry no value, so defaults above are not overwritten by them. */
function strip(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}
