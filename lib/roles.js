/**
 * The role profiles, and what they are made of.
 *
 * A requirement is built here, in the tool: coding units are assigned to it and
 * the catalog counts what came of that. A role profile is not. It is written
 * while reading the citations of a department — what its work is, what it files,
 * what it retrieves, what it hands over and in which shape it wants what it
 * receives — and that reading is prose, kept in the study's own file.
 *
 * What the file cannot do is answer for itself. It cannot say how much evidence
 * a pillar rests on, and it cannot say the thing that decides whether a profile
 * may be trusted at all: whose voice it is written from. A profile assembled
 * only out of what a department says about itself is a self-portrait; one that
 * carries other departments' statements about it has a second source. Two of
 * the six were never interviewed, so their profile is nothing *but* other
 * people's statements — which is a finding as long as it is visible, and a
 * silent weakness as soon as it is not.
 *
 * So this module joins the file to the material: every locator becomes a turn
 * of a transcript the tool already holds, with the department that spoke it and
 * the text it says, and the counting follows from that rather than from the
 * paraphrase. A locator that points at a turn nobody spoke is reported, not
 * quietly dropped — that is the one error the prose can make that no reader of
 * the chapter would ever catch.
 */

import { translator } from "./texts.js";

/* The pillars a profile stands on, in the order it is written in. The same
   shape as the blocked operations: the id is what a file stores, the name is
   looked up in the language the study is set up in — and once a file exists it
   carries its own wording, because renaming a pillar is the study's business
   and not the tool's. */
export const PILLARS = [
  { id: "tasks", key: "pillarTasks" },
  { id: "filing", key: "pillarFiling" },
  { id: "retrieval", key: "pillarRetrieval" },
  { id: "transfer", key: "pillarTransfer" },
  { id: "structure", key: "pillarStructure" },
];

export function seededPillars(language) {
  const t = translator(language);
  return PILLARS.map(({ id, key }) => ({ id, name: t(key) }));
}

/** The citation markers of the study's own chapter, out of a paraphrase. */
const MARKER = /\s*\[?@[\w-]+\{[^}]*\}\]?/g;

/**
 * A paraphrase as it reads.
 *
 * The stored text keeps its citation markers, so the chapter can be written
 * back from the file without loss. On screen they are noise: the citations are
 * listed under the sentence anyway, each one a button into the transcript,
 * which is more than a bracketed key ever told a reader.
 */
export const reading = (text) =>
  String(text ?? "")
    .replace(MARKER, "")
    .replace(/\s+([,.;])/g, "$1")
    .trim();

/**
 * The profiles, joined to the material.
 *
 * Every citation is resolved against the transcripts: the department that spoke
 * the turn, the time it was spoken at, and the text itself. `self` is the one
 * derived field the figures live off — whether the statement comes from the
 * department the profile is about or from another one.
 */
export function roleProfiles(interviews, roles, pillars) {
  const transcripts = new Map(
    interviews.map(({ transcript }) => [
      transcript.id,
      { transcript, turns: new Map(transcript.turns.map((turn) => [turn.number, turn])) },
    ]),
  );
  const order = pillars.map((pillar) => pillar.id);

  return roles.map((role) => {
    const entries = (role.entries ?? []).map((entry) => {
      const citations = (entry.citations ?? []).flatMap((citation) => {
        const source = transcripts.get(citation.interview);
        return (citation.turns ?? []).map((turn) => ({
          interview: citation.interview,
          department: source?.transcript.department ?? citation.interview,
          turn,
          time: source?.turns.get(turn)?.time ?? null,
          text: source?.turns.get(turn)?.text ?? "",
          // A locator the transcripts do not have. Kept and marked rather than
          // dropped: a piece of evidence that is not there is the finding, and
          // a profile that quietly counts one fewer says nothing about why.
          missing: !source?.turns.has(turn),
          self: citation.interview === role.interview,
        }));
      });
      return { ...entry, reading: reading(entry.text), citations };
    });

    entries.sort(
      (a, b) => order.indexOf(a.pillar) - order.indexOf(b.pillar),
    );

    const evidence = entries.flatMap((entry) => entry.citations);
    const under = (id) => entries.filter((entry) => entry.pillar === id);

    return {
      ...role,
      entries,
      open: (role.open ?? []).filter((id) => order.includes(id)),
      departments: [...new Set(evidence.map((one) => one.department))].sort((a, b) =>
        a.localeCompare(b, "de"),
      ),
      evidence: evidence.length,
      own: evidence.filter((one) => one.self).length,
      others: evidence.filter((one) => !one.self).length,
      missing: evidence.filter((one) => one.missing).length,
      pillars: pillars.map((pillar) => ({
        id: pillar.id,
        name: pillar.name,
        entries: under(pillar.id).length,
        evidence: under(pillar.id).flatMap((entry) => entry.citations).length,
        open: (role.open ?? []).includes(pillar.id),
      })),
    };
  });
}

/**
 * Who speaks about whom, as a matrix.
 *
 * Rows are the profiles, columns the departments that were interviewed, cells
 * the pieces of evidence. The diagonal is the self-portrait; everything off it
 * is the second source. Drawn as bars in the interface, but counted here so
 * that the figure, the table under it and the export cannot disagree.
 */
export function voices(profiles, departments) {
  return profiles.map((role) => ({
    name: role.name,
    values: departments.map(
      (department) =>
        role.entries.flatMap((entry) => entry.citations).filter((one) => one.department === department)
          .length,
    ),
    sum: role.evidence,
  }));
}

/**
 * What each pillar rests on, by the department that said it.
 *
 * The question the chapter has to answer before a profile may be used: a pillar
 * carried by two pieces of evidence is a guess written in the shape of a
 * finding, and until this is counted nobody can see which ones those are.
 */
export function pillarEvidence(profiles, pillars, departments) {
  return pillars.map((pillar) => {
    const citations = profiles.flatMap((role) =>
      role.entries.filter((entry) => entry.pillar === pillar.id).flatMap((entry) => entry.citations),
    );
    return {
      name: pillar.name,
      values: departments.map(
        (department) => citations.filter((one) => one.department === department).length,
      ),
      sum: citations.length,
      // How many of the six profiles say nothing at all under this pillar.
      open: profiles.filter((role) => role.open.includes(pillar.id)).length,
    };
  });
}

/**
 * The profiles as the chapter writes them.
 *
 * The way back: the section in the study's document was the source of this
 * file, and once the file is the thing that is maintained the document has to
 * be able to come out of it again — verbatim, citation markers and all, which
 * is why the paraphrase is stored the way it was written.
 */
export function roleProfilesMarkdown(profiles, pillars, language) {
  const t = translator(language);
  const lines = [];
  for (const role of profiles) {
    lines.push(`**${role.name}**`, "");
    for (const pillar of pillars) {
      const entries = role.entries.filter((entry) => entry.pillar === pillar.id);
      if (!entries.length) {
        lines.push(`- *${pillar.name}:* ${t("roleProfileOpen")}`);
        continue;
      }
      lines.push(`- *${pillar.name}:*`);
      for (const entry of entries) lines.push(`  - ${entry.text}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
