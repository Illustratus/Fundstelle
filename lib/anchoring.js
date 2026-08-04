/**
 * Checks whether the coding units still sit where they were filed.
 *
 * A coding holds its place through the turn number and a character range. When
 * the transcript is corrected — a recognition error fixed, say — every position
 * behind the edit shifts. Without this check the tool would render the
 * highlight over the wrong passage without anyone noticing, which is the worst
 * outcome: the paper would then claim a location that does not carry what it
 * says it carries.
 *
 * The stored citation text is the counter-check. Found exactly once in the
 * turn, the position is moved silently; that case is unambiguous and needs no
 * decision. Found nowhere or more than once, the coding stays flagged as lost
 * and is not displayed until it has been re-anchored by hand.
 *
 * A move must not land on top of a neighbour. Exactly one category per place is
 * a rule the store keeps on every write, and a correction to the transcript is
 * no reason to break it: an edit can pull one citation back across another that
 * still matches where it always sat. Such a move is refused and the unit is
 * handed over for re-anchoring — the same answer this file gives to every other
 * case it cannot settle on its own.
 *
 * The reasons are named rather than worded, because whoever asked is the one
 * who knows which language to answer in.
 */

function overlaps(a, b) {
  return a.turn === b.turn && a.start < b.end && b.start < a.end;
}

export function checkAnchors(transcript, codings) {
  const byNumber = new Map(transcript.turns.map((t) => [t.number, t]));

  // First pass: where does each unit want to be?
  const wanted = codings.map((coding) => {
    const turn = byNumber.get(coding.turn);
    if (!turn) {
      return { ...coding, state: "lost", reasonKey: "anchorTurnGone", reasonParams: { turn: coding.turn } };
    }

    if (turn.text.slice(coding.start, coding.end) === coding.text) {
      return { ...coding, state: "ok" };
    }

    const first = turn.text.indexOf(coding.text);
    const last = turn.text.lastIndexOf(coding.text);
    if (first >= 0 && first === last) {
      return { ...coding, start: first, end: first + coding.text.length, state: "moved" };
    }

    return {
      ...coding,
      state: "lost",
      reasonKey: first >= 0 ? "anchorAmbiguous" : "anchorNotFound",
    };
  });

  // Second pass: a unit that still sits where it was filed holds its ground; a
  // move that would run into one is refused rather than allowed to double up.
  const settled = wanted.map((coding) => {
    if (coding.state !== "moved") return coding;
    const collides = wanted.some(
      (other) => other.id !== coding.id && other.state !== "lost" && overlaps(coding, other),
    );
    if (!collides) return coding;
    const original = codings.find((one) => one.id === coding.id);
    return {
      ...original,
      state: "lost",
      reasonKey: "anchorWouldOverlap",
    };
  });

  return { codings: settled, changed: settled.some((coding) => coding.state === "moved") };
}

/** Without the check marks, the way it belongs in the file. */
export function withoutCheckMarks(codings) {
  return codings.map(({ state, reason, reasonKey, reasonParams, ...rest }) => rest);
}

/** The named reasons put into the language of whoever asked. */
export function withReasons(codings, t) {
  return codings.map(({ reasonKey, reasonParams, ...coding }) =>
    reasonKey ? { ...coding, reason: t(reasonKey, reasonParams) } : coding,
  );
}
