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
 */

export function checkAnchors(transcript, codings) {
  const byNumber = new Map(transcript.turns.map((t) => [t.number, t]));
  let changed = false;

  const checked = codings.map((coding) => {
    const turn = byNumber.get(coding.turn);
    if (!turn) {
      return {
        ...coding,
        state: "lost",
        reason: `Beitrag ${coding.turn} steht nicht mehr im Transkript.`,
      };
    }

    if (turn.text.slice(coding.start, coding.end) === coding.text) {
      return { ...coding, state: "ok" };
    }

    const first = turn.text.indexOf(coding.text);
    const last = turn.text.lastIndexOf(coding.text);
    if (first >= 0 && first === last) {
      changed = true;
      return { ...coding, start: first, end: first + coding.text.length, state: "moved" };
    }

    return {
      ...coding,
      state: "lost",
      reason:
        first >= 0
          ? "Der Beleg steht mehrfach im Beitrag, die Stelle ist nicht mehr eindeutig."
          : "Der Beleg steht so nicht mehr im Beitrag.",
    };
  });

  return { codings: checked, changed };
}

/** Without the check marks, the way it belongs in the file. */
export function withoutCheckMarks(codings) {
  return codings.map(({ state, reason, ...rest }) => rest);
}
