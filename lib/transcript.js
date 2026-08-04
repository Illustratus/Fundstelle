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

export function parseTranscript(text, id) {
  const lines = text.split("\n");
  const meta = {};
  let title = null;
  const sections = [];
  const turns = [];
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
      while (j < lines.length && lines[j].trim() === "") j++;
      while (j < lines.length && lines[j].trim() !== "") {
        parts.push(lines[j].trim());
        j++;
      }
      const speaker = turn[2];
      turns.push({
        number: Number(turn[1]),
        speaker,
        interviewer: speaker === INTERVIEWER,
        time: turn[3],
        section: sections.length ? sections.length - 1 : null,
        text: parts.join(" "),
      });
      i = j - 1;
    }
  }

  const department = title && title.includes(":")
    ? title.slice(title.indexOf(":") + 1).trim()
    : (turns.find((t) => !t.interviewer)?.speaker ?? "unknown");

  return {
    id,
    title: title ?? id,
    department,
    meta,
    sections,
    turns,
    characters: turns.reduce((n, t) => n + (t.interviewer ? 0 : t.text.length), 0),
  };
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
