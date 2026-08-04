import { expect, test } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Store } from "../lib/store.js";

/**
 * Merging, subordinating and dropping categories.
 *
 * These are the operations that move the most at once, and the one thing none
 * of them may leave behind is a category pointing at one that is gone: it is
 * drawn as a subcategory of nothing, in the panel, in the cross table and in
 * the coding guide, and no screen says why.
 */

function freshStore(seedLanguage = "de") {
  const root = mkdtempSync(join(tmpdir(), "fundstelle-categories-"));
  return new Store({ toolRoot: root, transcriptRoot: root, seedLanguage });
}

/** Every category whose parent is not in the system. */
function dangling(categories) {
  const present = new Set(categories.map((category) => category.id));
  return categories
    .filter((category) => category.parent && !present.has(category.parent))
    .map((category) => [category.id, category.parent]);
}

async function withFamily(store) {
  await store.addCategory({ name: "Oberbegriff", definition: "Am Material." });
  await store.addCategory({ name: "Unterbegriff", definition: "Am Material." });
  await store.addCategory({ name: "Nachbar", definition: "Am Material." });
  await store.updateCategory("ind.unterbegriff", { parent: "ind.oberbegriff" });
  await store.updateCategory("ind.nachbar", { parent: "ind.oberbegriff" });
  return store;
}

test("merging a category into its own subcategory leaves nothing pointing at a ghost", async () => {
  // A reasonable move: the distinction turns out to have been the main point.
  const store = await withFamily(freshStore());
  await store.mergeCategories("ind.oberbegriff", "ind.unterbegriff");

  const { categories } = await store.categories();
  expect(dangling(categories)).toEqual([]);
  expect(categories.some((category) => category.id === "ind.oberbegriff")).toBe(false);

  // The subcategory takes the place of the category it absorbed…
  const target = categories.find((category) => category.id === "ind.unterbegriff");
  expect(target.parent).toBe(null);
  // …and what used to sit beside it now sits under it. Still two levels.
  const sibling = categories.find((category) => category.id === "ind.nachbar");
  expect(sibling.parent).toBe("ind.unterbegriff");
  for (const category of categories) {
    if (!category.parent) continue;
    const parent = categories.find((one) => one.id === category.parent);
    expect(parent.parent, `${category.id} is at most two levels deep`).toBeFalsy();
  }
});

test("dropping a category moves what sat under it up, not into the void", async () => {
  const store = freshStore();
  await store.addCategory({ name: "Eltern", definition: "Am Material." });
  await store.addCategory({ name: "Kind", definition: "Am Material." });
  await store.updateCategory("ind.kind", { parent: "ind.eltern" });

  await store.removeCategory("ind.eltern", 0);

  const { categories } = await store.categories();
  expect(dangling(categories)).toEqual([]);
  expect(categories.find((category) => category.id === "ind.kind").parent).toBe(null);
});

test("merging two categories that share a parent keeps them where they were", async () => {
  const store = freshStore();
  await store.addCategory({ name: "Alpha", definition: "Am Material." });
  await store.addCategory({ name: "Beta", definition: "Am Material." });
  await store.updateCategory("ind.alpha", { parent: "routine" });
  await store.updateCategory("ind.beta", { parent: "routine" });

  await store.mergeCategories("ind.alpha", "ind.beta");

  const { categories } = await store.categories();
  expect(dangling(categories)).toEqual([]);
  expect(categories.find((category) => category.id === "ind.beta").parent).toBe("routine");
});

test("what emerged on the material survives the merge", async () => {
  const store = freshStore();
  await store.addCategory({ name: "Alpha", definition: "Von Alpha." });
  await store.addCategory({ name: "Beta", definition: "Von Beta." });
  await store.updateCategory("ind.alpha", {
    codingRules: ["Nur bei ausdrücklicher Nennung."],
    memo: "Aus Interview 2.",
  });
  await store.updateCategory("ind.beta", {
    codingRules: ["Nicht bei bloßer Andeutung."],
    memo: "Aus Interview 4.",
  });

  await store.mergeCategories("ind.alpha", "ind.beta");

  const { categories } = await store.categories();
  const target = categories.find((category) => category.id === "ind.beta");
  // Coding rules and notes from both sides are what the method produced; the
  // definition stays the target's, because that is the decision being made.
  expect(target.codingRules).toEqual([
    "Nicht bei bloßer Andeutung.",
    "Nur bei ausdrücklicher Nennung.",
  ]);
  expect(target.memo).toContain("Aus Interview 4.");
  expect(target.memo).toContain("Aus Interview 2.");
  expect(target.definition).toBe("Von Beta.");
});

test("a file already broken by an earlier version is put right on the next write", async () => {
  const store = freshStore();
  await store.addCategory({ name: "Waise", definition: "Am Material." });

  // What a former merge left behind: a parent that is not there.
  const data = await store.categories();
  data.categories.find((category) => category.id === "ind.waise").parent = "ind.weg";
  await store.setCategories(data);

  const { categories } = await store.categories();
  expect(dangling(categories)).toEqual([]);
  expect(categories.find((category) => category.id === "ind.waise").parent).toBe(null);
});

test("a deductive category is neither merged away nor dropped", async () => {
  const store = freshStore();
  await store.addCategory({ name: "Alpha", definition: "Am Material." });

  await expect(store.mergeCategories("routine", "ind.alpha")).rejects.toThrow(
    "errorDeductiveStays",
  );
  await expect(store.removeCategory("routine", 0)).rejects.toThrow("errorDeductiveStays");

  // And one that carries codings is not dropped either, whatever its origin.
  await expect(store.removeCategory("ind.alpha", 3)).rejects.toThrow("errorCategoryInUse");
});
