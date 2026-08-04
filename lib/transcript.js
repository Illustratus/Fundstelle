/**
 * Reads the pseudonymized final transcripts.
 *
 * The structure of the file is the contract between whatever produced the
 * transcript and this tool: `## Section: …` opens a guide section and
 * `**7 · Speaker [3:18]**` a speaker turn. The turn number is the citable
 * location and stays fixed even when turns were merged during editing. Gaps in
 * the numbering are therefore allowed and not an error.
 *
 * `## Erzählanstoß:` is accepted as an equivalent of `## Section:` because the
 * tool grew up on German transcripts and those files must keep working.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const SECTION = /^##\s+(?:Section|Erzählanstoß):\s*(.+?)\s*$/;
const TURN = /^\*\*(\d+)\s*·\s*(.+?)\s*\[(\d+:\d{2})\]\*\*\s*$/;
const TITLE = /^#\s+(.+?)\s*$/;
const META = /^-\s+([^:]+):\s*(.+?)\s*$/;

const INTERVIEWER = "Interviewer";

/** Section names carry a leading number in the guide: „1 · Filing (…)". */
function shortSectionName(name) {
  const match = name.match(/^(\d+)\s*·\s*(.+)$/);
  if (!match) return { number: null, short: name.replace(/\s*\(.*\)$/, "") };
  return { number: Number(match[1]), short: match[2].replace(/\s*\(.*\)$/, "") };
}

/**
 * A line that was meant to be a speaker turn but did not come out as one.
 *
 * `**7 · Sales**` without a timestamp, a stray bold line, a number written out:
 * the strict form is what keeps a citation citable, so these are not guessed
 * at. But they used to fall through in silence and take their text with them —
 * an interview that came out empty with nothing said about why. Anything shaped
 * like a turn header is now reported instead.
 */
const TURN_SHAPED = /^\*\*.*·.*\*\*\s*$/;

/**
 * A line that begins something else, and therefore ends the turn before it.
 *
 * A turn used to run to the next blank line, so an answer written in two
 * paragraphs lost everything after the first — silently, which is the part that
 * mattered: the text was gone from the reading surface, from the search and
 * from every count, and nothing said so. It now runs until something else
 * starts: the next turn, a heading, or a rule across the page.
 */
const BREAK = /^(?:#{1,6}\s|\*{3,}\s*$|-{3,}\s*$|_{3,}\s*$)/;

const beginsSomethingElse = (line) => TURN.test(line) || BREAK.test(line);

export function parseTranscript(text, id) {
  const lines = text.split("\n");
  const meta = {};
  let title = null;
  const sections = [];
  const turns = [];
  const problems = [];
  let inHeader = true;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (inHeader) {
      if (!title) {
        const found = line.match(TITLE);
        if (found) {
          title = found[1];
          continue;
        }
      }
      const entry = line.match(META);
      if (entry) {
        meta[entry[1].trim()] = entry[2].trim();
        continue;
      }
    }

    const section = line.match(SECTION);
    if (section) {
      inHeader = false;
      sections.push({ index: sections.length, name: section[1], ...shortSectionName(section[1]) });
      continue;
    }

    const turn = line.match(TURN);
    if (turn) {
      inHeader = false;
      // The text sits as one paragraph below the header line, separated by a
      // blank line. Everything up to the next blank line belongs to it.
      const parts = [];
      let j = i + 1;
      while (j < lines.length && !beginsSomethingElse(lines[j])) {
        if (lines[j].trim()) parts.push(lines[j].trim());
        j++;
      }
      const speaker = turn[2];
      const number = Number(turn[1]);
      // The turn number is what a coding holds on to. Two turns carrying the
      // same one make every citation on it ambiguous — the anchor check would
      // measure against whichever came last — so it is said out loud.
      if (turns.some((one) => one.number === number)) {
        problems.push({ key: "transcriptDuplicateTurn", params: { turn: number, line: i + 1 } });
      }
      turns.push({
        number,
        speaker,
        interviewer: speaker === INTERVIEWER,
        time: turn[3],
        section: sections.length ? sections.length - 1 : null,
        text: parts.join(" "),
      });
      i = j - 1;
      continue;
    }

    if (TURN_SHAPED.test(line)) {
      problems.push({ key: "transcriptUnreadTurn", params: { line: i + 1, text: line.trim() } });
    }
  }

  const department = title && title.includes(":")
    ? title.slice(title.indexOf(":") + 1).trim()
    : (turns.find((t) => !t.interviewer)?.speaker ?? "unknown");

  // A file that yielded nothing at all is worth saying so about: it is either
  // not a transcript or not in this format, and an empty screen says neither.
  if (!turns.length) problems.push({ key: "transcriptNoTurns", params: {} });

  return {
    id,
    title: title ?? id,
    department,
    meta,
    sections,
    turns,
    problems,
    characters: turns.reduce((n, t) => n + (t.interviewer ? 0 : t.text.length), 0),
  };
}

/** The named problems put into the language of whoever asked. */
export function withProblemText(problems, t) {
  return problems.map(({ key, params }) => ({ key, text: t(key, params) }));
}

/** Every interview directory that holds a released final transcript. */
export async function findInterviews(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const file = join(root, entry.name, "final.md");
    try {
      await stat(file);
    } catch {
      continue;
    }
    found.push({ id: entry.name, file });
  }
  return found;
}

export async function loadTranscript(root, id) {
  const text = await readFile(join(root, id, "final.md"), "utf8");
  return parseTranscript(text, id);
}
