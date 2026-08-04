/**
 * Turning a recording's transcript into one this tool can read.
 *
 * The transcript format is a small Markdown convention and the README explains
 * it in twenty lines — but nobody's transcript arrives in it. What people have
 * is what came out of the recording: a WebVTT file from Teams or Zoom, an SRT
 * from a subtitle tool, a Whisper output, or a plain text file where each line
 * begins with a name. Between that and a first coding stood an hour of manual
 * reformatting, which is a strange thing to ask before anyone has seen whether
 * the tool is any use to them.
 *
 * ## What has to happen, and why it is not just a rename
 *
 * A subtitle file is cut for reading along, not for reading. Teams emits a cue
 * every few seconds, so one interview is several hundred cues and a third of
 * them end mid-sentence. One turn per cue would produce a transcript nobody can
 * code: the coding unit would be shorter than the thought. So consecutive cues
 * by the same speaker are joined into one turn, and the timestamp kept is the
 * one the speaker began at — which is what a citation should point to.
 *
 * ## What is not decided here
 *
 * Which speaker is the interviewer. It cannot be guessed reliably — the first
 * voice is usually the interviewer and sometimes is not — and getting it wrong
 * is not cosmetic: the interviewer's turns cannot be coded at all, so a wrong
 * guess silently removes half the material or offers up questions as findings.
 * The caller says who it is, and the conversion reports every speaker it found
 * so that the caller can be asked.
 *
 * Nor the guide sections. They are the structure of the interview guide, not of
 * the recording, and no file carries them. A converted transcript has none;
 * they can be written in afterwards as `## Section: …` lines, and everything
 * works without them.
 */

/** `MM:SS`, which is what the transcript format uses. */
export function clock(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Seconds out of `HH:MM:SS.mmm`, `MM:SS,mmm` or `MM:SS`. */
export function seconds(stamp) {
  const parts = stamp.trim().replace(",", ".").split(":").map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

const VTT_TIME = /^\s*((?:\d+:)?\d+:\d+[.,]\d+)\s*-->\s*((?:\d+:)?\d+:\d+[.,]\d+)/;
const SRT_TIME = /^\s*((?:\d+:)?\d+:\d+[.,]\d+)\s*-->\s*((?:\d+:)?\d+:\d+[.,]\d+)/;
/** Teams and Zoom name the speaker in a voice tag; some tools prefix the text. */
const VOICE = /^<v\s+([^>]+)>\s*(.*?)(?:<\/v>)?\s*$/;
const SPEAKER_LINE = /^\s*(?:\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*)?([^:<>[\]]{1,60}?)\s*:\s*(.+)$/;
const TAGS = /<[^>]*>/g;

/**
 * Whisper and the tools around it put the whole cue on one line, in brackets,
 * with no blank line between cues — which the block reader below sees as one
 * enormous block with a single timing and throws away.
 */
const BRACKET_CUE =
  /^\s*[[(]?\s*((?:\d+:)?\d+:\d+[.,]\d+)\s*-->\s*(?:\d+:)?\d+:\d+[.,]\d+\s*[\])]?\s*(.*)$/;

/** Which of the shapes this file is, decided on its content rather than its name. */
export function detect(text) {
  const head = text.slice(0, 4000);
  const lines = head.split(/\r?\n/).filter((line) => line.trim());
  // One timed line per cue, text on the same line: checked first, because such
  // a file also contains "-->" and would otherwise be read as a subtitle file
  // and come out empty.
  const bracketed = lines.filter((line) => BRACKET_CUE.test(line) && BRACKET_CUE.exec(line)[2]);
  if (lines.length && bracketed.length >= Math.max(2, lines.length * 0.6)) return "timed-lines";
  if (/^﻿?WEBVTT/.test(head)) return "vtt";
  // An SRT cue is a number on its own line above the timing.
  if (/(^|\n)\s*\d+\s*\r?\n\s*(?:\d+:)?\d+:\d+[.,]\d+\s*-->/.test(head)) return "srt";
  if (SRT_TIME.test(head) || /-->/.test(head)) return "vtt";
  return "speakers";
}

/**
 * Cues out of a WebVTT or SRT file.
 *
 * Both are the same file with different punctuation once the header and the
 * cue numbers are dropped, so they are read by one reader rather than two that
 * drift apart.
 */
function cues(text) {
  const found = [];
  const blocks = text
    .replace(/\r\n?/g, "\n")
    .replace(/^﻿/, "")
    .split(/\n{2,}/);

  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.trim());
    if (!lines.length) continue;
    const at = lines.findIndex((line) => VTT_TIME.test(line));
    if (at < 0) continue;
    const time = lines[at].match(VTT_TIME);
    // A line above the timing is a cue number or an identifier, never text.
    const body = lines.slice(at + 1);
    if (!body.length) continue;

    let speaker = null;
    const parts = [];
    for (const line of body) {
      const voice = line.match(VOICE);
      if (voice) {
        speaker = speaker ?? voice[1].trim();
        parts.push(voice[2]);
        continue;
      }
      parts.push(line);
    }
    let said = parts.join(" ").replace(TAGS, "").trim();
    if (!speaker) {
      // Whisper and several exporters write the name into the text instead.
      const named = said.match(SPEAKER_LINE);
      if (named) {
        speaker = named[2].trim();
        said = named[3].trim();
      }
    }
    if (!said) continue;
    found.push({ at: seconds(time[1]) ?? 0, speaker, text: said });
  }
  return found;
}

