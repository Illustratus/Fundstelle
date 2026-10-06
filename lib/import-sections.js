/**
 * The guide's sections at import, as the researcher reviews them.
 *
 * `placeSections` (session.js) puts each logged block start on a turn by one
 * rule. Two things in practice move that rule's answer away from the truth,
 * and both are for the researcher to correct before anything is written:
 *
 * - The recording's clock is not the log's. Teams starts recording a few
 *   seconds — sometimes a minute — after the interviewer pressed start, so
 *   every block lands that much too late in the recording. One offset for the
 *   whole import shifts every start by the same amount; it is applied here and
 *   stored nowhere unless the researcher saves it as a correction of `t0`.
 * - A single heading sits one turn off: the button was pressed while the
 *   interviewer was still finishing the previous topic. That is moved by hand,
 *   and what is written is then exactly the list the researcher looked at —
 *   handed in as `[{ block, before }]` rather than re-derived on the server.
 *
 * Nothing here guesses: an explicit list is checked, not repaired.
 */

import { fail } from "./texts.js";

const bad = (key, params, status = 400) => Object.assign(fail(key, params), { status });

const tenth = (value) => Math.round(value * 10) / 10;

/** The offset of a request, in seconds; absent means none. */
export function readOffset(value) {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw bad("errorTimeShape", { value: String(value) });
  }
  return value;
}

/** The log with every block start moved by `offset` seconds; untimed stays untimed. */
export function shiftedSession(session, offset) {
  if (!offset) return session;
  return {
    ...session,
    blockStarts: session.blockStarts.map((one) => ({
      ...one,
      at: one.at === null || one.at === undefined ? one.at : tenth(one.at + offset),
    })),
  };
}

/**
 * The sections the researcher chose, checked against the guide and the turns.
 *
 * `list` is `[{ block, before, at? }]`: the block of the round's guide, the
 * index of the turn its heading goes in front of, and optionally the second it
 * was logged at (only reported back). Returned in the shape `placeSections`
 * answers with, ordered by turn and, at the same turn, as given.
 */
export function chosenSections(list, turns, blocks) {
  if (!Array.isArray(list)) throw bad("errorSectionList");
  const names = new Map(blocks.map((block) => [block.id, block.name]));
  const placed = list.map((entry, order) => {
    if (!entry || typeof entry !== "object") throw bad("errorSectionList");
    const name = names.get(entry.block);
    if (!name) throw bad("errorUnknownBlock", undefined, 404);
    const { before } = entry;
    if (!Number.isInteger(before) || before < 0 || before >= turns.length) {
      throw bad("errorSectionList");
    }
    const at = typeof entry.at === "number" && Number.isFinite(entry.at) ? entry.at : null;
    return {
      block: entry.block,
      name,
      at,
      before,
      turn: before + 1,
      turnAt: turns[before].at ?? null,
      order,
    };
  });
  placed.sort((a, b) => a.before - b.before || a.order - b.order);
  return placed.map(({ order, ...rest }) => rest);
}

/**
 * The placement an import reports when the researcher chose the sections:
 * what was chosen, and of what the rule could not place, whatever the
 * researcher left out.
 */
export function chosenPlacement(automatic, chosen) {
  const named = new Set(chosen.map((one) => one.block));
  return {
    placed: chosen,
    unplaced: automatic.unplaced.filter((one) => !named.has(one.block)),
  };
}

/**
 * Every turn, short, for the review: enough to see where a heading falls and
 * whose turn opens it, not the transcript itself.
 */
export function timelineOf(turns) {
  return turns.map((turn) => ({
    speaker: turn.speaker ?? null,
    at: turn.at ?? null,
    text: turn.text.length > 160 ? `${turn.text.slice(0, 159)}…` : turn.text,
  }));
}
