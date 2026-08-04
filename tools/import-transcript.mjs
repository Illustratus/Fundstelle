/**
 * Bring a recording's transcript into the shape the tool reads.
 *
 * The format is a small Markdown convention, but nobody's transcript arrives in
 * it: what people have is a WebVTT from Teams or Zoom, an SRT, a Whisper
 * output, or a text file whose lines begin with a name. An hour of reformatting
 * before the first coding is a strange thing to ask of somebody who has not yet
 * seen whether the tool is any use to them.
 *
 *   node tools/import-transcript.mjs recording.vtt
 *
 * Run without `--interviewer` it reads the file, says which speakers are in it
 * and stops. That is deliberate: which of them is the interviewer cannot be
 * guessed reliably, and getting it wrong is not cosmetic — the interviewer's
 * turns cannot be coded at all, so a wrong guess either removes half the
 * material or offers up the questions as findings.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { convert, folderName, readTranscript } from "../lib/import.js";
import { negotiate, translator } from "../lib/texts.js";

const language = negotiate(
  process.argv.includes("--lang") ? process.argv[process.argv.indexOf("--lang") + 1] : null,
  process.env.LC_ALL ?? process.env.LC_MESSAGES ?? process.env.LANG ?? "",
);
const t = translator(language);

function options(argv) {
  const found = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      found._.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (name === "dry" || name === "help") {
      found[name] = true;
      continue;
    }
    found[name] = argv[++i];
  }
  return found;
}

const argv = options(process.argv.slice(2));

if (argv.help || !argv._.length) {
  console.log(t("importUsage"));
  process.exit(argv.help ? 0 : 1);
}

const source = resolve(argv._[0]);
if (!existsSync(source)) {
  console.error(t("importNoFile", { file: source }));
  process.exit(1);
}
const text = readFileSync(source, "utf8");

const read = readTranscript(text, argv.format ?? null);
if (!read.turns.length) {
  console.error(t("importNothingRead", { file: source }));
  process.exit(1);
}

console.log(t("importRead", { format: read.format, turns: read.turns.length }));
if (read.speakers.length) {
  console.log(t("importSpeakers", { speakers: read.speakers.join(", ") }));
} else {
  console.log(t("importNoSpeakers"));
}

if (!argv.interviewer) {
  // Nothing is written until somebody has said who was asking. A guess here is
  // not a convenience, it is a silent decision about what counts as material.
  console.log("");
  console.log(t("importWhoAsks", { first: read.speakers[0] ?? "…" }));
  process.exit(read.speakers.length ? 0 : 1);
}

const department = argv.department ?? null;
const title = argv.title ?? (department ? `Interview: ${department}` : "Interview");
const result = convert(text, {
  title,
  department,
  interviewer: argv.interviewer,
  respondent: t("importRespondent"),
  format: argv.format ?? null,
  note: argv.note ?? null,
  meta: argv.date ? { [t("metaSurvey")]: argv.date } : {},
});

const root = resolve(
  argv.into ?? process.env.TRANSCRIPTS ?? process.env.TRANSKRIPTE ?? join("data", "transcripts"),
);
const folder = folderName(argv.folder ?? result.folder);
const target = join(root, folder, "final.md");

if (argv.dry) {
  console.log("");
  console.log(t("importWouldWrite", { file: target }));
  console.log("");
  console.log(result.markdown);
  process.exit(0);
}

// Never over a transcript that is already there: a coding holds on to the turn
// numbers in it, so an overwrite would move every citation in that interview.
if (existsSync(target)) {
  console.error(t("importExists", { file: target }));
  process.exit(1);
}

mkdirSync(join(root, folder), { recursive: true });
writeFileSync(target, result.markdown, "utf8");
console.log("");
console.log(t("importWrote", { file: target, turns: result.turns.length }));
console.log(t("importNextSection"));
