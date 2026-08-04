import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { clock, convert, detect, folderName, readTranscript, seconds } from "../lib/import.js";
import { parseTranscript } from "../lib/transcript.js";

/**
 * Getting a real transcript in.
 *
 * The format this tool reads is a small Markdown convention, and nobody's
 * transcript arrives in it. What people have is what the recording produced: a
 * WebVTT from Teams or Zoom, an SRT, a Whisper output, a text file whose lines
 * begin with a name. Between that and a first coding stood an hour of manual
 * reformatting — asked of someone who has not yet seen whether the tool is any
 * use to them.
 *
 * The check that matters most is the round trip: whatever comes out of the
 * conversion is fed to the tool's own parser, and it has to read it with no
 * problems reported. A converter whose output the tool cannot read is worse
 * than none, because the failure surfaces one screen later.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const TEAMS = `WEBVTT

0f2a1c-1
00:00:03.120 --> 00:00:06.480
<v Anna Berger>Vielen Dank, dass du dir die Zeit</v>

0f2a1c-2
00:00:06.480 --> 00:00:09.000
<v Anna Berger>nimmst. Erzähl doch kurz, was du machst.</v>

0f2a1c-3
00:00:09.500 --> 00:00:14.200
<v Jonas Klein>Ich betreue die Kampagnen und kümmere mich</v>

0f2a1c-4
00:00:14.200 --> 00:00:18.900
<v Jonas Klein>um die Inhalte auf der Webseite.</v>
`;

const SRT = `1
00:00:03,120 --> 00:00:06,480
Anna Berger: Vielen Dank, dass du dir die Zeit

2
00:00:06,480 --> 00:00:09,000
nimmst. Erzähl doch kurz, was du machst.

3
00:00:09,500 --> 00:00:14,200
Jonas Klein: Ich betreue die Kampagnen.
`;

const PLAIN = `Anna Berger: Vielen Dank, dass du dir die Zeit nimmst.
Erzähl doch kurz, was du machst.
Jonas Klein: Ich betreue die Kampagnen und kümmere mich
um die Inhalte auf der Webseite.
Anna Berger: Und was stört dabei am meisten?
`;

test("the shape of a file is decided on its content, not its name", () => {
  expect(detect(TEAMS)).toBe("vtt");
  expect(detect(SRT)).toBe("srt");
  expect(detect(PLAIN)).toBe("speakers");
});

test("a subtitle file becomes turns rather than cues", () => {
  /* Teams emits a cue every few seconds, so an interview is several hundred of
     them and a third end mid-sentence. One turn per cue would make the coding
     unit shorter than the thought. */
  const { turns, speakers } = readTranscript(TEAMS);
  expect(turns).toHaveLength(2);
  expect(speakers).toEqual(["Anna Berger", "Jonas Klein"]);
  // The sentence cut across two cues is whole again.
  expect(turns[0].text).toBe("Vielen Dank, dass du dir die Zeit nimmst. Erzähl doch kurz, was du machst.");
  // And the timestamp is the one the speaker began at, which is where a
  // citation should point.
  expect(turns[0].at).toBeCloseTo(3.12, 2);
  expect(turns[1].at).toBeCloseTo(9.5, 2);
});

test("a cue without a name belongs to whoever was speaking", () => {
  // A subtitle file only repeats the name when it changes.
  const { turns } = readTranscript(SRT);
  expect(turns).toHaveLength(2);
  expect(turns[0].speaker).toBe("Anna Berger");
  expect(turns[0].text).toContain("Erzähl doch kurz");
});

test("a plain text file is read by its names, and wrapped lines are joined", () => {
  const { turns, speakers } = readTranscript(PLAIN);
  expect(speakers).toEqual(["Anna Berger", "Jonas Klein"]);
  expect(turns).toHaveLength(3);
  expect(turns[1].text).toBe(
    "Ich betreue die Kampagnen und kümmere mich um die Inhalte auf der Webseite.",
  );
});

