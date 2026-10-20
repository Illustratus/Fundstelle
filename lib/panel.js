/**
 * The same people asked twice, compared.
 *
 * A second round with the persons of the first is a panel, and its unit is the
 * person — here the department, which is what the transcript header names and
 * what every figure of the tool is already cut by. Three things are computed
 * here, all of them pure functions of loaded interviews and the study:
 *
 * - the **panel comparison**: per category and department, what was said in one
 *   round and what in the other, as text beside text rather than as a count
 *   alone — a count is where the comparison starts, not what it is;
 * - the **criteria** a study pre-registered for its propositions, counted in
 *   persons and not in statements: four people saying a thing once is evidence
 *   from four people, one person saying it four times is evidence from one;
 * - the **report by guide question**: coding units grouped by the tag of the
 *   guide question they answer, which is how acceptance constructs are
 *   reported without inventing categories for them.
 *
 * ## What is never shown
 *
 * A department that took part in one round and not in the other. The panel is
 * the departments present in both; who is missing is something the researcher
 * says in their own words or not at all, and an export that lists the
 * difference would say it for them.
 */

import { placed } from "./analysis.js";
import { guideItems } from "./rounds.js";
import { READOUT_STATES } from "./session.js";
import { STANCES, effectiveStances, hasClaim } from "./stances.js";

const NO_TARGET = () => null;

/**
 * One coding unit, as the evaluation surfaces cite it. `stances` is what
 * counts — the unit's stances per proposition, an older single `stance` read
 * into it (`stances.js`); `stance` is that older field as it is stored.
 */
function unitRef(transcript, coding, targetOf = NO_TARGET) {
  const turn = transcript.turns.find((one) => one.number === coding.turn);
  return {
    id: coding.id,
    interview: transcript.id,
    turn: coding.turn,
    time: turn?.time ?? null,
    section: turn?.section != null ? (transcript.sections[turn.section]?.name ?? null) : null,
    category: coding.category,
    text: coding.text,
    stance: coding.stance ?? null,
    stances: effectiveStances(coding, targetOf),
    question: coding.question ?? null,
    reviewed: coding.reviewed === true,
    anchor: Boolean(coding.anchor),
    memo: coding.memo ?? "",
  };
}

/**
 * The persons of one round: departments, in reading order, each with the
 * interviews and the placed units that belong to them. Two interviews of the
 * same department in one round are one person asked twice, and count once.
 * `targetOf` reads an older single stance (`stanceTargets` in `stances.js`).
 */
export function personsIn(interviews, roundOf, round, targetOf = NO_TARGET) {
  const persons = new Map();
  for (const { transcript, codings } of interviews) {
    if (roundOf(transcript.id) !== round) continue;
    const department = transcript.department;
    if (!persons.has(department)) persons.set(department, { department, interviews: [], units: [] });
    const person = persons.get(department);
    person.interviews.push(transcript.id);
    for (const coding of placed(codings)) person.units.push(unitRef(transcript, coding, targetOf));
  }
  return [...persons.values()];
}

/* The panel comparison ----------------------------------------------------- */

/**
 * Per category and department, the two rounds side by side.
 *
 * `readout` comes from the guide of the later round: the list read out to each
 * department and, from that department's interview log, which entries are
 * still searched by hand. Listed counts what was named in the first round;
 * `still` what is still searched; `open` what was not asked or not marked —
 * never counted as either.
 */
