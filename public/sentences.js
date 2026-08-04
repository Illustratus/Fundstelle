/**
 * Where one sentence ends and the next begins.
 *
 * A coding unit in a content analysis is usually a sentence or a small group of
 * them, so the sentence is the step size the tool moves in: the double click
 * grabs one, and the keyboard walks from one to the next. Both need the same
 * answer, which is why the question is settled here and not twice.
 *
 * Splitting on every full stop is wrong in the two languages this tool speaks.
 * „z. B." and „e. g." are not two sentences, and neither is „am 1. Januar".
 * Two guards, both cheap: the word in front of the stop must not look like an
 * abbreviation, and what follows must not read like the middle of a sentence.
 * A wrong cut costs a step, never a coding — the edges are sharpened again
 * before anything is saved.
 */

/**
 * Words that carry a full stop without ending anything.
 *
 * Single letters are caught by rule and are not in the list („z. B.", „u. a.",
 * „e. g."); what remains are the abbreviations that are longer than one letter
 * and common enough in spoken material to matter.
 */
const ABBREVIATIONS = new Set([
  "bzw", "ca", "usw", "usf", "vgl", "ggf", "evtl", "inkl", "exkl", "mind", "max",
  "nr", "abb", "tab", "dr", "prof", "hr", "fr", "str", "jhd", "jh",
  "etc", "vs", "fig", "no", "mr", "mrs", "ms", "st", "approx", "cf", "dept",
]);

const ENDS = /[.!?]/;
const AFTER_END = /["'»“”’)\]]/;

/** Does the full stop at `at` belong to an abbreviation rather than a sentence? */
function shortensAWord(text, at) {
  let from = at;
  while (from > 0 && /[\p{L}\p{N}]/u.test(text[from - 1])) from -= 1;
  const word = text.slice(from, at);
  if (!word) return false;
  // „am 1. Januar", and a single letter as in „z. B." or „e. g.".
  if (/^\p{N}+$/u.test(word) || word.length === 1) return true;
  return ABBREVIATIONS.has(word.toLowerCase());
}

/** Every sentence of a text as [start, end), never empty for a non-empty text. */
export function sentences(text) {
  const found = [];
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    if (!ENDS.test(text[i])) continue;
    if (shortensAWord(text, i)) continue;
    // A closing quotation mark or bracket still belongs to the sentence.
    let to = i + 1;
    while (to < text.length && AFTER_END.test(text[to])) to += 1;
    const next = text.slice(to).match(/\S/);
    if (to < text.length && !/\s/.test(text[to])) continue;
    // A small letter after the stop reads as the middle of a sentence, which is
    // what most abbreviations look like from behind.
    if (next && /\p{Ll}/u.test(next[0])) continue;
    if (text.slice(from, to).trim()) found.push([from, to]);
    from = to;
    i = to - 1;
  }
  if (text.slice(from).trim()) found.push([from, text.length]);
  return found.length ? found : [[0, text.length]];
}

/** The index of the sentence that holds `position`. */
export function sentenceAt(text, position) {
  const all = sentences(text);
  const found = all.findIndex(([, end]) => position < end);
  return found < 0 ? all.length - 1 : found;
}
