/**
 * A recording and a log that disagree by twenty seconds, for the checks of the
 * section review at import (import-sections*.spec.js). All of it synthetic.
 */

export const BLOCKS = [
  { id: "warmfrage", name: "Warmfrage", prompt: "", checklist: [], mandatory: [] },
  { id: "1-ablage", name: "1 · Ablage (Wissen festhalten)", prompt: "", checklist: [], mandatory: [] },
  { id: "5-systeme", name: "5 · Systemlandschaft", prompt: "", checklist: [], mandatory: [] },
];

/* The recording: questions at 2, 30 and 90 seconds of its own clock. */
export const VTT = `WEBVTT

00:00:02.000 --> 00:00:05.000
<v Anna Berger>Wie geht es Ihnen heute?</v>

00:00:06.000 --> 00:00:20.000
<v Jonas Klein>Gut, danke der Nachfrage.</v>

00:00:30.000 --> 00:00:40.000
<v Anna Berger>Erzählen Sie, wie Sie zuletzt etwas abgelegt haben.</v>

00:00:41.000 --> 00:01:20.000
<v Jonas Klein>Ich habe das Angebot abgelegt, ohne Extrazeit.</v>

00:01:30.000 --> 00:01:36.000
<v Anna Berger>Welche Systeme durchsuchen Sie noch von Hand?</v>

00:01:37.000 --> 00:01:50.000
<v Jonas Klein>Nur noch das Postfach.</v>
`;

/* The log ran 20 seconds ahead of the recording: each block was pressed as its
   question was asked, which the log holds as 20 seconds later. */
export const T0 = "2026-10-14T09:00:00.000Z";
export const LATE = [
  ["warmfrage", 22],
  ["1-ablage", 50],
  ["5-systeme", 110],
];

/** A log in `folder` of the evaluation round, with the given block starts. */
export async function openLog(study, folder, starts, { t0 = T0, department = "Vertrieb" } = {}) {
  await study.post("/api/sessions", { department, round: "evaluation", folder });
  if (t0) await study.patch(`/api/sessions/${folder}`, { op: "start", t0 });
  for (const [block, at] of starts) {
    await study.patch(`/api/sessions/${folder}`, { op: "block", block, at });
  }
}