export function panelComparison({ interviews, roundOf, from, to, categories, only, blocks, sessions, targetOf }) {
  const before = personsIn(interviews, roundOf, from, targetOf);
  const after = personsIn(interviews, roundOf, to, targetOf);
  const afterBy = new Map(after.map((one) => [one.department, one]));
  const panel = before.filter((one) => afterBy.has(one.department));
  const departments = panel.map((one) => one.department);

  const wanted = only ? categories.filter((one) => one.id === only) : categories;
  const rows = wanted.map((category) => ({
    category: category.id,
    name: category.name,
    parent: category.parent ?? null,
    proposition: category.proposition,
    cells: panel.map((person) => {
      const earlier = person.units.filter((unit) => unit.category === category.id);
      const later = afterBy.get(person.department).units.filter((unit) => unit.category === category.id);
      return {
        department: person.department,
        from: { count: earlier.length, units: earlier },
        to: { count: later.length, units: later },
      };
    }),
  }));

  const readout = [];
  for (const block of blocks.filter((one) => one.readout)) {
    for (const person of panel) {
      const listed = block.readout.perDepartment[person.department];
      if (!listed) continue;
      const interview = afterBy.get(person.department).interviews.find((id) => sessions.has(id));
      const states = interview ? (sessions.get(interview).readout[block.id] ?? {}) : {};
      const items = listed.map((item) => ({ item, state: states[item] ?? null }));
      readout.push({
        department: person.department,
        interview: interview ?? null,
        block: block.id,
        label: block.readout.label,
        listed: listed.length,
        still: items.filter((one) => one.state === "still").length,
        noLonger: items.filter((one) => one.state === "no-longer").length,
        open: items.filter((one) => !READOUT_STATES.includes(one.state)).length,
        items,
      });
    }
  }

  return {
    from,
    to,
    departments,
    persons: {
      from: panel.map(({ department, interviews: ids }) => ({ department, interviews: ids })),
      to: departments.map((department) => ({
        department,
        interviews: afterBy.get(department).interviews,
      })),
    },
    categories: rows,
    readout,
  };
}

/* Pre-registered criteria -------------------------------------------------- */

export const VERDICTS = ["supported", "falsified"];

/** How a criterion is decided: counted by the tool, or read by the researcher. */
export const KINDS = ["count", "manual"];

/** Whom a criterion counts among: every person of the round, or those it can be checked with. */
export const BASES = ["all", "testable"];

/** How the criteria of one verdict combine: all of them, or any one. */
export const COMBINES = ["all", "any"];

const OPPOSITE = { supports: "contradicts", contradicts: "supports" };

/**
 * How many persons a threshold asks for, out of `of`.
 *
 * `atLeast` is a number of persons. `fraction` is a share of the base and is
 * rounded up — two thirds of five is four, not three and a third — in integer
 * arithmetic when written as `"2/3"`, so the boundary case is not left to a
 * float. `none` asks for nobody: the criterion holds while no person meets the
 * condition ("nobody names …").
 */
export function required(threshold, of) {
  if (threshold?.none === true) return 0;
  if (Number.isInteger(threshold?.atLeast)) return threshold.atLeast;
  const fraction = threshold?.fraction;
  if (typeof fraction === "string") {
    const [a, b] = fraction.split("/").map(Number);
    return Math.floor((a * of + b - 1) / b);
  }
  return Math.ceil(fraction * of - 1e-9);
}

function checkedThreshold(threshold, fail) {
  const value = threshold ?? {};
  const keys = Object.keys(value).filter((key) => value[key] !== undefined);
  if (keys.length !== 1) throw fail("errorCriterionThreshold", 400);
  if (keys[0] === "atLeast") {
    if (!Number.isInteger(value.atLeast) || value.atLeast < 1) throw fail("errorCriterionThreshold", 400);
    return { atLeast: value.atLeast };
  }
  if (keys[0] === "fraction") {
    const parts = typeof value.fraction === "string" ? value.fraction.split("/").map((one) => one.trim()) : null;
    const ok = parts
      ? parts.length === 2 &&
        parts.every((one) => /^\d+$/.test(one)) &&
        Number(parts[0]) >= 1 &&
        Number(parts[0]) <= Number(parts[1])
      : typeof value.fraction === "number" && value.fraction > 0 && value.fraction <= 1;
    if (!ok) throw fail("errorCriterionThreshold", 400);
    return { fraction: parts ? `${Number(parts[0])}/${Number(parts[1])}` : value.fraction };
  }
  if (keys[0] === "none" && value.none === true) return { none: true };
  throw fail("errorCriterionThreshold", 400);
}

/**
 * The criteria as they arrive, checked against what the study knows.
 *
 * A criterion belongs to one proposition and counts persons by their stance
 * *towards that proposition*, from whichever category the unit was coded in.
 * `round` must exist. `stance`, when given, is one of the two; `categories`,
 * when given, narrows the units to those categories and must name existing
 * ones; a counted criterion needs at least one of the two, or it would count
 * everybody who said anything. `base` is `all` (default) or `testable`.
 *
 * A counted criterion has a threshold — `{ atLeast }`, `{ fraction }` or
 * `{ none: true }`. A criterion `kind: "manual"` has none: it stands for a
 * condition the tool cannot decide (a count from the commit history, "the
 * cause named most often"), shows its wording and the evidence its stance and
 * categories select, and is never met or unmet by the tool.
 *
 * Ids are kept when given and made otherwise, so a criterion can be reworded
 * and stay the same criterion. What is written follows one order, and a
 * default is not written, so a criterion of version 0.12 reads back as it was.
 */
