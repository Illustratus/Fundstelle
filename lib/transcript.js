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

import { fail } from "./texts.js";

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

/**
 * The header of a transcript, written back.
 *
 * Everything a transcript says about itself — its title, the department it is
 * attributed to, the lines that describe who was asked and when — was readable
 * and not writable: the format has parsed those lines from the first version,
 * the sample table of the paper is built from them, and correcting a typo in
 * one meant leaving the tool and opening the file. The material below is not
 * touched, and that is the point of doing it here rather than by rewriting the
 * file from parsed turns: a citation holds by turn number and character range,
 * so the one thing that must not move is the text.
 *
 * The department is not a line of its own in the format — it is read off the
 * title behind the colon, and off the speaker when the title carries none. So
 * setting it writes the title, and the speakers keep the names they were
 * pseudonymized under.
 */
export function rewriteHeader(text, { title, department, meta } = {}) {
  const lines = text.split("\n");
  // The header is what stands before the material: the first guide section or
  // speaker turn ends it. A rule or a note in between belongs to it.
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (SECTION.test(lines[i]) || TURN.test(lines[i])) {
      end = i;
      break;
    }
  }
  const header = lines.slice(0, end);
  const body = lines.slice(end);

  const titleAt = header.findIndex((line) => TITLE.test(line));
  let heading = titleAt >= 0 ? header[titleAt].match(TITLE)[1] : null;
  if (title !== undefined) heading = String(title).trim();
  if (department !== undefined) {
    const name = String(department).trim();
    const base = (heading ?? "Interview").split(":")[0].trim();
    heading = name ? `${base}: ${name}` : base;
  }
  if (heading !== null && heading !== undefined) {
    if (titleAt >= 0) header[titleAt] = `# ${heading}`;
    else header.unshift(`# ${heading}`, "");
  }

  if (meta !== undefined) {
    const entries = Object.entries(meta)
      .map(([key, value]) => [String(key).trim(), String(value ?? "").trim()])
      // A key with a colon in it would be read back as a shorter key with the
      // rest of it in the value, so it is not written at all.
      .filter(([key, value]) => key && value && !key.includes(":"));
    const written = entries.map(([key, value]) => `- ${key}: ${value}`);
    const first = header.findIndex((line) => META.test(line));
    const kept = header.filter((line) => !META.test(line));
    if (first >= 0) {
      // In place, where the block already stood: a header is read top to bottom
      // and the description of an interview belongs where its author put it.
      const before = header.slice(0, first).filter((line) => !META.test(line)).length;
      kept.splice(before, 0, ...written);
    } else if (written.length) {
      // No block yet: after the title and the blank line under it, which is
      // where the tool's own conversion writes one.
      const at = kept.findIndex((line) => /^(?:---|\*\*\*|___)\s*$/.test(line));
      kept.splice(at >= 0 ? at : kept.length, 0, ...written, "");
    }
    header.length = 0;
    header.push(...kept);
  }

  return `${[...header, ...body].join("\n").trimEnd()}\n`;
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

/**
 * An interview identifier is the name of one folder, and nothing else.
 *
 * It arrives from a URL, and a URL can say `..%2f..%2fetc`. Every path in this
 * tool is built by joining that name onto a root, so without this the name
 * decides where the root is: reading resolved two levels above the transcript
 * folder, and writing would have put a coding file wherever the caller liked.
 * The tool binds to 127.0.0.1, which makes that a smaller thing than it looks,
 * and no smaller than it is.
 *
 * The rule is the narrow one on purpose: one segment, no separators, no
 * traversal, nothing that means something to a filesystem. Folders are created
 * by the tool itself from a slug, so nothing legitimate is turned away.
 */
export function safeInterviewId(id) {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    id.length <= 200 &&
    !id.includes("/") &&
    !id.includes("\\") &&
    !id.includes("\0") &&
    id !== "." &&
    id !== ".." &&
    // A leading dot hides the folder, and a leading dash reads as a flag to
    // whatever command somebody later points at these files.
    !id.startsWith(".") &&
    !id.startsWith("-")
  );
}

export async function loadTranscript(root, id) {
  if (!safeInterviewId(id)) throw Object.assign(fail("errorUnknownInterview"), { status: 404 });
  const text = await readFile(join(root, id, "final.md"), "utf8");
  return parseTranscript(text, id);
}