test("what comes out is what the tool reads", () => {
  /* The check that matters. A converter whose output the tool cannot read is
     worse than none: the failure would surface one screen later, on an
     interview that looks empty. */
  const { markdown } = convert(TEAMS, {
    title: "Interview 1: Marketing",
    department: "Marketing",
    interviewer: "Anna Berger",
  });
  const parsed = parseTranscript(markdown, "interview-01");

  expect(parsed.problems).toEqual([]);
  expect(parsed.turns).toHaveLength(2);
  expect(parsed.title).toBe("Interview 1: Marketing");
  // The department comes out of the title, and the answers are attributed to it.
  expect(parsed.department).toBe("Marketing");
  expect(parsed.turns[0].interviewer).toBe(true);
  expect(parsed.turns[1].interviewer).toBe(false);
  expect(parsed.turns[1].speaker).toBe("Marketing");
  // Turn numbers run from one without a gap; a coding holds on to them.
  expect(parsed.turns.map((turn) => turn.number)).toEqual([1, 2]);
});

test("every shape survives the round trip", () => {
  for (const [name, text] of [["vtt", TEAMS], ["srt", SRT], ["plain", PLAIN]]) {
    const { markdown } = convert(text, {
      title: "Interview 2: Vertrieb",
      department: "Vertrieb",
      interviewer: "Anna Berger",
    });
    const parsed = parseTranscript(markdown, "x");
    expect(parsed.problems, `${name} reads without problems`).toEqual([]);
    expect(parsed.turns.length, `${name} keeps its turns`).toBeGreaterThan(1);
    expect(parsed.department, `${name} knows its department`).toBe("Vertrieb");
  }
});

test("a file without timestamps gets an index, not an invented clock", () => {
  const noTime = "Anna: Erste Frage.\nJonas: Erste Antwort.\nAnna: Zweite Frage.";
  const { markdown } = convert(noTime, { title: "Interview", interviewer: "Anna" });
  // The format requires a stamp. Making one up that looks like a clock would
  // be a claim about the recording; a position is honest about being one.
  expect(markdown).toContain("[0:00]");
  expect(markdown).toContain("[0:30]");
  expect(parseTranscript(markdown, "x").problems).toEqual([]);
});

test("timestamps are read and written in the format's own clock", () => {
  expect(seconds("00:01:05.500")).toBeCloseTo(65.5, 3);
  expect(seconds("01:05,250")).toBeCloseTo(65.25, 3);
  expect(clock(65.9)).toBe("1:05");
  expect(clock(3605)).toBe("60:05");
  expect(clock(-1)).toBe("0:00");
});

test("a folder name is made of what a file system likes", () => {
  expect(folderName("Interview 3: Führung & Ablage")).toBe("interview-3-fuhrung-ablage");
  expect(folderName("Größe")).toBe("grosse");
  expect(folderName("···")).toBe("interview");
});

/* And the command line around it, which is what anyone will actually run. */

const run = (args, cwd) =>
  execFileSync(process.execPath, [join(ROOT, "tools", "import-transcript.mjs"), ...args], {
    cwd: cwd ?? ROOT,
    encoding: "utf8",
    env: { ...process.env, LANG: "de_DE.UTF-8" },
  });

const scratch = () => mkdtempSync(join(tmpdir(), "fundstelle-import-"));

test("without being told who asks, nothing is written", () => {
  /* Which speaker is the interviewer is not a detail that can be guessed. The
     interviewer's turns cannot be coded at all, so a wrong guess either takes
     half the material out or offers the questions up as findings. */
  const work = scratch();
  const file = join(work, "recording.vtt");
  writeFileSync(file, TEAMS);

  const out = run([file, "--into", join(work, "transcripts")]);
  expect(out).toContain("Anna Berger, Jonas Klein");
  expect(out).toContain("Wer von ihnen fragt");
  expect(existsSync(join(work, "transcripts"))).toBe(false);
});

test("told who asks, it writes a transcript the tool can read", () => {
  const work = scratch();
  const file = join(work, "recording.vtt");
  writeFileSync(file, TEAMS);
  const into = join(work, "transcripts");

  const out = run([
    file,
    "--into", into,
    "--interviewer", "Anna Berger",
    "--department", "Marketing",
    "--title", "Interview 1: Marketing",
    "--date", "28. Juli 2026",
  ]);
  expect(out).toContain("2 Beiträge");

  const written = join(into, "interview-1-marketing", "final.md");
  expect(existsSync(written)).toBe(true);
  const parsed = parseTranscript(readFileSync(written, "utf8"), "interview-1-marketing");
  expect(parsed.problems).toEqual([]);
  expect(parsed.department).toBe("Marketing");
  expect(parsed.meta.Erhebung).toBe("28. Juli 2026");
});