export function checkedCriteria(list, { rounds, categories, fail }) {
  if (!Array.isArray(list)) throw fail("errorCriteriaList", 400);
  const roundIds = new Set(rounds.map((one) => one.id));
  const categoryIds = new Set(categories.map((one) => one.id));
  const taken = new Set();
  return list.map((raw, index) => {
    const criterion = raw ?? {};
    if (!VERDICTS.includes(criterion.verdict)) throw fail("errorCriterionVerdict", 400);
    if (!criterion.round) throw fail("errorCriterionRound", 400);
    if (!roundIds.has(criterion.round)) throw fail("errorUnknownRound", 404);
    if (criterion.kind != null && !KINDS.includes(criterion.kind)) throw fail("errorCriterionKind", 400);
    const manual = criterion.kind === "manual";
    if (criterion.categories != null && !Array.isArray(criterion.categories)) {
      throw fail("errorCriterionCategories", 400);
    }
    const ids = [...new Set(criterion.categories ?? [])];
    if (ids.some((id) => !categoryIds.has(id))) throw fail("errorUnknownCategory", 404);
    if (criterion.stance != null && criterion.stance !== "" && !STANCES.includes(criterion.stance)) {
      throw fail("errorCriterionStance", 400);
    }
    const stance = criterion.stance || undefined;
    if (criterion.base != null && !BASES.includes(criterion.base)) throw fail("errorCriterionBase", 400);
    if (!manual && !stance && !ids.length) throw fail("errorCriterionCategories", 400);
    let threshold;
    if (manual) {
      if (criterion.threshold != null && Object.keys(criterion.threshold).length) {
        throw fail("errorCriterionManualThreshold", 400);
      }
    } else {
      threshold = checkedThreshold(criterion.threshold, fail);
    }
    let id = String(criterion.id ?? "").trim();
    if (!id || taken.has(id)) id = `${criterion.verdict}-${index + 1}`;
    while (taken.has(id)) id = `${id}-x`;
    taken.add(id);
    const text = String(criterion.text ?? "").trim();
    return {
      id,
      ...(text ? { text } : {}),
      verdict: criterion.verdict,
      round: criterion.round,
      ...(manual ? { kind: "manual" } : {}),
      ...(ids.length ? { categories: ids } : {}),
      ...(stance ? { stance } : {}),
      ...(criterion.base === "testable" ? { base: "testable" } : {}),
      ...(threshold ? { threshold } : {}),
    };
  });
}

/**
 * One criterion, counted in persons.
 *
 * A person meets it with at least one placed unit that carries the stance it
 * asks for towards `proposition` — from any category, unless the criterion
 * names categories, which are then taken as listed: a subcategory counts only
 * when it is listed itself, because a criterion that quietly widened itself
 * would no longer be the one that was registered. How often a person said it
 * does not matter. A person with units of both stances meets a criterion of
 * either; that is shown (`opposite`) and not settled here.
 *
 * The base is every person of the round, or, for `base: "testable"`, those
 * not marked as not checkable for this proposition (`untestable`, department →
 * reason); who was left out comes back with the reason.
 *
 * Everybody in the base who does not meet it comes back with what they did
 * say that bears on it — in its categories, or with any stance towards the
 * proposition — so the case can be written up from its evidence rather than
 * from its absence.
 */
