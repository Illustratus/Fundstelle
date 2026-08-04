import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { TEXTS as INTERFACE } from "../public/texts.js";
import { TEXTS as SERVER } from "../lib/texts.js";

/**
 * The two dictionaries, checked as structures rather than by reading them.
 *
 * Both are long, both are edited by hand, and both fail quietly. A key written
 * twice in one language block is not an error in JavaScript — the later one
 * simply wins, and the earlier wording disappears without a word. I did exactly
 * that while adding a message: a search-and-replace matched both language
 * blocks, so the English block carried the German wording and then the English
 * one, and only the second was ever shown. Nothing broke; it just would have
 * been wrong in whichever language lost.
 *
 * A key present in one language and missing in the other is the other half of
 * it. The German wording steps in where an English one is missing, which keeps
 * the interface working and puts German in front of an English reader — a
 * half-truth that is worse than a visible gap, because nobody reports it.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const dictionaries = [
  ["the interface", INTERFACE, join(ROOT, "public", "texts.js")],
  ["the server", SERVER, join(ROOT, "lib", "texts.js")],
];

for (const [what, texts, file] of dictionaries) {
  test(`${what} says the same things in both languages`, () => {
    const german = Object.keys(texts.de).sort();
    const english = Object.keys(texts.en).sort();

    const untranslated = german.filter((key) => !english.includes(key));
    const orphaned = english.filter((key) => !german.includes(key));
    expect(untranslated, `${what}: keys with no English wording`).toEqual([]);
    expect(orphaned, `${what}: English keys with no German wording`).toEqual([]);
  });

  test(`${what} defines no key twice`, () => {
    /* Read from the source, because by the time the object exists the duplicate
       has already resolved itself into a single winning value. */
    const source = readFileSync(file, "utf8");
    for (const language of ["de", "en"]) {
      const from = source.indexOf(`  ${language}: {`);
      expect(from, `${what}: the ${language} block is found`).toBeGreaterThan(0);
      const to = source.indexOf("\n  },", from);
      const block = source.slice(from, to);
      const keys = [...block.matchAll(/^ {4}([A-Za-z][A-Za-z0-9]*):/gm)].map((one) => one[1]);
      const twice = [...new Set(keys.filter((key, at) => keys.indexOf(key) !== at))];
      expect(twice, `${what}: keys written twice in ${language}`).toEqual([]);
    }
  });

  test(`${what} leaves no wording empty`, () => {
    for (const language of ["de", "en"]) {
      const empty = Object.entries(texts[language])
        .filter(([, value]) => typeof value === "string" && !value.trim())
        .map(([key]) => key);
      expect(empty, `${what}: empty wordings in ${language}`).toEqual([]);
    }
  });

  test(`${what} fills the same blanks in both languages`, () => {
    /* A message that names a file in German and says nothing in English is a
       message that will be read as being about something else. */
    const blanks = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((one) => one[1]).sort();
    for (const key of Object.keys(texts.de)) {
      if (!(key in texts.en)) continue;
      expect(blanks(texts.en[key]), `${key} takes the same values in both`).toEqual(
        blanks(texts.de[key]),
      );
    }
  });
}
