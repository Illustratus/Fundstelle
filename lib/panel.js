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

/** One coding unit, as the evaluation surfaces cite it. */
function unitRef(transcript, coding) {
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
 */
export function personsIn(interviews, roundOf, round) {
  const persons = new Map();
  for (const { transcript, codings } of interviews) {
    if (roundOf(transcript.id) !== round) continue;
    const department = transcript.department;
    if (!persons.has(department)) persons.set(department, { department, interviews: [], units: [] });
    const person = persons.get(department);
    person.interviews.push(transcript.id);
    for (const coding of placed(codings)) person.units.push(unitRef(transcript, coding));
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
export function panelComparison({ interviews, roundOf, from, to, categories, only, blocks, sessions }) {
  const before = personsIn(interviews, roundOf, from);
  const after = personsIn(interviews, roundOf, to);
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

/**
 * How many persons a threshold asks for, out of `of`.
 *
 * `atLeast` is a number of persons. `fraction` is a share of the panel and is
 * rounded up — two thirds of five is four, not three and a third — in integer
 * arithmetic when written as `"2/3"`, so the boundary case is not left to a
 * float.
 */
export function required(threshold, of) {
  if (Number.isInteger(threshold?.atLeast)) return threshold.atLeast;
  const fraction = threshold?.fraction;
  if (typeof fraction === "string") {
    const [a, b] = fraction.split("/").map(Number);
    return Math.floor((a * of + b - 1) / b);
  }
  return Math.ceil(fraction * of - 1e-9);
}

/**
 * The criteria as they arrive, checked against what the study knows.
 *
 * `round` and every category must exist; the stance, when given, is one of the
 * two; the threshold is one of the two forms. Ids are kept when given and made
 * otherwise, so a criterion can be reworded and stay the same criterion.
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
    const ids = Array.isArray(criterion.categories) ? [...new Set(criterion.categories)] : [];
    if (!ids.length) throw fail("errorCriterionCategories", 400);
    if (ids.some((id) => !categoryIds.has(id))) throw fail("errorUnknownCategory", 404);
    if (criterion.stance != null && !["supports", "contradicts"].includes(criterion.stance)) {
      throw fail("errorCriterionStance", 400);
    }
    const threshold = criterion.threshold ?? {};
    let shaped;
    if (threshold.atLeast !== undefined && threshold.fraction === undefined) {
      if (!Number.isInteger(threshold.atLeast) || threshold.atLeast < 1) {
        throw fail("errorCriterionThreshold", 400);
      }
      shaped = { atLeast: threshold.atLeast };
    } else if (threshold.fraction !== undefined && threshold.atLeast === undefined) {
      const value = threshold.fraction;
      const parts = typeof value === "string" ? value.split("/").map((one) => one.trim()) : null;
      const ok = parts
        ? parts.length === 2 &&
          parts.every((one) => /^\d+$/.test(one)) &&
          Number(parts[0]) >= 1 &&
          Number(parts[0]) <= Number(parts[1])
        : typeof value === "number" && value > 0 && value <= 1;
      if (!ok) throw fail("errorCriterionThreshold", 400);
      shaped = { fraction: parts ? `${Number(parts[0])}/${Number(parts[1])}` : value };
    } else {
      throw fail("errorCriterionThreshold", 400);
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
      categories: ids,
      ...(criterion.stance ? { stance: criterion.stance } : {}),
      threshold: shaped,
    };
  });
}

/**
 * One criterion, counted in persons.
 *
 * A person meets it with at least one placed unit in one of its categories
 * that carries its stance (any unit, when the criterion names no stance). The
 * categories are taken as listed: a subcategory counts only when it is listed
 * itself, because a criterion that quietly widened itself would no longer be
 * the one that was registered.
 *
 * Everybody else in the round is a deviant case for this criterion and comes
 * back with what they did say in those categories, so the case can be written
 * up from its evidence rather than from its absence.
 */
export function evaluateCriterion(criterion, persons) {
  const inScope = (unit) => criterion.categories.includes(unit.category);
  const matches = (unit) => inScope(unit) && (!criterion.stance || unit.stance === criterion.stance);
  const meeting = [];
  const deviant = [];
  for (const person of persons) {
    const evidence = person.units.filter(matches);
    if (evidence.length) {
      meeting.push({ department: person.department, interviews: person.interviews, units: evidence });
    } else {
      deviant.push({
        department: person.department,
        interviews: person.interviews,
        units: person.units.filter(inScope),
      });
    }
  }
  const need = required(criterion.threshold, persons.length);
  return {
    ...criterion,
    persons: persons.length,
    required: need,
    count: meeting.length,
    met: persons.length > 0 && need > 0 && meeting.length >= need,
    unreviewed: meeting.reduce((n, one) => n + one.units.filter((unit) => !unit.reviewed).length, 0),
    meeting,
    deviant,
  };
}

/**
 * Every proposition with criteria, evaluated round by round.
 *
 * A verdict holds when every criterion of that verdict in the round is met.
 * `status` is `supported`, `falsified`, `both` — the registered criteria
 * contradict each other on this material, which is a finding and not an error —
 * or `open`. Which persons are deviant for the verdict that holds is listed with
 * it; when none holds, the per-criterion lists say it all.
 */
export function evaluatePropositions({ interviews, roundOf, propositions, onlyRound = null }) {
  const personsByRound = new Map();
  const persons = (round) => {
    if (!personsByRound.has(round)) personsByRound.set(round, personsIn(interviews, roundOf, round));
    return personsByRound.get(round);
  };

  const result = [];
  for (const [id, proposition] of Object.entries(propositions)) {
    const criteria = (proposition.criteria ?? []).filter(
      (one) => !onlyRound || one.round === onlyRound,
    );
    if (!criteria.length) continue;
    const evaluated = criteria.map((one) => evaluateCriterion(one, persons(one.round)));
    const rounds = [...new Set(evaluated.map((one) => one.round))].map((round) => {
      const here = evaluated.filter((one) => one.round === round);
      const holds = (verdict) => {
        const of = here.filter((one) => one.verdict === verdict);
        return of.length > 0 && of.every((one) => one.met);
      };
      const supported = holds("supported");
      const falsified = holds("falsified");
      const status = supported && falsified ? "both" : supported ? "supported" : falsified ? "falsified" : "open";
      const deviantFor = status === "supported" || status === "falsified" ? status : null;
      const deviant = new Map();
      for (const criterion of here.filter((one) => one.verdict === deviantFor)) {
        for (const person of criterion.deviant) {
          if (!deviant.has(person.department)) deviant.set(person.department, { ...person, units: [] });
          const kept = deviant.get(person.department);
          for (const unit of person.units) {
            if (!kept.units.some((one) => one.id === unit.id)) kept.units.push(unit);
          }
        }
      }
      const everybody = persons(round);
      return {
        round,
        status,
        persons: everybody.length,
        uncoded: everybody.filter((one) => !one.units.length).map((one) => one.department),
        deviant: [...deviant.values()],
      };
    });
    result.push({ id, name: proposition.name, color: proposition.color, rounds, criteria: evaluated });
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
export function tagReport({ interviews, roundOf, round, blocks }) {
  const items = guideItems(blocks);
  const byId = new Map(items.map((item) => [item.id, item]));
  const order = [];
  for (const item of items) if (item.tag && !order.includes(item.tag)) order.push(item.tag);

  const persons = personsIn(interviews, roundOf, round);
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