export function evaluateCriterion(criterion, persons, { proposition = null, untestable = {} } = {}) {
  const filter = criterion.categories?.length ? new Set(criterion.categories) : null;
  const inCategories = (unit) => !filter || filter.has(unit.category);
  const stanceOf = (unit) => unit.stances?.[proposition] ?? null;
  const matches = (unit) => inCategories(unit) && (!criterion.stance || stanceOf(unit) === criterion.stance);
  const bearing = (unit) => inCategories(unit) && (filter ? true : stanceOf(unit) !== null);

  const excluded = criterion.base === "testable"
    ? persons.filter((person) => untestable[person.department] != null)
    : [];
  const base = persons.filter((person) => !excluded.includes(person));
  const manual = criterion.kind === "manual";
  // A criterion by hand that names neither stance nor category — a count from
  // the commit history, say — selects no evidence from the interviews at all.
  const selects = Boolean(criterion.stance || filter);
  const meeting = [];
  const deviant = [];
  for (const person of selects ? base : []) {
    const evidence = person.units.filter(matches);
    const who = { department: person.department, interviews: person.interviews };
    if (evidence.length) {
      const opposite = criterion.stance
        ? person.units.filter((unit) => inCategories(unit) && stanceOf(unit) === OPPOSITE[criterion.stance])
        : [];
      meeting.push({ ...who, units: evidence, ...(opposite.length ? { opposite } : {}) });
    } else {
      deviant.push({ ...who, units: person.units.filter(bearing) });
    }
  }
  const need = manual ? null : required(criterion.threshold, base.length);
  let met = null;
  if (!manual) {
    met = criterion.threshold?.none
      ? base.length > 0 && meeting.length === 0
      : base.length > 0 && need > 0 && meeting.length >= need;
  }
  return {
    ...criterion,
    persons: base.length,
    required: need,
    count: selects ? meeting.length : null,
    met,
    unreviewed: meeting.reduce((n, one) => n + one.units.filter((unit) => !unit.reviewed).length, 0),
    meeting,
    deviant,
    untestable: excluded.map((person) => ({
      department: person.department,
      interviews: person.interviews,
      reason: untestable[person.department],
    })),
  };
}

/**
 * Whether the criteria of one verdict hold together: `true`, `false`, or
 * `null` while it hangs on a criterion only the researcher can decide. With
 * `all`, one unmet criterion settles it and an open one keeps it open; with
 * `any`, one met criterion settles it. A verdict without criteria never holds.
 */
function verdictHolds(criteria, combine) {
  if (!criteria.length) return false;
  const values = criteria.map((one) => one.met);
  if (combine === "any") return values.includes(true) ? true : values.includes(null) ? null : false;
  return values.includes(false) ? false : values.includes(null) ? null : true;
}

/**
 * Every proposition that makes a claim, evaluated round by round.
 *
 * The rounds are every round after the first — the ones a stance is given in
 * — and any other round the proposition has criteria, stances or exclusions
 * in; `onlyRound` keeps one of them. Per round:
 *
 * - `tally`: who supports, who contradicts, who neither, in persons;
 * - `split`: persons with units of both stances. They count for both, and
 *   because a contradiction weighs more than a support they are listed with
 *   the deviant cases whatever the status says;
 * - `untestable`: who the proposition cannot be checked with, and why;
 * - `status`: `supported`, `falsified`, `both` — the registered criteria
 *   contradict each other on this material, which is a finding and not an
 *   error — or `open`, with `pending` naming the verdicts that hang on a
 *   criterion decided by hand. Shown, never settled here.
 */
