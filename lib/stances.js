/**
 * Where a coding unit stands towards the study's propositions.
 *
 * Mayring lets several category systems be applied to the same units: a
 * nominal one says what a person talks about, an ordinal one what the
 * statement means for a claim. The category system is the nominal one. The
 * stance is the ordinal one, and there is one of it per proposition: a unit
 * *supports* a proposition, *contradicts* it, or has no bearing on it — and
 * which of the three does not depend on the unit's category. A statement coded
 * under a category that argues nothing can still support a proposition, and one
 * unit can bear on two.
 *
 * ## In the file
 *
 * `stances` on the unit, keyed by proposition id: `{ "konversation":
 * "supports" }`. A proposition that is not named has no bearing — that is the
 * middle step, and it is never written, because most of what anybody says has
 * no bearing on a given claim and a field that had to be filled would be filled
 * with a guess. A unit nobody gave a stance to is written exactly as before.
 *
 * Version 0.12 kept a single `stance` per unit, meant as the stance towards the
 * proposition of the unit's own category. It is still read that way, so a
 * study coded with it loses nothing, and it is folded into `stances` the next
 * time the unit's stance or category is written. Nothing writes it any more.
 *
 * ## Which propositions take a stance
 *
 * Only those that make a claim of their own. `none` is where a category lands
 * that argues none of the study's points, and a study may keep a heading of the
 * same kind under its own name; such a heading is marked `claim: false` and
 * takes neither stances nor criteria. A stance towards a heading that claims
 * nothing could not be counted for anything.
 */

import { fail } from "./texts.js";

export const STANCES = ["supports", "contradicts"];

/** The fallback heading: what a category argues when it argues none of the study's points. */
export const NO_PROPOSITION = "none";

const bad = (key, params, status = 400) => Object.assign(fail(key, params), { status });

/** Whether a proposition makes a claim a unit can stand towards. */
export function hasClaim(id, proposition) {
  return Boolean(proposition) && id !== NO_PROPOSITION && proposition.claim !== false;
}

/**
 * For a category system, the proposition an older single `stance` speaks to,
 * by category: the category's own, when that one makes a claim; otherwise null.
 */
export function stanceTargets({ propositions, categories }) {
  const byCategory = new Map(categories.map((category) => [category.id, category.proposition ?? NO_PROPOSITION]));
  return (category) => {
    const proposition = byCategory.get(category) ?? NO_PROPOSITION;
    return hasClaim(proposition, propositions[proposition]) ? proposition : null;
  };
}

/** `stances` in the order every unit is written in: keys sorted, nothing empty. */
export function shapeStances(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value)
    .filter(([, stance]) => typeof stance === "string" && stance)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/**
 * A unit's stances as they count: what `stances` says, and an older `stance`
 * read as one towards the proposition of the unit's category — unless
 * `stances` already says something about that proposition, which is newer.
 */
export function effectiveStances(coding, targetOf) {
  const own = { ...(shapeStances(coding.stances) ?? {}) };
  if (STANCES.includes(coding.stance)) {
    const target = targetOf(coding.category);
    if (target && !(target in own)) own[target] = coding.stance;
  }
  return shapeStances(own) ?? {};
}

/**
 * `stances` as it arrives in a request, checked against the propositions.
 *
 * A key names a proposition that makes a claim; its value is `supports`,
 * `contradicts`, or `null` for no bearing. `null` for the whole field means no
 * bearing on anything. The answer is a patch: `null` for "clear all", else an
 * object whose `null` values remove that proposition's stance.
 */
export function checkedStancesPatch(value, propositions) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw bad("errorStancesShape");
  const patch = {};
  for (const [id, stance] of Object.entries(value)) {
    const proposition = propositions[id];
    if (!proposition) throw bad("errorUnknownProposition", undefined, 404);
    if (!hasClaim(id, proposition)) throw bad("errorStanceNoClaim", { name: proposition.name ?? id });
    if (stance === null || stance === "") patch[id] = null;
    else if (STANCES.includes(stance)) patch[id] = stance;
    else throw bad("errorStanceValue");
  }
  return patch;
}

/** The stances after a patch: `null` clears all, a `null` value clears one. */
export function patchedStances(current, patch) {
  if (patch === null) return undefined;
  const next = { ...(current ?? {}) };
  for (const [id, stance] of Object.entries(patch)) {
    if (stance === null) delete next[id];
    else next[id] = stance;
  }
  return shapeStances(next);
}