/** Cues out of a file with one timed line per cue. */
function timedLines(text) {
  const found = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const cue = line.match(BRACKET_CUE);
    if (!cue || !cue[2].trim()) continue;
    let speaker = null;
    let said = cue[2].trim();
    // Diarizing tools put the speaker in front of the text; plain Whisper has
    // none, and then every line belongs to whoever spoke before.
    const named = said.match(SPEAKER_LINE);
    if (named) {
      speaker = named[2].trim();
      said = named[3].trim();
    }
    found.push({ at: seconds(cue[1]) ?? 0, speaker, text: said });
  }
  return found;
}

/** Cues out of a plain file whose lines begin with a name. */
function speakerLines(text) {
  const found = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (!line.trim()) continue;
    const named = line.match(SPEAKER_LINE);
    if (named) {
      found.push({
        at: named[1] ? (seconds(named[1]) ?? 0) : null,
        speaker: named[2].trim(),
        text: named[3].trim(),
      });
      continue;
    }
    // A line without a name continues the one above it — a paragraph broken
    // across lines, which is what a text file usually is.
    if (found.length) found[found.length - 1].text += ` ${line.trim()}`;
  }
  return found;
}

/** Join what one person said in a row, so a turn is a thought and not a cue. */
function intoTurns(all) {
  const turns = [];
  for (const cue of all) {
    const last = turns[turns.length - 1];
    /* A cue without a name belongs to whoever was speaking; a subtitle file
       only repeats the name when it changes. */
    const speaker = cue.speaker ?? last?.speaker ?? null;
    if (last && last.speaker === speaker) {
      last.text = `${last.text} ${cue.text}`.replace(/\s+/g, " ").trim();
      continue;
    }
    turns.push({ speaker, at: cue.at, text: cue.text.replace(/\s+/g, " ").trim() });
  }
  return turns;
}

/**
 * Read a transcript file into turns, whatever shape it arrived in.
 *
 * Returns the turns, the speakers found and how the file was read, so that a
 * caller can put the question of who the interviewer is to whoever knows.
 */
export function readTranscript(text, format = null) {
  const shape = format ?? detect(text);
  const readers = { speakers: speakerLines, "timed-lines": timedLines };
  const all = (readers[shape] ?? cues)(text);
  const turns = intoTurns(all).filter((turn) => turn.text);
  const speakers = [...new Set(turns.map((turn) => turn.speaker).filter(Boolean))];
  return { format: shape, turns, speakers };
}

const INTERVIEWER = "Interviewer";

/** A folder name out of a title: lower case, no spaces, nothing surprising. */
export function folderName(title) {
  const slug = String(title)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "interview";
}

/**
 * The Markdown the tool reads, out of turns.
 *
 * `interviewer` is the speaker name to rename — everything else keeps the name
 * it arrived with, because that name becomes the department in the analysis and
 * only the author knows what it should say.
 *
 * A turn with no name at all becomes the respondent, not the interviewer. A
 * file without speaker separation — plain Whisper output, say — would otherwise
 * come out as an interview in which only the interviewer speaks, and not one
 * word of it could be coded. The command line refuses such a file before it
 * gets here; whoever reaches this by another road gets material rather than
 * silence.
 *
 * Timestamps are required by the format. A file that carries none — a plain
 * text export often does — gets none invented: the position in the interview is
 * used instead, which is honest about being an index rather than a clock, and
 * keeps citations pointing somewhere findable.
 */
export function toMarkdown({
  title,
  turns,
  interviewer = null,
  respondent = "Respondent",
  note = null,
  meta = {},
}) {
  const lines = [`# ${title}`, ""];
  if (note) lines.push(note, "");
  const entries = Object.entries(meta).filter(([, value]) => value);
  if (entries.length) {
    for (const [key, value] of entries) lines.push(`- ${key}: ${value}`);
    lines.push("");
  }
  lines.push("---", "");

  const timed = turns.some((turn) => turn.at != null);
  turns.forEach((turn, index) => {
    /* `interviewer` has to be a name before it can match one. Without it, an
       unnamed turn equalled an unnamed interviewer and the whole transcript
       came out as the questions. */
    const speaker =
      interviewer && turn.speaker === interviewer ? INTERVIEWER : (turn.speaker ?? respondent);
    const stamp = timed ? clock(turn.at ?? 0) : clock(index * 30);
    lines.push(`**${index + 1} · ${speaker} [${stamp}]**`, "", turn.text, "");
  });
  return `${lines.join("\n").trimEnd()}\n`;
}

/**
 * A whole conversion, from the file's text to the file's text.
 *
 * `department` is what the respondent's turns are attributed to in the
 * analysis; without one, the speaker's own name is kept.
 */
export function convert(
  text,
  {
    title,
    department = null,
    interviewer = null,
    respondent = "Respondent",
    format = null,
    note = null,
    meta = {},
  } = {},
) {
  const { turns, speakers, format: shape } = readTranscript(text, format);
  const named = department
    ? turns.map((turn) =>
        !interviewer || turn.speaker !== interviewer ? { ...turn, speaker: department } : turn,
      )
    : turns;
  const heading = title ?? (department ? `Interview: ${department}` : "Interview");
  return {
    format: shape,
    speakers,
    turns: named,
    folder: folderName(heading),
    markdown: toMarkdown({ title: heading, turns: named, interviewer, respondent, note, meta }),
  };
}
