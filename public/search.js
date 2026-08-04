/**
 * Patterns for searching the transcript.
 *
 * Plain string comparison does not do justice to an inflected language:
 * „ablegen" does not find „abgelegt", „Ablage" does not find „abzulegen" — and
 * in a study about filing those are not the edge cases but the central words.
 * Two remedies, both visible rather than guessed:
 *
 * `*` stands for any characters within a word. `ab*leg*` finds „ablegen",
 * „abgelegt" and „abzulegen", but never across a space — otherwise a pattern
 * would span half a turn.
 *
 * And when a word without a wildcard finds nothing at all, its ending is
 * trimmed and the search runs again. The result then says what was actually
 * searched for; silently reinterpreting the input would be worse than no hit.
 *
 * This file lives in `public/` because the server and the interface need the
 * same pattern. Two readings of one search term would be a bug that only
 * surfaces when a count disagrees with a highlight.
 */

/**
 * A slice through the citations.
 *
 * It lives here and not with the analysis because the interface and the export
 * must apply the same slice: what the analysis shows has to be what the export
 * writes, or the text cites something other than the view claims.
 */
export function matchesSlice(citation, slice = {}) {
  const word = (slice.word ?? "").trim();
  return (
    (!slice.department || citation.department === slice.department) &&
    (!slice.section || citation.sectionName === slice.section) &&
    (!slice.anchor || Boolean(citation.anchor)) &&
    (!slice.memo || Boolean((citation.memo ?? "").trim())) &&
    (!slice.withoutRequirement || !(citation.requirements ?? []).length) &&
    (!slice.unreviewed || citation.reviewed !== true) &&
    (!word || occurrences(`${citation.text} ${citation.memo ?? ""}`, word).length > 0)
  );
}

/**
 * Endings that inflect, longest first, per language.
 *
 * Not a stemmer and not trying to be one: a short list of the endings that
 * actually get in the way, applied only when a word finds nothing at all, and
 * always announced. The German list was here from the start and the English one
 * was not, so an English study got half the feature — the plural came through
 * by coincidence, because "s" and "es" inflect in both, while "-ing" and "-ed"
 * reached nothing. Matching is by substring, so a stem trimmed a little too far
 * still finds the word it came from.
 */
const ENDINGS = {
  de: ["ungen", "enden", "ende", "eten", "erte", "ung", "est", "ten", "tet", "end", "en", "em", "er", "es", "et", "st", "te", "e", "n", "s", "t"],
  en: ["ingly", "ings", "ing", "ies", "ied", "ers", "est", "ed", "er", "es", "ly", "s"],
};

const SPECIAL_CHARACTERS = /[.*+?^${}()|[\]\\]/g;

/**
 * Regular expression for a search term.
 *
 * Without `g`, so the caller decides about reuse; whoever needs every
 * occurrence sets the flag themselves.
 */
export function patternFor(word) {
  const wanted = word.trim();
  if (!wanted) return null;
  const parts = wanted.split("*").map((part) => part.replace(SPECIAL_CHARACTERS, "\\$&"));
  // The wildcard stays inside the word: anything but whitespace.
  return new RegExp(parts.join("\\S*"), "i");
}

/** Every occurrence as [from, to] in the given text. */
export function occurrences(text, word) {
  const pattern = patternFor(word);
  if (!pattern) return [];
  const all = new RegExp(pattern.source, "gi");
  const found = [];
  for (const match of text.matchAll(all)) {
    // An empty pattern would find nothing infinitely often.
    if (!match[0].length) break;
    found.push([match.index, match.index + match[0].length]);
  }
  return found;
}

/**
 * The term a set of texts is actually searched with, and what to say about it.
 *
 * Trimming the ending is decided once for the whole set, never per text: if one
 * citation matched the word and the next only its stem, the slice would be two
 * searches at once and the count would mean nothing. So the word is tried
 * across everything first, and only if it finds nothing anywhere is the stem
 * tried in its place.
 *
 * `instead` is what was searched for when it is not what was typed. Saying so
 * is the whole condition for doing it — reinterpreting the input in silence
 * would be worse than no hit at all.
 */
export function effectiveWord(texts, word, language) {
  const wanted = (word ?? "").trim();
  if (!wanted) return { word: "", instead: null };
  if (texts.some((text) => occurrences(text, wanted).length)) {
    return { word: wanted, instead: null };
  }
  const stem = trimStem(wanted, language);
  if (stem && texts.some((text) => occurrences(text, stem).length)) {
    return { word: stem, instead: stem };
  }
  return { word: wanted, instead: null };
}

/**
 * The same term without its inflecting ending, or null.
 *
 * Only for terms without a wildcard: whoever sets one has already decided and
 * does not get corrected.
 */
export function trimStem(word, language = "en") {
  const wanted = word.trim();
  if (!wanted || wanted.includes("*") || /\s/.test(wanted)) return null;
  for (const ending of ENDINGS[language] ?? ENDINGS.en) {
    if (wanted.length - ending.length >= 4 && wanted.toLowerCase().endsWith(ending)) {
      return wanted.slice(0, -ending.length);
    }
  }
  return null;
}