test("it never writes over a transcript that is already there", () => {
  /* Codings hold on to the turn numbers in that file. Overwriting it would move
     every citation in the interview without a word. */
  const work = scratch();
  const file = join(work, "recording.vtt");
  writeFileSync(file, TEAMS);
  const into = join(work, "transcripts");
  mkdirSync(join(into, "interview-1-marketing"), { recursive: true });
  writeFileSync(join(into, "interview-1-marketing", "final.md"), "# Nicht anfassen\n");

  let failed = null;
  try {
    run([file, "--into", into, "--interviewer", "Anna Berger", "--title", "Interview 1: Marketing"]);
  } catch (error) {
    failed = error;
  }
  expect(failed, "the run should fail").toBeTruthy();
  expect(failed.stderr).toContain("gibt es schon");
  expect(readFileSync(join(into, "interview-1-marketing", "final.md"), "utf8")).toBe(
    "# Nicht anfassen\n",
  );
});

test("a file it cannot read says what was expected", () => {
  const work = scratch();
  const file = join(work, "nothing.txt");
  writeFileSync(file, "\n\n   \n");
  let failed = null;
  try {
    run([file, "--into", join(work, "transcripts")]);
  } catch (error) {
    failed = error;
  }
  expect(failed).toBeTruthy();
  expect(failed.stderr).toContain("WebVTT");
});

test("the command line speaks the language it was asked in", () => {
  const out = execFileSync(
    process.execPath,
    [join(ROOT, "tools", "import-transcript.mjs"), "--help", "--lang", "en"],
    { encoding: "utf8" },
  );
  expect(out).toContain("Who is asking");
  expect(out).not.toContain("Wer fragt");
});

const WHISPER = `[00:00:03.120 --> 00:00:06.480]  Vielen Dank, dass du dir die Zeit
[00:00:06.480 --> 00:00:09.000]  nimmst. Erzähl doch kurz, was du machst.
[00:00:09.500 --> 00:00:14.200]  Ich betreue die Kampagnen.
`;

const ZOOM = `WEBVTT

1
00:00:03.120 --> 00:00:06.480
Anna Berger: Vielen Dank, dass du dir die Zeit

2
00:00:06.480 --> 00:00:09.000
Anna Berger: nimmst. Erzähl doch kurz.

3
00:00:09.500 --> 00:00:14.200
Jonas Klein: Ich betreue die Kampagnen.
`;

test("Zoom names the speaker inside the cue, and that is read too", () => {
  // Teams uses a voice tag, Zoom puts the name in the text. Both are common
  // enough that supporting only one would send half the users away.
  const { turns, speakers } = readTranscript(ZOOM);
  expect(speakers).toEqual(["Anna Berger", "Jonas Klein"]);
  expect(turns).toHaveLength(2);
});

test("one timed line per cue is read rather than thrown away", () => {
  /* Whisper and the tools around it put the whole cue on one line, in brackets,
     with no blank line between cues. Read as a subtitle file that is one
     enormous block with a single timing, and it came out empty — the shape most
     people's transcripts arrive in today, silently producing nothing. */
  expect(detect(WHISPER)).toBe("timed-lines");
  const { turns } = readTranscript(WHISPER);
  expect(turns).toHaveLength(1);
  expect(turns[0].text).toContain("Erzähl doch kurz");
  expect(turns[0].at).toBeCloseTo(3.12, 2);
});

test("a file with no names at all becomes material, not questions", () => {
  /* An unnamed turn used to come out as the interviewer's. A transcript without
     speaker separation then became an interview in which only the interviewer
     speaks and not one word could be coded — the worst possible reading of a
     file that simply carries no names. */
  const { markdown } = convert(WHISPER, { title: "Interview", respondent: "Befragte" });
  const parsed = parseTranscript(markdown, "x");
  expect(parsed.problems).toEqual([]);
  expect(parsed.turns.every((turn) => !turn.interviewer)).toBe(true);
  expect(parsed.turns[0].speaker).toBe("Befragte");
});

test("the command line refuses a file that names nobody", () => {
  // Which is the honest answer: the method needs to know who was asking.
  const work = scratch();
  const file = join(work, "whisper.txt");
  writeFileSync(file, WHISPER);
  let failed = null;
  try {
    run([file, "--into", join(work, "transcripts")]);
  } catch (error) {
    failed = error;
  }
  expect(failed, "the run should stop").toBeTruthy();
  expect(failed.stdout).toContain("nennt keine Sprechenden");
  expect(existsSync(join(work, "transcripts"))).toBe(false);
});
