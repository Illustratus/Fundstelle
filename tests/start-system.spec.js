import { expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Store } from "../lib/store.js";
import { translator } from "../lib/texts.js";

/**
 * Seeding the category system on first start, checked without a browser: the
 * bundled system, a start system of one's own through `START_SYSTEM`, and the
 * loud abort on an unusable file.
 */

function freshStore(startSystemFile = null) {
  const root = mkdtempSync(join(tmpdir(), "fundstelle-start-"));
  return new Store({ toolRoot: root, transcriptRoot: root, startSystemFile });
}

test("without a start system file the bundled system appears", async () => {
  const { categories, propositions } = await freshStore().categories();
  expect(categories.map((category) => category.id)).toEqual([
    "routine",
    "routine.disruption",
    "agreement",
  ]);
  expect(categories.find((c) => c.id === "routine.disruption").parent).toBe("routine");
  expect(propositions.practice.name).toContain("Proposition 1");
});

test("a start system of one's own replaces the bundled one", async () => {
  const root = mkdtempSync(join(tmpdir(), "fundstelle-start-"));
  const file = join(root, "start-system.json");
  writeFileSync(
    file,
    JSON.stringify({
      propositions: { core: { name: "Kernthese", color: "#123456" } },
      categories: [
        {
          id: "routine",
          name: "Arbeitsalltag",
          proposition: "core",
          definition: "Aussagen über wiederkehrende Abläufe.",
          children: [
            {
              id: "routine.disruption",
              name: "Störungen",
              definition: "Aussagen über Unterbrechungen.",
            },
          ],
        },
      ],
    }),
  );

  const { categories, propositions } = await freshStore(file).categories();
  expect(categories.map((category) => category.id)).toEqual(["routine", "routine.disruption"]);
  // The subcategory inherits the proposition, the abbreviation comes from the name.
  expect(categories[1]).toMatchObject({
    parent: "routine",
    proposition: "core",
    abbreviation: "Stö",
    origin: "deductive",
  });
  expect(propositions.core.color).toBe("#123456");
});

/**
 * A study started before the rename must keep working: German file names and
 * German keys are read as they are and written back in the current format.
 */
test("a category system in the old German format is read and migrated", async () => {
  const root = mkdtempSync(join(tmpdir(), "fundstelle-start-"));
  writeFileSync(
    join(root, "kategoriensystem.json"),
    JSON.stringify({
      version: 2,
      propositionen: { kern: { name: "Kernthese", farbe: "#123456" } },
      kategorien: [
        {
          id: "alltag",
          name: "Arbeitsalltag",
          kuerzel: "Arb",
          proposition: "kern",
          definition: "Aussagen über wiederkehrende Abläufe.",
          definitionStart: "Aussagen über Abläufe.",
          herkunft: "deduktiv",
          eltern: null,
          kodierregeln: ["Nur Wiederkehrendes."],
        },
        {
          id: "ind.medienbruch",
          name: "Medienbruch",
          definition: "Am Material gebildet.",
          herkunft: "induktiv",
          eltern: "alltag",
          kodierregeln: [],
        },
      ],
    }),
  );

  const store = new Store({ toolRoot: root, transcriptRoot: root });
  const { categories, propositions } = await store.categories();
  expect(propositions.kern.color).toBe("#123456");
  expect(categories[0]).toMatchObject({
    id: "alltag",
    abbreviation: "Arb",
    origin: "deductive",
    parent: null,
    initialDefinition: "Aussagen über Abläufe.",
    codingRules: ["Nur Wiederkehrendes."],
  });
  expect(categories[1]).toMatchObject({ origin: "inductive", parent: "alltag" });
});

test("codings in the old German format keep their place", async () => {
  const root = mkdtempSync(join(tmpdir(), "fundstelle-start-"));
  const interview = join(root, "interview-01");
  mkdirSync(interview, { recursive: true });
  writeFileSync(
    join(interview, "kodierung.json"),
    JSON.stringify({
      version: 2,
      interview: "interview-01",
      memo: "Lief schleppend an.",
      kodierungen: [
        {
          id: "a",
          beitrag: 4,
          start: 0,
          ende: 12,
          kategorie: "alltag",
          text: "Klar, ich",
          anker: true,
          geprueft: true,
          anforderungen: ["r1"],
        },
      ],
    }),
  );

  const store = new Store({ toolRoot: root, transcriptRoot: root });
  const { codings, memo } = await store.codings("interview-01");
  expect(memo).toBe("Lief schleppend an.");
  expect(codings[0]).toMatchObject({
    turn: 4,
    end: 12,
    category: "alltag",
    anchor: true,
    reviewed: true,
    requirements: ["r1"],
  });
});

test("requirements in the old German format keep their blocked operations", async () => {
  const root = mkdtempSync(join(tmpdir(), "fundstelle-start-"));
  writeFileSync(
    join(root, "anforderungen.json"),
    JSON.stringify({
      version: 2,
      anforderungen: [
        {
          id: "r1",
          titel: "Ablage ohne Arbeitsschritt",
          beschreibung: "Fällt nebenbei an.",
          blockiert: ["ablage", "abruf"],
          moscow: "must",
        },
      ],
    }),
  );

  const store = new Store({ toolRoot: root, transcriptRoot: root });
  const { requirements } = await store.requirements();
  expect(requirements[0]).toMatchObject({
    title: "Ablage ohne Arbeitsschritt",
    description: "Fällt nebenbei an.",
    blockedOperations: ["filing", "retrieval"],
    moscow: "must",
  });
});

test("the seed is recorded and not sown again on the next read", async () => {
  const store = freshStore();
  const first = await store.categories();
  await store.addCategory({ name: "Medienbruch", definition: "Am Material gebildet." });
  const second = await store.categories();
  expect(second.categories.length).toBe(first.categories.length + 1);
});

test("the bundled example file is a valid seed", async () => {
  const file = join(new URL("..", import.meta.url).pathname, "example-start-system.json");
  const { categories } = await freshStore(file).categories();
  expect(categories.map((category) => category.id)).toEqual([
    "routine",
    "routine.disruption",
    "agreement",
  ]);
});

/* The store names the case and leaves the wording to whoever caught it: it does
   not know which language the request came in. The message is the key, and the
   key is what a caller can rely on. */

test("a missing start system file aborts loudly", async () => {
  await expect(freshStore("/does/not/exist.json").categories()).rejects.toThrow(
    "errorStartSystemUnreadable",
  );
});

test("a start category without a definition aborts loudly", async () => {
  const root = mkdtempSync(join(tmpdir(), "fundstelle-start-"));
  const file = join(root, "start-system.json");
  writeFileSync(file, JSON.stringify({ categories: [{ id: "routine", name: "Arbeitsalltag" }] }));
  await expect(freshStore(file).categories()).rejects.toThrow("errorStartSystemFields");
});

test("the named case carries what it needs to be phrased in either language", async () => {
  const root = mkdtempSync(join(tmpdir(), "fundstelle-start-"));
  const file = join(root, "start-system.json");
  writeFileSync(file, JSON.stringify({ categories: [{ id: "routine", name: "Arbeitsalltag" }] }));

  const error = await freshStore(file)
    .categories()
    .catch((thrown) => thrown);
  expect(error.key).toBe("errorStartSystemFields");
  expect(translator("de")(error.key, error.params)).toContain("Jede Startkategorie braucht");
  expect(translator("en")(error.key, error.params)).toContain("Every start category needs");
  // The offending category is named in both, so the message stays actionable.
  for (const language of ["de", "en"]) {
    expect(translator(language)(error.key, error.params)).toContain("routine");
  }
});
