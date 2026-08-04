import { expect, test } from "@playwright/test";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Store } from "../lib/store.js";
import { translator } from "../lib/texts.js";

/**
 * Seeding the category system on first start, checked without a browser: the
 * bundled system, a start system of one's own through `START_SYSTEM`, and the
 * loud abort on an unusable file.
 */

function freshStore(startSystemFile = null, seedLanguage = undefined) {
  const root = mkdtempSync(join(tmpdir(), "fundstelle-start-"));
  return new Store({ toolRoot: root, transcriptRoot: root, startSystemFile, seedLanguage });
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

/* The bundled system carries both languages, because the first screen of a
   fresh installation should not be in a language nobody asked for. What is
   written out is one language, the way an author would have typed it. */

test("the bundled system is seeded in the language that was asked for", async () => {
  const german = await freshStore().categories("de");
  expect(german.categories.map((c) => c.name)).toEqual([
    "Arbeitsalltag",
    "Störungen",
    "Absprachen",
  ]);
  expect(german.categories[0].definition).toContain("wiederkehrende Abläufe");
  expect(german.propositions.practice.name).toBe("Proposition 1: Werkzeuge prägen den Arbeitsalltag");

  const english = await freshStore().categories("en");
  expect(english.categories.map((c) => c.name)).toEqual([
    "Everyday work",
    "Disruptions",
    "Agreements",
  ]);
  expect(english.categories[0].definition).toContain("recurring sequences");
  expect(english.propositions.practice.name).toBe("Proposition 1: Tools shape the working day");

  // The abbreviation follows the name it was derived from.
  expect(german.categories[1].abbreviation).toBe("Stö");
  expect(english.categories[1].abbreviation).toBe("Dis");
});

test("what is seeded is one language, not both", async () => {
  const store = freshStore();
  const { categories } = await store.categories("en");
  for (const category of categories) {
    expect(typeof category.name).toBe("string");
    expect(typeof category.definition).toBe("string");
  }
  // And it stays that way: the second read finds the file and ignores the wish.
  const again = await store.categories("de");
  expect(again.categories[0].name).toBe("Everyday work");
});

test("a pinned seed language outranks what the request asks for", async () => {
  // What `START_LANGUAGE` sets on the server: a shared or scripted setup wants
  // the same seed every time, whoever opens the tool first.
  const { categories } = await freshStore(null, "de").categories();
  expect(categories.map((c) => c.name)).toEqual(["Arbeitsalltag", "Störungen", "Absprachen"]);
});

test("seeding through a side door follows the pinned language too", async () => {
  // Half the store reaches the category system from the inside. Adding a
  // category on a fresh installation seeds it on the way, and that seed has to
  // obey the same pin as a plain read — otherwise the language of the start
  // system depends on which button was pressed first.
  const store = freshStore(null, "de");
  await store.addCategory({ name: "Medienbruch", definition: "Am Material gebildet." });

  const { categories } = await store.categories();
  expect(categories.map((c) => c.name)).toEqual([
    "Arbeitsalltag",
    "Störungen",
    "Absprachen",
    "Medienbruch",
  ]);
});

test("a language nobody wrote falls back instead of coming out empty", async () => {
  const { categories, propositions } = await freshStore().categories("fr");
  expect(categories[0].name).toBe("Everyday work");
  expect(propositions.practice.name).toContain("Proposition 1");
});

test("a start system of one's own may be bilingual too", async () => {
  const root = mkdtempSync(join(tmpdir(), "fundstelle-start-"));
  const file = join(root, "start-system.json");
  writeFileSync(
    file,
    JSON.stringify({
      propositions: { core: { name: { de: "Kernthese", en: "Core claim" }, color: "#123456" } },
      categories: [
        {
          id: "routine",
          name: { de: "Arbeitsalltag", en: "Everyday work" },
          proposition: "core",
          definition: { de: "Aussagen über Abläufe.", en: "Statements about sequences." },
        },
      ],
    }),
  );

  const german = await freshStore(file).categories("de");
  expect(german.categories[0].name).toBe("Arbeitsalltag");
  expect(german.propositions.core.name).toBe("Kernthese");

  const english = await freshStore(file).categories("en");
  expect(english.categories[0].name).toBe("Everyday work");
  expect(english.propositions.core.name).toBe("Core claim");
  expect(english.propositions.core.color).toBe("#123456");
});

test("a start system in one language is left exactly as it is", async () => {
  const root = mkdtempSync(join(tmpdir(), "fundstelle-start-"));
  const file = join(root, "start-system.json");
  writeFileSync(
    file,
    JSON.stringify({
      categories: [{ id: "own", name: "Eigene Kategorie", definition: "Nur auf Deutsch." }],
    }),
  );

  // Asking for English cannot invent a translation, and must not blank the name.
  const { categories } = await freshStore(file).categories("en");
  expect(categories[0]).toMatchObject({ name: "Eigene Kategorie", definition: "Nur auf Deutsch." });
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

/* A folder the tool may not write to is the ordinary first-run mishap of a
   container, not a bug. It has to read as a sentence, not as a stack trace. */

test("a folder that cannot be written to says so", async () => {
  // Running as root would sail straight through the permission bits and prove
  // nothing at all.
  test.skip(process.getuid?.() === 0, "root ignores the permission bits");

  const root = mkdtempSync(join(tmpdir(), "fundstelle-locked-"));
  const locked = join(root, "locked");
  mkdirSync(locked);
  chmodSync(locked, 0o500);
  try {
    const store = new Store({
      toolRoot: locked,
      transcriptRoot: locked,
      categoriesFile: join(locked, "categories.json"),
    });
    const error = await store.categories().catch((thrown) => thrown);
    expect(error.key).toBe("errorDataNotWritable");
    expect(error.params.path).toBe(locked);
    // Both languages can phrase it, and both name the folder to go and look at.
    for (const language of ["de", "en"]) {
      expect(translator(language)(error.key, error.params)).toContain(locked);
    }
    expect(translator("en")(error.key, error.params)).toContain("cannot be written to");
    expect(translator("de")(error.key, error.params)).toContain("lässt sich nicht schreiben");
  } finally {
    chmodSync(locked, 0o700);
  }
});

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