export function evaluatePropositions({
  interviews,
  roundOf,
  propositions,
  rounds = [],
  targetOf = NO_TARGET,
  untestableOf = () => ({}),
  onlyRound = null,
}) {
  const personsByRound = new Map();
  const persons = (round) => {
    if (!personsByRound.has(round)) personsByRound.set(round, personsIn(interviews, roundOf, round, targetOf));
    return personsByRound.get(round);
  };
  const roundIds = rounds.map((one) => one.id);

  const result = [];
  for (const [id, proposition] of Object.entries(propositions)) {
    if (!hasClaim(id, proposition)) continue;
    const all = proposition.criteria ?? [];
    const stancesIn = (round) =>
      persons(round).some((person) => person.units.some((unit) => unit.stances?.[id]));
    const wanted = [...new Set([...roundIds, ...all.map((one) => one.round)])].filter(
      (round) =>
        (!onlyRound || round === onlyRound) &&
        (roundIds.indexOf(round) > 0 ||
          all.some((one) => one.round === round) ||
          Object.keys(untestableOf(round, id)).length > 0 ||
          stancesIn(round)),
    );
    if (!wanted.length) continue;

    const evaluated = all
      .filter((one) => wanted.includes(one.round))
      .map((one) => evaluateCriterion(one, persons(one.round), { proposition: id, untestable: untestableOf(one.round, id) }));

    const combine = {
      supported: proposition.combine?.supported === "any" ? "any" : "all",
      falsified: proposition.combine?.falsified === "any" ? "any" : "all",
    };
    const perRound = wanted.map((round) => {
      const here = evaluated.filter((one) => one.round === round);
      const supported = verdictHolds(here.filter((one) => one.verdict === "supported"), combine.supported);
      const falsified = verdictHolds(here.filter((one) => one.verdict === "falsified"), combine.falsified);
      const status =
        supported === true && falsified === true
          ? "both"
          : supported === true
            ? "supported"
            : falsified === true
              ? "falsified"
              : "open";
      const pending = VERDICTS.filter((verdict) => (verdict === "supported" ? supported : falsified) === null);

      // Deviant for the verdict that holds: who does not meet its met criteria.
      const deviantFor = status === "supported" || status === "falsified" ? status : null;
      const deviant = new Map();
      for (const criterion of here.filter((one) => one.verdict === deviantFor && one.met === true && !one.threshold?.none)) {
        for (const person of criterion.deviant) {
          if (!deviant.has(person.department)) deviant.set(person.department, { ...person, units: [] });
          const kept = deviant.get(person.department);
          for (const unit of person.units) {
            if (!kept.units.some((one) => one.id === unit.id)) kept.units.push(unit);
          }
        }
      }

      const everybody = persons(round);
      const excluded = untestableOf(round, id);
      const departments = new Set(everybody.map((one) => one.department));
      const tally = { supports: [], contradicts: [], neither: [] };
      const split = [];
      for (const person of everybody) {
        const by = (stance) => person.units.filter((unit) => unit.stances?.[id] === stance);
        const supports = by("supports");
        const contradicts = by("contradicts");
        if (supports.length) tally.supports.push(person.department);
        if (contradicts.length) tally.contradicts.push(person.department);
        if (!supports.length && !contradicts.length) tally.neither.push(person.department);
        if (supports.length && contradicts.length) {
          split.push({ department: person.department, interviews: person.interviews, supports, contradicts });
        }
      }
      return {
        round,
        status,
        verdicts: { supported, falsified },
        pending,
        combine,
        persons: everybody.length,
        testable: everybody.filter((one) => excluded[one.department] == null).length,
        tally,
        split,
        untestable: Object.entries(excluded).map(([department, reason]) => ({
          department,
          reason,
          // A department marked once that is no longer a person of the round.
          present: departments.has(department),
        })),
        uncoded: everybody.filter((one) => !one.units.length).map((one) => one.department),
        deviant: [...deviant.values()],
      };
    });
    result.push({
      id,
      name: proposition.name,
      color: proposition.color,
      combine,
      rounds: perRound,
      criteria: evaluated,
    });
  }
  return result;
}

/* By guide question -------------------------------------------------------- */

/**
 * Coding units grouped by the tag of the guide question they were assigned to.
 *
 * Which question a unit answers is said by the researcher on the unit
 * (`question`), not worked out from timing: the log knows when a box was
 * ticked, not which sentence answered it. Units of the round without a
 * question are counted, so the report says how much of the round it covers.
 * Tags come in the order the guide first uses them.
 */
export function tagReport({ interviews, roundOf, round, blocks, targetOf }) {
  const items = guideItems(blocks);
  const byId = new Map(items.map((item) => [item.id, item]));
  const order = [];
  for (const item of items) if (item.tag && !order.includes(item.tag)) order.push(item.tag);

  const persons = personsIn(interviews, roundOf, round, targetOf);
  const groups = new Map(order.map((tag) => [tag, []]));
  const untagged = [];
  const unknown = [];
  let unassigned = 0;
  for (const person of persons) {
    for (const unit of person.units) {
      if (!unit.question) {
        unassigned += 1;
        continue;
      }
      const item = byId.get(unit.question);
      const entry = { ...unit, department: person.department };
      if (!item) unknown.push(entry);
      else if (item.tag) groups.get(item.tag).push(entry);
      else untagged.push(entry);
    }
  }
  const summary = (units) => ({
    departments: new Set(units.map((unit) => unit.department)).size,
    units,
  });
  return {
    round,
    persons: persons.length,
    tags: order.map((tag) => ({
      tag,
      items: items.filter((item) => item.tag === tag),
      ...summary(groups.get(tag)),
    })),
    untagged: { items: items.filter((item) => !item.tag), ...summary(untagged) },
    unknownQuestion: unknown,
    unassigned,
  };
}
