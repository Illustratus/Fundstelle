/**
 * Stances that were written into memos before the tool had a field for them.
 *
 * A study that began coding its evaluation round before stances per
 * proposition existed kept them where it could: in the memo of the unit, as a
 * sentence of a fixed form —
 *
 *   Stufe je Proposition: Konversationsprinzip stützt.
 *   Stufe je Proposition: Konversationsprinzip widerspricht (Grenzfall).
 *   Stufe je Proposition: Konversationsprinzip stützt, Transparenz-auf-Abruf-Prinzip widerspricht.
 *
 * (or the English "Stance per proposition: … supports, … contradicts"). This
 * module reads such sentences and plans what `tools/migrate-stances.mjs`
 * writes. It never guesses: a sentence it cannot read, a name that matches no
 * proposition or more than one, a proposition named twice with two stances, or
 * a unit that already carries a different stance is a problem, and a plan with
 * a problem is not written at all. "(Grenzfall)" is a note for the reader —
 * the stance holds — and is reported, not stored. The memo stays as it is.
 */

import { hasClaim } from "./stances.js";

const MARKERS = ["Stufe je Proposition:", "Stance per proposition:"];
const WORDS = { stützt: "supports", supports: "supports", widerspricht: "contradicts", contradicts: "contradicts" };
const BORDERLINE = /\s*\((Grenzfall|borderline)\)\s*$/i;

/**
 * The stances one memo states: `{ found: [{ name, stance, borderline }],
 * unreadable: [text] }`. Only sentences opened by the marker count; a memo
 * that says "if so, it supports …" without it states no stance.
 */
export function stancesInMemo(memo) {
  const found = [];
  const unreadable = [];
  const text = String(memo ?? "");
  for (const marker of MARKERS) {
    let from = text.indexOf(marker);
    while (from >= 0) {
      const start = from + marker.length;
      const end = text.indexOf(".", start);
      const sentence = text.slice(start, end < 0 ? undefined : end).trim();
      for (const raw of sentence.split(",").map((one) => one.trim()).filter(Boolean)) {
        const borderline = BORDERLINE.test(raw);
        const item = raw.replace(BORDERLINE, "").trim();
        const match = item.match(/^(.+?)\s+(\S+)$/);
        const stance = match ? WORDS[match[2].toLowerCase()] : undefined;
        if (!match || !stance) unreadable.push(raw);
        else found.push({ name: match[1].trim(), stance, borderline });
      }
      from = text.indexOf(marker, end < 0 ? text.length : end);
    }
  }
  return { found, unreadable };
}

/** A name as it is compared: case, hyphens and a trailing "-Prinzip"/"principle" do not matter. */
export function normalName(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[-–_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*(prinzip|principle)$/, "")
    .trim();
}

/**
 * Which proposition a name in a memo means: by its wording or its id, among
 * those that make a claim; `aliases` (name → id) settle what the wording does
 * not. Answers `{ id }` or `{ problem: "unknown" | "ambiguous", ids }`.
 */
export function propositionMatcher(propositions, aliases = {}) {
  const claims = Object.entries(propositions).filter(([id, proposition]) => hasClaim(id, proposition));
  const byAlias = new Map(Object.entries(aliases).map(([name, id]) => [normalName(name), id]));
  return (name) => {
    const wanted = normalName(name);
    if (byAlias.has(wanted)) {
      const id = byAlias.get(wanted);
      return claims.some(([one]) => one === id) ? { id } : { problem: "unknown", ids: [] };
    }
    const ids = claims
      .filter(([id, proposition]) => normalName(proposition.name) === wanted || normalName(id) === wanted)
      .map(([id]) => id);
    if (ids.length === 1) return { id: ids[0] };
    return { problem: ids.length ? "ambiguous" : "unknown", ids };
  };
}

/**
 * What a migration would write, unit by unit.
 *
 * `interviews` are `{ id, codings }` as the API returns them; `current(coding)`
 * gives the stances a unit already carries (the API's `stances`, an older
 * `stance` read into it). A unit is `write` with the stances to set,
 * `unchanged` when it already carries exactly those, or `conflict` when it
 * carries another; everything that cannot be read without a guess is a
 * problem.
 */
export function migrationPlan({ interviews, propositions, aliases = {}, current = (coding) => coding.stances ?? {} }) {
  const match = propositionMatcher(propositions, aliases);
  const units = [];
  const problems = [];
  for (const { id: interview, codings } of interviews) {
    for (const coding of codings) {
      const { found, unreadable } = stancesInMemo(coding.memo);
      if (!found.length && !unreadable.length) continue;
      const where = { interview, id: coding.id, turn: coding.turn, category: coding.category };
      for (const text of unreadable) problems.push({ ...where, kind: "unreadable", text });
      const set = {};
      const borderline = [];
      for (const one of found) {
        const resolved = match(one.name);
        if (!resolved.id) {
          problems.push({ ...where, kind: resolved.problem, name: one.name, ids: resolved.ids });
          continue;
        }
        if (set[resolved.id] && set[resolved.id] !== one.stance) {
          problems.push({ ...where, kind: "twice", name: one.name });
          continue;
        }
        set[resolved.id] = one.stance;
        if (one.borderline) borderline.push(resolved.id);
      }
      const have = current(coding);
      const write = {};
      let conflict = false;
      for (const [proposition, stance] of Object.entries(set)) {
        if (have[proposition] === stance) continue;
        if (have[proposition]) {
          conflict = true;
          problems.push({ ...where, kind: "conflict", name: propositions[proposition]?.name ?? proposition, have: have[proposition], want: stance });
          continue;
        }
        write[proposition] = stance;
      }
      if (!Object.keys(set).length) continue;
      const state = conflict ? "conflict" : Object.keys(write).length ? "write" : "unchanged";
      units.push({ ...where, set, write, borderline, state });
    }
  }
  return { units, problems };
}
